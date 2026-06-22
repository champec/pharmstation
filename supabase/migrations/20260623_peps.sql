-- =====================================================================
-- PharmStation: PEPS — Private Electronic Prescription Service
-- ---------------------------------------------------------------------
-- A private-prescription analogue of EPS. Prescriptions live on a
-- central "spine" and route between pharmacies:
--
--   status='available' + assigned_org_id IS NULL  -> open on the spine
--   status='available' + assigned_org_id = X      -> directed to pharmacy X
--   status='held'      + assigned_org_id = X       -> downloaded, locked to X
--   status='dispensed' / 'cancelled'               -> terminal
--
-- All cross-org transitions go through SECURITY DEFINER RPCs so the
-- rules are enforced server-side (mirrors ps_make_register_entry).
-- =====================================================================

-- =====================================================================
-- 1. PRESCRIBERS — global, centrally-approved registry (linked to a profile)
-- =====================================================================
CREATE TABLE IF NOT EXISTS ps_peps_prescribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  prescriber_type text NOT NULL DEFAULT 'doctor' CHECK (prescriber_type IN (
    'doctor', 'dentist', 'pharmacist_ip', 'nurse_ip', 'optometrist_ip',
    'physiotherapist_ip', 'paramedic_ip', 'veterinarian', 'other'
  )),
  registration_number text NOT NULL,
  registration_body text,                       -- GMC, GDC, GPhC, NMC, RCVS, ...
  email text,
  phone text,
  address text,                                 -- default prescribing address (free text)
  signature_data text,                          -- saved e-signature (PNG base64 data URL)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One prescriber identity per (user, registration). Registration is the legal id.
  CONSTRAINT ps_peps_prescribers_reg_unique UNIQUE (registration_number)
);

CREATE INDEX IF NOT EXISTS idx_peps_prescribers_user ON ps_peps_prescribers(user_id);
CREATE INDEX IF NOT EXISTS idx_peps_prescribers_name ON ps_peps_prescribers(lower(full_name));
CREATE INDEX IF NOT EXISTS idx_peps_prescribers_status ON ps_peps_prescribers(status);

-- =====================================================================
-- 2. ORG DIRECTORY — prescribing organisations referenced on scripts.
--    Global when they carry an ODS code; otherwise scoped to the
--    pharmstation org that created them.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ps_peps_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ods_code text,                                -- unique when present -> global
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  phone text,
  email text,
  is_global boolean NOT NULL DEFAULT false,     -- true when ods_code present
  created_by_org_id uuid REFERENCES ps_organisations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ps_peps_orgs_ods_unique UNIQUE (ods_code)
);

CREATE INDEX IF NOT EXISTS idx_peps_orgs_name ON ps_peps_orgs(lower(name));
CREATE INDEX IF NOT EXISTS idx_peps_orgs_scope ON ps_peps_orgs(created_by_org_id);

-- =====================================================================
-- 3. PRESCRIPTIONS — the spine token / header
-- =====================================================================
CREATE TABLE IF NOT EXISTS ps_peps_prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_ref text NOT NULL UNIQUE,        -- human-readable reference

  -- Who wrote it (registry id + immutable legal snapshot)
  prescriber_id uuid NOT NULL REFERENCES ps_peps_prescribers(id),
  prescriber_snapshot jsonb NOT NULL DEFAULT '{}',
  written_by uuid NOT NULL REFERENCES auth.users(id),
  origin_org_id uuid REFERENCES ps_organisations(id) ON DELETE SET NULL, -- pharmstation org the prescriber was logged into

  -- Patient (optional link to ps_patients + snapshot)
  patient_id uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  patient_snapshot jsonb NOT NULL DEFAULT '{}',

  -- Prescribing organisation (directory id + snapshot)
  prescribing_org_id uuid REFERENCES ps_peps_orgs(id) ON DELETE SET NULL,
  prescribing_org_snapshot jsonb NOT NULL DEFAULT '{}',

  -- Clinical
  prescription_type text NOT NULL DEFAULT 'private' CHECK (prescription_type IN ('private', 'vet')),
  animal_name text,                             -- vet only
  animal_owner text,                            -- vet only
  cascade_wording text,                         -- vet "prescribing cascade" statement
  repeats integer NOT NULL DEFAULT 0 CHECK (repeats >= 0 AND repeats <= 6),
  repeats_dispensed integer NOT NULL DEFAULT 0,
  prescription_date date NOT NULL DEFAULT current_date,
  signature_data text,                          -- e-signature applied to this script

  -- Spine / queue state
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'dispensed', 'cancelled')),
  assigned_org_id uuid REFERENCES ps_organisations(id) ON DELETE SET NULL,
  downloaded_at timestamptz,
  dispensed_at timestamptz,
  dispensed_by uuid REFERENCES auth.users(id),

  -- Security (single-copy token) — reserved for a later phase
  unique_code text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peps_rx_assigned ON ps_peps_prescriptions(assigned_org_id);
