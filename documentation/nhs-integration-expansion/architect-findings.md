# Architect Findings — Integrated NHS Expansion

> **Author:** Lead Architect (GitHub Copilot)
> **Date:** 26 February 2026
> **Based on:** Full audit of `/documentation/nhs/` — all API docs, MYS specs, onboarding docs

---

## 1. Executive Summary

PharmStation can become a fully accredited NHS service submission platform. The NHS Business Services Authority (NHS BSA) has provided documented REST APIs for every major community pharmacy advanced service. These APIs — accessed via the MYS (Manage Your Service) platform — are specifically designed to allow third-party software providers to **pre-populate and submit NHS claims on behalf of pharmacies**, replacing manual portal entry in tools like PharmOutcomes.

The key insight: **accreditation is granted per-platform, not per-pharmacy.** Once PharmStation is approved by NHSBSA as an IT supplier, every pharmacy using PharmStation can submit claims through our platform.

This is the exact same route PharmOutcomes and Sonar took.

---

## 2. What We're Integrating With

### 2.1 NHS BSA — MYS Platform APIs

The primary integration target. NHSBSA provides **seven distinct RESTful claim submission APIs** — one per advanced service. Each follows the same pattern: `POST` to create, `PUT` to update, `GET` to read, `DELETE` to remove.

| Service | API Base URL (staging) | Key Fields |
|---|---|---|
| **CPCS + Pharmacy First** (Emergency Med / Minor Illness / UEC / Pharmacy First) | `https://stg.services.nhsbsa.nhs.uk/pharmacy-cpcs-api/resources/Claim` | CLAIM_TYPE_CODE, PROVISION_DATE, CLAIMANT_ODS, PATIENT_NHSNO, REFERRAL details |
| **Flu Vaccination** | Same as CPCS (different CLAIM_TYPE_CODE) | DOSE_NUMBER, VACCINATION_SITE_ODS |
| **Smoking Cessation (SCS)** | `https://stg.api.scs.pharmacy.mys.nhsbsa.nhs.uk/v1/claims` | QUIT_DATE, NRT_PRODUCT, NUMBER_OF_CONSULTATIONS |
| **Contraception Service** | `https://stg.api.contraception.pharmacy.mys.nhsbsa.nhs.uk/v1/claim` | SERVICE_TYPE, CONTRACEPTION_METHOD, products array |
| **Hypertension Case-Finding (CVD)** | `https://stg.api.cvd.pharmacy.mys.nhsbsa.nhs.uk/v1/claim` | BP readings (systolic/diastolic), ABPM details, referral chain |
| **New Medicines Service (NMS)** | `https://stg.api.nms.pharmacy.mys.nhsbsa.nhs.uk/v1/claim` | CONDITION, PRODUCTS, CONSULT_OUTCOME, FOLLOW_UP |
| **COVID Vaccination** | Same as CPCS (CLAIM_TYPE_CODE: `COVID_VAC`, `GP_COVID_VAC`) | VACCINATION_SITE_ODS, DOSE_NUMBER |

> Production URLs follow the same pattern — replace `stg.` prefix with production domain.

### 2.2 NHS PDS FHIR API — Personal Demographics Service

Used for patient identity verification. When a pharmacist starts a consultation, PharmStation can look up the patient by NHS number (or search by name/DOB/postcode) against the national PDS database.

- **Endpoint:** `https://api.service.nhs.uk/personal-demographics/FHIR/R4/Patient`
- **Auth:** OAuth 2.0 (NHS CIS2 for healthcare worker access; application-restricted for back-end NHS number lookups)
- **Rate limit:** 5 TPS per app
- **Service level:** Platinum (24/7/365)
- **Use case for us:** Verify patient NHS number before claim submission; auto-fill patient demographic fields

### 2.3 Directory of Healthcare Services API v3

Used for GP practice ODS code lookup (required field in most MYS claims: `PATIENT_GPODS`).

- **Endpoint:** `https://api.nhs.uk/service-search/`
- **Auth:** Subscription key (simpler)
- **Service level:** Bronze (business hours only)
- **Use case:** Autocomplete GP practice field in service forms; validate ODS codes

### 2.4 MESH (Message Exchange for Social Care and Health)

