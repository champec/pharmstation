# Clinical Safety Case Report (CSCR)

**Document ID:** PS-CSCR-001
**Version:** 1.0
**Status:** Approved (pre-deployment baseline; SANDBOX / non-clinical use only)
**Release covered:** Pharmstation v0.1 (development build, sandbox NHS API integrations only)
**Date of Issue:** 30 April 2026
**Standard:** NHS Digital DCB0129 — *Clinical Risk Management: its Application in the Manufacture of Health IT Systems*
**Manufacturer:** Pharmstation (Champe Chilufya, sole trader; ODS D8W5S; ICO CSN7417303)
**Clinical Safety Officer:** Champe Chilufya, GPhC 2226350
**Classification:** OFFICIAL

---

## 1. Executive Summary

This Clinical Safety Case Report (CSCR) presents the clinical safety case for **Pharmstation v0.1**, a community-pharmacy clinical-services workflow platform. It is produced under DCB0129 by the Pharmstation Clinical Safety Officer (CSO).

This CSCR covers the **pre-deployment baseline** of Pharmstation:

- The system is integrated with **NHS PDS sandbox** (open-access, no live patient data) and is configured to consume **NHSBSA MYS staging credentials** (not yet issued). It is **not yet processing live NHS patient data**.
- All clinical safety processes (CRMP, hazard log, CSO appointment) are in place.
- 18 hazards have been identified, controlled and reduced to a maximum residual risk band of **Medium**, justified ALARP. 14 are Mitigated, 1 Accepted, and 4 are Open. None are High or Very High.
- **The CSO approves Pharmstation for continued development, sandbox testing, and NHS API assurance activity.** The CSO does **not** approve Pharmstation for live patient use until the four Open hazards (HAZ-004, HAZ-006, HAZ-014, HAZ-016) are closed and a "first PROD release" CSCR addendum is issued.

---

## 2. System description

| Item | Value |
|---|---|
| Product | Pharmstation |
| Release | v0.1 (development baseline) |
| Intended use | Workflow and record-keeping tool for community pharmacies delivering NHS-commissioned advanced services (CPCS / Pharmacy First, NMS, SCS, CVD case-finding, Contraception, Flu/COVID vaccinations) and locally-commissioned services. |
| Intended users | Registered pharmacists, registered pharmacy technicians, supervised pharmacy staff, pharmacy administrators. |
| NHS APIs in scope | PDS FHIR (sandbox), DoS UEC REST, NHS Notify (planned), NHSBSA MYS (CPCS / NMS / SCS / CVD / Contraception), NHS 111 ITK adaptor. |
| Out of scope | EPS prescription processing; PMR replacement; auto-prescribing; clinical decision-support algorithms. |
| Deployment model | Pharmstation is the manufacturer (DCB0129). Each deploying pharmacy is the deploying organisation (DCB0160) and is responsible for their own clinical safety case for deployment. |

A full description, including component architecture, is in the Clinical Risk Management Plan `PS-CRMP-001 §1`.

---

## 3. Clinical Risk Management System

The CRMS is documented in `PS-CRMP-001`. Key elements:

- **CSO appointed** in writing (`PS-CSO-001`). Champe Chilufya, GPhC 2226350.
- **Risk-acceptability matrix** defined with severity 1–5, likelihood 1–5, and acceptability bands (`PS-CRMP-001 §3`).
- **Hazard identification** uses functional hazard analysis, user-task walkthroughs, use-error analysis, and post-market surveillance.
- **Risk control** follows the ISO 14971 hierarchy: design → protective measures → information for safety.
- **Verification** — every control is traced to a test or procedural evidence reference.
- **Lifecycle integration** — clinical safety activity at specification, design, build, verification, release, post-market and modification.

---

## 4. Hazard Identification & Analysis

The full register is in `PS-HAZLOG-001` (18 hazards). Methods used:

1. Functional hazard analysis per NHS interface (PDS, NHSBSA MYS, NHS 111 ITK, NHS Notify, DoS).
2. Walkthroughs of each clinical service form by the CSO (a registered pharmacist) modelling foreseeable use and mis-use.
3. Use-error analysis per IEC 62366 principles.
4. Review of penetration test and DSPT findings for clinical-safety implications.
5. Review of NHS England, MHRA and supplier safety alerts in the past 12 months.
6. Architectural review of audit, RLS, and idempotency mechanisms.

### 4.1 Hazard summary by NHS interface

