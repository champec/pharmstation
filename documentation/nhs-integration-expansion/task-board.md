# NHS Integration Expansion — Task Board

> **Managed by:** Lead Architect
> **Updated:** 26 February 2026
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
**Status:** 🔲 Not Started

Actions:
- [ ] Email `mys-platform@nhsbsa.nhs.uk` — request IT supplier access for all 7 services
- [ ] Include: platform name (PharmStation), website, contact name, list of services to integrate
- [ ] Request staging environment credentials + PLATFORM_DEPOSIT_ID prefix (request `PSN-`)
- [ ] Once approved: register production Supabase Edge Function IP addresses for IP whitelisting

**Blocked by:** Nothing. Can start immediately.

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
**Status:** 🔲 Not Started

**Task:** Research whether Supabase Edge Functions expose fixed/static egress IP addresses that could be registered with NHSBSA for IP whitelisting. Document findings. If not possible natively, propose an alternative (e.g., dedicated VPS proxy, Cloudflare Worker with static IP).

**Output:** Written findings in `agent-messages.md` + recommendation.

---

### A4 — Database Schema: NHS Claims Tables

**Owner:** Subagent
**Status:** 🔲 Not Started

**Task:** Create Supabase migration file for the following tables (see `db-schema.md` for full spec):
- `nhs_claim_submissions` — master claim record
- `nhs_submission_attempts` — API call audit log
- `nhs_patient_pds_cache` — PDS lookup cache

**Files to create:**
- `supabase/migrations/YYYYMMDD_nhs_claims_schema.sql`

**Requirements:**
- Enable RLS on all tables
- RLS policy: org members can read/write claims for their org only
- Use `ps_organisations` FK for org-scoping
- Add indexes on: `org_id`, `patient_id`, `service_type`, `status`, `claim_year_month`
- Add `platform_deposit_id` UNIQUE constraint

**Blocked by:** Nothing.

---

### A5 — TypeScript Types: NHS Claims

**Owner:** Subagent (can be parallelised with A4)
**Status:** 🔲 Not Started

**Task:** Add NHS claim types to `packages/types/src/`:

```ts
// packages/types/src/nhs.ts
export type NHSServiceType =
  | 'cpcs_emg_med' | 'cpcs_min_ill' | 'cpcs_emg_uec' | 'cpcs_min_uec'
  | 'cpcs_ccs' | 'flu_vac' | 'covid_vac' | 'scs' | 'contraception'
  | 'cvd_hypertension' | 'nms';

export type NHSClaimStatus =
  | 'draft' | 'pending' | 'submitted' | 'accepted' | 'rejected' | 'updated' | 'deleted';

export type ConsultationMethod =
  | 'FACE_TO_FACE' | 'TELEPHONE' | 'VIDEO' | 'ONLINE_ASYNCHRONOUS';

export interface NHSClaimSubmission { ... }
export interface NHSSubmissionAttempt { ... }
export interface PDSPatient { ... }
export interface CPCSClaimPayload { ... }
export interface SCSClaimPayload { ... }
export interface CVDClaimPayload { ... }
export interface NMSClaimPayload { ... }
export interface ContraceptionClaimPayload { ... }
```

**Blocked by:** Nothing. Must be done before Edge Functions or forms.

---

### A6 — Edge Function Scaffold (Skeleton Only)

**Owner:** Subagent
**Status:** 🔲 Not Started

**Task:** Create skeleton Edge Functions — stubbed out (no real API calls yet). Each function should:
1. Accept a typed POST request body
2. Validate it with Zod
3. Return a stub 200 response with fake BSA response shape
4. Log the attempt to `nhs_submission_attempts`

**Functions to create:**
- `supabase/functions/nhs-claim-cpcs/index.ts`
- `supabase/functions/nhs-claim-scs/index.ts`
- `supabase/functions/nhs-claim-contraception/index.ts`
- `supabase/functions/nhs-claim-cvd/index.ts`
- `supabase/functions/nhs-claim-nms/index.ts`
- `supabase/functions/nhs-pds-lookup/index.ts`
- `supabase/functions/nhs-gp-search/index.ts`

**Blocked by:** A5 (types).

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

### B2 — Flu Vaccination Claim Form & Submission

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
| A — Foundation | 7 | 7 | 0 | 0 | 0 |
| B — Core Services | 3 | 3 | 0 | 0 | 0 |
| C — Advanced Services | 4 | 4 | 0 | 0 | 0 |
| D — Patient Verification | 2 | 2 | 0 | 0 | 0 |
| E — Dashboard | 2 | 2 | 0 | 0 | 0 |
| F — Production Readiness | 3 | 3 | 0 | 0 | 0 |
| **Total** | **21** | **21** | **0** | **0** | **0** |
