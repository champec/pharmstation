# DoS Risk Log — paste-by-column helper

Fill the pristine v0.3 `.xlsx` by pasting ONE column at a time into the supplier
columns only: **H, I, L, M, S**. Never paste a wide block — the columns J, K, N, O
are formulas (Calculated) and P, Q, R belong to the NHS assurance team.

How to paste each column:
1. Click the FIRST data cell of that column (the cell in the DosRESTAPI-001 row).
2. Copy the 21 lines from the matching block below.
3. Paste (Ctrl+V). Excel fills the 21 rows downward.
4. (Optional extra safety: Paste Special → Values.)

Before you start: confirm the template lists DosRESTAPI-001 … 021 in order with no
gap rows, so the 21 lines line up. Match by HEADER NAME (column letters below are
from the template you shared).

===============================================================================
COLUMN H — "Cause Likelihood (1-5)"   (21 lines)
===============================================================================
3
3
1
1
3
3
3
3
3
3
3
1
1
3
1
3
3
3
3
3
3

===============================================================================
COLUMN I — "Justification of Cause Likelihood Rating"   (21 lines)
===============================================================================
All DoS queries are routed through the authenticated nhs-dos-lookup Edge Function, which validates the caller's Supabase JWT before any query runs. Access is org-scoped by Supabase Row-Level Security. NHS_DOS_API_KEY is stored in Supabase secrets — never exposed to the client. Role-based restriction to specific staff is applied in the application UI at point of use (pre-launch; no live users yet).
All DoS queries routed through Pharmstation nhs-dos-lookup Edge Function which validates user JWT before processing. Unauthenticated requests rejected at Edge Function entry.
Not applicable to the DoS request itself — Pharmstation does not send user audit information to the DoS API. All audit logging is internal to Pharmstation (ps_nhs_api_audit table), recording the authenticated user ID taken from the validated JWT plus a timestamp, so the recorded user cannot be wrong. DoS queries are application-restricted.
All DoS lookup results are logged in the ps_nhs_api_audit table by the server-side Edge Function. On the success path the audit write is mandatory: if it fails, DoS details are withheld (HTTP 500) rather than returned, so a user cannot view DoS details without a corresponding audit record.
Pharmstation nhs-dos-lookup Edge Function wraps all DoS API calls in try/catch. All error paths return structured JSON responses with HTTP status codes. Network failures return 503 DOS_UNAVAILABLE. Application never crashes on DoS error — always returns a response.
All error responses include a human-readable message field explaining what went wrong and what action to take (e.g. 'The pharmacy may not be registered in the Directory of Services — contact their local ICS DoS Lead').
All DoS API errors are logged server-side in Supabase with full request context (action / ODS code / HTTP status / error body / timestamp). Supabase dashboard provides real-time log access.
Pharmstation passes ODS codes directly from authenticated pharmacy tenant configuration — codes are validated against ODS API at pharmacy onboarding. No transformation of DoS response data before presenting to user.
Pharmstation nhs-dos-lookup passes DoS API responses directly to caller without re-structuring. No mapping layer that could corrupt structure.
Pharmstation displays DoS response data directly from the API response, with no custom processing that could drop fields — the Edge Function returns the DoS payload unmodified.
The Edge Function returns the complete DoS payload unmodified (thin envelope; code reference: nhs-dos-lookup/index.ts), so no fields are dropped server-side. The DoS presentation layer is designed to render all returned fields; end-to-end rendering against a live DoS response is to be demonstrated at NHS witness testing (presentation layer not yet exercised against a live DoS response).
Pharmstation does not cache DoS service profile data locally. Each query fetches live from DoS API to ensure freshness. No local data store for DoS results.
Not applicable — Pharmstation makes live DoS API calls on demand. No caching of DoS service profile data. Every care decision uses a fresh DoS query.
Pharmstation nhs-dos-lookup validates all required fields server-side before calling DoS. Missing ODS code returns 400 INVALID_REQUEST. Invalid format returns 400 INVALID_ODS_CODE. Client cannot bypass server-side validation.
DoS data is designed to be presented in a structured pharmacy-profile view with labelled fields; the raw API response is not exposed to end users. Live presentation of a real DoS response is to be confirmed at NHS witness testing.
All DoS error codes mapped to user-facing messages with clear next-action instructions. e.g. SERVICE_NOT_FOUND → 'Pharmacy not registered in DoS — contact local ICS DoS Lead'. DOS_UNAVAILABLE → 'DoS service temporarily unavailable — retry or use manual referral process'.
Pharmstation is subscribed to NHS England API change notifications. DoS API base URL and version are pinned as named constants in code — a single point of update. Breaking changes require a code update — release process includes CSO sign-off before deployment.
Pharmstation DoS queries execute in Supabase Edge Functions (Deno, global edge network) with sub-second response targets. Edge Function response times are monitored via the Supabase dashboard.
Supabase Edge Functions are deployed on Deno Deploy (global, multi-region). Vercel frontend is globally distributed. Both platforms have 99.9%+ SLA. NHS DoS unavailability handled gracefully — system returns DOS_UNAVAILABLE error and allows manual fallback.
Build-failure alerts configured on Vercel and Supabase to CSO email. Edge Function errors surfaced to users with clear error messages. DoS query errors recorded in the ps_nhs_api_audit table for review.
Pharmstation uses CI/CD via Vercel (frontend) and Supabase CLI (Edge Functions). Every deployment is atomic with instant rollback. Release checklist includes a post-deploy smoke test confirming the function is live before marking release complete.