CREATE INDEX IF NOT EXISTS idx_peps_rx_status ON ps_peps_prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_peps_rx_prescriber ON ps_peps_prescriptions(prescriber_id);
CREATE INDEX IF NOT EXISTS idx_peps_rx_written_by ON ps_peps_prescriptions(written_by);
CREATE INDEX IF NOT EXISTS idx_peps_rx_patient ON ps_peps_prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_peps_rx_date ON ps_peps_prescriptions(prescription_date);

-- =====================================================================
-- 4. PRESCRIPTION ITEMS — dm+d-backed drug lines
-- =====================================================================
CREATE TABLE IF NOT EXISTS ps_peps_prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES ps_peps_prescriptions(id) ON DELETE CASCADE,
  line_order integer NOT NULL DEFAULT 0,
  dmd_code text,                                -- vpid (VMP) or apid (AMP)
  dmd_type text CHECK (dmd_type IN ('vmp', 'amp', 'free_text')),
  drug_name text NOT NULL,
  strength text,
  form text,
  quantity text NOT NULL,
  dosage text,                                  -- directions / sig
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peps_items_rx ON ps_peps_prescription_items(prescription_id);

-- =====================================================================
-- 5. EVENTS — audit trail + "where is the script" history
-- =====================================================================
CREATE TABLE IF NOT EXISTS ps_peps_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES ps_peps_prescriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'sent_to_spine', 'directed', 'downloaded',
    'released', 'transferred', 'dispensed', 'cancelled'
  )),
  from_org_id uuid REFERENCES ps_organisations(id) ON DELETE SET NULL,
  to_org_id uuid REFERENCES ps_organisations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_peps_events_rx ON ps_peps_events(prescription_id, created_at);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
DROP TRIGGER IF EXISTS ps_peps_prescribers_updated_at ON ps_peps_prescribers;
CREATE TRIGGER ps_peps_prescribers_updated_at BEFORE UPDATE ON ps_peps_prescribers
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS ps_peps_orgs_updated_at ON ps_peps_orgs;
CREATE TRIGGER ps_peps_orgs_updated_at BEFORE UPDATE ON ps_peps_orgs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS ps_peps_prescriptions_updated_at ON ps_peps_prescriptions;
CREATE TRIGGER ps_peps_prescriptions_updated_at BEFORE UPDATE ON ps_peps_prescriptions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
ALTER TABLE ps_peps_prescribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_peps_orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_peps_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_peps_prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_peps_events ENABLE ROW LEVEL SECURITY;

-- Prescribers: globally readable (so anyone can search the registry).
DROP POLICY IF EXISTS peps_prescribers_read ON ps_peps_prescribers;
CREATE POLICY peps_prescribers_read ON ps_peps_prescribers
  FOR SELECT TO authenticated USING (true);

-- A user may create/maintain their own prescriber identity.
DROP POLICY IF EXISTS peps_prescribers_insert_own ON ps_peps_prescribers;
CREATE POLICY peps_prescribers_insert_own ON ps_peps_prescribers
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS peps_prescribers_update_own ON ps_peps_prescribers;
CREATE POLICY peps_prescribers_update_own ON ps_peps_prescribers
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Org directory: global entries visible to all; scoped entries to creator org.
DROP POLICY IF EXISTS peps_orgs_read ON ps_peps_orgs;
CREATE POLICY peps_orgs_read ON ps_peps_orgs
  FOR SELECT TO authenticated
  USING (is_global = true OR created_by_org_id IN (SELECT ps_get_user_org_ids()));

