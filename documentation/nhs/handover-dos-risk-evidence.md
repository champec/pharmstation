# HANDOVER — NHS DoS REST API Risk Log Test Evidence (Pharmstation)

> **Created:** 1 July 2026
> **Owner:** Champe Chilufya (GPhC 2226350)
> **Status:** 🔄 In progress — blocked on MCP access to the Pharmstation project
> **Classification:** Internal — Onboarding Working Note

---

## What I'm working on

Resolving two NHS Digital Onboarding portal queries for the **DoS UEC REST API**.
Issue 1 (controller) is answered. Issue 2 (risk log evidence) is in progress and has
uncovered code gaps that must be fixed before evidence can be honestly produced.

## Key identifiers

- Supabase project ref (Pharmstation): `xsqwpmqfbirqdncoephf`
- Supabase URL: `https://xsqwpmqfbirqdncoephf.supabase.co`
- ODS code: **D8W5S** (PHARMSTATION) — software supplier, NOT a pharmacy
- ICO: CSN7417303 | CSO: Champe Chilufya GPhC 2226350 | Deputy CSO: Biniam Fesseha GPhC 2221360
- Deployed function under test: `nhs-dos-lookup` (actions: byODSCode, byServiceId, search)
- Reference function (correct auth + audit pattern): `nhs-pds-lookup`

## ISSUE 1 — Controller/Processor (Q2.2, FtRS Team) — ✅ ANSWER READY (not yet posted)

NHS said we listed Pharmstation as BOTH controller and processor. Correct position
(matches our ROPA §2 + ISMS): **controller = the End User Organisations (deploying
pharmacy contractors); Pharmstation = processor** under a DPA. No live customers yet,
so no named controller can be given — that's an accepted pre-launch supplier position.
Ignore NHS England's role per their hint. Draft answer + additional-comment text already
written — just needs pasting into the portal.

## ISSUE 2 — Risk Log Test Evidence (Shatakshi Tyagi, 15 Jun 2026) — 🔄 IN PROGRESS

Their request (use they/them — gender unknown):

- **(a)** Provide test evidence for ALL 21 risks (DosRESTAPI-001..021), not just the 4
  error-handling ones already in the uploaded PDF.
- **(b)** Stick to the ORIGINAL v0.3 .xlsx template — don't change format, fill supplier
  columns only. Portal question "Do you need to upload Test Evidence?" → answer YES.

### ⚠️ CRITICAL FINDINGS (theme: don't claim mitigations that aren't implemented)

While producing evidence I live-tested the deployed function and found TWO false claims:

1. **Risk 002 (auth) — WAS FALSE.** A call with NO Authorization header sailed through
   to DoS and returned 404, not 401. Risk 002 claims "JWT validation on every call;
   unauthenticated requests rejected at entry."
   - FIX APPLIED LOCALLY (Option A, user-approved): added an auth guard to
     `supabase/functions/nhs-dos-lookup/index.ts` mirroring `nhs-pds-lookup`
     (checks Authorization header → `supabase.auth.getUser()` → 401 UNAUTHORIZED if
     missing/invalid). Also added `createClient` import with `@ts-ignore`. No TS errors.
   - ⛔ NOT YET DEPLOYED. Deploy cmd (user cancelled last time):
     `npx supabase functions deploy nhs-dos-lookup --project-ref xsqwpmqfbirqdncoephf --no-verify-jwt`
     (`--no-verify-jwt` is intentional so our in-function guard returns the clean 401.)

2. **Risks 003/004/007 (audit) — CURRENTLY FALSE / UNVERIFIED.** `nhs-dos-lookup` never
   writes to `ps_audit_log` (no audit insert at all). These risks claim every DoS query
   is logged with user_id/ODS/HTTP status. NOT yet fixed. DECISION NEEDED: implement
   audit logging vs reword risks. NOTE: local `ps_audit_log` schema (migration
   `20260213_001`) is a ROW-MUTATION table (action CHECK = INSERT/UPDATE/DELETE, needs
   `table_name` + `record_id`) — it does NOT fit API-query event logging well. May need a
   dedicated table (e.g. `ps_nhs_api_audit`). The PDS risk log makes the SAME
   `ps_audit_log` claims, so this likely affects PDS too.

### Other risk-log fixes still to do

- Replace `N/A` in numeric scoring cells (rows 003, 004, 012, 013 — Cause Likelihood /
  Post-Mitigation Likelihood) with **1**, so the template's Impact×Likelihood formula works.
- Ensure all 21 rows present & in order in the ORIGINAL .xlsx (not a CSV re-export).

## ⛔ BLOCKER — MCP cannot reach the Pharmstation project

I need to verify the LIVE `ps_audit_log` schema (local migration may be stale) before
writing audit code, but MCP access is broken:

- Available MCP token lists 5 projects under org `uhxuwjzngouvgjirpctr`: PharmacySkills,
  pocketpharma, simplescribe, landa, Biind.
- **`xsqwpmqfbirqdncoephf` (Pharmstation) is NOT in that list** → every MCP call returns
  "permission denied". Yet curl tests DO hit the deployed function at that ref, so the
  project is real — the MCP token just isn't authorised for it.
- ACTION: either (a) point the correct pharmstation-scoped MCP at ref
  `xsqwpmqfbirqdncoephf`, or (b) authorise the unscoped server's PAT for that project.
- MCP config lives at: `%APPDATA%\Code\User\mcp.json`.

## NEXT STEPS (in order)

1. Fix MCP access to `xsqwpmqfbirqdncoephf`; verify live `ps_audit_log` schema + whether
   the table even exists in prod.
2. Decide audit approach for risks 003/004/007 (implement logging vs reword). Apply same
   decision to PDS risk log for consistency.
3. Deploy the nhs-dos-lookup auth fix; then live-test to capture a genuine 401.
4. Build the 21-item Test Evidence pack (one section per risk, live tests + code refs +
   config screenshots, matching the accepted Q2/Q3 PDF style).
5. Repair the risk log in the ORIGINAL .xlsx template (N/A→1, all 21 rows). Upload both.
6. Post the Q2.2 controller answer.

## Files touched / relevant

- EDITED (not deployed): `supabase/functions/nhs-dos-lookup/index.ts`
- Reference: `supabase/functions/nhs-pds-lookup/index.ts`
- 21 risks: `documentation/legal-and-compliance/dos-rest-api-risk-log.csv`
- Schema (maybe stale): `supabase/migrations/20260213_001_pharmstation_schema.sql`
- PDS risk log (same audit claims): `documentation/legal-and-compliance/pds-fhir-apprestricted-risk-log.csv`

## Guardrails

- Honesty first: do NOT produce evidence for any claim that isn't actually implemented.
- Stick to NHS's original .xlsx template; supplier columns only.
- Verify against LIVE project via MCP, not local files.
