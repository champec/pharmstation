# DSPT 2024/25 Independent Assessment — Terms of Reference

**Engagement:** DSPT v6 (2024/25) Independent Assessment — IT Supplier scope
**Client:** Pharmstation (ODS: **D8W5S**), sole trader, registered Wales, UK
**Independent Assessor:** Kaputo Mwamba — independent IT and information-security assessor. BA (Hons) Economics; AI / AI-safety and alignment researcher (programme includes a cyber-security module covering threat modelling, secure system design and adversarial robustness); several years' experience across web development, cyber security and IT (including at Amazon); independent advisory work with small businesses. No formal cyber-security certification.
**Reporting period:** 1 April 2025 – 31 March 2026 (Pharmstation's first DSPT submission)
**Issue date:** 30 April 2026
**Mandatory submission deadline:** 30 June 2026

---

## 1. Background

Pharmstation is a small UK software supplier developing a community-pharmacy clinical-services platform that will integrate with NHS England APIs (PDS FHIR, DoS UEC REST, NHS Notify). Pharmstation has been registered on the NHS Data Security and Protection Toolkit (DSPT) since 3 March 2026 as an **IT Supplier** under ODS code **D8W5S**.

The NHS Standard Contract and DSPT requirements mandate that IT Suppliers complete an annual DSPT independent assessment in line with the published 2024/25 guidance ("DSPT Independent Assurance and Audit 2024-25", NHSE, 12 May 2024).

## 2. Scope statement

This is an **IT Supplier** assessment, **not** a CAF-aligned assessment. The CAF-aligned methodology applies only to NHS Trusts, ICBs, CSUs and DHSC ALBs in 2024/25.

The Independent Assessor will assess Pharmstation's mandatory DSPT evidence items against the scope mandated by NHSE, namely the **13 evidence items in §4** below. Evidence items that would be exempt under a current Cyber Essentials Plus or ISO 27001 certification are **not** out of scope here, as Pharmstation holds neither certification.

Out of scope (per NHSE guidance):
- Evidence items 1.1.7 and 1.1.8 (auditors not required to include these).
- Any non-mandatory evidence item.

## 3. Output required (mandatory framework)

Per NHSE guidance, the output **must** include:

1. A **risk rating against each of the 10 NDG (National Data Guardian) Data Security Standards**, derived from the count of Critical / High / Medium / Low weighted assertion-level risks.
2. An **overall risk rating** across all 10 NDG Standards.
3. An **overall confidence rating** based on the Independent Assessor's confidence in the veracity of Pharmstation's self-assessment.

The presentation will follow the "DSPT Audit Table" template referenced in the NHSE guidance (see report §1.4).

## 4. Mandatory evidence items in scope

| # | Evidence item | NDG Standard |
|---|---|---|
| 1 | **1.1** The organisation has a framework in place to support Lawfulness, Fairness and Transparency *(1.1.7 and 1.1.8 excluded)* | 1 — Personal Confidential Data |
| 2 | **2.2** Staff contracts set out responsibilities for data security | 2 — Staff Responsibilities |
| 3 | **3.1** Staff have appropriate understanding of IG and cyber security | 3 — Training |
| 4 | **3.2** Organisation engages proactively to improve data security; just culture for incidents | 3 — Training |
| 5 | **4.5** Passwords are suitable for the information being protected | 4 — Managing Data Access |
| 6 | **5.1** Process reviews are held at least once per year | 5 — Process Reviews |
| 7 | **6.2** All user devices subject to AV; email benefits from spam filtering at the corporate gateway | 6 — Responding to Incidents |
| 8 | **7.1** Defined, planned, communicated response to data security incidents | 7 — Continuity Planning |
| 9 | **8.2** Unsupported software/hardware categorised, documented, risk-managed | 8 — Unsupported Systems |
| 10 | **9.2** Penetration test scoped and undertaken | 9 — IT Protection |
| 11 | **9.5** Network and information systems supporting essential services are securely configured | 9 — IT Protection |
| 12 | **9.6** Organisation is protected by a well-managed firewall | 9 — IT Protection |
| 13 | **10.2** Basic due diligence undertaken against each supplier handling personal information | 10 — Accountable Suppliers |

## 5. Approach

| Phase | Activity | Timing |
|---|---|---|
| Planning | Review of Pharmstation evidence pack (this folder + linked source documents) | Prior to fieldwork |
| Fieldwork | Targeted document review, walkthroughs (sole operator), spot-checks of stated controls (e.g. BitLocker status, MFA enrolment, GitHub Dependabot) | Up to 5 working days |
| Reporting | Draft report → management response → final report | Prior to 31 May 2026 |
| Submission | Add Independent Assessor as 'Auditor' user on DSPT portal; upload signed report; SIRO submits | Before 30 Jun 2026 |

## 6. Limitations

- Pharmstation is a **sole trader with no employees**. Sample testing populations for staff-facing evidence items (e.g. 2.2, 3.1) are size 1.
- Pharmstation has **no live NHS production traffic** as of the engagement date. API onboarding eligibility was approved by NHS England on 27 April 2026; technical conformance testing is to follow.
- The audit relies on management's representations supplemented by direct inspection of documentation and platform configuration screenshots.

## 7. Independence

The Independent Assessor confirms:
- No financial, employment, or family relationship with Pharmstation that would impair independence.
- Has not been involved in the design or implementation of any control assessed.
- Will exercise professional scepticism throughout.

## 8. Deliverables

1. Signed Independent Assessment Report (this folder, file `03`).
2. Management responses (this folder, file `04`) — countersigned.
3. Upload of signed PDF to the DSPT portal under 'Provide Audit details'.

## 9. Fees

Per separate engagement letter / verbal agreement. Pharmstation to settle on receipt of invoice.

## 10. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Independent Assessor | Kaputo Mwamba | _Kaputo Mwamba_ | 30 / 04 / 2026 |
| SIRO (Pharmstation) | Champe Chilufya | _Champe Chilufya_ | 30 / 04 / 2026 |
