# Information Security Policy — Information Security Management System (ISMS)

**Document ID:** PS-ISMS-001
**Version:** 1.0
**Status:** Approved
**Date of Issue:** 8 May 2026
**Next Review:** 8 May 2027 (annual)
**Owner:** Champe Chilufya — SIRO, IG Lead, Caldicott Guardian
**Organisation:** Pharmstation (ODS: D8W5S; ICO: CSN7417303)
**Standard alignment:** ISO/IEC 27001:2022 (without formal certification), NHS Data Security and Protection Toolkit (DSPT) v6, UK GDPR, DCB0129
**Classification:** OFFICIAL

---

## 1. Purpose

This document is the master policy for Pharmstation's **Information Security Management System (ISMS)**. It:

1. Defines the scope of the ISMS.
2. States Pharmstation's information security objectives and principles.
3. Establishes governance, roles, and accountability.
4. Provides a complete index of all component policies and documents that together constitute the ISMS.
5. Defines the management review and continual-improvement cycle.

This policy applies to **all information assets**, systems, processes, and personnel (including contractors and third parties) within scope. Compliance is mandatory.

---

## 2. Scope

The ISMS covers all information processed, stored, or transmitted in connection with the **Pharmstation health IT system** and its supporting infrastructure.

### 2.1 In-scope systems and services

| Asset | Description |
|---|---|
| Pharmstation web application | React/Vite SPA hosted on Vercel — pharmacy staff-facing clinical workflow tool |
| Pharmstation desktop application | Tauri desktop wrapper |
| Pharmstation mobile application | Mobile companion |
| Supabase backend | Postgres database, Edge Functions, Auth, Storage (EU West region) |
| NHS 111 ITK adaptor | Railway-hosted SOAP→FHIR adaptor for NHS 111 referrals |
| NHS API integrations | PDS FHIR, NHSBSA MYS, NHS Notify, DoS UEC REST |
| Development and CI/CD toolchain | GitHub repository (`champec/pharmstation`), pnpm/Turborepo, Vercel/Supabase deployment pipelines |
| Organisational devices | Windows 11 laptop (primary development and administrative device) |
| Email | `champe.chilufya@wales.nhs.uk` (NHS Wales — for NHS-sensitive communications); `chronic2157@gmail.com` (developer portal); `champe@pharmstation.co.uk` (business) |
| Domain and DNS | `pharmstation.co.uk` managed via GoDaddy |

### 2.2 In-scope information

- Patient personal and health data (NHS numbers, demographics, clinical service records, prescription data, referral data)
- Pharmacy organisation data (ODS codes, configurations, staff records)
- NHS API credentials and keys
- Locum pharmacist personal data (identity documents, DBS, GPhC registration)
- Business data (financial records, contracts, supplier agreements)
- Audit and log data

### 2.3 Out of scope

- Pharmacy customers' own internal IT systems (their responsibility under DCB0160)
- NHS infrastructure (NHS responsibility)
- NHSBSA infrastructure (NHSBSA responsibility)

### 2.4 Boundaries

The ISMS boundary is Pharmstation as a **software manufacturer and data processor/controller**. Pharmstation processes data on behalf of deploying pharmacies (as data processor where the pharmacy is controller, e.g. patient records) and as a data controller in its own right (e.g. staff records, business accounts).

---

## 3. Information Security Objectives

Pharmstation's information security objectives for 2026–27 are:

| Objective | Measure | Target |
|---|---|---|
| **1. Zero patient data breaches** | Number of confirmed breaches reportable to ICO | 0 |
| **2. DSPT "Standards Met"** | DSPT v6 publication status | Published by Q2 2026 (post independent audit) |
| **3. NHS API assurance passed** | APIs cleared for production: PDS, NHS Notify, DoS REST | All 3 by Q4 2026 |
| **4. All critical controls verified** | Proportion of DSPT evidence items completed | 103/103 ✅ (achieved March 2026) |
| **5. Incident response tested** | Annual tabletop exercise completed | ✅ 4 March 2026; next March 2027 |
| **6. Supplier security reviewed** | Proportion of tier-1 suppliers reviewed annually | 100% by September 2026 |
| **7. No High/V.High residual clinical risks** | DCB0129 hazard log — highest residual risk band | ≤ Medium ✅ (achieved April 2026) |

