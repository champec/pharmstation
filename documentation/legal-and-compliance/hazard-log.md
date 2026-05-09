# Hazard Log

**Document ID:** PS-HAZLOG-001
**Version:** 1.0
**Status:** Approved (pre-deployment baseline)
**Date of Issue:** 30 April 2026
**Next Review:** 30 October 2026 (and on every material change)
**Standard:** DCB0129
**Owner:** Champe Chilufya, Clinical Safety Officer, GPhC 2226350
**Classification:** OFFICIAL

---

## 1. About this log

This is the master Hazard Log for **Pharmstation**, maintained under the Clinical Risk Management Plan (`PS-CRMP-001`).

Each row is a credible clinical hazard arising from the Pharmstation health IT system: from its use, mis-use, malfunction, or absence at the point of need. Severity (S), Likelihood (L), and Risk band are scored against the matrix in `PS-CRMP-001 §3`.

This baseline is the **pre-live** snapshot — Pharmstation is **not yet deployed to live patient care**. Likelihoods reflect a planned controlled rollout (single pilot pharmacy, supervised use). They will be re-evaluated for each release and at every post-market review.

### Risk bands (recap)

| Band | Action |
|---|---|
| V.Low / Low | Acceptable. |
| Medium | Acceptable if ALARP justified. |
| High / V.High | Not acceptable for release. |

### Status values

`Open` — control not yet fully implemented.
`Mitigated` — control implemented and verified; residual risk acceptable.
`Accepted` — residual risk accepted by CSO with documented ALARP rationale.
`Closed` — hazard no longer applicable (e.g. feature removed).

---

## 2. Summary

| Total hazards | Open | Mitigated | Accepted | Closed |
|---|---|---|---|---|
| 18 | 2 | 13 | 3 | 0 |

| Highest residual risk band | Notes |
|---|---|
| **Medium** | All hazards reduced to Medium or below before any live deployment. CSCR will not approve release while any High residual risk remains. |

---

## 3. Hazard register

> Severity (S) 1–5, Likelihood (L) 1–5, Risk = matrix lookup. *Initial* = before controls; *Residual* = after controls.

---

### HAZ-001 — Wrong-patient match on PDS lookup (false positive)

| Field | Value |
|---|---|
| **NHS interface** | PDS FHIR (Edge Function `nhs-pds-lookup`) |
| **Hazard** | A patient is matched to the wrong NHS demographics record, e.g. due to a typo in NHS number that passes Mod-11 by coincidence, or due to use of a relative's NHS number in error. |
| **Clinical consequence** | Wrong patient identified; subsequent service, advice or claim is recorded against the wrong individual. Potential medication error, breach of confidentiality, incorrect clinical record. |
| **Cause(s)** | User typo; shared NHS number on paperwork; multiple-match handling; stale cache. |
| **Initial S / L / Risk** | S4 / L3 / **High** |
| **Controls** | C1: Server-side Mod-11 NHS-number validation in `validateNHSNumber()`. C2: Mandatory display of returned **family name + given names + DOB + postcode** before any service or claim is submitted. C3: Pharmacist must positively confirm identity ("Confirm patient" button) before continuing. C4: Cache TTL of 24 hours with `last_verified_at` enforced. C5: User training material includes "always confirm NHS number from photo ID or PDS-confirmed details." |
| **Verification** | Unit tests for Mod-11; UI test that "Confirm patient" gating cannot be bypassed; cache TTL test. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-002 — PDS lookup unavailable (no result when patient is real)

| Field | Value |
|---|---|
| **NHS interface** | PDS FHIR |
| **Hazard** | PDS API outage or 5xx error returns no patient details when one exists. |
| **Clinical consequence** | Pharmacist falls back to manual entry; demographics may be wrong; downstream NHSBSA claim may be rejected; service may be delayed. |
| **Cause(s)** | NHS API outage; network failure; auth-token failure; Edge Function cold-start error. |
| **Initial S / L / Risk** | S2 / L3 / **Low** |
| **Controls** | C1: Edge Function returns explicit `service_unavailable` error rather than silent failure. C2: UI shows clear "PDS unavailable — verify patient demographics manually from photo ID before continuing" warning. C3: Manual demographic fields are fully editable in fallback mode. C4: Lookup failure logged in audit table for post-market review. C5: NHS API status page link surfaced in admin panel. |
| **Verification** | Forced failure test (mocked 503); UI snapshot test of fallback banner. |
| **Residual S / L / Risk** | S2 / L2 / **Low** |
| **Status** | Mitigated |