Secure NHS messaging infrastructure. Not needed for MYS claim submission (those use direct REST), but may be needed for future integrations (e.g., EPS, referral notifications). Lower priority for MVP.

---

## 3. Authentication & Security Architecture

### 3.1 NHSBSA MYS APIs

These APIs use **IP whitelisting + HTTPS/TLSv1.2**. There is no OAuth — access is granted at the IP level for approved platforms.

**Implication:** PharmStation's claim submission engine must route all NHSBSA API calls through a **fixed set of Supabase Edge Functions** deployed on predictable infrastructure with static IP addresses. We cannot call NHSBSA APIs directly from the browser or from dynamic serverless functions with variable IPs.

**Solution:** Deploy dedicated Supabase Edge Functions for each service type. These functions have fixed edge network IPs that we register with NHSBSA during onboarding.

### 3.2 NHS Digital APIs (PDS, DoHS)

These use standard OAuth 2.0 / API key patterns.

- **PDS (application-restricted mode):** JWT-signed auth — suitable for server-side lookups
- **Directory of Healthcare Services:** Simple subscription-key header

**Implication:** Store API keys/secrets as Supabase Edge Function environment variables (never in client code). Use NHS sandbox environments for development.

### 3.3 PLATFORM_DEPOSIT_ID

Every NHSBSA claim requires a globally unique platform deposit ID using a pattern assigned by NHSBSA per approved platform. For example:
- PharmOutcomes: `PEM-nnnnnnnnn`
- Sonar: `SON-nnnnnnnn`
- **PharmStation (proposed):** `PSN-nnnnnnnnn`

This ID is the audit key — it prevents duplicate submissions and allows CRUD operations on any claim.

**Design:** Generate as `PSN-{orgOdsCode}-{unix_timestamp_ms}` locally, store in our DB, then include in every API call.

---

## 4. Integration Strategy — Existing Services System (REVISED)

> **⚠️ Architecture Correction — 26 February 2026**
>
> NHS advanced services are **NOT** a separate new subsystem. They integrate into the existing PharmStation services architecture.
> Do NOT create new service delivery tables or new service form infrastructure — use and extend what already exists.

### 4.1 Existing Services Architecture (What We Already Have)

PharmStation has a full flexible services system:

```
ps_service_library        → Platform-curated catalogue of service types
ps_services               → A pharmacy's enabled/subscribed services (org-scoped)
ps_service_forms          → Form attached to a service (versioned)
ps_service_form_fields    → Individual fields in a form (text/select/date/boolean etc.)
ps_service_deliveries     → Record of a service being delivered to a patient (form_data jsonb)
```

This system was built for **custom pharmacy services** (e.g. travel vaccinations, MURs, consultations). It is flexible by design. **NHS advanced services are just services with specific pre-defined fields.**

### 4.2 How NHS Services Fit In

| Existing Concept | NHS Interpretation |
|---|---|
| `ps_service_library` entry | Each NHS advanced service (CPCS, NMS, Flu, etc.) becomes a library item with `category = 'nhs_advanced_service'` and a `nhs_service_type` metadata field |
| `ps_services` (pharmacy enables it) | Pharmacy "subscribes" to e.g. CPCS by activating it from the library — same as any other service |
| `ps_service_forms` + `ps_service_form_fields` | Pre-seeded from the library with all NHSBSA-required fields. Pharmacies cannot remove mandatory fields; they can add optional fields |
| `ps_service_deliveries` | Clinical record when the service is delivered. `form_data jsonb` holds all NHSBSA required field values already |
| **NEW: `nhs_claim_submissions`** | The submission tracking record that **links to** a `ps_service_delivery` and holds NHSBSA submission state |

### 4.3 What Needs to Change / Be Added

**Database additions (minimal):**

1. Add `nhs_service_type text` column to `ps_service_library` — marks which NHSBSA claim type this maps to
2. Add `is_nhs_service boolean` flag to `ps_service_library` and `ps_services`
3. Create `nhs_claim_submissions` table with FK back to `ps_service_deliveries` — this is the submission tracking layer
4. Create `nhs_submission_attempts` — audit log of every API call
5. Create `nhs_patient_pds_cache` — PDS lookup cache keyed by NHS number

