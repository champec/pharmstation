-- ============================================
-- PharmStation Schema Migration
-- Prefix: ps_ (to differentiate from legacy tables)
-- References existing: cdr_drugs_unique (957 CD drugs)
-- ============================================

-- ============================================
-- CORE TABLES
-- ============================================

CREATE TABLE ps_organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id),
  name TEXT NOT NULL,
  gphc_premises_number TEXT UNIQUE,
  address JSONB NOT NULL DEFAULT '{}',
  geolocation GEOGRAPHY(POINT, 4326),
  geo_radius_meters INTEGER DEFAULT 100,
  settings JSONB DEFAULT '{}',
  subscription_tier TEXT DEFAULT 'base' CHECK (subscription_tier IN ('base', 'professional', 'enterprise')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ps_user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT NOT NULL,
  email TEXT,
  gphc_number TEXT,
  phone TEXT,
  default_role TEXT DEFAULT 'dispenser' CHECK (default_role IN (
    'owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum'
  )),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ps_organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ps_user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'dispenser' CHECK (role IN (
    'owner', 'manager', 'pharmacist', 'technician', 'dispenser', 'locum'
  )),
  permissions JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'pending')),
  is_locum BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES ps_user_profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  UNIQUE(organisation_id, user_id)
);

CREATE TABLE ps_active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ps_user_profiles(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL,
  terminal_name TEXT,
  platform TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'desktop', 'mobile')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  geo_verified BOOLEAN DEFAULT FALSE,
  twofa_verified BOOLEAN DEFAULT FALSE
);

-- ============================================
-- REGISTER SYSTEM
-- ============================================

CREATE TABLE ps_register_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  register_type TEXT NOT NULL CHECK (register_type IN ('CD', 'RP', 'RETURNS', 'PRIVATE_CD', 'POM')),
  drug_id UUID REFERENCES cdr_drugs_unique(id),
  drug_name TEXT,
  drug_form TEXT,
  drug_strength TEXT,
  drug_class TEXT,
  current_balance NUMERIC DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  lock_version INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES ps_user_profiles(id),
  UNIQUE NULLS NOT DISTINCT (organisation_id, register_type, drug_id)
);

CREATE INDEX idx_ps_ledgers_org ON ps_register_ledgers(organisation_id);
CREATE INDEX idx_ps_ledgers_org_type ON ps_register_ledgers(organisation_id, register_type);
CREATE INDEX idx_ps_ledgers_drug ON ps_register_ledgers(drug_id) WHERE drug_id IS NOT NULL;

CREATE TABLE ps_register_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ps_register_ledgers(id),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id),
  entry_number INTEGER NOT NULL,
  register_type TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('normal', 'correction')),
  date_of_transaction DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_scan')),
  corrects_entry_id UUID REFERENCES ps_register_entries(id),
  correction_reason TEXT,
  scan_image_path TEXT,
  entered_by UUID NOT NULL REFERENCES ps_user_profiles(id),
  session_id UUID REFERENCES ps_active_sessions(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_entry_id UUID REFERENCES ps_register_entries(id),
  ledger_lock_version INTEGER NOT NULL,
  -- CD fields
  quantity_received NUMERIC CHECK (quantity_received >= 0),
  quantity_deducted NUMERIC CHECK (quantity_deducted >= 0),
  running_balance NUMERIC,
  previous_balance NUMERIC,
  transaction_type TEXT CHECK (transaction_type IN (
    'receipt', 'supply', 'return_to_supplier', 'patient_return',
    'disposal', 'correction', 'transfer_in', 'transfer_out'
  )),
  supplier_name TEXT,
  invoice_number TEXT,
  patient_name TEXT,
  patient_address TEXT,
  prescriber_name TEXT,
  prescriber_address TEXT,
  prescription_date DATE,
  prescription_image_path TEXT,
  witness_name TEXT,
  witness_role TEXT,
  authorised_by TEXT,
  -- RP fields
  pharmacist_name TEXT,
  gphc_number TEXT,
  rp_signed_in_at TIMESTAMPTZ,
  rp_signed_out_at TIMESTAMPTZ,
  -- Returns fields
  return_patient_name TEXT,
  return_drug_name TEXT,
  return_drug_form TEXT,
  return_drug_strength TEXT,
  return_quantity NUMERIC,
  return_reason TEXT,
  return_received_by TEXT,
  disposal_date DATE,
  disposal_witness TEXT,
  disposal_method TEXT,
  -- Constraints
  UNIQUE(ledger_id, entry_number),
  CHECK ((entry_type != 'correction') OR (corrects_entry_id IS NOT NULL AND correction_reason IS NOT NULL)),
  CHECK ((register_type NOT IN ('CD', 'PRIVATE_CD')) OR (entry_type = 'correction') OR (quantity_received IS NOT NULL OR quantity_deducted IS NOT NULL)),
  CHECK ((register_type != 'RP') OR (entry_type = 'correction') OR (pharmacist_name IS NOT NULL AND gphc_number IS NOT NULL))
);

