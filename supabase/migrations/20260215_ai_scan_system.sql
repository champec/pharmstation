-- ============================================
-- AI Scan System — Image Capture & Processing
-- Created: 2026-02-15
-- ============================================

-- ============================================
-- 1. Augmentation Notes (global + org-level AI context)
-- ============================================

CREATE TABLE IF NOT EXISTS ps_ai_augmentation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES ps_organisations(id) ON DELETE CASCADE,  -- NULL = global
  scope TEXT NOT NULL CHECK (scope IN ('global', 'organisation')),
  category TEXT NOT NULL CHECK (category IN (
    'invoice_quirks', 'prescription_notes', 'supplier_patterns',
    'pharmacy_conventions', 'general'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ps_ai_augmentation ENABLE ROW LEVEL SECURITY;

-- Global augmentation notes are readable by everyone
CREATE POLICY "ps_ai_augmentation_select_global" ON ps_ai_augmentation
  FOR SELECT USING (scope = 'global');

-- Org-specific augmentation readable by org members
CREATE POLICY "ps_ai_augmentation_select_org" ON ps_ai_augmentation
  FOR SELECT USING (
    scope = 'organisation'
    AND organisation_id IN (SELECT ps_get_user_org_ids())
  );

-- Org-specific augmentation writable by org members
CREATE POLICY "ps_ai_augmentation_insert_org" ON ps_ai_augmentation
  FOR INSERT WITH CHECK (
    scope = 'organisation'
    AND organisation_id IN (SELECT ps_get_user_org_ids())
  );

CREATE POLICY "ps_ai_augmentation_update_org" ON ps_ai_augmentation
  FOR UPDATE USING (
    scope = 'organisation'
    AND organisation_id IN (SELECT ps_get_user_org_ids())
  );

CREATE INDEX IF NOT EXISTS idx_ai_augmentation_scope
  ON ps_ai_augmentation(scope, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_augmentation_org
  ON ps_ai_augmentation(organisation_id) WHERE organisation_id IS NOT NULL;

-- ============================================
-- 2. AI Scan Queue — uploaded images awaiting/completed processing
-- ============================================

CREATE TABLE IF NOT EXISTS ps_ai_scan_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES ps_user_profiles(id),
  image_path TEXT NOT NULL,
  image_url TEXT,
  document_type TEXT CHECK (document_type IN ('prescription', 'invoice', 'unknown')),
  overall_confidence INTEGER CHECK (overall_confidence BETWEEN 0 AND 3),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (
    'uploading', 'processing', 'ready', 'partially_approved',
    'fully_approved', 'rejected', 'error'
  )),
  raw_ai_response JSONB,
  ai_notes TEXT,
  model_used TEXT,
  error_message TEXT,
  -- Invoice fields
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  -- Prescription fields
  patient_name TEXT,
  patient_address TEXT,
  prescriber_name TEXT,
  prescriber_address TEXT,
  prescriber_registration TEXT,
  is_partial_supply BOOLEAN DEFAULT FALSE,
  handwritten_notes TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES ps_user_profiles(id)
);

ALTER TABLE ps_ai_scan_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_ai_scan_queue_select" ON ps_ai_scan_queue
  FOR SELECT USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "ps_ai_scan_queue_insert" ON ps_ai_scan_queue
  FOR INSERT WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "ps_ai_scan_queue_update" ON ps_ai_scan_queue
  FOR UPDATE USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "ps_ai_scan_queue_delete" ON ps_ai_scan_queue
  FOR DELETE USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE INDEX IF NOT EXISTS idx_ai_scan_queue_org_status
  ON ps_ai_scan_queue(organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_scan_queue_uploaded_by
  ON ps_ai_scan_queue(uploaded_by, created_at DESC);

-- ============================================
-- 3. AI Scan Items — individual drug entries extracted from a scan
-- ============================================

CREATE TABLE IF NOT EXISTS ps_ai_scan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES ps_ai_scan_queue(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  -- AI-extracted fields (raw)
  drug_name_raw TEXT,
  drug_class_raw TEXT,
  drug_form_raw TEXT,
  drug_strength_raw TEXT,
  quantity NUMERIC,
  -- Reconciled against cdr_drugs_unique
  matched_drug_id UUID REFERENCES cdr_drugs_unique(id),
  matched_drug_brand TEXT,
  matched_drug_form TEXT,
  matched_drug_strength TEXT,
  matched_drug_class TEXT,
  -- Confidence
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 3),
  confidence_notes TEXT,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'edited', 'rejected')),
  -- User edits
  edited_drug_id UUID REFERENCES cdr_drugs_unique(id),
  edited_quantity NUMERIC,
  -- After approval link to actual register entry
  entry_id UUID REFERENCES ps_register_entries(id),
  approved_by UUID REFERENCES ps_user_profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ps_ai_scan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_ai_scan_items_select" ON ps_ai_scan_items
  FOR SELECT USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "ps_ai_scan_items_insert" ON ps_ai_scan_items
  FOR INSERT WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "ps_ai_scan_items_update" ON ps_ai_scan_items
  FOR UPDATE USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE INDEX IF NOT EXISTS idx_ai_scan_items_scan
  ON ps_ai_scan_items(scan_id);
CREATE INDEX IF NOT EXISTS idx_ai_scan_items_org_status
  ON ps_ai_scan_items(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_scan_items_entry
  ON ps_ai_scan_items(entry_id) WHERE entry_id IS NOT NULL;

-- ============================================
-- 4. Storage bucket for scan images
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scan-images',
  'scan-images',
  false,
  10485760,  -- 10MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — org members can upload/read
CREATE POLICY "scan_images_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'scan-images');

CREATE POLICY "scan_images_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'scan-images');

CREATE POLICY "scan_images_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'scan-images');

-- ============================================
-- 5. Seed global augmentation notes
-- ============================================

INSERT INTO ps_ai_augmentation (scope, category, title, content, is_active)
VALUES
  ('global', 'invoice_quirks', 'Alliance Healthcare invoices',
   'Alliance Healthcare invoice numbers typically start with "ALH" followed by digits. Their invoices list drugs by brand name with pack sizes.',
   true),
  ('global', 'invoice_quirks', 'AAH Pharmaceuticals invoices',
   'AAH invoice numbers are usually 8-digit numbers. They list both generic and brand names on the same line.',
   true),
  ('global', 'prescription_notes', 'Partial supply conventions',
   'When a prescription is partially supplied, pharmacists typically write the quantity supplied, the date, and their initials on the back of the prescription. Look for "supplied X/Y" or "part supply" or just a number with a date.',
   true),
  ('global', 'prescription_notes', 'Brand endorsements',
   'When a controlled drug is prescribed generically (e.g. "morphine sulfate MR tablets 30mg"), the pharmacist writes the actual brand dispensed on the prescription (e.g. "MST" or "Zomorph"). Look for handwritten brand names near the prescribed drug.',
   true),
  ('global', 'pharmacy_conventions', 'CD quantity conventions',
   'Quantities for CDs are typically written in words and figures on prescriptions. For liquids, the quantity is in millilitres. For tablets/capsules, it is the number of units. For patches, it is the number of patches.',
   true),
  ('global', 'pharmacy_conventions', 'Schedule 2 CD identification',
   'Schedule 2 CDs include: morphine, oxycodone, fentanyl, methadone, amphetamine, methylphenidate, pethidine, diamorphine, cocaine, alfentanil, remifentanil, tapentadol, dexamfetamine, lisdexamfetamine. Nabilone is Schedule 2. Gabapentin and pregabalin are Schedule 3 (NOT Schedule 2).',
   true)
ON CONFLICT DO NOTHING;
