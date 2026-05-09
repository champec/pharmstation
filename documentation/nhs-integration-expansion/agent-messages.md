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

6. **Error handling is critical** — every Edge Function must catch HTTP 400, 403, 422, 500 responses and store them in `ps_nhs_submission_attempts`. Do not silently swallow errors. The pharmacist must know if a submission failed.

7. **RLS on all new tables** — every new database table must have row-level security that scopes reads/writes to the pharmacy's `org_id`.

8. **Use Zod for all payload validation** — validate on the Edge Function side before calling NHSBSA. Return user-friendly error messages for missing required fields.

9. **Patient data is highly sensitive** — do not log full patient records to console. The `ps_nhs_submission_attempts` table should store payloads but this is internal audit only, not user-visible.

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

## ENTRY 007 — ARCHITECT — 26 February 2026 — Re: A6 Complete ✅

### Task A6 — Edge Function Scaffolding — COMPLETE

All 7 NHS Edge Functions have been created and are scaffolded. Phase A is now **5 of 7 tasks complete** (A1 In Progress, A2 Not Started are human-action tasks).

**Functions created:**

| Function | File | Service | Actions |
|---|---|---|---|
| `nhs-claim-cpcs` | `supabase/functions/nhs-claim-cpcs/index.ts` | CPCS + Pharmacy First + Flu + COVID | submit, update, delete, get |
| `nhs-claim-nms` | `supabase/functions/nhs-claim-nms/index.ts` | New Medicines Service | submit, update, delete, get |
| `nhs-claim-scs` | `supabase/functions/nhs-claim-scs/index.ts` | Smoking Cessation Service | submit, update, delete, get |
| `nhs-claim-cvd` | `supabase/functions/nhs-claim-cvd/index.ts` | Hypertension / CVD Case-Finding | submit, update, delete, get |
| `nhs-claim-contraception` | `supabase/functions/nhs-claim-contraception/index.ts` | NHS Contraception Service | submit, update, delete, get |
| `nhs-pds-lookup` | `supabase/functions/nhs-pds-lookup/index.ts` | PDS Patient Lookup | lookup, verify |
| `nhs-gp-search` | `supabase/functions/nhs-gp-search/index.ts` | DoHS GP Practice Search | search, lookup_ods |

**Pattern notes for subagents reading these:**
- All functions use `getAdminClient()` with `SUPABASE_SERVICE_ROLE_KEY` for DB writes — never expose service role to browser
- Auth is always verified: `createClient(URL, ANON_KEY)` + `supabase.auth.getUser()` before any action
- Manual field validation (no Zod) — consistent with existing `ai-chat` and `nhs-notify`
- All NHSBSA HTTP calls are **stubbed** — look for `// [STUB]` and `// TODO Phase B` comments
- `nhs-pds-lookup` includes NHS number **mod-11 validation** and a 24-hour cache layer
- `nhs-gp-search` includes ODS code format validation: `[A-Z]\d{5}`

**What's real vs stubbed:**
- ✅ REAL: auth check, field validation, DB insert to `ps_nhs_claim_submissions`, DB insert to `ps_nhs_submission_attempts`, all DB reads
- 🔴 STUBBED: all calls to NHSBSA endpoints, all calls to PDS FHIR API, all calls to DoHS API

**Next unblocked task:** A7 — NHS Settings page in UI.
Phase B is **blocked on NHSBSA staging credentials** (A1 response pending).

---

## ENTRY 006 — ARCHITECT — 26 February 2026 — Re: A3/A4/A5 Complete + Live DB Findings

### Tasks completed today
- **A3** — Supabase Edge Function IP research: complete. See findings below.
- **A4** — DB migration applied to live DB. All 3 new tables created, 9 NHS services seeded. ✅
- **A5** — TypeScript types written: `packages/types/src/nhs.ts`, exported from index. ✅

---

### A3 — Supabase Edge Function Static IP — Decision Made ✅

Supabase Edge Functions run on Deno Deploy — a globally distributed serverless network. Egress IPs are dynamic by design. Official Supabase docs confirm three solutions:

1. **Outbound proxy VPS** ✅ — route Edge Function requests through a small VPS with a fixed static IP ← **OUR CHOICE**
2. **Header-based auth** ❌ — only works if you control the destination server. We don't control NHSBSA's servers. Not applicable.
3. **Self-host the Edge Runtime** ❌ — deploy Supabase's Deno runtime on your own VPS. Intended for compliance scenarios where proxies are forbidden. Overkill for us.