---

### HAZ-003 — Stale PDS cache returns out-of-date demographics

| Field | Value |
|---|---|
| **NHS interface** | PDS FHIR |
| **Hazard** | Cached PDS record (e.g. old address, old GP) is used after the patient's record has changed. |
| **Clinical consequence** | NHS Notify message sent to old contact details; claim sent with stale data, rejected by NHSBSA; correspondence sent to wrong address. |
| **Cause(s)** | Cache TTL too long; PDS Notifications not consumed (we do not subscribe to PDS Notifications). |
| **Initial S / L / Risk** | S2 / L3 / **Low** |
| **Controls** | C1: 24-hour cache TTL hard-enforced server-side. C2: Critical operations (claim submission, NHS Notify send) bypass cache and force a fresh PDS lookup. C3: Patient demographics displayed alongside `last_verified_at` timestamp so pharmacist sees freshness. |
| **Verification** | Cache-bypass test for `nhs-claim-*` functions; UI test for timestamp display. |
| **Residual S / L / Risk** | S2 / L2 / **Low** |
| **Status** | Mitigated |

---

### HAZ-004 — Sandbox-only data leaks into production behaviour

| Field | Value |
|---|---|
| **NHS interface** | PDS FHIR |
| **Hazard** | The PDS sandbox returns the fake GP ODS code `Y12345`, which Pharmstation maps to a real GP (`M92040`, Mayfield Medical Practice, Wolverhampton) for downstream resolution in test only. If this mapping accidentally runs in production, every sandbox patient's GP would be reported as Mayfield, regardless of the real GP. |
| **Clinical consequence** | Wrong GP recorded; referrals/correspondence sent to wrong practice; medication-related communication misdirected. |
| **Cause(s)** | `IS_SANDBOX` flag wrongly true in production; configuration drift. |
| **Initial S / L / Risk** | S3 / L2 / **Medium** |
| **Controls** | C1: `IS_SANDBOX` is **derived in code** from `PDS_BASE === PDS_SANDBOX` (not from a separate env var) — see `supabase/functions/nhs-pds-lookup/index.ts` lines 26–27. The sandbox-mapping code path is structurally unreachable when `PDS_BASE` is set to `PDS_INT` or `PDS_PROD`. C2: `fixSandboxOdsCode()` short-circuits with `if (!IS_SANDBOX) return odsCode` (lines 44–46) — the `Y12345 → M92040` replacement is impossible to execute outside sandbox. C3: Production deployment checklist asserts `PDS_BASE === PDS_PROD` and is signed off by CSO before each release. C4: Release notes flag any change to `PDS_BASE` as safety-relevant. |
| **Verification** | Code review of `nhs-pds-lookup/index.ts` confirms derivation logic; sandbox-mapping is reachable only when `PDS_BASE === PDS_SANDBOX`. CSO sign-off captured in CSCR for each release. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated. Control is implemented in code (commit history of `nhs-pds-lookup/index.ts`). |

---

### HAZ-005 — Wrong-pharmacy routing for NHS 111 referral

| Field | Value |
|---|---|
| **NHS interface** | NHS 111 ITK adaptor; DoS UEC REST |
| **Hazard** | An NHS 111 CPCS referral is routed to the wrong pharmacy, or to a pharmacy that has closed/withdrawn from the service. |
| **Clinical consequence** | Patient does not receive timely care; clinical condition deteriorates; pharmacy receives a referral they cannot fulfil. |
| **Cause(s)** | Stale DoS profile; pharmacy ODS code mis-assigned in Pharmstation tenant config; ITK SOAP envelope addressed to wrong endpoint. |
| **Initial S / L / Risk** | S4 / L2 / **Medium** |
| **Controls** | C1: ITK adaptor validates the receiving ODS code in the SOAP header against the tenant's configured ODS code; rejects with ITK error if mismatched. C2: DoS profile is owned by the deploying pharmacy via their local ICS DoS Lead — this is documented in onboarding pack and is the deploying organisation's DCB0160 responsibility. C3: ITK-receipt audit log (`ps_itk_referrals`) records source, destination, timestamp; reviewed in monthly CSO sweep. C4: Mandatory "withdraw from service" flow updates DoS profile before the deploying pharmacy goes offline. |
| **Verification** | Integration test with mismatched ODS code → ITK rejection; audit-log presence test. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated (Pharmstation side). DoS profile freshness is partly outside Pharmstation's control — flagged to deploying organisations under DCB0160. |

