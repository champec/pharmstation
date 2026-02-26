-- ===========================================
-- PharmStation: Drug Delivery System
-- Patient medications, delivery rounds, driver tracking, templates
-- ===========================================

-- ─── Patient Medications ─────────────────────────────────────────────

CREATE TABLE ps_patient_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES ps_patients(id) ON DELETE CASCADE,
  drug_id uuid NOT NULL REFERENCES bnf_medicinal_forms(id),
  drug_name text NOT NULL,
  drug_form text,
  drug_strength text,
  dose text,
  quantity integer,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_patient_medications_unique UNIQUE (patient_id, drug_id)
);

CREATE INDEX idx_patient_medications_patient ON ps_patient_medications(patient_id);
CREATE INDEX idx_patient_medications_org ON ps_patient_medications(organisation_id);

ALTER TABLE ps_patient_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_patient_medications"
  ON ps_patient_medications FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_insert_patient_medications"
  ON ps_patient_medications FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_update_patient_medications"
  ON ps_patient_medications FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_delete_patient_medications"
  ON ps_patient_medications FOR DELETE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE TRIGGER ps_patient_medications_updated_at
  BEFORE UPDATE ON ps_patient_medications
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);


-- ─── Delivery Round Templates ────────────────────────────────────────
-- (Created before rounds so rounds can FK to templates)

CREATE TABLE ps_delivery_round_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_round_templates_org ON ps_delivery_round_templates(organisation_id);

ALTER TABLE ps_delivery_round_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_templates"
  ON ps_delivery_round_templates FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_insert_templates"
  ON ps_delivery_round_templates FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_update_templates"
  ON ps_delivery_round_templates FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_delete_templates"
  ON ps_delivery_round_templates FOR DELETE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE TRIGGER ps_delivery_round_templates_updated_at
  BEFORE UPDATE ON ps_delivery_round_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);


-- ─── Delivery Rounds ─────────────────────────────────────────────────

CREATE TABLE ps_delivery_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  title text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  scheduled_date date,
  scheduled_time_start time,
  scheduled_time_end time,
  driver_id uuid REFERENCES ps_organisation_members(id),
  template_id uuid REFERENCES ps_delivery_round_templates(id) ON DELETE SET NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES ps_user_profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_rounds_org ON ps_delivery_rounds(organisation_id);
CREATE INDEX idx_delivery_rounds_status ON ps_delivery_rounds(status);
CREATE INDEX idx_delivery_rounds_driver ON ps_delivery_rounds(driver_id);
CREATE INDEX idx_delivery_rounds_date ON ps_delivery_rounds(scheduled_date);
CREATE INDEX idx_delivery_rounds_template ON ps_delivery_rounds(template_id);

ALTER TABLE ps_delivery_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_delivery_rounds"
  ON ps_delivery_rounds FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_insert_delivery_rounds"
  ON ps_delivery_rounds FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_update_delivery_rounds"
  ON ps_delivery_rounds FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_delete_delivery_rounds"
  ON ps_delivery_rounds FOR DELETE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE TRIGGER ps_delivery_rounds_updated_at
  BEFORE UPDATE ON ps_delivery_rounds
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);


-- ─── Delivery Round Patients ─────────────────────────────────────────

CREATE TABLE ps_delivery_round_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES ps_delivery_rounds(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES ps_patients(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  delivery_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'skipped',
                      'pending_redelivery', 'moved_to_round', 'returned', 'cancelled')),
  delivery_address_line_1 text,
  delivery_address_line_2 text,
  delivery_city text,
  delivery_postcode text,
  notes text,
  signature_data text,
  delivered_at timestamptz,
  failure_reason text,
  original_round_patient_id uuid REFERENCES ps_delivery_round_patients(id) ON DELETE SET NULL,
  moved_to_round_patient_id uuid REFERENCES ps_delivery_round_patients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_delivery_round_patients_unique UNIQUE (round_id, patient_id)
);

CREATE INDEX idx_delivery_round_patients_round ON ps_delivery_round_patients(round_id);
CREATE INDEX idx_delivery_round_patients_patient ON ps_delivery_round_patients(patient_id);
CREATE INDEX idx_delivery_round_patients_org ON ps_delivery_round_patients(organisation_id);
CREATE INDEX idx_delivery_round_patients_redelivery
  ON ps_delivery_round_patients(organisation_id, status) WHERE status = 'pending_redelivery';

ALTER TABLE ps_delivery_round_patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_round_patients"
  ON ps_delivery_round_patients FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_insert_round_patients"
  ON ps_delivery_round_patients FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_update_round_patients"
  ON ps_delivery_round_patients FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE POLICY "org_members_delete_round_patients"
  ON ps_delivery_round_patients FOR DELETE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

CREATE TRIGGER ps_delivery_round_patients_updated_at
  BEFORE UPDATE ON ps_delivery_round_patients
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);


-- ─── Delivery Patient Medications ────────────────────────────────────

CREATE TABLE ps_delivery_patient_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_round_patient_id uuid NOT NULL REFERENCES ps_delivery_round_patients(id) ON DELETE CASCADE,
  patient_medication_id uuid NOT NULL REFERENCES ps_patient_medications(id) ON DELETE CASCADE,
  quantity integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_delivery_patient_medications_unique
    UNIQUE (delivery_round_patient_id, patient_medication_id)
);

CREATE INDEX idx_delivery_patient_meds_drp ON ps_delivery_patient_medications(delivery_round_patient_id);