| NHS interface / area | Hazards | Highest residual risk |
|---|---|---|
| PDS FHIR | HAZ-001, HAZ-002, HAZ-003, HAZ-004 | Low (HAZ-004 still Open — Medium initial, Low after C3) |
| NHS 111 ITK / DoS | HAZ-005, HAZ-006 | Low |
| NHSBSA MYS | HAZ-007, HAZ-008 | Low |
| NHS Notify | HAZ-009, HAZ-010 | Low |
| Cross-cutting (auth, audit, build, concurrency, logs) | HAZ-011, HAZ-012, HAZ-014, HAZ-015, HAZ-018 | Low |
| Clinical workflow | HAZ-013, HAZ-017 | Low |
| Organisational | HAZ-016 | Low (but Open until deputy CSO appointed) |

---

## 5. Risk Evaluation & Control

### 5.1 Initial risk profile

Before controls, the hazard log included **3 hazards in the High band** (HAZ-001 wrong-patient PDS match, HAZ-006 NHS 111 referral lost, HAZ-014 build regression) and **6 in the Medium band**.

### 5.2 Controls applied

Key controls are summarised in §6 (key engineering controls) and itemised in `PS-HAZLOG-001`. They include:

- Server-enforced NHS-number Mod-11 validation; mandatory patient-confirmation step.
- ITK adaptor durable-write-before-ACK with reconciliation reporting.
- Server-side claim payload construction and idempotent `PLATFORM_DEPOSIT_ID`.
- Postgres Row-Level Security on every patient/clinical table.
- Single-transaction clinical-write + audit-write coupling.
- PR review and CI gating on safety-relevant code paths.
- Intended-use disclosure on first login and per form.

### 5.3 Residual risk profile

After controls:

| Band | Count |
|---|---|
| V.High | 0 |
| High | 0 |
| Medium | 0 |
| Low | 16 |
| V.Low | 2 |

No hazard sits at High or above. Where hazards retained Low residual that is still above V.Low, ALARP is satisfied because further controls would either (a) be disproportionate (e.g. mandating in-person ID verification for every PDS lookup), or (b) introduce competing risks (e.g. friction reducing clinical-workflow safety overall).

### 5.4 Open hazards

Four hazards are recorded as **Open** in the baseline log. Each has an explicit precondition for closure before any live patient deployment:

| ID | Closure precondition |
|---|---|
| HAZ-004 | Boot-time sandbox-mapping self-test in `nhs-pds-lookup`. |
| HAZ-006 | Reconciliation-report SOP signed off by deploying pharmacy at go-live. |
| HAZ-014 | CSO alerting configured for Vercel/Supabase build failures. |
| HAZ-016 | Deputy CSO appointed; business-continuity plan published to deploying pharmacies. |

These are not blockers for **sandbox testing or API assurance**, but they are blockers for the first PROD release CSCR (which will be a successor to this document).

---

## 6. Key Engineering Controls (Evidence)

| Control | Implementation | Evidence |
|---|---|---|
| NHS-number Mod-11 validation | `validateNHSNumber()` in `supabase/functions/nhs-pds-lookup/index.ts` | Function exists; unit-test coverage to be added per HAZ-001 verification. |
| Sandbox/PROD environment derivation | `IS_SANDBOX` derived from `PDS_BASE` in `nhs-pds-lookup/index.ts` | Code review; HAZ-004 self-test pending. |
| Idempotent claim submission | `PLATFORM_DEPOSIT_ID` (`PSN-` prefix) per claim, persisted in `ps_nhs_submission_attempts` | Architect findings doc §7; idempotency test pending NHSBSA staging credentials. |
| Append-only audit | `ps_audit` table with no DELETE permission; clinical writes wrapped in transactions | RLS/permission tests in CI. |
| Row-Level Security | RLS policies on every patient/clinical table | Supabase migration history; automated RLS test suite. |
| Authentication & MFA | Supabase Auth; MFA enforced for admin roles | Supabase config. |
| Logging redaction | Structured logger with PII redaction | Logging guidelines documented; redaction tests. |
| ITK durable-write-before-ACK | NHS 111 adaptor persists before sending ACK | Adaptor implementation; integration test. |
| Cache TTL | 24-hour `last_verified_at` enforced; safety-critical operations bypass cache | `nhs-pds-lookup/index.ts` logic. |

Full evidence per hazard is referenced in the Verification column of `PS-HAZLOG-001`.

---

## 7. Compliance & Information Governance Linkage

This CSCR is produced alongside, and is consistent with, Pharmstation's wider compliance posture:

