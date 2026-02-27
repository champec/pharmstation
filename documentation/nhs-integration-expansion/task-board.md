# NHS Integration Expansion — Task Board

> **Managed by:** Lead Architect
> **Updated:** 26 February 2026 (A6 complete)
>
> This is the canonical task list for all subagents working on the Integrated NHS Expansion.
> Each phase must be sequential. Within a phase, tasks can be parallelised where indicated.
> **Statuses:** `🔲 Not Started` | `🔄 In Progress` | `✅ Complete` | `⛔ Blocked` | `📋 Review`

---

## PHASE A — Foundation & Onboarding

> Goal: Database schema, scaffold Edge Functions, onboarding initiated.
> No clinical form UI yet — just the infrastructure.

### A1 — NHSBSA Supplier Onboarding (Human Action Required ⚠️)

**Owner:** Business / Product team (not a subagent task)
**Status:** � In Progress

Actions:
- [x] Email `mys-platform@nhsbsa.nhs.uk` — sent **26 February 2026** by Champe Chilufya (GPhC: 2226350) ✅
- [x] Included: platform name (PharmStation), contact details, full list of services to integrate ✅
- [x] Requested staging environment credentials + PLATFORM_DEPOSIT_ID prefix `PSN-` ✅
- [x] Requested IP whitelisting process and registration form ✅
- [ ] **Awaiting response** from NHSBSA
- [ ] Once approved: register production Supabase Edge Function IP addresses for IP whitelisting

**Blocked by:** Nothing. ~~Can start immediately.~~ Email sent — awaiting NHSBSA response.

> 📧 **Email sent 26 Feb 2026** — See `agent-messages.md` ENTRY 005 for full copy.

---

### A2 — NHS Developer Portal — API Access (Human Action Required ⚠️)

**Owner:** Business / Technical team
**Status:** 🔲 Not Started

Actions:
- [ ] Log into developer.nhs.uk with `chronic2157@gmail.com`
- [ ] Open app `PharmStation` (ID: `04cc89f0-3d9b-44d2-ba18-dd6ae18f9f7a`)
- [ ] Request access to: **Personal Demographics Service - FHIR API** (application-restricted mode)
- [ ] Request access to: **Directory of Healthcare Services API v3**
- [ ] Complete use case confirmations for each
- [ ] Retrieve API keys / subscription keys for integration env

**Blocked by:** Nothing. Can start immediately.

---

### A3 — Investigate Supabase Edge Function IP Addresses

**Owner:** Subagent / DevOps
**Status:** ✅ Complete — Decision Made 26 February 2026

**Findings:** Supabase Edge Functions (Deno Deploy) have no static egress IPs. Official Supabase docs offer three solutions:
1. ✅ **Outbound proxy VPS** — **chosen**
2. ❌ Header-based auth — not applicable (we don't control NHSBSA's servers)
3. ❌ Self-host edge runtime — overkill

**Decision: Outbound proxy VPS (Hetzner CX11, UK region, Nginx).** Edge Functions route all NHSBSA API calls through a cheap VPS with a fixed static IP registered with NHSBSA. Zero business logic on the proxy — it's a dumb `proxy_pass`.

**Does NOT block staging** — staging can be tested without the proxy. Only needed before production go-live (Phase F).

**Human action required before Phase F:** Provision VPS, configure Nginx, register static IP with NHSBSA. See `agent-messages.md` ENTRY 006 for full details.

---

### A4 — Database Schema: NHS Claims Tables

**Owner:** Subagent
**Status:** ✅ Complete — 26 February 2026

**Delivered:**
- Migration file: `supabase/migrations/20260226_nhs_claims_schema.sql`
- Applied to live DB via Supabase MCP ✅
- Tables created: `nhs_claim_submissions`, `nhs_submission_attempts`, `nhs_patient_pds_cache`
- Columns added: `ps_organisations.ods_code`, `nhs_bsa_environment`, `nhs_ip_whitelist_registered`
- Columns added: `ps_service_library.is_nhs_service`, `nhs_service_type`
- Columns added: `ps_services.is_nhs_service`
- 9 NHS services seeded into `ps_service_library` ✅
- RLS enabled on all new tables using `ps_organisation_members` (correct table, verified live)

**Live DB notes discovered during build:**
- `ps_patients.nhs_number` already exists — no change needed ✅
- RLS uses `ps_organisation_members` not `ps_staff` — docs corrected
- **Legacy `service_pfs`, `service_pharmacy_first`, `service_flu`, `service_htn`, `service_nms`, `service_dms` — IGNORE. Architect decision: these are dead legacy tables. Do not read, write, join, or reference them in any NHS work.**
- `ps_user_profiles.gphc_number` exists — can auto-populate `PROFESSIONAL_IDENTIFIER` for Pharmacy First

---

### A5 — TypeScript Types: NHS Claims

**Owner:** Subagent (can be parallelised with A4)
**Status:** ✅ Complete — 26 February 2026

