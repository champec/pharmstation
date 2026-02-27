# NHS Claims — Database Schema

> **Version:** 1.0
> **Author:** Lead Architect
> **Date:** 26 February 2026

---

## Overview

> **⚠️ Revised Architecture — 26 February 2026**
>
> NHS claims do NOT replace or duplicate the existing services system. The existing `ps_services` / `ps_service_forms` / `ps_service_form_fields` / `ps_service_deliveries` tables remain **unchanged**. This schema adds:
> 1. New columns on `ps_service_library` and `ps_services` to mark NHS services
> 2. Three new claims tracking tables linked back to `ps_service_deliveries` via FK
> 3. New columns on `ps_organisations` for ODS code and NHS BSA config

The key relationship:
```
ps_service_deliveries (existing — clinical record)
    └── ps_nhs_claim_submissions (NEW — NHSBSA submission tracking)
            └── ps_nhs_submission_attempts (NEW — per-API-call audit log)

ps_nhs_patient_pds_cache (NEW — PDS lookup cache)
```

---

## Table: `ps_nhs_claim_submissions`

The master record for each NHS service claim.

```sql
CREATE TYPE nhs_service_type AS ENUM (
  'cpcs_emg_med',
  'cpcs_min_ill',
  'cpcs_emg_uec',
  'cpcs_min_ill_uec',
  'cpcs_ccs',
  'flu_vac',
  'covid_vac',
  'gp_covid_vac',
  'scs',
  'contraception',
  'cvd_hypertension',
  'nms'
);

CREATE TYPE nhs_claim_status AS ENUM (
  'draft',
  'pending',
  'submitted',
  'accepted',
  'rejected',
  'updated',
  'deleted'
);

CREATE TABLE ps_nhs_claim_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id          uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  service_delivery_id uuid REFERENCES ps_service_deliveries(id) ON DELETE SET NULL,  -- ← LINK to existing system
  service_type        nhs_service_type NOT NULL,
  platform_deposit_id text NOT NULL UNIQUE,   -- e.g. PSN-TEST-orgid-timestamp
  claim_year_month    text NOT NULL,           -- yyyy-MM format
  status              nhs_claim_status NOT NULL DEFAULT 'draft',
  payload             jsonb NOT NULL,          -- full payload sent to NHSBSA (built from service_delivery.form_data)
  bsa_response        jsonb,                   -- raw NHSBSA response
  submitted_at        timestamptz,
  last_updated_at     timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_nhs_claims_org_id ON ps_nhs_claim_submissions(org_id);
CREATE INDEX idx_nhs_claims_patient_id ON ps_nhs_claim_submissions(patient_id);
CREATE INDEX idx_nhs_claims_delivery_id ON ps_nhs_claim_submissions(service_delivery_id);
CREATE INDEX idx_nhs_claims_service_type ON ps_nhs_claim_submissions(service_type);
CREATE INDEX idx_nhs_claims_status ON ps_nhs_claim_submissions(status);
CREATE INDEX idx_nhs_claims_year_month ON ps_nhs_claim_submissions(claim_year_month);
CREATE INDEX idx_nhs_claims_created_at ON ps_nhs_claim_submissions(created_at DESC);
```

### RLS Policies

```sql
ALTER TABLE ps_nhs_claim_submissions ENABLE ROW LEVEL SECURITY;

-- Org members can read their org's claims
CREATE POLICY "org_members_read_claims"
  ON ps_nhs_claim_submissions FOR SELECT
  USING (
    org_id IN (
      SELECT organisation_id FROM ps_staff
      WHERE user_id = auth.uid()
    )
  );

-- Org members can insert claims for their org
CREATE POLICY "org_members_insert_claims"
  ON ps_nhs_claim_submissions FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT organisation_id FROM ps_staff
      WHERE user_id = auth.uid()
    )
  );

-- Org members can update their org's claims (for draft/update operations)
CREATE POLICY "org_members_update_claims"
  ON ps_nhs_claim_submissions FOR UPDATE
  USING (
    org_id IN (
      SELECT organisation_id FROM ps_staff
      WHERE user_id = auth.uid()
    )
  );
```

---

## Table: `ps_nhs_submission_attempts`

Audit log of every API call made to NHSBSA. Every attempt (including failures and retries) is logged here.

```sql
CREATE TABLE ps_nhs_submission_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES ps_nhs_claim_submissions(id) ON DELETE CASCADE,
  attempt_number      int NOT NULL DEFAULT 1,
  http_method         text NOT NULL CHECK (http_method IN ('POST', 'PUT', 'GET', 'DELETE')),
  endpoint_url        text NOT NULL,
  request_payload     jsonb,
  response_status     int,
  response_body       jsonb,
  error_message       text,
  succeeded           boolean NOT NULL DEFAULT false,
  attempted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_submission_attempts_submission_id ON ps_nhs_submission_attempts(submission_id);
CREATE INDEX idx_submission_attempts_attempted_at ON ps_nhs_submission_attempts(attempted_at DESC);
```