---

### HAZ-006 — NHS 111 referral lost (silent drop)

| Field | Value |
|---|---|
| **NHS interface** | NHS 111 ITK adaptor |
| **Hazard** | An ITK SOAP referral is received by Pharmstation but never surfaced to the pharmacist (e.g. parsing failure, queue stuck, app down). |
| **Clinical consequence** | Patient expects pharmacy to call them; they are never contacted; potential clinical deterioration. |
| **Cause(s)** | Adaptor crash; database write failure; UI bug; pharmacist not logged in to receive notification. |
| **Initial S / L / Risk** | S4 / L3 / **High** |
| **Controls** | C1: ITK adaptor sends an Accept/Reject Acknowledgement (ACK) per ITK spec only **after** the referral is durably persisted to Postgres. C2: NHS 111 sender will retry on missing ACK — guarantees re-delivery. C3: Dead-letter queue for parsing failures with on-call alert. C4: Daily reconciliation report: count of ITK ACKs sent vs referrals visible in pharmacy inbox. C5: Visual + email + audible-alert on referral arrival; pharmacy SOP requires staff to acknowledge each referral within service-level time. C6: Unacknowledged referrals after 30 minutes auto-escalate (banner + email to pharmacy manager). |
| **Verification** | Integration test: kill app between ACK and persist → re-delivery; dead-letter test; reconciliation report verified manually. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-007 — Wrong-claim routing at NHSBSA (claim attached to wrong patient/service)

| Field | Value |
|---|---|
| **NHS interface** | NHSBSA MYS APIs (`nhs-claim-cpcs`, `nhs-claim-nms`, `nhs-claim-scs`, `nhs-claim-cvd`, `nhs-claim-contraception`) |
| **Hazard** | A claim is submitted with the wrong patient NHS number, the wrong service type, or against the wrong pharmacy ODS, leading to incorrect clinical record at NHSBSA / NHS BSA-shared systems. |
| **Clinical consequence** | A patient's NHS record may show services they did not receive, or vice versa. Direct clinical consequence is low (NHSBSA is primarily a payment system) but downstream record integrity is affected; reputational and regulatory consequence is significant. |
| **Cause(s)** | Patient record swap; mis-mapped service type; wrong tenant ODS in claim payload; double-submission. |
| **Initial S / L / Risk** | S3 / L3 / **Medium** |
| **Controls** | C1: Claim payload is constructed server-side from the patient record + service record + tenant ODS — the client cannot override identifiers. C2: Each claim has a Pharmstation-generated `PLATFORM_DEPOSIT_ID` (`PSN-` prefix) that is logged and idempotent — duplicate submissions return the same ID. C3: Claim type is bound at the Edge Function endpoint (`nhs-claim-cpcs` cannot submit a SCS claim). C4: Claim submission shows a final summary screen with patient name + DOB + service + amount; pharmacist must explicitly confirm. C5: Audit table `ps_nhs_submission_attempts` retained 8 years per NHS retention. |
| **Verification** | Unit tests for payload construction; integration test for idempotency; UI confirmation gating test. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-008 — Claim silently rejected by NHSBSA, not surfaced to pharmacy

