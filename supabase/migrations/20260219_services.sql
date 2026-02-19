-- ===========================================
-- PharmStation: Services & Service Forms
-- ===========================================

-- Platform-curated service library
CREATE TABLE ps_service_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ps_service_library ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the library
CREATE POLICY "anyone_read_service_library"
  ON ps_service_library FOR SELECT
  USING (true);

-- Organisation's services
CREATE TABLE ps_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  library_service_id uuid REFERENCES ps_service_library(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT false,
  duration_minutes int NOT NULL DEFAULT 15,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_org ON ps_services(org_id);
CREATE INDEX idx_services_public ON ps_services(org_id, is_public) WHERE is_public = true;

ALTER TABLE ps_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_services"
  ON ps_services FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Public can read public services of public orgs
CREATE POLICY "anon_read_public_services"
  ON ps_services FOR SELECT
  USING (
    is_public = true
    AND is_active = true
    AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
  );

-- Service forms (attached to a service)
CREATE TABLE ps_service_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  is_default boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_forms_service ON ps_service_forms(service_id);

ALTER TABLE ps_service_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_service_forms"
  ON ps_service_forms FOR ALL
  USING (
    service_id IN (
      SELECT id FROM ps_services WHERE org_id IN (SELECT ps_get_user_org_ids())
    )
  )
  WITH CHECK (
    service_id IN (
      SELECT id FROM ps_services WHERE org_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Public can read forms for public services
CREATE POLICY "anon_read_public_service_forms"
  ON ps_service_forms FOR SELECT
  USING (
    service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Service form fields (columns/inputs in a form)
CREATE TABLE ps_service_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES ps_service_forms(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_key text NOT NULL,
  field_type text NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date', 'textarea', 'signature')),
  options jsonb,
  is_required boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0
);

CREATE INDEX idx_service_form_fields_form ON ps_service_form_fields(form_id);

ALTER TABLE ps_service_form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_form_fields"
  ON ps_service_form_fields FOR ALL
  USING (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.org_id IN (SELECT ps_get_user_org_ids())
    )
  )
  WITH CHECK (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.org_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Public can read fields for public service forms
CREATE POLICY "anon_read_public_form_fields"
  ON ps_service_form_fields FOR SELECT
  USING (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.is_public = true AND s.is_active = true
      AND s.org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- ===========================
-- Seed: Service Library
-- ===========================

INSERT INTO ps_service_library (name, description, category) VALUES
  ('Flu Vaccination', 'Seasonal influenza vaccination service', 'vaccination'),
  ('COVID-19 Vaccination', 'COVID-19 booster vaccination service', 'vaccination'),
  ('Travel Vaccination', 'Pre-travel vaccination and advice service', 'vaccination'),
  ('Blood Pressure Check', 'Free NHS blood pressure check service', 'screening'),
  ('Medication Review', 'Structured medication review with pharmacist', 'consultation'),
  ('New Medicine Service (NMS)', 'NHS New Medicine Service — follow-up for new prescriptions', 'consultation'),
  ('Smoking Cessation', 'Stop smoking support and NRT supply', 'consultation'),
  ('Emergency Contraception', 'Emergency hormonal contraception consultation', 'consultation'),
  ('UTI Consultation', 'Pharmacy First — urinary tract infection consultation', 'pharmacy_first'),
  ('Sore Throat Consultation', 'Pharmacy First — sore throat test and treat', 'pharmacy_first'),
  ('Sinusitis Consultation', 'Pharmacy First — sinusitis consultation', 'pharmacy_first'),
  ('Impetigo Consultation', 'Pharmacy First — impetigo consultation', 'pharmacy_first'),
  ('Ear Infection Consultation', 'Pharmacy First — ear infection consultation', 'pharmacy_first'),
  ('Shingles Consultation', 'Pharmacy First — shingles consultation', 'pharmacy_first'),
  ('Infected Insect Bite Consultation', 'Pharmacy First — infected insect bite consultation', 'pharmacy_first');