**Decision: Solution 1 — Outbound proxy VPS.** All Edge Function code stays on Supabase unchanged. A single cheap VPS (Hetzner CX11 ~€4/mo, UK region) runs Nginx as a dumb HTTP forwarder. Edge Functions POST to the proxy; the proxy forwards to NHSBSA.

**Traffic flow:**
```
Browser
  → Supabase Edge Function (auth, Zod validation, payload build, DB writes)
      → Proxy VPS (static IP — registered with NHSBSA)
          → NHSBSA staging / production endpoint
```

**Proxy config (Nginx, ~5 lines):**
```nginx
location /nhsbsa/ {
    proxy_pass https://stg.services.nhsbsa.nhs.uk/;
    proxy_ssl_server_name on;
}
```

**This does NOT block staging.** NHSBSA staging likely doesn't enforce IP whitelisting. Build and test all Edge Functions freely against staging. The proxy only needs to be live before production go-live (Phase F).

**Action required (Champe — before Phase F):** Spin up a Hetzner CX11 in UK region, configure Nginx proxy pointing at NHSBSA production URLs, register its static IP with NHSBSA during the onboarding response.

---

### A4 — Live DB Discoveries (important corrections to docs)

The following was discovered by querying the live database — **do not trust static docs over the live schema**:

1. **`ps_patients.nhs_number` already exists** — no migration needed for this. It's already there.

2. **RLS table is `ps_organisation_members`** — uses `organisation_id` + `user_id`. Previous docs incorrectly referenced `ps_staff`. All new NHS RLS policies use `ps_organisation_members` correctly.

3. **Legacy `service_*` tables — IGNORE COMPLETELY** (architect decision, 26 Feb 2026):
   - `service_pfs`, `service_pharmacy_first`, `service_flu`, `service_htn`, `service_nms`, `service_dms`
   - **Do not read from, write to, join, migrate, or reference these tables in any NHS integration work.**
   - They are dead legacy. All NHS claim work uses `ps_service_deliveries` → `ps_nhs_claim_submissions` only.

4. **`ps_user_profiles.gphc_number` exists** — for Pharmacy First (CCS), `PROFESSIONAL_IDENTIFIER` can be auto-populated from the logged-in user's GPhC number. Subagents building the CCS form should pre-fill this field.

5. **`ps_nhs111_referrals` table already exists** — stores incoming NHS 111 referral data with `referral_data jsonb`, linked to `appointment_id`. When building the CPCS form (B1), check this table — the referral data the pharmacy already received from NHS 111 should pre-populate the CPCS claim fields.

---

### Next unblocked tasks

With A3, A4, A5 done, the following are now unblocked:
- **A6** — Edge Function scaffolding (skeleton functions, stubbed responses)
- **A7** — NHS Settings page in UI (`/settings/nhs` — ODS code entry, BSA env toggle)

Both can be worked in parallel. A6 requires A5 types (done). A7 requires A4 DB columns (done).

---

## ENTRY 005 — ARCHITECT — 26 February 2026 — Re: A1 NHSBSA Onboarding Email Sent ✅

**Status update:** The NHSBSA supplier onboarding email has been sent by Champe Chilufya on 26 February 2026.

**Sent to:** `mys-platform@nhsbsa.nhs.uk`
**From:** `champe.chilufya@wales.nhs.uk`
**Date sent:** 26 February 2026

---

### Copy of sent email

> **Subject:** IT Supplier Integration Request — PharmStation Clinical Services Platform
>
> Dear MYS Platform Team,
>
> I am writing to request IT supplier integration access to the MYS platform APIs for a clinical services platform I am developing called **PharmStation**.
>
> **About the platform:**
> PharmStation is a web-based pharmacy management and clinical services platform designed for community pharmacies in England. We are seeking accreditation as an IT supplier to enable pharmacies using our platform to submit NHS advanced service claims directly through the MYS APIs, as an alternative to manual portal entry.
>
> **Services we wish to integrate:**
> - Community Pharmacist Consultation Service (CPCS) — Emergency Medicine Supply, Minor Illness, UEC pathways
> - Pharmacy First (CCS) — all 7 clinical pathways
> - Seasonal Influenza Advanced Service
> - New Medicines Service (NMS)
> - NHS Hypertension Case-Finding Service
> - Smoking Cessation Service (SCS)
> - NHS Contraception Service
>
> **Technical contact:**
> - Platform name: PharmStation
> - Developer/contact: Champe Chilufya
> - Email: champe.chilufya@wales.nhs.uk
> - Phone: 07445693784
>
> **Request:**
> Could you please provide:
> 1. Access to the staging/test environment for all services listed above
> 2. Assignment of a `PLATFORM_DEPOSIT_ID` prefix for PharmStation (we would like to request `PSN-`)
> 3. The IP whitelisting process and IP address registration form — we will be routing all API calls through fixed-IP infrastructure
> 4. Details of any supplier assurance or onboarding documentation required
>
> I am a registered pharmacist in England (GPhC number: **2226350**) and am the clinical lead for this platform. I am happy to arrange a call to discuss the integration in more detail.
>
> Many thanks for your time.
>
> Kind regards,
> Champe Chilufya
> Clinical Lead, PharmStation
> GPhC: 2226350
> champe.chilufya@wales.nhs.uk
> 07445693784