### RLS Policies

```sql
ALTER TABLE ps_nhs_submission_attempts ENABLE ROW LEVEL SECURITY;

-- Org members can only read attempts for claims belonging to their org
CREATE POLICY "org_members_read_attempts"
  ON ps_nhs_submission_attempts FOR SELECT
  USING (
    submission_id IN (
      SELECT id FROM ps_nhs_claim_submissions
      WHERE org_id IN (
        SELECT organisation_id FROM ps_staff WHERE user_id = auth.uid()
      )
    )
  );

-- Only Edge Functions (service role) can insert attempts
CREATE POLICY "service_role_insert_attempts"
  ON ps_nhs_submission_attempts FOR INSERT
  WITH CHECK (true); -- Enforced at Edge Function level with service role key
```

---

## Table: `ps_nhs_patient_pds_cache`

Cache of PDS (Personal Demographics Service) lookup results, linked to patients.

```sql
CREATE TABLE ps_nhs_patient_pds_cache (
  nhs_number          text PRIMARY KEY,
  patient_id          uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  org_id              uuid REFERENCES ps_organisations(id) ON DELETE CASCADE,
  pds_family_name     text,
  pds_given_names     text[],
  pds_dob             date,
  pds_gender          text,
  pds_address_line1   text,
  pds_address_postcode text,
  pds_gp_ods          text,
  pds_restricted      boolean DEFAULT false,
  full_pds_response   jsonb,
  last_verified_at    timestamptz NOT NULL DEFAULT now(),
  verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_pds_cache_patient_id ON ps_nhs_patient_pds_cache(patient_id);
CREATE INDEX idx_pds_cache_org_id ON ps_nhs_patient_pds_cache(org_id);
CREATE INDEX idx_pds_cache_last_verified ON ps_nhs_patient_pds_cache(last_verified_at DESC);
```

### RLS Policies

```sql
ALTER TABLE ps_nhs_patient_pds_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_pds_cache"
  ON ps_nhs_patient_pds_cache FOR SELECT
  USING (
    org_id IN (
      SELECT organisation_id FROM ps_staff WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_upsert_pds_cache"
  ON ps_nhs_patient_pds_cache FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT organisation_id FROM ps_staff WHERE user_id = auth.uid()
    )
  );
```

---

## Columns to add to existing tables

### `ps_organisations` — NHS configuration

```sql
ALTER TABLE ps_organisations
  ADD COLUMN IF NOT EXISTS ods_code text,
  ADD COLUMN IF NOT EXISTS nhs_bsa_environment text DEFAULT 'staging' CHECK (nhs_bsa_environment IN ('staging', 'production')),
  ADD COLUMN IF NOT EXISTS nhs_ip_whitelist_registered boolean DEFAULT false;
```

### `ps_service_library` — NHS service metadata

```sql
ALTER TABLE ps_service_library
  ADD COLUMN IF NOT EXISTS is_nhs_service boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nhs_service_type text;  -- maps to nhs_service_type enum values

-- e.g. seed data:
INSERT INTO ps_service_library (name, description, category, is_nhs_service, nhs_service_type) VALUES
  ('CPCS — Emergency Medicine',      'Community Pharmacist Consultation Service: Emergency Medicine Supply', 'nhs_advanced_service', true, 'cpcs_emg_med'),
  ('CPCS — Minor Illness',           'Community Pharmacist Consultation Service: Minor Illness', 'nhs_advanced_service', true, 'cpcs_min_ill'),
  ('Pharmacy First',                 'NHS Pharmacy First (CCS) — 7 clinical pathways: Acute Otitis Media, Shingles, Infected Insect Bites, Sinusitis, Impetigo, Uncomplicated UTI, Acute Sore Throat', 'nhs_advanced_service', true, 'cpcs_ccs'),
  ('Flu Vaccination',                'NHS Flu Vaccination Service', 'nhs_advanced_service', true, 'flu_vac'),
  ('New Medicines Service',          'NHS New Medicines Service', 'nhs_advanced_service', true, 'nms'),
  ('Hypertension Case-Finding',      'NHS Hypertension Case-Finding Service (CVD)', 'nhs_advanced_service', true, 'cvd_hypertension'),
  ('Smoking Cessation Service',      'NHS Stop Smoking Service', 'nhs_advanced_service', true, 'scs'),
  ('Contraception Service',          'NHS Contraception Service', 'nhs_advanced_service', true, 'contraception'),
  ('COVID-19 Vaccination',           'NHS COVID-19 Vaccination Service', 'nhs_advanced_service', true, 'covid_vac');
```