---

## 4. Information Security Principles

All Pharmstation information processing must adhere to these principles:

1. **Confidentiality** — Information is accessible only to those authorised. Patient data is segregated by organisation (multi-tenancy RLS). NHS API credentials are never exposed client-side.
2. **Integrity** — Information is accurate and protected from unauthorised modification. Critical registers are immutable. All changes are audit-logged.
3. **Availability** — Systems and information are available to authorised users when needed, with resilience proportionate to risk. NHS API integrations fail safely and explicitly.
4. **Lawfulness** — All processing has a documented legal basis under UK GDPR. Special-category data is processed only under Art. 9(2)(h) (health care provision) or other documented condition.
5. **Accountability** — Every action on patient or sensitive data is attributed to an authenticated, identified user and is auditable.
6. **Minimum necessary** — Only data necessary for the stated purpose is collected, retained, or shared (data minimisation).
7. **Security by design** — Security controls are built into the system at design time, not added afterwards (e.g. RLS enabled at table creation, not retrospectively).

---

## 5. Governance and Roles

| Role | Holder | Responsibilities |
|---|---|---|
| **Senior Information Risk Owner (SIRO)** | Champe Chilufya | Accountable for information risk; owns ISMS; approves risk-acceptance decisions; signs off DSPT publication. |
| **Information Governance (IG) Lead** | Champe Chilufya | Day-to-day IG management; maintains policies and ROPA; responds to DSARs; manages ICO registration. |
| **Caldicott Guardian** | Champe Chilufya | Ensures patient information is used ethically and lawfully; approves any novel use of patient data. |
| **Data Protection Officer (DPO)** | Not appointed (legal basis: Pharmstation does not meet the threshold for mandatory DPO under UK GDPR Art. 37 — not large-scale systematic processing as core activity) | — |
| **Clinical Safety Officer (CSO)** | Champe Chilufya (GPhC 2226350) | Accountable for clinical safety of the health IT system under DCB0129. See `PS-CSO-001`. |
| **Deputy CSO** | Biniam Eyob Fesseha (GPhC 2221360) | Backup CSO if primary CSO unavailable. See `PS-CSO-002`. |
| **System Administrator** | Champe Chilufya | Manages Supabase, Vercel, Railway, GitHub, GoDaddy configurations. |

As a sole-trader manufacturer, many roles are held by one individual. This concentration is a declared organisational risk (see `PS-HAZLOG-001` HAZ-016, now mitigated by deputy CSO appointment).

### 5.1 Third-party responsibilities

Deploying pharmacies (pharmacy customers using Pharmstation) are responsible for their own ISMS, DSPT compliance, and DCB0160 deployment safety case. Pharmstation provides them with the CSCR and hazard-log extract to support this. Their obligations are set out in the Pharmstation Terms of Service and Data Processing Agreement.

---

## 6. Risk Management

Information security risk management is integrated with clinical risk management and follows a unified approach:

- **Risk identification** — Through functional analysis, threat modelling, DSPT self-assessment, penetration testing, and incident review.
- **Risk assessment** — Severity × Likelihood matrix (defined in `PS-CRMP-001 §3`). The same matrix is used for both information security and clinical safety risks.
- **Risk treatment** — ISO 14971 hierarchy: design out → technical controls → procedural controls → information for users.
- **Risk register** — Information security risks with clinical implications are recorded in `PS-HAZLOG-001`. Pure information security risks (no direct clinical consequence) are recorded in the **IS Risk Register** (section 7 below).
- **Residual risk acceptance** — Accepted by the SIRO in writing; recorded with ALARP justification.
- **Review** — Risk register reviewed at least annually, on any material change, and after any security incident.