---

**Next steps for A1 (awaiting):**
- NHSBSA typically responds within 5–10 working days
- When they respond, record the assigned `PLATFORM_DEPOSIT_ID` prefix here and update staging credentials in Supabase Edge Function environment variables
- If no response after 10 working days, follow up directly by phone or via the NHSBSA supplier portal

**Note to subagents:** Task A1 is now **In Progress**. Do not wait for A1 to complete before starting A3, A4, A5, A6, A7 — those are all unblocked and should proceed in parallel.

---

## ENTRY 006 — ARCHITECT — 5 March 2026 — Re: Digital Onboarding Started + API Emails Sent

### Status update — Major progress day

**1. Digital Onboarding Service — REGISTERED ✅**

The old `developer.nhs.uk` portal was decommissioned on 2 March 2026. All onboarding now happens at `onboarding.prod.api.platform.nhs.uk` using the new "Single Assessment flow".

- **Portal:** `https://onboarding.prod.api.platform.nhs.uk/`
- **Account:** `chronic2157@gmail.com`
- **Organisation:** PharmStation
- **Product:** PharmStation
- **APIs selected for onboarding:**
  - Personal Demographics Service (PDS) — FHIR API
  - Directory of Services (DoS) — Urgent and Emergency Care — REST API
  - NHS Notify

**Onboarding stages visible on portal:**
1. Check eligibility — Product details, Organisation details, DoS additional details (all "Not started")
2. Shared sections — Service/incident management, Data Security (DSPT), Clinical risk (DCB0129)
3. Complete API assurance — Technical conformance per API
4. Get access — Connection Agreement

**Blocker:** Shared sections (Data Security, Clinical Risk) cannot be submitted until eligibility is approved.

**2. BaRS Early Access Email — SENT ✅**

- **To:** `bookingandreferralstandard@nhs.net`
- **From:** `champe.chilufya@wales.nhs.uk`
- **Subject:** Digital Onboarding Request — Booking and Referral FHIR API (Referral Receiver GP-Pharmacy CPCS)
- **Content:** Requested early access to BaRS Referral Receiver GP-Pharmacy (CPCS). Described existing NHS 111 ITK SOAP pipeline. Included ODS D8W5S.

**3. DoHS v3 Onboarding Email — SENT ✅**

- **To:** `ssd.nationalservicedesk@nhs.net`
- **From:** `champe.chilufya@wales.nhs.uk`
- **Subject:** Service Search v3 API onboarding
- **Content:** Requested onboarding to Directory of Healthcare Services API v3. Use case: GP practice/service lookup for clinical forms. Included ODS D8W5S.

**4. DSPT — All 103 items completed ✅**

Completed 4–5 March 2026. Supporting documents created (ROPA, TNA, tabletop exercise, supplier register, verification checklist, privacy notice). Awaiting ICO registration (£40) and independent audit before publication.

### Pending replies tracker

| Email | Sent | To | Chase by |
|-------|------|----|----------|
| NHSBSA MYS | 26 Feb | mys-platform@nhsbsa.nhs.uk | **12 March** (phone 0300 330 1368) |
| BaRS early access | 5 Mar | bookingandreferralstandard@nhs.net | 19 March |
| DoHS v3 | 5 Mar | ssd.nationalservicedesk@nhs.net | 19 March |

---

## ENTRY 008 — ARCHITECT — 6 March 2026 — Re: ICO Registration Completed

### ICO Data Protection Registration — DONE ✅

- **Portal:** `https://ico.org.uk/for-organisations/register/`
- **Application number:** C1887941
- **Security number:** CSN7417303 — satisfies DSPT evidence item 1.1.1
- **Organisation type:** Individual / Sole Trader
- **Trading name:** Pharmstation
- **Nature of work:** Software Development
- **Payment tier:** Tier 1 — £52/year (Direct Debit)
- **DPO required?** No — provided data protection contact (Champe Chilufya, Director)
- **Contact email:** `champe.chilufya@wales.nhs.uk`
- **Address:** 31 Norman Davies Gardens, Bilston, WV14 0BD