CREATE INDEX idx_ps_entries_ledger ON ps_register_entries(ledger_id, entry_number);
CREATE INDEX idx_ps_entries_org ON ps_register_entries(organisation_id);
CREATE INDEX idx_ps_entries_type ON ps_register_entries(organisation_id, register_type);
CREATE INDEX idx_ps_entries_date ON ps_register_entries(organisation_id, date_of_transaction);
CREATE INDEX idx_ps_entries_correction ON ps_register_entries(corrects_entry_id) WHERE corrects_entry_id IS NOT NULL;
CREATE INDEX idx_ps_entries_rp ON ps_register_entries(organisation_id, rp_signed_in_at) WHERE register_type = 'RP';

-- ============================================
-- ANNOTATIONS, CONTACTS, AUDIT
-- ============================================

CREATE TABLE ps_entry_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES ps_register_entries(id),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id),
  annotation_text TEXT NOT NULL,
  annotation_type TEXT DEFAULT 'note' CHECK (annotation_type IN ('note', 'flag', 'query', 'resolution')),
  created_by UUID NOT NULL REFERENCES ps_user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ps_annotations_entry ON ps_entry_annotations(entry_id);

CREATE TABLE ps_known_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('patient', 'prescriber')),
  full_name TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  postcode TEXT,
  gmc_number TEXT,
  gphc_number TEXT,
  prescriber_type TEXT,
  nhs_number TEXT,
  date_of_birth DATE,
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  search_key TEXT GENERATED ALWAYS AS (
    lower(trim(full_name)) || ' ' || COALESCE(lower(trim(postcode)), '')
  ) STORED
);

CREATE INDEX idx_ps_contacts_search ON ps_known_contacts(organisation_id, contact_type, search_key);
CREATE INDEX idx_ps_contacts_usage ON ps_known_contacts(organisation_id, contact_type, usage_count DESC);

CREATE TABLE ps_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  performed_by UUID,
  session_id UUID,
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET
);