| Topic | Reference | Status |
|---|---|---|
| Data Security and Protection Toolkit (DSPT) | `dspt-verification-checklist.md` | 103/103 evidence items complete; ICO done (CSN7417303); awaiting independent audit. |
| Information Asset Register / ROPA (UK GDPR Art. 30) | `information-asset-register-ropa.md` | Maintained. |
| Supplier register | `supplier-register.md` | Maintained. |
| Tabletop incident exercise | `tabletop-exercise-record-2026-03-04.md` | Exercise held 4 Mar 2026. |
| GPhC obligations | `gphc-guidelines.md` | CSO is the responsible pharmacist (GPhC 2226350). |

DSPT and DCB0129 cover different but overlapping ground: DSPT focuses on information security; DCB0129 on clinical safety. Where a control discharges both (e.g. RLS, audit, MFA), it is recorded in both.

---

## 8. Post-Market Surveillance Plan

Once Pharmstation is in live use:

1. **Incident & complaint review** — every support ticket is tagged for safety relevance and reviewed by the CSO at least monthly.
2. **Field-safety notices** — any incident with potential or actual patient harm triggers an immediate hazard-log review and, if needed, a notice to deploying pharmacies within 5 working days.
3. **Aggregate metrics** — PDS error rates, NHSBSA rejection rates, NHS 111 referral failures, NHS Notify failed-delivery rates monitored as leading indicators.
4. **Hazard log review** — full review every 6 months, or sooner on material change.
5. **External signal review** — NHS England Clinical Safety alerts, MHRA, supplier CVEs.

The output of post-market surveillance feeds back into a successor CSCR for each release.

---

## 9. Residual Risk Statement

The residual risk profile is **acceptable for the activity scope of this release** (development, sandbox NHS API integration, NHS Digital Onboarding API assurance), as set out in §1 and §5.

The residual risk profile is **not yet acceptable for deployment to live patient care**. Acceptance for live deployment requires:

1. Closure of all four Open hazards (HAZ-004, HAZ-006, HAZ-014, HAZ-016).
2. Independent audit of DSPT v6 published.
3. Deputy CSO appointed.
4. Successful completion of NHS Digital Onboarding API assurance for the APIs in active use at first deployment (PDS at minimum).
5. Issue of a successor CSCR (`PS-CSCR-001` v2.0 or `PS-CSCR-002`) by the CSO, with the same DCB0129 process.

---

## 10. CSO Decision

I, **Champe Chilufya**, Clinical Safety Officer for Pharmstation (GPhC 2226350), having reviewed this Clinical Safety Case Report against DCB0129, confirm:

- A Clinical Risk Management System is in place (`PS-CRMP-001`).
- A hazard log has been produced and is maintained (`PS-HAZLOG-001`).
- All identified hazards have been analysed, controlled, and reduced to a residual risk no greater than **Medium**, with no Medium residuals retained at this baseline (all reduced to Low or below).
- The four Open hazards are recorded with explicit closure preconditions before live patient deployment.

**Decision:**

| Scope | CSO decision |
|---|---|
| Continued development, sandbox NHS API integration, NHS Digital Onboarding API assurance, internal demos | **Approved**. |
| Live deployment to a pharmacy treating NHS patients | **Not approved.** A successor CSCR is required after Open-hazard closure and DSPT audit. |

---

## 11. Approval & Signatures

| | |
|---|---|
| **Author / CSO** | Champe Chilufya, Clinical Safety Officer (GPhC 2226350) |
| **Signature** | Champe Chilufya |
| **Date** | 30 April 2026 |

| | |
|---|---|
| **Senior management acceptance** | Champe Chilufya, Owner, Pharmstation |
| **Signature** | Champe Chilufya |
| **Date** | 30 April 2026 |

*(Sole-trader entity — owner and CSO are the same individual; conflict-of-interest mitigation per `PS-CSO-001 §5`.)*

| | |
|---|---|
| **Independent peer reviewer (to be recorded for first PROD release)** | [To be appointed before first PROD release — see HAZ-016] |

---

## 12. Document Control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 30 April 2026 | Champe Chilufya (CSO) | Initial CSCR for Pharmstation v0.1 baseline (sandbox / API-assurance scope). 18 hazards documented, all reduced to ≤ Medium residual; 4 open items must close before first PROD release. |

**Related documents:**
- `PS-CSO-001` — CSO Appointment Letter
- `PS-CRMP-001` — Clinical Risk Management Plan
- `PS-HAZLOG-001` — Hazard Log
- `dspt-verification-checklist.md` — DSPT submission evidence
- `information-asset-register-ropa.md` — Information Asset Register / ROPA
