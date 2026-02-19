-- ===========================================
-- PharmStation: Patients table
-- ===========================================

CREATE TABLE ps_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date,
  nhs_number text,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_patients_nhs_unique UNIQUE NULLS NOT DISTINCT (nhs_number, organisation_id)
);

-- Indexes
CREATE INDEX idx_patients_org ON ps_patients(organisation_id);
CREATE INDEX idx_patients_auth ON ps_patients(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX idx_patients_name ON ps_patients(organisation_id, last_name, first_name);
CREATE INDEX idx_patients_phone ON ps_patients(organisation_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_patients_nhs ON ps_patients(nhs_number) WHERE nhs_number IS NOT NULL;

-- RLS
ALTER TABLE ps_patients ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's patients
CREATE POLICY "org_members_read_patients"
  ON ps_patients FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Org members can insert patients for their org
CREATE POLICY "org_members_insert_patients"
  ON ps_patients FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Org members can update their org's patients
CREATE POLICY "org_members_update_patients"
  ON ps_patients FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Patients can read their own record
CREATE POLICY "patients_read_own"
  ON ps_patients FOR SELECT
  USING (auth_user_id = auth.uid());

-- Patients can update their own record
CREATE POLICY "patients_update_own"
  ON ps_patients FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER ps_patients_updated_at
  BEFORE UPDATE ON ps_patients
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