**Service library seeding:**
- Seed all 7 NHS advanced services into `ps_service_library` with `is_nhs_service = true`
- Pre-populate `ps_service_forms` and `ps_service_form_fields` for each — every NHSBSA required field pre-configured with correct type, label, `is_required = true`

**UI additions (additive, not replacement):**
- Within the existing services delivery flow: after a delivery is saved, show a **"Submit to NHS"** action button (only visible for NHS services)
- New **"NHS Submissions" tab** in the services section — shows all deliveries for NHS services alongside their claim status (`draft | pending | submitted | accepted | rejected`)
- Submission status badges on delivery records

### 4.4 Core Database Design

New tables only. Existing service tables are unchanged.

```
nhs_claim_submissions
  - id (uuid PK)
  - org_id (FK ps_organisations)
  - patient_id (FK ps_patients)
  - service_delivery_id (FK ps_service_deliveries)  ← KEY LINK to existing system
  - service_type (nhs_service_type enum)
  - platform_deposit_id (text UNIQUE) — PSN-XXXXX pattern
  - claim_year_month (text) — yyyy-MM
  - status (nhs_claim_status enum: draft | pending | submitted | accepted | rejected | updated | deleted)
  - submitted_at (timestamptz)
  - last_updated_at (timestamptz)
  - bsa_response (jsonb) — raw response from NHSBSA
  - payload (jsonb) — full claim payload sent (built from service_delivery.form_data + patient NHS number + org ODS)
  - created_by (uuid FK auth.users)
  - created_at (timestamptz)

nhs_submission_attempts
  - id (uuid PK)
  - submission_id (FK nhs_claim_submissions)
  - attempt_number (int)
  - http_method (text) — POST | PUT | GET | DELETE
  - request_payload (jsonb)
  - response_status (int)
  - response_body (jsonb)
  - attempted_at (timestamptz)
  - succeeded (boolean)

nhs_patient_pds_cache
  - nhs_number (text PK)
  - patient_id (FK ps_patients, nullable)
  - pds_response (jsonb) — cached PDS lookup result
  - last_verified_at (timestamptz)
  - verified_by (uuid FK auth.users)
```

### 4.5 Payload Construction Strategy

When a pharmacist clicks "Submit to NHS" on a delivery:

1. Load `ps_service_deliveries.form_data` (jsonb) — this contains all the form field values the pharmacist entered
2. Load `ps_patients` record — get NHS number, DOB, name
3. Load `ps_organisations` — get ODS code
4. Edge Function assembles the NHSBSA-shaped payload from these three sources
5. Generate `platform_deposit_id` as `PSN-{orgODS}-{timestamp_ms}`
6. POST to appropriate NHSBSA staging/production endpoint
7. Store result in `nhs_claim_submissions` + `nhs_submission_attempts`

**Key principle:** `form_data` in `ps_service_deliveries` IS the clinical record. The NHS submission is a thin layer on top that tracks what was submitted where and what the BSA said back.

---

## 5. Service-by-Service Field Analysis

### 5.1 Common Fields (All Services)

Every NHSBSA service claim requires these core fields:

| Field | Description |
|---|---|
| `PLATFORM_DEPOSIT_ID` | Unique claim ID assigned by platform (PSN-pattern) |
| `CLAIMANT_ODS` | Pharmacy's ODS code |
| `CLAIM_YEAR_MONTH` | yyyy-MM billing period |
| `PATIENT_NHSNO` | 10-digit NHS number (or special code if unavailable) |
| `PATIENT_GPODS` | Patient's GP practice ODS code |
| `ASSESSMENT_DATE` | Date of consultation |
| `CONSULTATION_METHOD` | Face-to-face / Phone / Video / Online |
| `PROFESSIONAL_ROLE` | Pharmacist / Pharmacy Technician / IP |

### 5.2 Service-Specific Unique Fields

**CPCS (Emergency Medicine / Minor Illness):**
- `CLAIM_TYPE_CODE` — distinguishes EMG_MED / MIN_ILL / EMG_MED_UEC / MIN_ILL_UEC
- `REFERRAL_DATE`, `REFERRER_ORG_ODS` — NHS 111 or GP referral source
- Drug supply details: `DRUG_CODE`, `DRUG_DESC`, `QUANTITY`, `MEDICATION_SUPPLY_TYPE`
- `URGENCY_OF_REFERRAL`, `DISPOSITION_CODE` (Dx code from NHS 111 CDSS)