CREATE INDEX idx_ps_audit_org ON ps_audit_log(organisation_id);
CREATE INDEX idx_ps_audit_table ON ps_audit_log(table_name, record_id);
CREATE INDEX idx_ps_audit_time ON ps_audit_log(performed_at);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Make register entry (the ONLY way to insert entries)
CREATE OR REPLACE FUNCTION ps_make_register_entry(
  p_ledger_id UUID, p_register_type TEXT, p_entry_type TEXT DEFAULT 'normal',
  p_date_of_transaction DATE DEFAULT CURRENT_DATE, p_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'manual', p_corrects_entry_id UUID DEFAULT NULL,
  p_correction_reason TEXT DEFAULT NULL, p_scan_image_path TEXT DEFAULT NULL,
  p_entered_by UUID DEFAULT NULL, p_session_id UUID DEFAULT NULL,
  p_expected_lock_version INTEGER DEFAULT NULL,
  p_transaction_type TEXT DEFAULT NULL, p_quantity_received NUMERIC DEFAULT NULL,
  p_quantity_deducted NUMERIC DEFAULT NULL, p_supplier_name TEXT DEFAULT NULL,
  p_invoice_number TEXT DEFAULT NULL, p_patient_name TEXT DEFAULT NULL,
  p_patient_address TEXT DEFAULT NULL, p_prescriber_name TEXT DEFAULT NULL,
  p_prescriber_address TEXT DEFAULT NULL, p_prescription_date DATE DEFAULT NULL,
  p_prescription_image_path TEXT DEFAULT NULL, p_witness_name TEXT DEFAULT NULL,
  p_witness_role TEXT DEFAULT NULL, p_authorised_by TEXT DEFAULT NULL,
  p_pharmacist_name TEXT DEFAULT NULL, p_gphc_number TEXT DEFAULT NULL,
  p_rp_signed_in_at TIMESTAMPTZ DEFAULT NULL, p_rp_signed_out_at TIMESTAMPTZ DEFAULT NULL,
  p_return_patient_name TEXT DEFAULT NULL, p_return_drug_name TEXT DEFAULT NULL,
  p_return_drug_form TEXT DEFAULT NULL, p_return_drug_strength TEXT DEFAULT NULL,
  p_return_quantity NUMERIC DEFAULT NULL, p_return_reason TEXT DEFAULT NULL,
  p_return_received_by TEXT DEFAULT NULL, p_disposal_date DATE DEFAULT NULL,
  p_disposal_witness TEXT DEFAULT NULL, p_disposal_method TEXT DEFAULT NULL
)
RETURNS ps_register_entries LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ledger ps_register_ledgers;
  v_previous_entry ps_register_entries;
  v_new_balance NUMERIC;
  v_entry_number INTEGER;
  v_new_entry ps_register_entries;
BEGIN
  SELECT * INTO v_ledger FROM ps_register_ledgers WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ledger not found: %', p_ledger_id; END IF;
  IF v_ledger.register_type != p_register_type THEN
    RAISE EXCEPTION 'Register type mismatch. Ledger is %, entry is %', v_ledger.register_type, p_register_type;
  END IF;
  IF p_expected_lock_version IS NOT NULL AND v_ledger.lock_version != p_expected_lock_version THEN
    RAISE EXCEPTION 'CONFLICT: Ledger modified. Expected version %, got %. Refresh and retry.', p_expected_lock_version, v_ledger.lock_version;
  END IF;
  IF p_source NOT IN ('manual', 'ai_scan') THEN
    RAISE EXCEPTION 'Invalid source: %. Must be manual or ai_scan.', p_source;
  END IF;
  SELECT * INTO v_previous_entry FROM ps_register_entries WHERE ledger_id = p_ledger_id ORDER BY entry_number DESC LIMIT 1;
  v_entry_number := v_ledger.entry_count + 1;
  v_new_balance := NULL;
  IF p_register_type IN ('CD', 'PRIVATE_CD') THEN
    v_new_balance := v_ledger.current_balance;
    IF p_quantity_received IS NOT NULL THEN v_new_balance := v_new_balance + p_quantity_received; END IF;
    IF p_quantity_deducted IS NOT NULL THEN v_new_balance := v_new_balance - p_quantity_deducted; END IF;
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Negative balance: %. Current: %, deducting: %', v_new_balance, v_ledger.current_balance, p_quantity_deducted;
    END IF;
  END IF;
  IF p_entry_type = 'correction' THEN
    IF p_corrects_entry_id IS NULL OR p_correction_reason IS NULL THEN
      RAISE EXCEPTION 'Corrections require corrects_entry_id and correction_reason';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ps_register_entries WHERE id = p_corrects_entry_id AND ledger_id = p_ledger_id) THEN
      RAISE EXCEPTION 'Corrected entry not found on this ledger';
    END IF;
  END IF;
  IF p_register_type = 'RP' AND p_entry_type = 'normal' THEN
    IF p_pharmacist_name IS NULL OR p_gphc_number IS NULL THEN RAISE EXCEPTION 'RP entries require pharmacist_name and gphc_number'; END IF;
    IF p_rp_signed_in_at IS NULL THEN RAISE EXCEPTION 'RP entries require rp_signed_in_at'; END IF;
  END IF;
  IF p_register_type IN ('CD', 'PRIVATE_CD') AND p_entry_type = 'normal' THEN
    IF p_transaction_type IS NULL THEN RAISE EXCEPTION 'CD entries require transaction_type'; END IF;
  END IF;

  INSERT INTO ps_register_entries (
    ledger_id, organisation_id, entry_number, register_type, entry_type,
    date_of_transaction, notes, source, corrects_entry_id, correction_reason, scan_image_path,
    entered_by, session_id, previous_entry_id, ledger_lock_version,
    transaction_type, quantity_received, quantity_deducted, running_balance, previous_balance,
    supplier_name, invoice_number, patient_name, patient_address,
    prescriber_name, prescriber_address, prescription_date, prescription_image_path,
    witness_name, witness_role, authorised_by,
    pharmacist_name, gphc_number, rp_signed_in_at, rp_signed_out_at,
    return_patient_name, return_drug_name, return_drug_form, return_drug_strength,
    return_quantity, return_reason, return_received_by, disposal_date, disposal_witness, disposal_method
  ) VALUES (
    p_ledger_id, v_ledger.organisation_id, v_entry_number, p_register_type, p_entry_type,
    p_date_of_transaction, p_notes, p_source, p_corrects_entry_id, p_correction_reason, p_scan_image_path,
    COALESCE(p_entered_by, auth.uid()), p_session_id, v_previous_entry.id, v_ledger.lock_version,
    p_transaction_type, p_quantity_received, p_quantity_deducted, v_new_balance, v_ledger.current_balance,
    p_supplier_name, p_invoice_number, p_patient_name, p_patient_address,
    p_prescriber_name, p_prescriber_address, p_prescription_date, p_prescription_image_path,
    p_witness_name, p_witness_role, p_authorised_by,
    p_pharmacist_name, p_gphc_number, p_rp_signed_in_at, p_rp_signed_out_at,
    p_return_patient_name, p_return_drug_name, p_return_drug_form, p_return_drug_strength,
    p_return_quantity, p_return_reason, p_return_received_by, p_disposal_date, p_disposal_witness, p_disposal_method
  ) RETURNING * INTO v_new_entry;

  UPDATE ps_register_ledgers SET
    current_balance = COALESCE(v_new_balance, current_balance),
    entry_count = v_entry_number,
    lock_version = lock_version + 1
  WHERE id = p_ledger_id;

  RETURN v_new_entry;
