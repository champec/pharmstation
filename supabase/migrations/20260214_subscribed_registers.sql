-- ============================================
-- Subscribed Registers — Pharmacies subscribe to specific drug registers
-- ============================================

CREATE TABLE IF NOT EXISTS ps_subscribed_registers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  drug_id uuid NOT NULL REFERENCES cdr_drugs_unique(id) ON DELETE CASCADE,
  drug_brand text NOT NULL,
  drug_form text NOT NULL,
  drug_strength text NOT NULL,
  drug_class text NOT NULL,
  drug_type text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(organisation_id, drug_id)
);

ALTER TABLE ps_subscribed_registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org subscribed registers" ON ps_subscribed_registers
  FOR SELECT USING (
    organisation_id IN (
      SELECT organisation_id FROM ps_organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own org subscribed registers" ON ps_subscribed_registers
  FOR INSERT WITH CHECK (
    organisation_id IN (
      SELECT organisation_id FROM ps_organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own org subscribed registers" ON ps_subscribed_registers
  FOR DELETE USING (
    organisation_id IN (
      SELECT organisation_id FROM ps_organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_subscribed_registers_org ON ps_subscribed_registers(organisation_id);

-- Update ps_known_contacts to support 'supplier' contact type
ALTER TABLE ps_known_contacts DROP CONSTRAINT IF EXISTS ps_known_contacts_contact_type_check;
ALTER TABLE ps_known_contacts ADD CONSTRAINT ps_known_contacts_contact_type_check 
  CHECK (contact_type = ANY (ARRAY['patient'::text, 'prescriber'::text, 'supplier'::text]));

-- Add ID check columns to register entries
ALTER TABLE ps_register_entries ADD COLUMN IF NOT EXISTS was_id_requested boolean DEFAULT false;
ALTER TABLE ps_register_entries ADD COLUMN IF NOT EXISTS was_id_provided boolean DEFAULT false;