---

## 7. Information Security Risk Register

Risks without direct clinical consequence (therefore not in the clinical hazard log) are recorded here.

| ID | Risk | Initial rating | Controls | Residual rating | Status |
|---|---|---|---|---|---|
| IS-001 | **GitHub repository accidentally made public** — source code, credentials or secrets exposed | High | Repo is private; secrets stored in environment variables (Supabase/Vercel secrets, not `.env` files committed); `.gitignore` covers all secret patterns; pre-commit hook alerts on `*.env`. | Low | Mitigated |
| IS-002 | **Supabase `service_role` key leaked** — full database access without RLS | V.High | Key stored only in Vercel/Supabase edge-function secrets, never in client bundles; no `.env` committed to git; RLS provides secondary defence even if key is compromised. | Medium | Mitigated (ALARP — key segregation and RLS are industry best practice; additional HSM would be disproportionate at this scale) |
| IS-003 | **Domain hijack (`pharmstation.co.uk`)** — attacker takes control of DNS, redirects traffic, issues rogue TLS certificates | High | GoDaddy account has MFA enabled; registrar lock active; domain contact email monitored. | Low | Mitigated |
| IS-004 | **Phishing attack on developer/admin account** — attacker gains GitHub, Supabase, Vercel, or GoDaddy access | High | MFA enabled on all critical accounts (GitHub, Supabase, Vercel, Railway, GoDaddy, Microsoft 365); NHS Wales email used for NHS communications; no auto-pay/admin actions via unverified links. | Low | Mitigated |
| IS-005 | **Dependency supply-chain attack** — malicious npm/pnpm package introduced | Medium | Dependabot / pnpm audit run in CI; `pnpm-lock.yaml` committed (reproducible builds); safety-relevant functions (`nhs-*`) reviewed manually before merge. | Low | Mitigated |
| IS-006 | **DSPT self-assessment inaccuracy** — evidence overstated, independent audit reveals non-conformity | Medium | 103/103 evidence items completed in good faith; independent audit commissioned; all claims are traceable to documentation in this repo. | Low | Mitigated |
| IS-007 | **Data retained beyond retention period** — patient or staff data kept longer than required | Medium | Retention schedule defined in `record-retention-requirements.md`; review trigger included in annual ISMS review; automated purge scripts to be developed before first live deployment. | Low | Open — automated purge to be implemented before first PROD release. |
| IS-008 | **No formal penetration test completed** — unknown vulnerabilities in application | High | DSPT assertion 9.1.4 requires annual pen test; scheduled for Q3 2026 before first pharmacy goes live; Supabase Auth and RLS provide baseline hardening in the interim. | Medium | Open — pen test to be completed Q3 2026. |

---

## 8. ISMS Document Index

The following documents, together with this policy, constitute the Pharmstation ISMS. All are held in the `documentation/legal-and-compliance/` directory of the Pharmstation git repository unless otherwise noted.

### 8.1 Core ISMS / governance

| Doc ID | Document | Purpose |
|---|---|---|
| **PS-ISMS-001** | `information-security-policy.md` (this document) | ISMS master policy, scope, governance, risk register, document index |
| — | `data-protection-gdpr.md` | UK GDPR compliance, legal bases, data subject rights, DPA obligations |
| — | `information-asset-register-ropa.md` | Information Asset Register + Art. 30 ROPA; technical & organisational security measures |
| — | `supplier-register.md` | Third-party supplier register; DPA status; security review record |
| — | `record-retention-requirements.md` | Data retention schedule; legal basis for each retention period |
| — | `training-needs-analysis.md` | Staff training requirements; completion records |

### 8.2 Clinical safety (DCB0129)