**Delivered:**
- New file: `packages/types/src/nhs.ts`
- Exported from `packages/types/src/index.ts`
- Covers: `NHSServiceType`, `NHSClaimStatus`, `ConsultationMethod`, `ProfessionalRole`
- Payload types: `CPCSClaimPayload`, `PharmacyFirstClaimPayload`, `FluVacClaimPayload`, `NMSClaimPayload`, `SCSClaimPayload`, `ContraceptionClaimPayload`, `CVDClaimPayload`
- DB row types: `NHSClaimSubmission`, `NHSSubmissionAttempt`, `NHSPatientPDSCache`
- PDS type: `PDSPatient`
- `NHS_CLAIM_TYPE_CODE` map (internal type → NHSBSA field value)
- `NHS_NUMBER_FALLBACK` constants
- Pharmacy First: `CCSPresentingComplaint` union type with all 7 pathways + `CCSNoSupplyReason`
- Otitis Media constraint documented in type comment

---

### A6 — Edge Function Scaffold (Skeleton Only)

**Owner:** Subagent
**Status:** ✅ Complete — 26 February 2026

**Delivered:**
All 7 Edge Functions created. Pattern: action-based routing, JWT auth, `getAdminClient()` service role, manual field validation (no Zod — consistent with existing functions `ai-chat` / `nhs-notify`). NHSBSA API calls are all **STUBBED** with `_stub: true` responses and `// TODO Phase B` comments. DB writes (create submission record, log attempt) are real.

- ✅ `supabase/functions/nhs-claim-cpcs/index.ts` — CPCS + Pharmacy First (CCS) + Flu + COVID. Actions: submit/update/delete/get. Includes CCS validation, Otitis Media face-to-face constraint, auto-populate `PROFESSIONAL_IDENTIFIER` hint.
- ✅ `supabase/functions/nhs-claim-nms/index.ts` — New Medicines Service. Actions: submit/update/delete/get. Validates `CONDITIONS[]` and `NMS_PRODUCTS[]` arrays.
- ✅ `supabase/functions/nhs-claim-scs/index.ts` — Smoking Cessation Service. Actions: submit/update/delete/get. Validates `QUIT_DATE`, `NRT_PRODUCT[]`.
- ✅ `supabase/functions/nhs-claim-cvd/index.ts` — Hypertension / CVD Case-Finding. Actions: submit/update/delete/get. Validates CLINIC_BP or ABPM with linked detail objects.
- ✅ `supabase/functions/nhs-claim-contraception/index.ts` — Contraception Service. Actions: submit/update/delete/get. Validates SERVICE_TYPE enum + `CONTRACEPTION_METHOD[]`.
- ✅ `supabase/functions/nhs-pds-lookup/index.ts` — PDS FHIR R4 patient lookup. Actions: lookup/verify. Includes NHS number mod-11 validation, 24-hour cache via `nhs_patient_pds_cache`.
- ✅ `supabase/functions/nhs-gp-search/index.ts` — DoHS GP search. Actions: search/lookup_ods. Includes ODS code format validation (`[A-Z]\d{5}`).

**Blocked by:** A5 (types). ~~(now resolved)~~

---

### A7 — NHS Settings Page in UI

**Owner:** Subagent
**Status:** 🔲 Not Started

**Task:** Create `/nhs-settings` route in the web app. Settings include:
- Organisation ODS code (stored in `ps_organisations`)
- BSA API environment toggle (Staging / Production)
- IP whitelist status indicator (manual flag initially)
- Last successful submission timestamp

**Blocked by:** A4 (DB), A5 (types).

---

## PHASE B — Core Claim Forms (CPCS + Flu + NMS)

> Goal: First three services fully working end-to-end in staging.
> Blocked by: Phase A completion + NHSBSA staging credentials (A1).

### B1 — CPCS Claim Form & Submission

**Owner:** Subagent
**Status:** 🔲 Not Started

**Description:** Build the full CPCS claim workflow:
1. Service form UI with all NHSBSA-required fields (see `architect-findings.md` §5)
2. PDS NHS number lookup integration (auto-fill patient details)
3. Zod validation schema matching NHSBSA field requirements exactly
4. Submit → Edge Function → NHSBSA staging → status update
5. Update/Delete operations from claim detail view

**Claim types to support:** EMG_MED, MIN_ILL, EMG_MED_UEC, MIN_ILL_UEC, CCS

**Blocked by:** Phase A complete, A1 staging credentials received.

---

### B2 — Pharmacy First (CCS) Claim Form & Submission

**Owner:** Subagent
**Status:** 🔲 Not Started

**Description:** Pharmacy First claim form. Uses the same CPCS API/Edge Function with `CLAIM_TYPE_CODE: CCS`. Launched January 2024 — allows pharmacists to consult and supply a POM under PGD for 7 specific conditions without GP referral.