ALTER TABLE ps_delivery_patient_medications ENABLE ROW LEVEL SECURITY;

-- RLS via round patient's org scope
CREATE POLICY "org_members_read_delivery_meds"
  ON ps_delivery_patient_medications FOR SELECT
  USING (
    delivery_round_patient_id IN (
      SELECT id FROM ps_delivery_round_patients
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_insert_delivery_meds"
  ON ps_delivery_patient_medications FOR INSERT
  WITH CHECK (
    delivery_round_patient_id IN (
      SELECT id FROM ps_delivery_round_patients
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_update_delivery_meds"
  ON ps_delivery_patient_medications FOR UPDATE
  USING (
    delivery_round_patient_id IN (
      SELECT id FROM ps_delivery_round_patients
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_delete_delivery_meds"
  ON ps_delivery_patient_medications FOR DELETE
  USING (
    delivery_round_patient_id IN (
      SELECT id FROM ps_delivery_round_patients
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );


-- ─── Template Patients ───────────────────────────────────────────────

CREATE TABLE ps_delivery_round_template_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES ps_delivery_round_templates(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES ps_patients(id) ON DELETE CASCADE,
  delivery_order integer NOT NULL DEFAULT 0,
  delivery_address_line_1 text,
  delivery_address_line_2 text,
  delivery_city text,
  delivery_postcode text,
  notes text,
  include_all_active_meds boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_template_patients_unique UNIQUE (template_id, patient_id)
);

CREATE INDEX idx_template_patients_template ON ps_delivery_round_template_patients(template_id);

ALTER TABLE ps_delivery_round_template_patients ENABLE ROW LEVEL SECURITY;

-- RLS via template's org scope
CREATE POLICY "org_members_read_template_patients"
  ON ps_delivery_round_template_patients FOR SELECT
  USING (
    template_id IN (
      SELECT id FROM ps_delivery_round_templates
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_insert_template_patients"
  ON ps_delivery_round_template_patients FOR INSERT
  WITH CHECK (
    template_id IN (
      SELECT id FROM ps_delivery_round_templates
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_update_template_patients"
  ON ps_delivery_round_template_patients FOR UPDATE
  USING (
    template_id IN (
      SELECT id FROM ps_delivery_round_templates
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_delete_template_patients"
  ON ps_delivery_round_template_patients FOR DELETE
  USING (
    template_id IN (
      SELECT id FROM ps_delivery_round_templates
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );


-- ─── Template Medications ────────────────────────────────────────────

CREATE TABLE ps_delivery_round_template_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_patient_id uuid NOT NULL REFERENCES ps_delivery_round_template_patients(id) ON DELETE CASCADE,
  patient_medication_id uuid NOT NULL REFERENCES ps_patient_medications(id) ON DELETE CASCADE,
  default_quantity integer,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_template_medications_unique
    UNIQUE (template_patient_id, patient_medication_id)
);

CREATE INDEX idx_template_meds_tp ON ps_delivery_round_template_medications(template_patient_id);

ALTER TABLE ps_delivery_round_template_medications ENABLE ROW LEVEL SECURITY;

-- RLS via template patient → template → org
CREATE POLICY "org_members_read_template_meds"
  ON ps_delivery_round_template_medications FOR SELECT
  USING (
    template_patient_id IN (
      SELECT tp.id FROM ps_delivery_round_template_patients tp
      JOIN ps_delivery_round_templates t ON t.id = tp.template_id
      WHERE t.organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_insert_template_meds"
  ON ps_delivery_round_template_medications FOR INSERT
  WITH CHECK (
    template_patient_id IN (
      SELECT tp.id FROM ps_delivery_round_template_patients tp
      JOIN ps_delivery_round_templates t ON t.id = tp.template_id
      WHERE t.organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_update_template_meds"
  ON ps_delivery_round_template_medications FOR UPDATE
  USING (
    template_patient_id IN (
      SELECT tp.id FROM ps_delivery_round_template_patients tp
      JOIN ps_delivery_round_templates t ON t.id = tp.template_id
      WHERE t.organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "org_members_delete_template_meds"
  ON ps_delivery_round_template_medications FOR DELETE
  USING (
    template_patient_id IN (
      SELECT tp.id FROM ps_delivery_round_template_patients tp
      JOIN ps_delivery_round_templates t ON t.id = tp.template_id
      WHERE t.organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );


-- ─── Location Updates (Driver GPS Tracking) ──────────────────────────

CREATE TABLE ps_delivery_location_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES ps_delivery_rounds(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES ps_organisation_members(id),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_updates_round ON ps_delivery_location_updates(round_id, recorded_at);
CREATE INDEX idx_location_updates_driver ON ps_delivery_location_updates(driver_id);

ALTER TABLE ps_delivery_location_updates ENABLE ROW LEVEL SECURITY;

-- Org members can read location updates for their rounds
CREATE POLICY "org_members_read_location_updates"
  ON ps_delivery_location_updates FOR SELECT
  USING (
    round_id IN (
      SELECT id FROM ps_delivery_rounds
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Org members (drivers) can insert location updates
CREATE POLICY "org_members_insert_location_updates"
  ON ps_delivery_location_updates FOR INSERT
  WITH CHECK (
    round_id IN (
      SELECT id FROM ps_delivery_rounds
      WHERE organisation_id IN (SELECT ps_get_user_org_ids())
    )
  );