END;
$$;

-- Immutability triggers
CREATE OR REPLACE FUNCTION ps_prevent_entry_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Register entries are immutable. Cannot % on ps_register_entries.', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ps_entries_no_update BEFORE UPDATE ON ps_register_entries FOR EACH ROW EXECUTE FUNCTION ps_prevent_entry_mutation();
CREATE TRIGGER ps_entries_no_delete BEFORE DELETE ON ps_register_entries FOR EACH ROW EXECUTE FUNCTION ps_prevent_entry_mutation();
CREATE TRIGGER ps_annotations_no_update BEFORE UPDATE ON ps_entry_annotations FOR EACH ROW EXECUTE FUNCTION ps_prevent_entry_mutation();
CREATE TRIGGER ps_annotations_no_delete BEFORE DELETE ON ps_entry_annotations FOR EACH ROW EXECUTE FUNCTION ps_prevent_entry_mutation();

-- Auto-learn contacts
CREATE OR REPLACE FUNCTION ps_learn_contacts_from_entry() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.patient_name IS NOT NULL AND NEW.patient_name != '' THEN
    INSERT INTO ps_known_contacts (organisation_id, contact_type, full_name, address_line_1, last_used_at, usage_count)
    VALUES (NEW.organisation_id, 'patient', NEW.patient_name, NEW.patient_address, NOW(), 1)
    ON CONFLICT DO NOTHING;
    UPDATE ps_known_contacts SET usage_count = usage_count + 1, last_used_at = NOW()
    WHERE organisation_id = NEW.organisation_id AND contact_type = 'patient' AND lower(trim(full_name)) = lower(trim(NEW.patient_name));
  END IF;
  IF NEW.prescriber_name IS NOT NULL AND NEW.prescriber_name != '' THEN
    INSERT INTO ps_known_contacts (organisation_id, contact_type, full_name, address_line_1, last_used_at, usage_count)
    VALUES (NEW.organisation_id, 'prescriber', NEW.prescriber_name, NEW.prescriber_address, NOW(), 1)
    ON CONFLICT DO NOTHING;
    UPDATE ps_known_contacts SET usage_count = usage_count + 1, last_used_at = NOW()
    WHERE organisation_id = NEW.organisation_id AND contact_type = 'prescriber' AND lower(trim(full_name)) = lower(trim(NEW.prescriber_name));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ps_learn_contacts AFTER INSERT ON ps_register_entries FOR EACH ROW EXECUTE FUNCTION ps_learn_contacts_from_entry();