**Unique fields (all mandatory for CCS):**
- `CCS_PRESENTING_COMPLAINT_OR_ISSUE` — dropdown of 7 conditions: `A_O_M`, `SHG`, `I_I_B`, `SNT`, `ITG`, `U_UTI`, `A_S_T`
- `PROFESSIONAL_IDENTIFIER` — GPhC/NMC registration number of the supplying clinician
- `CCS_NO_SUPPLY_REASON` — if no POM supplied, mandatory reason code (options A-F)
- **Conditional validation:** if condition = `A_O_M` (Acute Otitis Media), `CONSULTATION_METHOD` must be `FACE_TO_FACE` only — enforce in form and Zod schema
- No `REFERRAL_DATE` or `DISPOSITION_CODE` (patient self-presents, unlike regular CPCS)

**Blocked by:** B1 (re-uses CPCS Edge Function).

---

### B3 — Flu Vaccination Claim Form & Submission

**Owner:** Subagent
**Status:** 🔲 Not Started

**Description:** Flu jab claim form. Re-uses CPCS Edge Function with `FLU_VAC` claim type. Unique fields: dose number, vaccine batch, vaccination site ODS.

**Blocked by:** B1 (re-uses CPCS infrastructure).

---

### B3 — NMS Claim Form & Submission

**Owner:** Subagent
**Status:** 🔲 Not Started

**Description:** New Medicines Service claim form. Unique fields: conditions (array), NMS products, follow-up consultation outcome, not-using-medicine reasons.

**Blocked by:** Phase A complete, A1 staging credentials received.

---

## PHASE C — Advanced Services

> Goal: Full service coverage. Blocked by Phase B.

### C1 — Hypertension Case-Finding (CVD) Form

**Status:** 🔲 Not Started

Two-part form: Clinic BP test + ABPM. Complex branching logic (if clinic BP provided → show readings; if ABPM undertaken → show ABPM readings). Blood pressure ratings calculated/displayed.

---

### C2 — Smoking Cessation (SCS) Form

**Status:** 🔲 Not Started

Includes NRT product selection from live NRT product list API, multi-consultation tracking, quit date management.

---

### C3 — Contraception Service Form

**Status:** 🔲 Not Started

Arrays for contraception method + products. Service type branching (initiation vs ongoing vs emergency).

---

### C4 — COVID Vaccination Form

**Status:** 🔲 Not Started

Re-uses CPCS Edge Function. COVID-specific fields: HOME_BOUND, OTHER_RESIDENTIAL treatment supplement.

---

## PHASE D — Patient Verification Layer

> Goal: NHS number lookup becomes a first-class feature across PharmStation.

### D1 — PDS NHS Number Lookup

**Status:** 🔲 Not Started

Integrate `nhs-pds-lookup` Edge Function into the existing patient records (`ps_patients`). When creating/editing a patient, pharmacist can enter NHS number → verify against PDS → auto-fill confirmed details.

---

### D2 — GP ODS Code Search

**Status:** 🔲 Not Started

Integrate `nhs-gp-search` Edge Function as an autocomplete input. Used in claim forms and patient profiles.

---

## PHASE E — Claims Dashboard & Reporting

> Goal: Full visibility for pharmacy owners and managers.

### E1 — NHS Claims Dashboard

**Status:** 🔲 Not Started

- Summary cards: Total claims this month, by service type, accepted vs rejected
- Recent claims feed with status badges
- Quick-action: view/edit/resubmit rejected claims
- Route: `/nhs-services`

---

### E2 — Monthly Submission Report

**Status:** 🔲 Not Started

- Export of all claims for a given month (for pharmacy records)
- Breakdown by service type, total value (estimated reimbursement)
- Route: `/nhs-services/reports`

---

## PHASE F — Polish & Production Readiness

### F1 — Clinical Safety Case Preparation

**Status:** 🔲 Not Started (Human + Legal action required)

Prepare DCB0129 Clinical Safety Case. Required by NHS for accreditation.

---

### F2 — End-to-End Staging Acceptance Testing

**Status:** 🔲 Not Started

All services tested against NHSBSA staging. All CRUD operations verified. Error states documented and handled.

---

### F3 — Switch to Production Endpoints

**Status:** 🔲 Not Started

Flip Edge Functions from staging to production URLs. Monitor first submissions closely.

---

## Stats

| Phase | Tasks | Not Started | In Progress | Complete | Blocked |
|---|---|---|---|---|---|
| A — Foundation | 7 | 3 | 1 | 3 | 0 |
| B — Core Services | 4 | 4 | 0 | 0 | 0 |
| C — Advanced Services | 4 | 4 | 0 | 0 | 0 |
| D — Patient Verification | 2 | 2 | 0 | 0 | 0 |
| E — Dashboard | 2 | 2 | 0 | 0 | 0 |
| F — Production Readiness | 3 | 3 | 0 | 0 | 0 |
| **Total** | **22** | **18** | **1** | **3** | **0** |
