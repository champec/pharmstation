-- ===========================================
-- PharmStation: Appointment Slots & Appointments
-- Slots define org availability; Appointments are bookings.
-- service_id is NULLABLE — appointments don't always need a service.
-- Completed appointments can optionally result in a service_delivery.
-- ===========================================

-- Org availability slots (always linked to a service)
CREATE TABLE ps_appointment_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  max_bookings int NOT NULL DEFAULT 1,
  booked_count int NOT NULL DEFAULT 0,
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_rule text, -- iCal RRULE string
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_slots_time_check CHECK (end_time > start_time),
  CONSTRAINT ps_slots_booking_check CHECK (booked_count >= 0 AND booked_count <= max_bookings)
);

CREATE INDEX idx_ps_slots_org ON ps_appointment_slots(org_id);
CREATE INDEX idx_ps_slots_service ON ps_appointment_slots(service_id);
CREATE INDEX idx_ps_slots_time ON ps_appointment_slots(org_id, start_time, end_time) WHERE is_active = true;

ALTER TABLE ps_appointment_slots ENABLE ROW LEVEL SECURITY;

-- Org members: full CRUD on their org's slots
CREATE POLICY "org_members_crud_slots"
  ON ps_appointment_slots FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Public (anon): read available slots for public, active services of public orgs
CREATE POLICY "anon_read_available_slots"
  ON ps_appointment_slots FOR SELECT
  USING (
    is_active = true
    AND booked_count < max_bookings
    AND service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Booked appointments
-- service_id is nullable: appointments can exist without a service
-- (e.g. generic consultation, walk-in). Completed appointments can
-- optionally result in a ps_service_deliveries row via the UI.
CREATE TABLE ps_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid REFERENCES ps_appointment_slots(id) ON DELETE SET NULL,
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  service_id uuid REFERENCES ps_services(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES ps_patients(id) ON DELETE CASCADE,
  form_id uuid REFERENCES ps_service_forms(id) ON DELETE SET NULL,
  form_data jsonb DEFAULT '{}', -- filled-in form fields
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  booked_by_user_id uuid REFERENCES ps_user_profiles(id) ON DELETE SET NULL, -- null if patient self-booked
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ps_appointments_org ON ps_appointments(org_id);
CREATE INDEX idx_ps_appointments_patient ON ps_appointments(patient_id);
CREATE INDEX idx_ps_appointments_service ON ps_appointments(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX idx_ps_appointments_status ON ps_appointments(org_id, status);
CREATE INDEX idx_ps_appointments_slot ON ps_appointments(slot_id) WHERE slot_id IS NOT NULL;

ALTER TABLE ps_appointments ENABLE ROW LEVEL SECURITY;

-- Org members: full CRUD on their org's appointments
CREATE POLICY "org_members_crud_appointments"
  ON ps_appointments FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Patients: read their own appointments
CREATE POLICY "patients_read_own_appointments"
  ON ps_appointments FOR SELECT
  USING (
    patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  );

-- Patients: can cancel their own pending/confirmed appointments
CREATE POLICY "patients_cancel_own_appointments"
  ON ps_appointments FOR UPDATE
  USING (
    patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    status = 'cancelled'
    AND patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  );

-- Anon: can INSERT appointments for public services (guest booking)
CREATE POLICY "anon_insert_public_appointments"
  ON ps_appointments FOR INSERT
  WITH CHECK (
    service_id IS NOT NULL
    AND service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Trigger: auto-increment booked_count on slot when appointment is inserted
CREATE OR REPLACE FUNCTION ps_increment_slot_booked_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL THEN
    UPDATE ps_appointment_slots
    SET booked_count = booked_count + 1
    WHERE id = NEW.slot_id
      AND booked_count < max_bookings;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slot is fully booked or does not exist';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ps_appointment_slot_increment
  AFTER INSERT ON ps_appointments
  FOR EACH ROW
  EXECUTE FUNCTION ps_increment_slot_booked_count();

-- Trigger: auto-decrement booked_count when appointment is cancelled
CREATE OR REPLACE FUNCTION ps_decrement_slot_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' AND NEW.slot_id IS NOT NULL THEN
    UPDATE ps_appointment_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ps_appointment_slot_decrement
  AFTER UPDATE ON ps_appointments
  FOR EACH ROW
  EXECUTE FUNCTION ps_decrement_slot_on_cancel();

-- Updated_at trigger
CREATE TRIGGER ps_appointments_updated_at
  BEFORE UPDATE ON ps_appointments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