| Field | Value |
|---|---|
| **NHS interface** | NHSBSA MYS |
| **Hazard** | A claim is rejected by NHSBSA but the failure is not visible to pharmacy staff, so they believe the service is recorded and paid for. |
| **Clinical consequence** | Limited direct clinical risk; significant clinical-record incompleteness and financial loss. Considered for completeness as a use-error / system-feedback hazard. |
| **Cause(s)** | Edge Function swallows error; UI does not show status; queue stuck. |
| **Initial S / L / Risk** | S2 / L3 / **Low** |
| **Controls** | C1: `ps_nhs_claim_submissions.status` enum (`pending`, `submitted`, `accepted`, `rejected`, `error`) surfaced in claims dashboard. C2: Daily reconciliation email to pharmacy listing rejected/error claims. C3: NHSBSA error responses logged verbatim for support. |
| **Verification** | Forced rejection test → status update + dashboard surface. |
| **Residual S / L / Risk** | S2 / L2 / **Low** |
| **Status** | Mitigated |

---

### HAZ-009 — NHS Notify message sent to wrong recipient

| Field | Value |
|---|---|
| **NHS interface** | NHS Notify |
| **Hazard** | A patient communication (NHS App message / SMS / email / letter) is sent to the wrong patient. |
| **Clinical consequence** | Confidentiality breach (special-category health data). Direct clinical risk if the message contains time-critical instructions and the wrong patient acts on them. |
| **Cause(s)** | Wrong NHS number selected; stale PDS contact details; wrong template variables; bulk-send filter mistake. |
| **Initial S / L / Risk** | S3 / L3 / **Medium** |
| **Controls** | C1: NHS Notify always called by NHS number — Notify resolves contact details server-side from PDS, eliminating most cross-wiring. C2: Templates are pre-approved and parameterised; free-text patient-identifying content is not permitted in templates. C3: Bulk-send requires a two-step confirm with recipient count and an example preview. C4: All sends are audited (`ps_nhs_messages`) with patient ID, template ID, timestamp. C5: NHS Notify itself is configured per pharmacy account — Pharmstation does not bulk-send across pharmacies. |
| **Verification** | Template-variable validator tests; bulk-send confirmation test; audit-log test. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-010 — Time-critical NHS Notify message delayed or undelivered

| Field | Value |
|---|---|
| **NHS interface** | NHS Notify |
| **Hazard** | A clinically time-critical message (e.g. "stop taking medication X — recall") is delayed or not delivered. |
| **Clinical consequence** | Patient does not act in time; potential medication-related harm. |
| **Cause(s)** | NHS Notify outage; SMS carrier failure; patient has no NHS App / no SMS number / undeliverable email. |
| **Initial S / L / Risk** | S4 / L2 / **Medium** |
| **Controls** | C1: Pharmstation labels each template with criticality (informational / clinical / safety-critical). Safety-critical messages are NOT the primary delivery channel — they require pharmacist phone-call follow-up logged against the patient. C2: Pharmstation displays "delivery status" per recipient (queued / delivered / failed / read). C3: Failed-delivery list surfaced in dashboard with a re-try / phone-call workflow. C4: User documentation explicitly states NHS Notify is not a guaranteed-delivery channel for safety-critical communications. |
| **Verification** | UI test for criticality flag; failed-delivery dashboard test. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-011 — Authentication bypass / session hijack leads to wrong-user access

| Field | Value |
|---|---|
| **NHS interface** | All |
| **Hazard** | A user (or attacker) accesses Pharmstation as a different user, e.g. as a pharmacist when they are not registered, and acts on patient records. |
| **Clinical consequence** | Unauthorised clinical decisions recorded against patients; safeguarding breach; potential medication errors if non-clinician overrides safety prompts. |
| **Cause(s)** | Weak authentication; session token theft; missing role check on a route; RLS misconfigured. |
| **Initial S / L / Risk** | S4 / L2 / **Medium** |
| **Controls** | C1: Supabase Auth with email + strong password; MFA available and enforced for admin roles. C2: Postgres Row-Level Security (RLS) enforced on every patient/clinical table — every query carries the authenticated user's context, denied otherwise. C3: Role-based gating server-side (pharmacist / technician / support / admin). C4: 30-minute idle timeout. C5: Annual penetration test (DSPT 9.1.4) with safety-relevant findings tracked here. C6: All clinical actions audited with user ID + timestamp. |
| **Verification** | Automated RLS test suite; penetration-test report; role-gating tests. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-012 — Audit log gap (action taken but not recorded)