**Status:** Registration complete. Security number CSN7417303 allocated. DSPT evidence item 1.1.1 satisfied.

**Remaining DSPT blockers:**
1. ✅ ICO registration — DONE (CSN7417303)
2. 🔴 Independent audit (auditor identified, not yet started)
3. 🔴 Confirm 33 assertions + publish

---

## ENTRY 009 — ARCHITECT — 30 April 2026 — Re: Digital Onboarding Eligibility APPROVED 🎉

### NHS England approved all eligibility sections on 27 April 2026

After ~7 weeks of waiting (submitted 5 March, approved 27 April), NHS England's Digital Onboarding Service approved every eligibility section we submitted. Four separate emails received from `api.onboarding@nhs.net`:

1. **Pharmstation - Gateway — Product details approved** ✅
2. **Pharmstation - Gateway — Organisation details approved** ✅
3. **Pharmstation - (DoS) REST API — Additional details for the Directory of Services (DoS) REST API approved** ✅
4. **Pharmstation — Eligibility checks complete** ✅ — for **PDS**, **NHS Notify**, and **(DoS) REST API**

Assessor feedback on every section: "Approved" — no changes requested.

### What this unlocks

We can now begin the **API Assurance** stage on the portal for all 3 APIs. Each API requires:
- **Technical conformance** — proof we implement the API correctly (test scripts, integration testing)
- **Clinical safety** — DCB0129 Clinical Safety Case Report (still outstanding 🔴)
- **Information governance** — DSPT "Standards Met" status (blocked by independent audit 🔴)

### Critical takeaways for subagents

- Product is registered as **two separate entities** on the portal:
  - "Pharmstation - Gateway" (covers Product + Organisation details, used for PDS + NHS Notify + general)
  - "Pharmstation - (DoS) REST API" (separate product entry for DoS REST API specifically)
- Use this exact naming when referencing the portal in any future correspondence
- The new Digital Onboarding contact email is `api.onboarding@nhs.net`

### Updated blocker priorities

| Blocker | Status | Notes |
|---------|--------|-------|
| ✅ Eligibility | DONE | Approved 27 Apr 2026 |
| ✅ DSPT independent audit | DONE | Completed 8 May 2026 |
| 🔴 DSPT publication | **DO NOW** | Audit complete — confirm assertions and publish for "Standards Met" |
| ✅ DCB0129 CSCR | DONE | PS-CSCR-001 v1.0 signed 30 Apr 2026. Submitted to portal 9 May 2026. |
| ✅ DoS REST technical conformance | DONE | Submitted 9 May 2026. Awaiting witness testing. |
| 🔄 NHSBSA MYS reply | No reply 2+ months | Phone chase 0300 330 1368 |
| � BaRS reply | No reply 2+ months | Chase `bookingandreferralstandard@nhs.net` |

---

## ENTRY 010 — ARCHITECT — 9 May 2026 — Re: DSPT Audit Complete + Major Progress Update

### DSPT independent audit COMPLETED 🎉

The independent assessment report was completed on **8 May 2026** by the auditor. This is the final blocker before DSPT publication.

**IMMEDIATE ACTION REQUIRED:** Log into dsptoolkit.nhs.uk, confirm all 33 assertions, and click Publish. Status will become **"Standards Met"**. This unblocks:
- Data Security shared section on the NHS Digital Onboarding portal
- PDS FHIR API assurance submission
- NHS Notify API assurance submission

### Other progress since ENTRY 009 (30 Apr 2026)

| Item | Status | Date |
|------|--------|------|
| DCB0129 artefacts | ✅ Created and submitted | 30 Apr – 9 May 2026 |
| CSO Appointment (PS-CSO-001) | ✅ Done | 30 Apr 2026 |
| Deputy CSO (PS-CSO-002) | ✅ Done | 30 Apr 2026 | 
| Deputy: Biniam Eyob Fesseha | ✅ Appointed | GPhC 2221360, bfesseha13@gmail.com |
| CRMP (PS-CRMP-001) | ✅ Done | 30 Apr 2026 |
| Hazard Log (PS-HAZLOG-001) | ✅ Done | 30 Apr 2026 | 
| CSCR (PS-CSCR-001) | ✅ Done | 30 Apr 2026 |
| ISMS Policy (PS-ISMS-001) | ✅ Done | 8 May 2026 |
| Clinical risk management portal section | ✅ Submitted | 9 May 2026 |
| Core IG portal section | ✅ Submitted | 9 May 2026 |
| nhs-dos-lookup Edge Function | ✅ Built + deployed | 9 May 2026 |
| DoS REST technical conformance (Q1–Q4) | ✅ Submitted | 9 May 2026 |
| DoS REST risk log (21 risks) | ✅ Submitted | 9 May 2026 |
| Pen test | 🔴 Scheduled 08/07/2026 | Find independent tester |
| Supabase region | ⚠️ us-east-1 (USA) | Migrate to eu-west-2 before go-live |