| Doc ID | Document | Purpose |
|---|---|---|
| **PS-CSO-001** | `clinical-safety-officer-appointment.md` | CSO appointment — Champe Chilufya GPhC 2226350 |
| **PS-CSO-002** | `deputy-clinical-safety-officer-appointment.md` | Deputy CSO appointment — Biniam Eyob Fesseha GPhC 2221360 |
| **PS-CRMP-001** | `clinical-risk-management-plan.md` | Clinical risk management lifecycle process; risk matrix |
| **PS-HAZLOG-001** | `hazard-log.md` | 18 clinical hazards; controls; residual risk; open items |
| **PS-CSCR-001** | `clinical-safety-case-report.md` | Clinical safety case; CSO release decision |

### 8.3 Legal and regulatory compliance

| Document | Purpose |
|---|---|
| `gphc-guidelines.md` | GPhC obligations; responsible pharmacist register; CD requirements |
| `cd-register-legal-requirements.md` | Controlled drug register legal framework |
| `misuse-of-drugs-regulations.md` | MDR 2001 compliance requirements |
| `responsible-pharmacist-regulations.md` | RP register legal requirements |
| `nhs-data-security-standards.md` | NDG 10 data security standards reference |

### 8.4 Operational security

| Document | Purpose |
|---|---|
| `tabletop-exercise-record-2026-03-04.md` | Incident response tabletop exercise (4 March 2026) |
| `dspt-verification-checklist.md` | DSPT v6 evidence checklist — 103/103 items |

### 8.5 NHS onboarding (cross-referenced)

| Document | Location | Purpose |
|---|---|---|
| `nhs-onboarding-master.md` | `documentation/nhs/` | Full NHS API onboarding tracker |
| `agent-messages.md` | `documentation/nhs-integration-expansion/` | Architect comms log |

---

## 9. Key Controls Summary

The following controls form the backbone of the Pharmstation ISMS. Full detail is in the referenced documents.

### 9.1 Access control
- Supabase Auth: email + password, optional MFA (MFA mandatory for admin/owner roles).
- Role-based access: 6 roles (owner, manager, pharmacist, technician, dispenser, locum).
- Postgres Row-Level Security on every table — multi-tenancy enforced at the database layer.
- `service_role` key restricted to server-side Edge Functions only.
- 30-minute idle session timeout.

### 9.2 Data in transit
- TLS enforced on all endpoints (Supabase, Vercel, Railway, NHS APIs).
- HTTPS redirect enforced on Vercel deployment.
- NHS API calls (PDS, NHSBSA MYS) over TLS 1.2+ only.

### 9.3 Data at rest
- Supabase Postgres: encryption at rest (AES-256) by default (managed by Supabase/AWS EU West).
- Supabase Storage: encrypted at rest for uploaded files (SOP PDFs, AI scan images).
- No patient data stored on local devices.

### 9.4 Audit and logging
- Append-only `ps_audit_log` — all clinical and administrative actions logged with user ID + timestamp.
- Supabase dashboard access logs retained.
- Clinical writes and audit writes are transactionally coupled — one cannot succeed without the other.

### 9.5 Vulnerability management
- Dependabot / `pnpm audit` on every CI run.
- Manual security review of all NHS-interface Edge Function changes before merge.
- Annual penetration test (first scheduled Q3 2026 — DSPT 9.1.4).
- MHRA and NHS England security alerts reviewed as received.

### 9.6 Incident management
- Incident management process documented and tested (tabletop 4 March 2026).
- ICO breach reporting within 72 hours if required.
- Field-safety notices to deploying pharmacies within 5 working days for patient-safety incidents.
- Post-incident review feeds back into risk register and hazard log.

### 9.7 Business continuity
- All source code and documentation in git (GitHub, `champec/pharmstation`).
- Deputy CSO appointed (Biniam Eyob Fesseha) for clinical safety continuity.
- Supabase daily automated backups.
- Vercel instant rollback on deployment failure.