**Pharmacy First (CCS — Community Consultation Service):**
> Launched **31 January 2024**. Uses the **same CPCS API** with `CLAIM_TYPE_CODE: CCS`. Pharmacists can consult, diagnose, and supply a POM under a Patient Group Direction (PGD) for 7 specific pathways — without a GP referral. This is a distinct patient-initiated pathway (no NHS 111 referral required).

- `CLAIM_TYPE_CODE` = `CCS`
- `CCS_PRESENTING_COMPLAINT_OR_ISSUE` — **mandatory** for CCS, selects one of the 7 conditions:

  | Code | Condition |
  |---|---|
  | `A_O_M` | Acute Otitis Media (earache) |
  | `SHG` | Shingles |
  | `I_I_B` | Infected Insect Bites |
  | `SNT` | Sinusitis |
  | `ITG` | Impetigo |
  | `U_UTI` | Uncomplicated UTI |
  | `A_S_T` | Acute Sore Throat |

- **Special rule:** If `CCS_PRESENTING_COMPLAINT_OR_ISSUE` = `A_O_M` (Acute Otitis Media), then `CONSULTATION_METHOD` **must be face-to-face only**. Any other method is rejected by the API.
- `PROFESSIONAL_IDENTIFIER` — **mandatory for CCS** (GPhC or NMC registration number of the clinician supplying)
- `PROFESSIONAL_ROLE` — mandatory (Pharmacist / IP / Pharmacy Technician)
- `CCS_NO_SUPPLY_REASON` — if no POM was supplied, must provide one of:
  - `A` — Patient does not meet inclusion criteria under PGD
  - `B` — Patient excluded under PGD
  - `C` — Patient does not consent
  - `D` — Shared decision: self-care preferred
  - `E` — Shared decision: delay treatment
  - `F` — Other
- `CONSULTATION_METHOD`, `CONSULTATION_OUTCOME`, `ONWARD_REFERRAL_REASON`, `REFERRED_ODS` — same as regular CPCS
- No `DISPOSITION_CODE` or `REFERRAL_DATE` required (patient walks in directly)

**Flu / COVID Vaccination:**
- `DOSE_NUMBER`, `VACCINATION_SITE_ODS`
- Flu: specific approved vaccine list (changes annually)
- COVID: `HOME_BOUND`, `OTHER_RESIDENTIAL` treatment supplement

**Smoking Cessation (SCS):**
- `QUIT_DATE` (4-week target)
- `NUMBER_OF_CONSULTATIONS`, `NUMBER_OF_SUPPORT_WEEKS`
- `NRT_PRODUCT` (array — specific NRT products from approved list)
- `4_WEEKS_POST_QUIT`, `12_WEEKS_POST_QUIT` outcome flags
- `PREGNANCY_STATUS`, `E_CIGARETTES_USED`

**Contraception Service:**
- `SERVICE_TYPE` — Initiation / Ongoing monitoring / Emergency
- `CONTRACEPTION_METHOD` (array — multiple methods possible)
- `PRODUCT_SUPPLY_TYPE` — OTC / POM / Patient group direction
- `PROFESSIONAL_IDENTIFIER` — GPhC / NMC number

**Hypertension Case-Finding (CVD):**
- Two sub-workflows: Clinic BP test + ABPM (Ambulatory Blood Pressure Monitoring)
- `CLINIC_BP_PROVIDED` flag, then full `clinicTestDetails` object
- `ABPM_UNDERTAKEN` flag, then full `abpmDetails` object
- Blood pressure readings: `SYSTOLIC`, `DIASTOLIC`, `PULSE_RATE`, rating
- `HEALTHY_LIVING_ADVICE` (array of advice given)
- Escalation/onward referral chain

**New Medicines Service (NMS):**
- `PRESCRIPTION_DATE`, `CONDITIONS` (array)
- `NMS_PRODUCTS` (array with product details + whether patient is using medicine)
- `CONSULTATION_OUTCOME` — follow-up result
- `NOT_USING_MEDICINE_REASON` (array)

