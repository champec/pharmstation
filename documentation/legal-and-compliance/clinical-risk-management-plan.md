# Clinical Risk Management Plan (CRMP)

**Document ID:** PS-CRMP-001
**Version:** 1.0
**Status:** Approved
**Date of Issue:** 30 April 2026
**Next Review:** 30 October 2026 (6-monthly until first live deployment, then annually)
**Standard:** NHS Digital DCB0129 — *Clinical Risk Management: its Application in the Manufacture of Health IT Systems*
**Classification:** OFFICIAL

---

## 1. Purpose & Scope

### 1.1 Purpose

This Clinical Risk Management Plan (CRMP) defines how **Pharmstation** identifies, analyses, evaluates, controls and monitors clinical risk arising from its health IT system, in accordance with **DCB0129**.

It is the master clinical safety process document for Pharmstation. Every release of Pharmstation is governed by this plan, and a Clinical Safety Case Report (CSCR) is produced under this plan for each release.

### 1.2 In-scope health IT system

The Pharmstation system, comprising:

| Component | Description | NHS interface |
|---|---|---|
| Pharmstation Web app | React/Vite SPA used by pharmacy staff to deliver clinical services (CPCS, NMS, SCS, CVD, Contraception, Flu/COVID vaccinations, Pharmacy First) | — |
| Pharmstation Desktop app | Tauri desktop wrapper of the web app | — |
| Pharmstation Mobile app | Mobile companion (read-only / patient-facing) | — |
| Supabase backend | Postgres database, Edge Functions, Auth | — |
| `nhs-pds-lookup` Edge Function | Patient demographics lookup / verify / search | **NHS PDS FHIR API** |
| `nhs-claim-*` Edge Functions (CPCS, NMS, SCS, CVD, Contraception) | Claim submission to NHSBSA | **NHSBSA MYS APIs** |
| NHS 111 ITK adaptor (Railway-hosted) | Receives ITK SOAP referrals from NHS 111 / Pathways | **NHS 111 ITK** |
| NHS Notify integration (planned) | Patient messaging | **NHS Notify** |
| DoS UEC REST consumer | Pharmacy/service lookup for routing context | **NHS DoS UEC REST API** |

### 1.3 Out of scope

- Pharmacy Patient Medication Record (PMR) systems — Pharmstation does not currently dispense or replace a PMR.
- Electronic Prescription Service (EPS) prescription processing — not currently integrated.
- Clinical decision-support algorithms that auto-recommend treatment — Pharmstation provides structured forms; clinical judgement remains with the registered pharmacist.

### 1.4 Intended use

Pharmstation is a **workflow and record-keeping tool** for community pharmacies delivering NHS-commissioned advanced and locally-commissioned services. It is **not** a medical device under UK MDR 2002, because it does not perform diagnosis, treatment selection, or dosing calculations. It supports a registered pharmacist who remains the clinical decision-maker.

### 1.5 Intended users

- Registered pharmacists (GPhC)
- Registered pharmacy technicians (GPhC)
- Pharmacy support staff acting under pharmacist supervision
- Pharmacy administrators (configuration, claims reconciliation)

---

## 2. Clinical Risk Management System

### 2.1 Roles

| Role | Holder | Responsibilities |
|---|---|---|
| **Manufacturer** | Pharmstation (Champe Chilufya, sole trader) | Owns the system; ultimately accountable for clinical safety. |
| **Clinical Safety Officer (CSO)** | Champe Chilufya, GPhC 2226350 | Accountable for execution of this CRMP. Authority to block release. See `PS-CSO-001`. |
| **Independent peer reviewer** | Registered clinician (named per release in CSCR) | Reviews CSCR before release approval. |
| **Development team** | Pharmstation engineering | Implements controls, runs test plans, reports hazards to CSO. |
| **Deploying organisation** | Each pharmacy customer | Discharges DCB0160 (deployment side). Pharmstation provides CSCR and hazard-log extract to support this. |

### 2.2 Governance

- The CSO chairs a **Clinical Safety Review (CSR)** before each release. As a sole-trader manufacturer, this is currently a documented self-review with peer-reviewer sign-off captured in the CSCR.
- Hazards may be raised by **any** team member, customer, end user, or NHS England, by emailing `safety@pharmstation.co.uk` (mailbox monitored by the CSO).
- Decisions are recorded in the Hazard Log (`PS-HAZLOG-001`) with rationale and date.

### 2.3 Competence & training

- The CSO maintains DCB0129 / clinical risk management competence through CPD recorded against GPhC revalidation.
- Engineering team members read this CRMP and the hazard log as part of induction; this is recorded.

### 2.4 Lifecycle integration

This CRMP applies to the full lifecycle:

| Phase | Clinical safety activity |
|---|---|
| Specification | Hazard identification workshop; risk-acceptability criteria reviewed. |
| Design | Hazard log updated; controls designed in. |
| Build | Controls implemented; unit/integration tests cover safety-relevant logic. |
| Verification | Test evidence linked to hazard-log entries; CSO reviews. |
| Release | CSCR signed; release approved or rejected by CSO. |
| Post-market | Incidents, complaints, support tickets reviewed monthly; hazard log updated; field-safety notices issued if required. |
| Modification | Any change to safety-relevant code triggers hazard-log review; if residual risk changes, a new CSCR is issued. |
| Decommissioning | Migration plan; data export; final CSCR addendum. |

---

## 3. Risk-Acceptability Matrix

### 3.1 Severity (clinical consequence to a patient)