### Current top priority order

1. ~~**Publish DSPT**~~ ✅ DONE 9 May 2026 — Standards Met published.
2. **Complete Data Security portal section** — do immediately (fully unblocked)
3. **Begin PDS API assurance** — technical conformance + CSCR + DSPT all ready
4. **Pen test** — arrange by June for 8 July date
5. **NHSBSA + BaRS chases** — still no reply

---

## ENTRY 011 — ARCHITECT — 9 May 2026 — Re: DSPT "Standards Met" Published 🎉

### DSPT v6 published — Status: Standards Met

**DSPT v6 published 9 May 2026. Status: Standards Met.**

This is the final major IG blocker cleared. The full compliance picture now:

| Requirement | Status |
|---|---|
| DSPT v6 "Standards Met" | ✅ Published 9 May 2026 |
| ICO registration (CSN7417303) | ✅ Done 6 Mar 2026 |
| DCB0129 CSCR (PS-CSCR-001) | ✅ Done 30 Apr 2026 |
| CSO appointed (Champe Chilufya GPhC 2226350) | ✅ Done |
| Deputy CSO (Biniam Fesseha GPhC 2221360) | ✅ Done |
| ISMS Policy (PS-ISMS-001) | ✅ Done 8 May 2026 |
| DoS REST technical conformance | ✅ Submitted 9 May 2026 |
| Pen test | 🔴 Scheduled 08/07/2026 |

### What this unblocks

- **Data Security portal section** — complete immediately on portal
- **PDS FHIR API assurance** — all 3 requirements met (DSPT + DCB0129 + technical conformance possible)
- **NHS Notify API assurance** — same
- **Connection Agreement** — will be auto-generated as assurance progresses

### Next actions for subagents

1. Complete Data Security shared section on portal (upload DSPT Standards Met reference)
2. Build PDS technical conformance evidence (similar to DoS REST process)
3. Ensure `nhs-pds-lookup` error handling produces clean evidence for PDS portal Q2/Q3

---

## ENTRY 004 — ARCHITECT — 26 February 2026 — Re: Pharmacy First (CCS) Clarification

**Pharmacy First is NOT a separate API. It is `CLAIM_TYPE_CODE: CCS` on the CPCS API.**

Pharmacy First launched 31 January 2024. It allows pharmacists to consult and supply prescription-only medicines under a Patient Group Direction for 7 specific conditions — without the patient needing to see a GP or be referred from NHS 111. The patient walks in directly.

**The 7 conditions** (field `CCS_PRESENTING_COMPLAINT_OR_ISSUE`):
- `A_O_M` — Acute Otitis Media
- `SHG` — Shingles
- `I_I_B` — Infected Insect Bites
- `SNT` — Sinusitis
- `ITG` — Impetigo
- `U_UTI` — Uncomplicated UTI
- `A_S_T` — Acute Sore Throat

**Critical rules for subagents building B2 (Pharmacy First form):**

1. `PROFESSIONAL_IDENTIFIER` is **mandatory** for CCS — this is the GPhC registration number. Add as a required field on the CCS form (pre-populate from the logged-in pharmacist's profile on `ps_staff` if stored).

2. **Otitis Media face-to-face constraint:** if `CCS_PRESENTING_COMPLAINT_OR_ISSUE` = `A_O_M`, the `CONSULTATION_METHOD` field must be locked to `FACE_TO_FACE` only. Enforce in both Zod schema AND UI. NHSBSA will reject otherwise.

3. `CCS_NO_SUPPLY_REASON` is required if no medication was supplied. Show this field conditionally based on whether the pharmacist indicates a supply was made.

4. No `REFERRAL_DATE`, `REFERRER_ORG_ODS`, or `DISPOSITION_CODE` — Pharmacy First is patient-initiated, not a referral service.

5. Pharmacy First is a single service library entry (`cpcs_ccs`). The form shows all 7 conditions as a dropdown — do NOT create 7 separate service entries.

---