===============================================================================
COLUMN L — "Supplier Internal Mitigations"   (21 lines)
===============================================================================
Authenticated-only access enforced server-side: the caller's JWT is validated at Edge Function entry and unauthenticated requests return 401 before reaching DoS. Org-scoped access via Supabase Row-Level Security. NHS_DOS_API_KEY held as a Supabase secret, not in the client bundle. Role gating to specific staff is applied in the application UI at point of use (pre-launch).
JWT validation on every Edge Function call. Supabase Auth enforces session validity. MFA mandatory for admin/owner roles. 30-minute idle session timeout. DoS API key never exposed client-side.
All DoS queries logged internally in ps_nhs_api_audit with authenticated user ID (from JWT), org_id, timestamp, and query parameters. On the success path DoS details are withheld (HTTP 500) if the audit write fails, so a result cannot be viewed without a corresponding audit record. Append-only table; no DELETE permission.
Every byODSCode and byServiceId call logs: user_id, org_id, ods_code/service_id queried, timestamp, and response status. Audit is written server-side in the Edge Function via the service role — it cannot be bypassed by the client. On success, results are withheld (HTTP 500) if the audit write fails.
Comprehensive try/catch around all DoS fetch calls. Distinct error codes for each failure mode: MISSING_ACTION / INVALID_ODS_CODE / SERVICE_NOT_FOUND / DOS_AUTH_ERROR / RATE_LIMITED / DOS_SERVER_ERROR / DOS_UNAVAILABLE / INTERNAL_ERROR. All return consistent JSON structure. Evidence: error handling test PDF (Q2/Q3).
Every error response contains: (1) machine-readable code e.g. SERVICE_NOT_FOUND, (2) human-readable message with actionable advice, (3) optional detail field with raw DoS response for developer debugging. UI surfaces the message field prominently. Evidence: error handling test PDF (Q2/Q3).
All DoS errors logged in the ps_nhs_api_audit table with: user_id, action, query params, HTTP status, error detail (the error body returned), and timestamp. Supabase Edge Function logs (Deno runtime) additionally capture stack traces. Build-failure alerts configured to CSO email (HAZ-014 in DCB0129 hazard log).
ODS code passed verbatim from validated pharmacy configuration. DoS response returned to UI without modification — data integrity preserved end-to-end. ODS code format validated (3-6 alphanumeric) before query. Pharmacy ODS verified against NHS ODS API at tenant setup.
DoS API response passed through without transformation. nhs-dos-lookup wraps the response in a thin envelope: { source, ods_code, services: [DoS response] } — the DoS data structure itself is unmodified (code reference: nhs-dos-lookup/index.ts, handleByOdsCode/handleByServiceId). Structure fidelity against a live response to be verified at NHS witness testing; no live data-returning DoS endpoint is currently available to the supplier.
The nhs-dos-lookup Edge Function returns the complete DoS payload with no truncation or field-dropping (thin envelope; code reference: nhs-dos-lookup/index.ts). UI renders all fields returned by the DoS API. Live end-to-end rendering of a real DoS response to be verified at NHS witness testing; no live data-returning DoS endpoint is currently available to the supplier.
Server-side pass-through returns all DoS fields with no field-dropping (thin envelope). The presentation layer is designed to render every returned field, with typed interfaces and peer code review required for any DoS display change. Live rendering of a real DoS response to be verified at NHS witness testing; no live data-returning DoS endpoint is currently available to the supplier.
No local DoS data store — all queries are live against DoS API. Eliminates stale-cache risk entirely. DoS profile data is read-only reference data fetched on demand.
Live queries only — no DoS data caching. Every byODSCode / byServiceId call performs a fresh request to the configured DoS endpoint (no local store is read). Freshness is guaranteed by design (code reference: nhs-dos-lookup/index.ts — no cache read/write).
Server-side validation in Edge Function: (1) ods_code presence check — returns 400 INVALID_REQUEST if missing; (2) ODS format regex check — returns 400 INVALID_ODS_CODE if invalid format; (3) service_id numeric check for byServiceId. Validation runs before any DoS API call. Evidence: TEST 1 and TEST 2 in error handling PDF.
DoS data designed for presentation in a structured view with human-readable labels (Service Name, Opening Hours, Service Type, Address); raw JSON not shown to users. Accessibility: WCAG 2.1 AA target. Live rendering of a real DoS response to be confirmed at NHS witness testing (presentation layer not yet exercised against a live DoS response).
Full error-code-to-user-message mapping in nhs-dos-lookup. Each code has a specific human-readable message and recommended action. Errors surfaced in UI with suggested next steps. Evidence: error handling PDF Q2/Q3.
(1) NHS England API change notifications subscribed via developer portal. (2) DoS base URL and version are named constants in nhs-dos-lookup/index.ts (single point of update). (3) Edge Function deployments are versioned via the Supabase CLI, enabling rollback. (4) CSO sign-off required for any change to NHS API integration code. NOTE: the legacy DoS REST API was deprecated by NHS on 31 May 2026; Pharmstation is continuing onboarding to the current API with NHS England agreement and will transition to the replacement Find the Right Service API per NHS timelines — this change-management item is actively in hand.
Edge Functions run on Deno Deploy (global edge) — low latency to NHS API endpoints. Supabase dashboard provides response-time monitoring for the nhs-dos-lookup function. DoS queries are non-blocking (async/await). NHS DoS rate limits will be respected by design — a single-pharmacy pilot generates fewer than 10 DoS queries/day. End-to-end DoS response-time measurement to be captured at NHS witness testing against the live endpoint.
(1) Supabase global edge deployment — no single point of failure. (2) Vercel global CDN. (3) DOS_UNAVAILABLE error response allows pharmacist to use manual referral process. (4) Supabase daily automated backups. (5) Vercel instant rollback on deployment failure. (6) Status monitoring via Supabase/Vercel status pages.
(1) Vercel 'Failed Deployment' notifications → CSO email. (2) Supabase 'Failed function deploy' notifications → CSO email. (3) All DoS errors returned to UI with visible error messages — never silent failures. (4) ps_nhs_api_audit records all DoS errors (HTTP status + error detail) for CSO review. (5) Supabase dashboard shows Edge Function logs and error rates.
(1) Vercel atomic deployments with instant rollback. (2) Supabase Edge Function deployment via CLI with version tracking (each deploy increments the function version). (3) Post-deployment smoke test: an authenticated call confirms nhs-dos-lookup is live and returns its structured response. (4) Build failure alerts to CSO. (5) Release checklist signed off by CSO before production deployment.

===============================================================================
COLUMN M — "Post Mitigation Likelihood"   (21 lines)
===============================================================================
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1
1

===============================================================================
COLUMN S — "Is the mitigation in place?"   (21 lines)
===============================================================================
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes
Yes

===============================================================================
After pasting: check the Calculated columns (J = Overall Risk Score, N = Residual
Score) show numbers, not #VALUE!/blank. Expected pairs (Overall / Residual):
001 12/4 · 002 6/2 · 003 2/2 · 004 2/2 · 005 12/4 · 006 12/4 · 007 12/4 ·
008 9/3 · 009 9/3 · 010 9/3 · 011 9/3 · 012 3/3 · 013 3/3 · 014 12/4 ·
015 3/3 · 016 9/3 · 017 12/4 · 018 9/3 · 019 9/3 · 020 9/3 · 021 9/3
===============================================================================