### 9.8 Supplier management
- Tier-1 suppliers (Supabase, Vercel, Stripe, Daily.co) reviewed annually against SOC 2 / ISO 27001 certifications.
- Data Processing Agreements in place or in progress for all suppliers processing personal data.
- Full register in `supplier-register.md`.

---

## 10. Compliance with Specific Standards

| Standard | Compliance approach | Status |
|---|---|---|
| **NHS DSPT v6** | Full self-assessment (103/103 evidence items); ICO registered (CSN7417303); independent audit commissioned | ✅ Awaiting audit |
| **UK GDPR / Data Protection Act 2018** | ROPA maintained; legal bases documented; privacy notice published; ICO registered | ✅ |
| **DCB0129 (Clinical Safety — Manufacturer)** | CRMP, Hazard Log, CSCR, CSO + Deputy CSO all in place | ✅ |
| **DCB0160 (Clinical Safety — Deployment)** | Deploying pharmacies' responsibility; Pharmstation provides CSCR + hazard-log extract | ✅ |
| **GPhC standards** | CSO (and Deputy CSO) are registered pharmacists; GPhC obligations documented | ✅ |
| **ISO/IEC 27001:2022** | ISMS aligned (no formal certification sought at this stage) | ✅ Aligned |
| **NIS Regulations 2018** | Not applicable — Pharmstation is not a designated OES or DSP at current scale | N/A |

---

## 11. ISMS Review and Continual Improvement

### 11.1 Management review schedule

| Review type | Frequency | Trigger |
|---|---|---|
| **Full ISMS review** (all policies, risk register, objectives) | Annual — next due 8 May 2027 | Calendar + any major change |
| **Hazard log / IS risk register review** | 6-monthly (or on material change) | Calendar / incident / new feature |
| **DSPT self-assessment update** | Annual (DSPT year April–March) | DSPT deadline |
| **Supplier security review** | Annual | Supplier register next-review date |
| **Incident response exercise** | Annual | Calendar — next March 2027 |
| **Penetration test** | Annual | Q3 2026 first test; annually thereafter |
| **GPhC registration check (CSO + Deputy)** | Annual | Tied to GPhC renewal dates (Oct 2026 for deputy) |

### 11.2 Continual improvement

After each review, the SIRO records:
- What was reviewed
- Findings / non-conformities identified
- Corrective actions assigned (with owner and target date)
- Changes made to policies or controls

This record is appended to the review section at the bottom of this document.

### 11.3 Input to management review

- Results of DSPT self-assessment and independent audit
- Results of penetration test
- Incidents and near-misses since last review
- Changes to legal / regulatory requirements
- Changes to Pharmstation's system or NHS API integrations
- Feedback from deploying pharmacies or NHS England
- Status of open risks (IS-007, IS-008) and open hazards (HAZ-006, HAZ-014)

---

## 12. Acceptance of This Policy

All persons with access to Pharmstation systems or data are required to read and comply with this policy. Acceptance is recorded as part of induction and annually thereafter.

Currently, the sole person in scope is Champe Chilufya. When additional staff, contractors, or deploying pharmacy administrators are onboarded, acceptance will be recorded in the Training Needs Analysis (`training-needs-analysis.md`).

---

## 13. Approval

| | |
|---|---|
| **Author** | Champe Chilufya, SIRO / IG Lead |
| **Approved** | Champe Chilufya, Owner, Pharmstation |
| **Date** | 8 May 2026 |
| **Signature** | Champe Chilufya |

---

## 14. Document Control

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 8 May 2026 | Champe Chilufya | Initial issue. Establishes ISMS master policy, scope, governance, objectives, IS risk register (8 risks), control summary, compliance table, document index, and review schedule. |

---

## Appendix A — Management Review Record

| Review date | Reviewer | Scope | Findings | Actions | Completed |
|---|---|---|---|---|---|
| *(First review due 8 May 2027)* | | | | | |
