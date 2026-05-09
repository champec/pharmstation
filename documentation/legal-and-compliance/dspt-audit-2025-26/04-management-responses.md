# Management Responses to Independent Assessment Findings

**Pharmstation — DSPT 2024/25 — 30 April 2026**

This document records management responses to the findings raised in `03-independent-assessment-report.md`. Action owners and dates may be adjusted by the Independent Assessor.

---

## Finding 1 (Medium) — 6.2 — Malwarebytes Premium licence not active

**Management response:** Accepted.
**Action:** Either (a) purchase Malwarebytes Premium and activate real-time + web protection, or (b) document a SIRO-approved risk acceptance that Windows Defender + SmartScreen + NHSmail gateway constitute sufficient AV cover for a sole-operator endpoint with no local NHS production data. The decision will be made by 15 May 2026 and implemented by 31 May 2026.
**Owner:** Champe Chilufya (SIRO).
**Target date:** 31 May 2026.

## Finding 2 (Medium) — 6.2 — `pharmstation.co.uk` SPF/DMARC/DKIM missing

**Management response:** Accepted.
**Action:** Publish in GoDaddy DNS:
- `v=spf1 -all` (no mail sent from this domain at present)
- `_dmarc.pharmstation.co.uk` TXT `v=DMARC1; p=reject; rua=mailto:champe.chilufya@wales.nhs.uk`
- Null DKIM (no selector required while no mail is sent).
Re-test via mxtoolbox.com after publication.
**Owner:** Champe Chilufya.
**Target date:** 31 May 2026.

## Finding 3 (Medium) — 7.1 — Business Continuity Plan not finalised

**Management response:** Accepted.
**Action:** Finalise the BCP today (30 April 2026), commit to `documentation/legal-and-compliance/business-continuity-plan.md`, and circulate to the Independent Assessor.
**Owner:** Champe Chilufya.
**Target date:** 30 April 2026 (today).

## Finding 4 (Medium) — 8.2 — Node 18 on NHS 111 Bridge container

**Management response:** Accepted and closed.
**Action:** Dockerfile `infrastructure/nhs111/Dockerfile` updated from `node:18-alpine` to `node:22-alpine`. CI rebuilt; Railway deployment updated. Independent Assessor invited to inspect the Dockerfile in the repository.
**Owner:** Champe Chilufya.
**Target date:** 30 April 2026 (today — completed).

## Finding 5 (High) — 9.2 — No external CHECK/CREST penetration test

**Management response:** Accepted.
**Action:** Commission a CHECK or CREST-accredited third-party penetration test covering web application, API and cloud configuration, scoped against the OWASP ASVS / API Security Top 10. The test must complete before any production NHS data is processed. Procurement quotes will be obtained from at least two providers; engagement signed by 30 June 2026; test executed before NHS API technical-conformance sign-off.
**Owner:** Champe Chilufya (SIRO) with budget approval as sole director.
**Target date:** Before production go-live (estimated Q3 2026).

## Finding 6 (informational) — Sole-operator key-person dependency

**Management response:** Acknowledged. This is a structural feature of the organisation at this stage and will be reduced as Pharmstation hires. In the interim:
- All credentials in password manager with emergency-access nominee.
- Encrypted offline credential backup stored at home office (tabletop Action 3 — closed 14 March 2026).
- Recovery procedures documented for all critical platforms.
- Annual SIRO review of key-person risk added to the governance calendar (Observation 4).

## Observation 1 (Low) — 1.1 — DPIA periodic-review marker

**Management response:** Accepted. Annual DPIA review reminder set in calendar; due-by-anniversary marker added to each DPIA in the register.
**Target date:** 30 June 2026.

## Observation 2 (Low) — 2.2 — Future-hire data-security clause

**Management response:** Accepted. Standard data-security clause to be drafted and placed in `documentation/legal-and-compliance/employment-contract-template.md` before any first hire.
**Target date:** Before first hire (no current hiring plan).

## Observation 3 (Low) — 3.2 — External peer-group engagement

**Management response:** Accepted. Will join the Community Pharmacy IT Suppliers Forum (or equivalent) and review NCSC CISP eligibility.
**Target date:** 31 March 2027.

## Observation 4 (Low) — 5.1 — Governance calendar not formalised

**Management response:** Accepted. A `documentation/legal-and-compliance/governance-calendar.md` will be created listing all annual / quarterly / monthly recurring data-security and IG activities with owners.
**Target date:** 30 June 2026.

## Observation 5 (Low) — 7.1 — Incident notification templates not committed

**Management response:** Accepted. Templates to be committed under `documentation/legal-and-compliance/incident-notification-templates/`.
**Target date:** 31 May 2026.

## Observation 6 (Low) — 10.2 — Supplier-onboarding checklist

**Management response:** Accepted. A one-page supplier security evaluation checklist will be created at `documentation/legal-and-compliance/supplier-onboarding-checklist.md` and applied before any new processor is adopted.
**Target date:** Before next new supplier.

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| SIRO / DPO / Caldicott Guardian | Champe Chilufya | _Champe Chilufya_ | 30 / 04 / 2026 |
| Independent Assessor (acknowledged) | Kaputo Mwamba | _Kaputo Mwamba_ | 30 / 04 / 2026 |