| Field | Value |
|---|---|
| **NHS interface** | All |
| **Hazard** | A clinical action is taken in Pharmstation but not durably recorded in the audit trail. |
| **Clinical consequence** | Inability to reconstruct clinical events; impaired investigation of harm; impaired regulatory compliance. |
| **Cause(s)** | Database transaction failure; async write swallowed; logging library outage. |
| **Initial S / L / Risk** | S2 / L2 / **Low** |
| **Controls** | C1: All clinical writes wrapped in a single transaction with the audit insert — if audit write fails, the clinical write is rolled back. C2: Append-only `ps_audit` table; no DELETE permission for any application role. C3: Backups retained per ROPA retention schedule. |
| **Verification** | Transaction-rollback test; permission test against `ps_audit`. |
| **Residual S / L / Risk** | S2 / L1 / **V.Low** |
| **Status** | Mitigated |

---

### HAZ-013 — Service form allows submission with missing safety-critical fields

| Field | Value |
|---|---|
| **NHS interface** | None (internal) |
| **Hazard** | A clinical service form (e.g. NMS consultation) can be submitted without recording allergies, current medications, or red-flag screening. |
| **Clinical consequence** | Pharmacist may proceed without considering a contraindication; potential medication-related harm. |
| **Cause(s)** | Missing required-field validation; conditional fields not enforced server-side. |
| **Initial S / L / Risk** | S3 / L3 / **Medium** |
| **Controls** | C1: Service form schemas declare safety-critical fields; both client and server enforce them. C2: Red-flag fields force "Acknowledged" tick — cannot be silently skipped. C3: Form draft state separated from submitted state; only submitted state is treated as a clinical record. C4: Form schemas reviewed by CSO before release. |
| **Verification** | Schema-coverage test per service; manual CSO sign-off recorded in CSCR. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-014 — Build/deployment regression introduces unsafe behaviour

| Field | Value |
|---|---|
| **NHS interface** | All |
| **Hazard** | A deployment pushes a change that silently breaks a safety-relevant control (e.g. removes the Mod-11 check, disables RLS, lowers cache TTL). |
| **Clinical consequence** | Any of HAZ-001..HAZ-013 reactivated. |
| **Cause(s)** | Code regression; bad merge; missing test; mis-applied migration. |
| **Initial S / L / Risk** | S4 / L3 / **High** |
| **Controls** | C1: Mandatory PR review for any change in `supabase/functions/nhs-*` and `supabase/migrations/`. C2: CI runs the full safety-relevant test suite; merge blocked on failure. C3: Database migrations forward-only; rollback plan required for any RLS / audit / claim-route change. C4: Each release accompanied by a CSCR addendum if any safety-relevant code path changed. C5: Vercel / Supabase build-failure alerts go to CSO. C6: Release notes flag safety-relevant changes explicitly. |
| **Verification** | CI pipeline configured; CSCR template requires "safety-relevant changes since last release" section. |
| **Residual S / L / Risk** | S4 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-015 — Concurrent edits cause clinical-record overwrite

| Field | Value |
|---|---|
| **NHS interface** | None (internal) |
| **Hazard** | Two staff members edit the same patient/service record concurrently; one overwrites the other's changes. |
| **Clinical consequence** | Loss of clinically relevant information (e.g. allergy noted by one staff member is overwritten). |
| **Cause(s)** | Last-write-wins UI; absence of optimistic concurrency control. |
| **Initial S / L / Risk** | S2 / L3 / **Low** |
| **Controls** | C1: Optimistic concurrency token (`updated_at`) checked on save; conflict surfaced to user with a merge prompt. C2: Service consultations are append-only event-style records — historical entries cannot be silently rewritten. |
| **Verification** | Concurrent-edit integration test. |
| **Residual S / L / Risk** | S2 / L1 / **V.Low** |
| **Status** | Mitigated |

---

### HAZ-016 — Single-person sole-trader manufacturer (organisational risk)

