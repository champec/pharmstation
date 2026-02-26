# Agent Messages — Architect ↔ Subagent Communication Log

> This file is the **communication channel** between the Lead Architect and subagents.
> Architect leaves instructions, context, and steering notes here.
> Subagents should read this file at the start of every session and append their status updates.
>
> Format:
> `---`
> `**[ARCHITECT | SUBAGENT] — DATE — Re: TASK_ID**`
> `Message`

---

## ENTRY 001 — ARCHITECT — 26 February 2026 — Re: All Tasks

### Context for all subagents

This is the **Integrated NHS Expansion** for PharmStation. The goal is to make PharmStation a direct alternative to PharmOutcomes — an NHS-accredited platform where pharmacies can submit NHS service claims (CPCS, Flu, NMS, Hypertension, SCS, Contraception, COVID Jab) directly to the NHS Business Services Authority (NHSBSA) through our app.

**You are a subagent working on a complex, regulated healthcare software project. Please read this carefully before starting any task:**

1. **Read `architect-findings.md` first** — it has the full technical architecture, API details, and field mappings. Do not guess or invent any NHS API fields — use only what is documented.

2. **Read `task-board.md`** — pick up a task that is `🔲 Not Started` and not blocked. Mark it `🔄 In Progress` in this file before you begin.

3. **Every NHS API field name must match the NHSBSA documentation exactly** — field names like `PLATFORM_DEPOSIT_ID`, `CLAIMANT_ODS`, `PATIENT_NHSNO` etc. are dictated by NHS, not by us. Do not camelCase them in the payload.

4. **PLATFORM_DEPOSIT_ID format (staging):** Until we receive an official prefix from NHSBSA, use `PSN-TEST-{orgId}-{timestamp}` for staging submissions. This will be updated once NHSBSA assigns our prefix.

5. **All NHSBSA API calls must go through Supabase Edge Functions** — never from the browser. The reason is IP whitelisting — only Edge Function IPs will be registered with NHSBSA.

6. **Error handling is critical** — every Edge Function must catch HTTP 400, 403, 422, 500 responses and store them in `nhs_submission_attempts`. Do not silently swallow errors. The pharmacist must know if a submission failed.

7. **RLS on all new tables** — every new database table must have row-level security that scopes reads/writes to the pharmacy's `org_id`.

8. **Use Zod for all payload validation** — validate on the Edge Function side before calling NHSBSA. Return user-friendly error messages for missing required fields.

9. **Patient data is highly sensitive** — do not log full patient records to console. The `nhs_submission_attempts` table should store payloads but this is internal audit only, not user-visible.

10. **Follow existing code patterns** — React Router 7, Zustand stores, Zod + react-hook-form, Supabase RLS. Look at the existing expansion agents (`agent-1-services.md`, etc.) for code patterns before writing new code.

---

### Priority for first subagent

Start with **Task A4 (Database Schema)** and **Task A5 (TypeScript Types)** — these are the foundation everything else depends on. These can be done in parallel.

Once A4 and A5 are done, move to **Task A6 (Edge Function Scaffolding)**.

---

### Critical question pending

Before building the live NHSBSA integration (Phase B onwards), we need to verify:
**Can Supabase Edge Functions have fixed/static egress IP addresses?**

This is Task A3. If the answer is NO, we will need an alternative architecture (proxy VPS). Do NOT implement Phase B until A3 is resolved.

---

## ENTRY 002 — ARCHITECT — 26 February 2026 — Re: A4 (DB Schema)

When creating the migration for NHS claims tables, please check what migration number to use by running:

```bash
ls supabase/migrations/
```

Use the next sequential date-based prefix. The migration should be idempotent (use `IF NOT EXISTS`) and non-destructive to existing tables.

The `service_type` enum should map to the NHSBSA claim types we support:
- `cpcs_emg_med` → CLAIM_TYPE_CODE: `EMG_MED`
- `cpcs_min_ill` → CLAIM_TYPE_CODE: `MIN_ILL`
- `cpcs_emg_uec` → CLAIM_TYPE_CODE: `EMG_MED_UEC`
- `cpcs_min_ill_uec` → CLAIM_TYPE_CODE: `MIN_ILL_UEC`
- `cpcs_ccs` → CLAIM_TYPE_CODE: `CCS`
- `flu_vac` → CLAIM_TYPE_CODE: `FLU_VAC`
- `covid_vac` → CLAIM_TYPE_CODE: `COVID_VAC`
- `gp_covid_vac` → CLAIM_TYPE_CODE: `GP_COVID_VAC`
- `scs` → SCS API
- `contraception` → Contraception API
- `cvd_hypertension` → CVD API
- `nms` → NMS API

---

## ENTRY 003 — ARCHITECT — 26 February 2026 — Re: A5 (TypeScript Types)

For the PDS patient type, reference the actual PDS FHIR R4 resource structure (it's a FHIR Patient resource with UK Core extensions). Key fields we care about:

```ts
interface PDSPatient {
  nhsNumber: string;        // from identifier[0].value
  familyName: string;       // from name[0].family
  givenNames: string[];     // from name[0].given
  dateOfBirth: string;      // from birthDate
  gender: 'male' | 'female' | 'other' | 'unknown';
  address?: {
    line: string[];
    city?: string;
    postalCode?: string;
  };
  gpPracticeOdsCode?: string;  // from generalPractitioner[0].identifier.value
  restrictedPatient: boolean;  // from meta.security
}
```

Do not over-engineer the FHIR mapping — just extract what we need for claim submission.

---

## [Subagent status updates go below this line]

---