-- Audit log trigger
CREATE OR REPLACE FUNCTION ps_audit_trigger() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ps_audit_log (organisation_id, table_name, record_id, action, old_data, new_data, performed_by, performed_at)
  VALUES (
    COALESCE(NEW.organisation_id, OLD.organisation_id), TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id), TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid(), NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ps_audit_entries AFTER INSERT ON ps_register_entries FOR EACH ROW EXECUTE FUNCTION ps_audit_trigger();
CREATE TRIGGER ps_audit_annotations AFTER INSERT ON ps_entry_annotations FOR EACH ROW EXECUTE FUNCTION ps_audit_trigger();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE ps_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_register_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_register_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_entry_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_known_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_audit_log ENABLE ROW LEVEL SECURITY;

-- User profiles
CREATE POLICY "ps_profiles_select_own" ON ps_user_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "ps_profiles_update_own" ON ps_user_profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "ps_profiles_insert_own" ON ps_user_profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "ps_profiles_select_org_members" ON ps_user_profiles FOR SELECT USING (
  id IN (SELECT om.user_id FROM ps_organisation_members om WHERE om.organisation_id IN (
    SELECT om2.organisation_id FROM ps_organisation_members om2 WHERE om2.user_id = auth.uid() AND om2.status = 'active'
  ))
);

-- Organisations
CREATE POLICY "ps_orgs_select_member" ON ps_organisations FOR SELECT USING (
  id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
  OR auth_user_id = auth.uid()
);
CREATE POLICY "ps_orgs_update_own" ON ps_organisations FOR UPDATE USING (auth_user_id = auth.uid());

-- Organisation members
CREATE POLICY "ps_members_select" ON ps_organisation_members FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_members_insert" ON ps_organisation_members FOR INSERT WITH CHECK (
  organisation_id IN (SELECT o.id FROM ps_organisations o WHERE o.auth_user_id = auth.uid())
  OR organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'manager') AND om.status = 'active')
);

-- Register ledgers
CREATE POLICY "ps_ledgers_select" ON ps_register_ledgers FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_ledgers_insert" ON ps_register_ledgers FOR INSERT WITH CHECK (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

-- Register entries
CREATE POLICY "ps_entries_select" ON ps_register_entries FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_entries_insert" ON ps_register_entries FOR INSERT WITH CHECK (
  entered_by = auth.uid()
  AND organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

-- Annotations
CREATE POLICY "ps_annotations_select" ON ps_entry_annotations FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_annotations_insert" ON ps_entry_annotations FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

-- Known contacts
CREATE POLICY "ps_contacts_select" ON ps_known_contacts FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_contacts_insert" ON ps_known_contacts FOR INSERT WITH CHECK (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);

-- Sessions
CREATE POLICY "ps_sessions_select" ON ps_active_sessions FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.status = 'active')
);
CREATE POLICY "ps_sessions_insert" ON ps_active_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ps_sessions_update" ON ps_active_sessions FOR UPDATE USING (user_id = auth.uid());

-- Audit log (owners/managers only)
CREATE POLICY "ps_audit_select" ON ps_audit_log FOR SELECT USING (
  organisation_id IN (SELECT om.organisation_id FROM ps_organisation_members om WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'manager') AND om.status = 'active')
);