| Level | Label | Description |
|---|---|---|
| 1 | Minor | Inconvenience or short-term discomfort; no clinical harm. |
| 2 | Significant | Minor injury or treatment delay not requiring intervention. |
| 3 | Considerable | Clinical injury requiring intervention; reversible harm. |
| 4 | Major | Severe injury, long-term harm, or major treatment delay. |
| 5 | Catastrophic | Death or permanent disability. |

### 3.2 Likelihood (probability of the harm occurring)

| Level | Label | Definition |
|---|---|---|
| 1 | Very low | Negligible — once in 5 years per pharmacy. |
| 2 | Low | Unlikely — once per year per pharmacy. |
| 3 | Medium | Possible — once per month per pharmacy. |
| 4 | High | Likely — once per week per pharmacy. |
| 5 | Very high | Certain — daily occurrence. |

### 3.3 Risk matrix (Severity × Likelihood)

|  | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| **S5** | Med | High | High | V.High | V.High |
| **S4** | Low | Med | High | High | V.High |
| **S3** | Low | Low | Med | High | High |
| **S2** | V.Low | Low | Low | Med | High |
| **S1** | V.Low | V.Low | Low | Low | Med |

### 3.4 Acceptability

| Risk band | Action |
|---|---|
| **V.Low / Low** | Acceptable without further mitigation. Document and monitor. |
| **Medium** | Acceptable only if ALARP (As Low As Reasonably Practicable) is demonstrated. CSO must justify in CSCR. |
| **High** | Not acceptable for release. Mitigation required to reduce to Medium or below. |
| **V.High** | Not acceptable under any circumstances. Feature must be redesigned, removed, or release blocked. |

A residual risk of **High** or **V.High** at release is grounds for the CSO to block the release.

---

## 4. Hazard Identification Methods

The CSO uses the following methods, in combination, to identify hazards across the lifecycle:

1. **Functional hazard analysis** — for each NHS interface (PDS, NHSBSA MYS, NHS 111 ITK, NHS Notify, DoS), enumerate failure modes (wrong data, no data, stale data, slow data, repeated data, intercepted data) and trace to clinical consequence.
2. **User-task walkthrough** — registered pharmacists walk through each clinical service form (CPCS, NMS, etc.) and call out where a user could be misled.
3. **Use-error analysis** (per IEC 62366 principles) — identify foreseeable mis-use.
4. **Incident & complaint review** — once live, review every support ticket and incident for safety-relevant signals (post-market surveillance).
5. **External signals** — NHS England Clinical Safety alerts, MHRA alerts, supplier security advisories, dependency CVEs in safety-relevant code paths.
6. **Penetration test & DSPT findings** — security findings reviewed for clinical-safety implications (e.g. an authentication bypass that could lead to wrong-patient access).

---

## 5. Risk Control

### 5.1 Hierarchy of controls

The CSO applies controls in this priority order (per ISO 14971):

1. **Inherently safe by design** — eliminate the hazard (e.g. server-side enforcement of NHS-number format and Mod-11 check).
2. **Protective measures in the system** — alerts, confirmations, second-checks (e.g. mandatory display of patient name + DOB before claim submission).
3. **Information for safety** — labels, training, user manuals, on-screen warnings.

### 5.2 Verification of controls

Every control referenced in the hazard log must be:

- Implemented in code or process,
- Verified by test (automated test, manual test, or written procedure), and
- Linked from the hazard log entry to the test evidence.

The CSCR confirms verification status for each release.

---

## 6. Clinical Safety Case Report (CSCR)

For each release (and each material modification), the CSO produces a CSCR (`PS-CSCR-001` for the current release) that:

- States the version of Pharmstation released,
- Summarises hazards identified, controls applied, and residual risk,
- Justifies acceptability of any Medium residual risks (ALARP argument),
- Records the CSO's release decision (Approve / Approve with conditions / Reject),
- Carries the CSO signature and date.

The CSCR is provided to deploying pharmacies and to NHS England as part of API assurance.

---

## 7. Post-Market Surveillance

Once Pharmstation is in live use:

- All support tickets are tagged for safety relevance and reviewed by the CSO at least monthly.
- Any incident with potential or actual patient harm triggers an immediate hazard-log review and, where necessary, a field-safety notice to deploying pharmacies within 5 working days.
- The hazard log is reviewed in full at least every 6 months, or sooner on material change.
- Aggregate metrics (PDS lookup error rates, NHSBSA claim rejection rates, NHS 111 referral failures) are monitored as leading indicators.

---

## 8. Documents and Records

| ID | Title | Owner |
|---|---|---|
| `PS-CSO-001` | Clinical Safety Officer Appointment Letter | CSO |
| `PS-CRMP-001` | Clinical Risk Management Plan (this document) | CSO |
| `PS-HAZLOG-001` | Hazard Log | CSO |
| `PS-CSCR-001` | Clinical Safety Case Report (per release) | CSO |
| `dspt-verification-checklist.md` | DSPT submission evidence | SIRO |
| `information-asset-register-ropa.md` | Information Asset Register / ROPA | SIRO/DPO |
| `tabletop-exercise-record-2026-03-04.md` | Incident response exercise | SIRO |

All documents are version-controlled in Pharmstation's git repository. Signed PDF exports are retained for 8 years (NHS retention) after the last active deployment.

---

## 9. Approval

| | |
|---|---|
| **Author** | Champe Chilufya, Clinical Safety Officer (GPhC 2226350) |
| **Reviewer** | Pharmstation senior management (Champe Chilufya, owner) — see CSO appointment letter §5 for conflict mitigation. |
| **Approved** | 30 April 2026 |
| **Signature** | Champe Chilufya |

---

## 10. Document Control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 30 April 2026 | Champe Chilufya (CSO) | Initial issue. Defines clinical risk management process for Pharmstation under DCB0129. |