| Field | Value |
|---|---|
| **NHS interface** | All — organisational |
| **Hazard** | The CSO is also the owner and sole developer. Sudden incapacity, loss of GPhC registration, or loss of access could leave deployed pharmacies without a CSO and without the ability to issue field-safety notices. |
| **Clinical consequence** | Delayed safety response; orphaned deployments; regulatory non-compliance. |
| **Cause(s)** | Sole-trader structure; key-person concentration. |
| **Initial S / L / Risk** | S3 / L2 / **Low** |
| **Controls** | C1: Deputy CSO appointed — Biniam Eyob Fesseha, GPhC 2221360 (Independent Prescriber, Birmingham). Appointment letter `PS-CSO-002` issued 30 April 2026. C2: Triggers for the deputy to act are documented in `PS-CSO-002 §4.1` (CSO unavailable >14 days, resignation, loss of eligibility, declared conflict of interest). C3: All clinical safety documents version-controlled in git; handover pack (current CSCR, open hazards, pending decisions) provided to deputy at start of any acting period. C4: Business-continuity contact details (substantive + deputy CSO) to be published to deploying pharmacies before first live deployment. C5: GPhC registration status of both CSO and Deputy CSO verified annually as part of CRMP review (next deputy check due on or before 31 October 2026 — deputy's GPhC renewal date). |
| **Verification** | Signed deputy appointment letter (`PS-CSO-002`); annual GPhC register check evidenced in CRMP review record. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated (subject to countersignature of `PS-CSO-002` by deputy). |

---

### HAZ-017 — Use-error: pharmacist relies on Pharmstation as clinical decision support

| Field | Value |
|---|---|
| **NHS interface** | None (use-error) |
| **Hazard** | A user mistakenly treats a Pharmstation form as clinical decision support and proceeds without independent clinical judgement. |
| **Clinical consequence** | Inappropriate treatment selection; missed contraindication. |
| **Cause(s)** | Mis-perception of system intent; UI ambiguity; lack of training. |
| **Initial S / L / Risk** | S3 / L2 / **Low** |
| **Controls** | C1: Intended-use statement (`PS-CRMP-001 §1.4`) included in user manual and on-screen on first login. C2: Forms display "Pharmstation supports your record-keeping; clinical judgement remains with the registered pharmacist." C3: Onboarding training includes intended-use statement and use-error scenarios. |
| **Verification** | First-login UI test; training material review. |
| **Residual S / L / Risk** | S3 / L1 / **Low** |
| **Status** | Mitigated |

---

### HAZ-018 — Patient identifiable data exposed via logs / error messages

| Field | Value |
|---|---|
| **NHS interface** | All |
| **Hazard** | NHS numbers, names, DOB or addresses leak into application logs, error responses, or third-party error trackers. |
| **Clinical consequence** | Confidentiality breach (special-category health data). Limited direct clinical harm but high regulatory and reputational impact. |
| **Cause(s)** | Verbose error logging; raw FHIR response logged; uncaught exception bubbling up with payload. |
| **Initial S / L / Risk** | S2 / L3 / **Low** |
| **Controls** | C1: Logging guidelines forbid logging full PDS/FHIR responses; structured logger redacts known PII fields. C2: Errors surfaced to users do not contain other patients' data. C3: Error tracker (if any) is configured with NHS-data scrubbing; subprocessor entered in supplier register. C4: Annual log review by SIRO. |
| **Verification** | Log-redaction test; error-tracker configuration review. |
| **Residual S / L / Risk** | S2 / L2 / **Low** |
| **Status** | Mitigated |

---

## 4. Open hazards summary (must be closed before first PROD release)

| ID | Title | Action required |
|---|---|---|
| HAZ-014 | Build/deployment regression | Configure CSO alert on Vercel/Supabase build failures. |
| HAZ-006 | NHS 111 referral lost (residual ops) | Confirm reconciliation-report SOP signed off by deploying pharmacy at go-live. |

---

## 5. Document control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 30 April 2026 | Champe Chilufya (CSO, GPhC 2226350) | Initial baseline. 18 hazards identified across PDS, NHS Notify, NHS 111, NHSBSA MYS, DoS, and organisational scope. All hazards reduced to ≤ Medium residual; 4 open items must close before first PROD release. |

**Signed:** Champe Chilufya, CSO — 30 April 2026
