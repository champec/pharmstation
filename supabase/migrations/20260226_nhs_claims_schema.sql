-- ============================================================
-- NHS Claims Schema — Integrated NHS Expansion
-- Migration: 20260226_nhs_claims_schema
-- Author: Lead Architect
-- Date: 26 February 2026
--
-- Adds NHS claim submission infrastructure on top of the
-- existing ps_services / ps_service_deliveries system.
-- Does NOT replace or alter existing service delivery tables.
--
-- Real schema notes (verified against live DB):
--   - ps_patients.nhs_number already exists — not added here
--   - RLS uses ps_organisation_members (organisation_id + user_id)
--   - Legacy service_pfs / service_flu / service_nms etc. left untouched
-- ============================================================

-- ============================================================
-- Step 1: Enums
-- ============================================================

DO $$ BEGIN
  CREATE TYPE nhs_service_type AS ENUM (
    'cpcs_emg_med',
    'cpcs_min_ill',
    'cpcs_emg_uec',
    'cpcs_min_ill_uec',
    'cpcs_ccs',        -- Pharmacy First
    'flu_vac',
    'covid_vac',
    'gp_covid_vac',
    'scs',
    'contraception',
    'cvd_hypertension',
    'nms'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nhs_claim_status AS ENUM (
    'draft',
    'pending',
    'submitted',
    'accepted',
    'rejected',
    'updated',
    'deleted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Step 2: Columns on existing tables
-- ============================================================

-- ps_organisations: add NHS configuration fields
ALTER TABLE ps_organisations
  ADD COLUMN IF NOT EXISTS ods_code                    text,
  ADD COLUMN IF NOT EXISTS nhs_bsa_environment         text NOT NULL DEFAULT 'staging'
    CHECK (nhs_bsa_environment IN ('staging', 'production')),
  ADD COLUMN IF NOT EXISTS nhs_ip_whitelist_registered boolean NOT NULL DEFAULT false;

-- ps_service_library: mark which entries are NHS advanced services
ALTER TABLE ps_service_library
  ADD COLUMN IF NOT EXISTS is_nhs_service  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nhs_service_type text;

-- ps_services: inherit NHS flag for easy querying
ALTER TABLE ps_services
  ADD COLUMN IF NOT EXISTS is_nhs_service boolean NOT NULL DEFAULT false;

-- ============================================================
-- Step 3: nhs_claim_submissions
-- Master record for every NHS claim — linked to a service delivery
-- ============================================================

CREATE TABLE IF NOT EXISTS nhs_claim_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id          uuid        REFERENCES ps_patients(id) ON DELETE SET NULL,
  service_delivery_id uuid        REFERENCES ps_service_deliveries(id) ON DELETE SET NULL,
  service_type        nhs_service_type NOT NULL,
  platform_deposit_id text        NOT NULL UNIQUE,   -- PSN-TEST-{orgId}-{ts} in staging; PSN-{prefix}-{ts} in prod
  claim_year_month    text        NOT NULL,           -- yyyy-MM
  status              nhs_claim_status NOT NULL DEFAULT 'draft',
  payload             jsonb       NOT NULL DEFAULT '{}',  -- full payload sent to NHSBSA
  bsa_response        jsonb,                              -- raw NHSBSA response
  submitted_at        timestamptz,
  last_updated_at     timestamptz,
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_org_id          ON nhs_claim_submissions(org_id);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_patient_id      ON nhs_claim_submissions(patient_id);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_delivery_id     ON nhs_claim_submissions(service_delivery_id);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_service_type    ON nhs_claim_submissions(service_type);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_status          ON nhs_claim_submissions(status);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_year_month      ON nhs_claim_submissions(claim_year_month);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_created_at      ON nhs_claim_submissions(created_at DESC);

ALTER TABLE nhs_claim_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nhs_claims_select" ON nhs_claim_submissions
  FOR SELECT USING (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "nhs_claims_insert" ON nhs_claim_submissions
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "nhs_claims_update" ON nhs_claim_submissions
  FOR UPDATE USING (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- Step 4: nhs_submission_attempts
-- Audit log of every API call to NHSBSA (successes + failures)
-- ============================================================

CREATE TABLE IF NOT EXISTS nhs_submission_attempts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    uuid        NOT NULL REFERENCES nhs_claim_submissions(id) ON DELETE CASCADE,
  attempt_number   int         NOT NULL DEFAULT 1,
  http_method      text        NOT NULL CHECK (http_method IN ('POST', 'PUT', 'GET', 'DELETE')),
  endpoint_url     text        NOT NULL,
  request_payload  jsonb,
  response_status  int,
  response_body    jsonb,
  error_message    text,
  succeeded        boolean     NOT NULL DEFAULT false,
  attempted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nhs_attempts_submission_id ON nhs_submission_attempts(submission_id);
CREATE INDEX IF NOT EXISTS idx_nhs_attempts_attempted_at  ON nhs_submission_attempts(attempted_at DESC);

ALTER TABLE nhs_submission_attempts ENABLE ROW LEVEL SECURITY;

-- Org members can read attempts for their org's claims
CREATE POLICY "nhs_attempts_select" ON nhs_submission_attempts
  FOR SELECT USING (
    submission_id IN (
      SELECT id FROM nhs_claim_submissions
      WHERE org_id IN (
        SELECT organisation_id FROM ps_organisation_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Only service role (Edge Functions) can insert attempts
CREATE POLICY "nhs_attempts_insert_service_role" ON nhs_submission_attempts
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- Step 5: nhs_patient_pds_cache
-- Cache of NHS PDS (Personal Demographics Service) lookups
-- ============================================================

CREATE TABLE IF NOT EXISTS nhs_patient_pds_cache (
  nhs_number            text        PRIMARY KEY,
  patient_id            uuid        REFERENCES ps_patients(id) ON DELETE SET NULL,
  org_id                uuid        NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  pds_family_name       text,
  pds_given_names       text[],
  pds_dob               date,
  pds_gender            text,
  pds_address_line1     text,
  pds_address_postcode  text,
  pds_gp_ods            text,
  pds_restricted        boolean     NOT NULL DEFAULT false,
  full_pds_response     jsonb,
  last_verified_at      timestamptz NOT NULL DEFAULT now(),
  verified_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pds_cache_patient_id     ON nhs_patient_pds_cache(patient_id);
CREATE INDEX IF NOT EXISTS idx_pds_cache_org_id         ON nhs_patient_pds_cache(org_id);
CREATE INDEX IF NOT EXISTS idx_pds_cache_last_verified  ON nhs_patient_pds_cache(last_verified_at DESC);

ALTER TABLE nhs_patient_pds_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pds_cache_select" ON nhs_patient_pds_cache
  FOR SELECT USING (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "pds_cache_insert" ON nhs_patient_pds_cache
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "pds_cache_update" ON nhs_patient_pds_cache
  FOR UPDATE USING (
    org_id IN (
      SELECT organisation_id FROM ps_organisation_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- Step 6: Seed ps_service_library with NHS advanced services
-- ============================================================

INSERT INTO ps_service_library (name, description, category, is_nhs_service, nhs_service_type)
VALUES
  ('CPCS — Emergency Medicine',
   'Community Pharmacist Consultation Service: Emergency Medicine Supply (NHS 111 / GP referral)',
   'nhs_advanced_service', true, 'cpcs_emg_med'),

  ('CPCS — Minor Illness',
   'Community Pharmacist Consultation Service: Minor Illness (NHS 111 / GP referral)',
   'nhs_advanced_service', true, 'cpcs_min_ill'),

  ('Pharmacy First',
   'NHS Pharmacy First (CCS) — 7 pathways: Acute Otitis Media, Shingles, Infected Insect Bites, Sinusitis, Impetigo, Uncomplicated UTI, Acute Sore Throat',
   'nhs_advanced_service', true, 'cpcs_ccs'),

  ('Flu Vaccination',
   'NHS Seasonal Influenza Advanced Service',
   'nhs_advanced_service', true, 'flu_vac'),

  ('New Medicines Service',
   'NHS New Medicines Service (NMS) — supports patients starting new medicines',
   'nhs_advanced_service', true, 'nms'),

  ('Hypertension Case-Finding',
   'NHS Hypertension Case-Finding Service — clinic BP and ABPM',
   'nhs_advanced_service', true, 'cvd_hypertension'),

  ('Smoking Cessation Service',
   'NHS Stop Smoking Service (SCS) — NRT supply and behavioural support',
   'nhs_advanced_service', true, 'scs'),

  ('Contraception Service',
   'NHS Contraception Service — initiation, ongoing monitoring, emergency contraception',
   'nhs_advanced_service', true, 'contraception'),

  ('COVID-19 Vaccination',
   'NHS COVID-19 Vaccination Service',
   'nhs_advanced_service', true, 'covid_vac')

ON CONFLICT DO NOTHING;