---

## 6. Frontend UX Architecture (REVISED)

NHS integration is **additive** to the existing services UI. We are not building a separate NHS section — we are extending the existing services flow.

### 6.1 Existing Services Flow (Unchanged)

```
Services list → Select service → Fill form → Submit delivery → View record
```

### 6.2 NHS Extension Points

**On NHS service delivery forms:**
- Pre-populate patient NHS number from `ps_patients` (if stored)
- NHS number lookup button → triggers PDS FHIR lookup → fills/verifies patient details
- GP practice autocomplete field → triggers DoHS API for ODS code search
- All mandatory NHSBSA fields marked with NHS badge / required indicator
- Saving the delivery creates `ps_service_deliveries` as normal

**On the delivery record (post-save):**
- "Submit to NHS" button (only visible for NHS services)
- If already submitted: show claim status badge (`Submitted`, `Accepted`, `Rejected`)
- If rejected: show rejection reason + "Resubmit" / "Edit & Resubmit" options

### 6.3 New NHS Submissions Tab

A new tab **"NHS Claims"** within the services section (not a separate top-level route). Shows:
- All NHS service deliveries and their claim lifecycle
- Filter by service type, status, date range
- Bulk submission option (submit multiple draft claims at once)
- Monthly summary: total submitted, total accepted, total rejected, reimbursement estimate

**Route structure (minimal additions):**
```
/services/nhs-claims                    → NHS Claims tab (all submissions)
/services/nhs-claims/:submissionId      → Individual claim detail / edit / resubmit
/settings/nhs                           → NHS Settings (ODS code, BSA env toggle, IP status)
```

All other service routes remain unchanged. NHS services appear in the regular `/services` list alongside custom services, just with an NHS badge.

---

## 7. Back-End Architecture (Edge Functions)

One Edge Function per service type, responsible for:
1. Receiving the validated payload from the frontend
2. Generating `PLATFORM_DEPOSIT_ID`
3. Calling the NHSBSA staging/production endpoint
4. Logging the attempt in `nhs_submission_attempts`
5. Updating `nhs_claim_submissions.status` based on response
6. Returning result to client

**Edge Functions required:**
- `nhs-claim-cpcs` — handles all CPCS/Flu/COVID claim types
- `nhs-claim-scs` — Smoking Cessation
- `nhs-claim-contraception` — Contraception Service
- `nhs-claim-cvd` — Hypertension Case-Finding
- `nhs-claim-nms` — New Medicines Service
- `nhs-pds-lookup` — PDS patient lookup/verify
- `nhs-gp-search` — GP ODS code search via Directory of Healthcare Services

---

## 8. Onboarding & Accreditation Path

This is the **critical path** — we cannot submit live claims until NHSBSA approves us.

### Step 1 — NHS Developer Portal (DONE partially)
- ✅ App registered: PharmStation (`04cc89f0-3d9b-44d2-ba18-dd6ae18f9f7a`)
- ⬜ Select APIs: PDS FHIR, Directory of Healthcare Services v3, MESH
- ⬜ Complete use case confirmation for each API

### Step 2 — NHSBSA MYS Supplier Onboarding
- Contact: `mys-platform@nhsbsa.nhs.uk`
- Request: IT supplier integration access for each advanced service
- Provide: Platform name, use case description, technical contact
- Receive: Staging credentials, `PLATFORM_DEPOSIT_ID` prefix (e.g., `PSN-`)
- Register: Production IP addresses for IP whitelisting

### Step 3 — Integration Testing
- Test all 7 service APIs against staging endpoints
- Submit test claims, verify responses, test update/delete operations
- Validate `PLATFORM_DEPOSIT_ID` uniqueness enforcement

### Step 4 — Clinical Safety & Assurance
- Prepare Clinical Safety Case (DCB0129 standard)
- Demonstrate data governance and patient data handling

### Step 5 — Go Live
- Switch Edge Functions to production endpoints
- First pharmacy pilots (start with one pharmacy under test conditions)

---