### `ps_services` — NHS flag (inherited from library, exposed here for easy query)

```sql
ALTER TABLE ps_services
  ADD COLUMN IF NOT EXISTS is_nhs_service boolean NOT NULL DEFAULT false;
```

---

## Notes

- The `payload` jsonb column in `ps_nhs_claim_submissions` stores the **full claim payload** as sent to NHSBSA. This is built at submission time by combining `ps_service_deliveries.form_data` + patient NHS number + org ODS code. This allows re-submission without re-entering data.
- The `bsa_response` jsonb stores the raw NHSBSA response. For accepted claims, this contains the BSA claim reference number.
- PDS cache entries should be considered stale after 24 hours — always re-verify before claim submission if cached entry is older.
- NHS numbers must be validated (Luhn-like check mod-11 algorithm) before storage.
- `ps_service_form_fields` for NHS services have field keys that **map directly to NHSBSA payload field names** (e.g. `CONSULTATION_METHOD`, `PATIENT_GPODS`). The Edge Function reads `form_data` and uses these keys directly to construct the NHSBSA payload.
- `is_required = true` on mandatory NHSBSA fields — the form cannot be submitted without them. Non-NHSBSA fields (pharmacy notes etc.) can be added by the pharmacy as optional fields.

---

## ⚠️ CRITICAL — Service Forms Architecture & RLS

> **Added 27 February 2026** after debugging empty forms bug.
> **This section is mandatory reading for any agent working on services or forms.**

### Foreign Key Relationship

`ps_service_forms.service_id` has a **foreign key to `ps_service_library.id`** — NOT to `ps_services.id`.

```
ps_service_library (global templates)
    └── ps_service_forms (form templates, FK → ps_service_library.id)
            └── ps_service_form_fields (field definitions, FK → ps_service_forms.id)

ps_services (org-level subscribed services)
    └── ps_services.library_service_id → ps_service_library.id  (reference, not FK on forms)
```

This means:
1. **Forms are library-level templates**, shared across all orgs that subscribe to a library service.
2. **Forms do NOT belong to `ps_services`** — you cannot insert a form with `service_id = ps_services.id` (FK violation).
3. When an org subscribes to a library service, it creates a `ps_services` row with `library_service_id` pointing back to the library entry. The forms remain on the library.

### RLS Implications

The default RLS policy `org_members_crud_service_forms` checks:
```sql
service_id IN (SELECT ps_services.id FROM ps_services WHERE ps_services.org_id IN (SELECT ps_get_user_org_ids()))
```
This **only matches forms where `service_id` is a `ps_services.id`** — which library-level forms are not.

**Solution (applied 27 Feb 2026):** Two additional RLS policies were added:

1. **`subscribed_read_library_forms`** on `ps_service_forms`:
   ```sql
   service_id IN (
     SELECT s.library_service_id FROM ps_services s
     WHERE s.org_id IN (SELECT ps_get_user_org_ids())
       AND s.library_service_id IS NOT NULL
   )
   ```

2. **`subscribed_read_library_form_fields`** on `ps_service_form_fields`:
   ```sql
   form_id IN (
     SELECT f.id FROM ps_service_forms f
     WHERE f.service_id IN (
       SELECT s.library_service_id FROM ps_services s
       WHERE s.org_id IN (SELECT ps_get_user_org_ids())
         AND s.library_service_id IS NOT NULL
     )
   )
   ```

These allow authenticated users to **read** library forms when their org has subscribed to that library service.

### Query Pattern (IMPORTANT)

When loading forms for a service, you MUST query **both** the org-level service ID and the library service ID:

```typescript
// In fetchServiceDetail():
const formServiceIds = [serviceId]
if (service.library_service_id) {
  formServiceIds.push(service.library_service_id)
}
const { data } = await client
  .from('ps_service_forms')
  .select('*')
  .in('service_id', formServiceIds)
```

A simple `.eq('service_id', serviceId)` will return **zero forms** for library-based services — this was the root cause of the "empty forms" bug.

### Options Column Format

`ps_service_form_fields.options` is a `jsonb` column. For NHS service forms, it stores a **plain JSON array** of option codes:

```json
["FACE_TO_FACE", "TELEPHONE", "VIDEO"]
```

It does **NOT** use the `{ values: [...] }` wrapper format. Frontend code must handle both formats:

```typescript
const optionValues: string[] = Array.isArray(field.options)
  ? field.options                          // plain array (NHS forms)
  : Array.isArray((field.options as any)?.values)
    ? (field.options as any).values        // { values: [...] } format (custom forms)
    : []
```

NHS option codes (e.g. `A_O_M`, `SHG`, `U_UTI`) need human-readable labels in the UI. These are mapped in `ServiceDeliveryPage.tsx` via the `NHS_OPTION_LABELS` lookup and `optionLabel()` helper.