DROP POLICY IF EXISTS peps_orgs_insert ON ps_peps_orgs;
CREATE POLICY peps_orgs_insert ON ps_peps_orgs
  FOR INSERT TO authenticated
  WITH CHECK (created_by_org_id IN (SELECT ps_get_user_org_ids()));

DROP POLICY IF EXISTS peps_orgs_update ON ps_peps_orgs;
CREATE POLICY peps_orgs_update ON ps_peps_orgs
  FOR UPDATE TO authenticated
  USING (created_by_org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (created_by_org_id IN (SELECT ps_get_user_org_ids()));

-- Prescriptions: visible to (a) the prescriber who wrote it,
-- (b) the pharmacy it's assigned to / held by,
-- (c) any pharmacy when it's openly available on the spine (assigned_org_id IS NULL).
-- NOTE: contents are only meaningfully reachable in these cases; the
-- "where is it" lookup for other pharmacies uses ps_peps_spine_search (definer).
DROP POLICY IF EXISTS peps_rx_read ON ps_peps_prescriptions;
CREATE POLICY peps_rx_read ON ps_peps_prescriptions
  FOR SELECT TO authenticated
  USING (
    written_by = auth.uid()
    OR assigned_org_id IN (SELECT ps_get_user_org_ids())
    OR (status = 'available' AND assigned_org_id IS NULL)
  );

-- Creation: only by an active prescriber writing as themselves.
DROP POLICY IF EXISTS peps_rx_insert ON ps_peps_prescriptions;
CREATE POLICY peps_rx_insert ON ps_peps_prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    written_by = auth.uid()
    AND prescriber_id IN (
      SELECT id FROM ps_peps_prescribers WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Items: readable/insertable alongside the parent prescription.
DROP POLICY IF EXISTS peps_items_read ON ps_peps_prescription_items;
CREATE POLICY peps_items_read ON ps_peps_prescription_items
  FOR SELECT TO authenticated
  USING (
    prescription_id IN (
      SELECT id FROM ps_peps_prescriptions
      WHERE written_by = auth.uid()
        OR assigned_org_id IN (SELECT ps_get_user_org_ids())
        OR (status = 'available' AND assigned_org_id IS NULL)
    )
  );

DROP POLICY IF EXISTS peps_items_insert ON ps_peps_prescription_items;
CREATE POLICY peps_items_insert ON ps_peps_prescription_items
  FOR INSERT TO authenticated
  WITH CHECK (
    prescription_id IN (SELECT id FROM ps_peps_prescriptions WHERE written_by = auth.uid())
  );

-- Events: readable alongside the parent prescription.
DROP POLICY IF EXISTS peps_events_read ON ps_peps_events;
CREATE POLICY peps_events_read ON ps_peps_events
  FOR SELECT TO authenticated
  USING (
    prescription_id IN (
      SELECT id FROM ps_peps_prescriptions
      WHERE written_by = auth.uid()
        OR assigned_org_id IN (SELECT ps_get_user_org_ids())
        OR (status = 'available' AND assigned_org_id IS NULL)
    )
    OR from_org_id IN (SELECT ps_get_user_org_ids())
    OR to_org_id IN (SELECT ps_get_user_org_ids())
  );

-- Inserts of events come from SECURITY DEFINER RPCs (and create flow).
DROP POLICY IF EXISTS peps_events_insert ON ps_peps_events;
CREATE POLICY peps_events_insert ON ps_peps_events
  FOR INSERT TO authenticated WITH CHECK (actor_user_id = auth.uid());

-- =====================================================================
-- HELPER: assert caller is an active member of an org
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_assert_member(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ps_organisation_members
    WHERE organisation_id = p_org_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not an active member of organisation %', p_org_id;
  END IF;
END;
$$;

-- =====================================================================
-- RPC: download (fetch) prescriptions into a pharmacy's queue.
-- Claims every openly-available or directed-to-me script (optionally a
-- specific subset). available -> held, locked to the pharmacy.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_download(p_org_id uuid, p_ids uuid[] DEFAULT NULL)
RETURNS SETOF ps_peps_prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r ps_peps_prescriptions;
BEGIN
  PERFORM ps_peps_assert_member(p_org_id);

  FOR r IN
    SELECT * FROM ps_peps_prescriptions
    WHERE status = 'available'
      AND (assigned_org_id IS NULL OR assigned_org_id = p_org_id)
      AND (p_ids IS NULL OR id = ANY(p_ids))
    FOR UPDATE
  LOOP
    UPDATE ps_peps_prescriptions
      SET status = 'held', assigned_org_id = p_org_id, downloaded_at = now()
      WHERE id = r.id;

    INSERT INTO ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
      VALUES (r.id, 'downloaded', r.assigned_org_id, p_org_id, auth.uid());

    RETURN QUERY SELECT * FROM ps_peps_prescriptions WHERE id = r.id;
  END LOOP;
END;
$$;

-- =====================================================================
-- RPC: release a held prescription back to the open spine.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_release(p_id uuid)
RETURNS ps_peps_prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rx ps_peps_prescriptions;
BEGIN
  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescription not found'; END IF;
  IF rx.status <> 'held' THEN RAISE EXCEPTION 'Only held prescriptions can be released'; END IF;
  PERFORM ps_peps_assert_member(rx.assigned_org_id);

  UPDATE ps_peps_prescriptions
    SET status = 'available', assigned_org_id = NULL, downloaded_at = NULL
    WHERE id = p_id;

  INSERT INTO ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
    VALUES (p_id, 'released', rx.assigned_org_id, NULL, auth.uid());

  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id;
  RETURN rx;
END;
$$;

-- =====================================================================
-- RPC: transfer a held prescription directly to another pharmacy.
-- Goes back to 'available' but directed to the target (they must download).
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_transfer(p_id uuid, p_to_org_id uuid)
RETURNS ps_peps_prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rx ps_peps_prescriptions;
BEGIN
  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescription not found'; END IF;
  IF rx.status <> 'held' THEN RAISE EXCEPTION 'Only held prescriptions can be transferred'; END IF;
  PERFORM ps_peps_assert_member(rx.assigned_org_id);

  UPDATE ps_peps_prescriptions
    SET status = 'available', assigned_org_id = p_to_org_id, downloaded_at = NULL
    WHERE id = p_id;

  INSERT INTO ps_peps_events (prescription_id, event_type, from_org_id, to_org_id, actor_user_id)
    VALUES (p_id, 'transferred', rx.assigned_org_id, p_to_org_id, auth.uid());

  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id;
  RETURN rx;
END;
$$;

-- =====================================================================
-- RPC: dispense a held prescription (irreversible).
-- Honours repeats: stays held until all issues used, then 'dispensed'.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_dispense(p_id uuid)
RETURNS ps_peps_prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rx ps_peps_prescriptions;
  total_issues integer;
BEGIN
  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescription not found'; END IF;
  IF rx.status <> 'held' THEN RAISE EXCEPTION 'Only held prescriptions can be dispensed'; END IF;
  PERFORM ps_peps_assert_member(rx.assigned_org_id);

  total_issues := rx.repeats + 1;  -- initial issue + repeats

  UPDATE ps_peps_prescriptions
    SET repeats_dispensed = rx.repeats_dispensed + 1,
        dispensed_at = now(),
        dispensed_by = auth.uid(),
        status = CASE WHEN rx.repeats_dispensed + 1 >= total_issues THEN 'dispensed' ELSE 'held' END
    WHERE id = p_id;

  INSERT INTO ps_peps_events (prescription_id, event_type, from_org_id, actor_user_id, metadata)
    VALUES (p_id, 'dispensed', rx.assigned_org_id, auth.uid(),
            jsonb_build_object('issue', rx.repeats_dispensed + 1, 'of', total_issues));

  SELECT * INTO rx FROM ps_peps_prescriptions WHERE id = p_id;
  RETURN rx;
END;
$$;

-- =====================================================================
-- RPC: spine search — locate a patient's prescriptions across pharmacies
-- WITHOUT exposing clinical contents. Returns only where each script is.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_spine_search(p_query text)
RETURNS TABLE (
  id uuid,
  prescription_ref text,
  patient_name text,
  prescription_date date,
  status text,
  location text,
  is_open boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    rx.id,
    rx.prescription_ref,
    COALESCE(rx.patient_snapshot->>'full_name',
             trim(concat(rx.patient_snapshot->>'first_name', ' ', rx.patient_snapshot->>'last_name'))) AS patient_name,
    rx.prescription_date,
    rx.status,
    CASE
      WHEN rx.status = 'available' AND rx.assigned_org_id IS NULL THEN 'Spine (unclaimed)'
      WHEN rx.status = 'dispensed' THEN 'Dispensed'
      WHEN rx.status = 'cancelled' THEN 'Cancelled'
      ELSE COALESCE(org.name, 'A pharmacy')
    END AS location,
    (rx.status = 'available' AND rx.assigned_org_id IS NULL) AS is_open
  FROM ps_peps_prescriptions rx
  LEFT JOIN ps_organisations org ON org.id = rx.assigned_org_id
  WHERE p_query IS NOT NULL AND length(trim(p_query)) >= 2
    AND (
      COALESCE(rx.patient_snapshot->>'full_name','') ILIKE '%' || p_query || '%'
      OR COALESCE(rx.patient_snapshot->>'first_name','') ILIKE '%' || p_query || '%'
      OR COALESCE(rx.patient_snapshot->>'last_name','') ILIKE '%' || p_query || '%'
      OR COALESCE(rx.patient_snapshot->>'nhs_number','') ILIKE '%' || p_query || '%'
      OR rx.prescription_ref ILIKE '%' || p_query || '%'
    )
  ORDER BY rx.prescription_date DESC
  LIMIT 50;
$$;

-- =====================================================================
-- RPC: dm+d drug search for the prescription writer (excludes CDs).
-- Searches generics (VMP) and brands (AMP) by name.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_dmd_search(p_query text)
RETURNS TABLE (
  code text,
  dmd_type text,
  name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT trim(p_query) AS term)
  SELECT * FROM (
    SELECT v.vpid AS code, 'vmp'::text AS dmd_type, v.nm AS name
    FROM dmd_vmp v, q
    WHERE q.term <> ''
      AND v.invalid IS DISTINCT FROM '1'
      AND (v.cat_cd IS NULL OR v.cat_cd = '0000')   -- 0000 = no controlled-drug status
      AND v.nm ILIKE '%' || q.term || '%'
    UNION ALL
    SELECT a.apid AS code, 'amp'::text AS dmd_type, a.nm AS name
    FROM dmd_amp a
    JOIN dmd_vmp av ON av.vpid = a.vpid, q
    WHERE q.term <> ''
      AND a.invalid IS DISTINCT FROM '1'
      AND (av.cat_cd IS NULL OR av.cat_cd = '0000')  -- 0000 = no controlled-drug status
      AND a.nm ILIKE '%' || q.term || '%'
  ) results
  ORDER BY (name ILIKE p_query || '%') DESC, length(name), name
  LIMIT 30;
$$;

-- =====================================================================
-- RPC: pharmacy directory search (for routing). Pharmacies are global;
-- returns active pharmstation orgs by name / ODS.
-- =====================================================================
CREATE OR REPLACE FUNCTION ps_peps_pharmacy_search(p_query text)
RETURNS TABLE (id uuid, name text, ods_code text, address jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, o.ods_code, o.address
  FROM ps_organisations o
  WHERE o.is_active = true
    AND length(trim(p_query)) >= 2
    AND (o.name ILIKE '%' || p_query || '%' OR o.ods_code ILIKE '%' || p_query || '%')
  ORDER BY o.name
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION ps_peps_download(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_pharmacy_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_release(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_dispense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_spine_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION ps_peps_dmd_search(text) TO authenticated;