## 9. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| NHSBSA rejects IP whitelist from Supabase Edge | ~~High~~ **Resolved** | Using outbound proxy VPS with static IP — not Supabase Edge IPs directly |
| PLATFORM_DEPOSIT_ID prefix not assigned | High | Email NHSBSA early; use temp prefix in staging |
| NHS API rate limits under load | Medium | Queue submissions; retry with backoff |
| Patient NHS number not available | Medium | Support NHSBSA fallback codes (NO_NHS_NUMBER, TRACE_FAIL, etc.) |
| Claim rejected post-submission | Medium | Status tracking + pharmacist notification + easy re-submit UI |
| Service spec changes (NHSBSA updates annually) | Low-Medium | Version API fields; monitor changelog; watch for annual flu vaccine list updates |
| Supabase Edge IPs not fixed | ~~High~~ **Resolved** | Outbound proxy VPS (Hetzner CX11, Nginx). Edge Functions → proxy (static IP) → NHSBSA. Proxy needed for production only; staging unaffected. |

---

## 10. Competitive Positioning

PharmOutcomes currently charges pharmacies a monthly fee to use their platform for NHS service submissions. PharmStation building this natively means:

- Pharmacies using PharmStation get **NHS claim submission included** in their subscription
- No need to context-switch between two apps
- Service records and claims are in one place with full audit trail
- Potential to offer real-time claim status dashboards PharmOutcomes does not provide

---

## 11. Recommended Build Order (REVISED)

```
Phase A — Foundation & Onboarding
  A1. NHSBSA & NHS developer portal onboarding (human action — email NHS BSA)
  A2. DB: Add nhs_service_type + is_nhs_service columns to ps_service_library/ps_services
  A3. DB: nhs_claim_submissions, nhs_submission_attempts, nhs_patient_pds_cache tables
  A4. Seed ps_service_library with all 7 NHS advanced services + pre-configured forms/fields
  A5. TypeScript types for NHS claims, service types, PDS patient
  A6. Investigate Supabase Edge Function static egress IP (critical blocker)
  A7. Edge Function scaffolding (skeleton, stubbed)
  A8. NHS Settings page (/settings/nhs) — ODS code, BSA env toggle

Phase B — Core Services (highest volume / most common)
  B1. CPCS (Emergency Medicine + Minor Illness) — form seeding + Edge Function + UI hooks
  B2. Flu Vaccination — form seeding + Edge Function (re-uses CPCS) + UI hooks
  B3. NMS — form seeding + Edge Function + UI hooks
  → For each: "Submit to NHS" button on delivery, status badge on delivery record

Phase C — Advanced Services
  C1. Hypertension Case-Finding (CVD) — complex form with branching BP/ABPM
  C2. Smoking Cessation (SCS) — NRT product list, multi-consultation tracking
  C3. Contraception Service — arrays of methods + products
  C4. COVID Vaccination — re-uses CPCS Edge Function

Phase D — Patient Verification Layer
  D1. PDS NHS number lookup in patient creation/edit + claim form
  D2. GP ODS code autocomplete via DoHS API

Phase E — NHS Claims Tab & Dashboard
  E1. NHS Claims tab in services section (/services/nhs-claims)
  E2. Bulk submission, filters, monthly summary
  E3. Rejected claims management (resubmit / edit + resubmit)

Phase F — Production Readiness
  F1. Clinical Safety Case (DCB0129) — human + legal
  F2. End-to-end staging acceptance testing
  F3. Switch Edge Functions to production endpoints
```

---

## 12. Open Questions (To Resolve Before Build Starts)

1. ~~**Supabase Edge Function IP addresses**~~ **RESOLVED** — Use outbound proxy VPS (Hetzner CX11, Nginx). Edge Functions route NHSBSA calls through a cheap VPS with a fixed static IP. Only needed for production go-live; staging is unaffected.
2. **NHSBSA staging access** — Has anyone emailed `mys-platform@nhsbsa.nhs.uk` yet?
3. **PDS access mode** — We want application-restricted (back-end NHS number verification). Do we need to request this specifically during NHS onboarding?
4. **PLATFORM_DEPOSIT_ID prefix** — Will NHSBSA assign `PSN-` or similar once we register?
5. **DCB0129 Clinical Safety** — Do we need a clinical safety officer? Who owns this?

---

*Document maintained by: Lead Architect*
*Last updated: 26 February 2026*
