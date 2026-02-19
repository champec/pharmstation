-- ===========================================
-- PharmStation: Service Deliveries
-- Records of services delivered to patients (walk-in or ad-hoc)
-- ===========================================

CREATE TABLE ps_service_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  form_id uuid REFERENCES ps_service_forms(id) ON DELETE SET NULL,
  form_data jsonb NOT NULL DEFAULT '{}',
  delivered_by uuid REFERENCES ps_user_profiles(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('draft', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_service_deliveries_org ON ps_service_deliveries(org_id);
CREATE INDEX idx_service_deliveries_service ON ps_service_deliveries(org_id, service_id);
CREATE INDEX idx_service_deliveries_patient ON ps_service_deliveries(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX idx_service_deliveries_date ON ps_service_deliveries(org_id, created_at DESC);

ALTER TABLE ps_service_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_deliveries"
  ON ps_service_deliveries FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Patients can read their own delivery records
CREATE POLICY "patients_read_own_deliveries"
  ON ps_service_deliveries FOR SELECT
  USING (
    patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  );
