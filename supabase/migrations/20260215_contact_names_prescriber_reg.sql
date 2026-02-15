-- Add first_name / last_name to ps_known_contacts for patient record keeping
ALTER TABLE ps_known_contacts
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

-- Add prescriber_registration to ps_register_entries
ALTER TABLE ps_register_entries
  ADD COLUMN IF NOT EXISTS prescriber_registration text;

-- Add UPDATE and DELETE RLS policies (were missing — caused update errors)
CREATE POLICY ps_contacts_update ON ps_known_contacts
  FOR UPDATE
  USING (organisation_id IN (
    SELECT om.organisation_id FROM ps_organisation_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'
  ))
  WITH CHECK (organisation_id IN (
    SELECT om.organisation_id FROM ps_organisation_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'
  ));

CREATE POLICY ps_contacts_delete ON ps_known_contacts
  FOR DELETE
  USING (organisation_id IN (
    SELECT om.organisation_id FROM ps_organisation_members om
    WHERE om.user_id = auth.uid() AND om.status = 'active'
  ));

-- Prevent duplicate contacts (same name in same org+type)
CREATE UNIQUE INDEX IF NOT EXISTS ps_known_contacts_unique_name 
ON ps_known_contacts (organisation_id, contact_type, lower(trim(full_name)));
