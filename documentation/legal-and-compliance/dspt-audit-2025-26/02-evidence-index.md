# Evidence Index — DSPT 2024/25 Independent Assessment

**Pharmstation — ODS D8W5S — 30 April 2026**

This index maps each in-scope DSPT evidence item to the source document(s) within the Pharmstation repository. Source documents are the primary working papers; the Independent Assessor should rely on these (not the audit report itself) for substantive testing.

All paths are relative to the repository root (`c:\Users\simplescribe\Documents\monorepos\pharmstation\`).

---

## 1.1 — Lawfulness, Fairness and Transparency framework

| Item | Document |
|------|----------|
| 1.1.1 ICO registration | `documentation/nhs/nhs-onboarding-master.md` (CSN7417303 record); ICO confirmation email retained |
| 1.1.2 Records of Processing Activity (ROPA) | `documentation/legal-and-compliance/information-asset-register-ropa.md` |
| 1.1.3 Privacy notices | Pharmstation public website privacy notice; `documentation/legal-and-compliance/data-protection-gdpr.md` |
| 1.1.4 DPIAs | DPIA register (in `data-protection-gdpr.md`) — DPIAs completed for PDS, NHS Notify, DoS, OpenAI image processing |
| 1.1.5 Lawful bases | `data-protection-gdpr.md` §"Lawful bases" |
| 1.1.6 Subject rights procedures | `data-protection-gdpr.md` §"Data subject rights" |
| 1.1.7 / 1.1.8 | **Out of scope per NHSE guidance** |

## 2.2 — Staff contracts: data security responsibilities

| Item | Document |
|------|----------|
| 2.2.x | Sole-trader self-declaration (no employees). Director's confidentiality and data-security obligations recorded in `documentation/legal-and-compliance/clinical-safety-officer-appointment.md` and supplier/director acceptable-use statement. Future hires: template employment contract clause to be provided pre-onboarding. |

## 3.1 — Training and awareness

| Item | Document |
|------|----------|
| 3.1.x | `documentation/legal-and-compliance/training-needs-analysis.md` (full TNA); NHS Data Security Awareness e-learning Level 1 certificate (completed within last 12 months); Caldicott e-learning certificate; DCB0129/0160 self-study record |

## 3.2 — Just culture / proactive engagement

| Item | Document |
|------|----------|
| 3.2.x | `training-needs-analysis.md` Module 5; `tabletop-exercise-record-2026-03-04.md` (just-culture review of simulated breach) |

## 4.5 — Password suitability

| Item | Document |
|------|----------|
| 4.5.x | Password manager in use (1Password / Bitwarden — confirm vendor in report). Supabase Auth password policy ≥12 chars + complexity. MFA enforced on GitHub, Supabase, Vercel, Railway, GoDaddy, NHSmail. Evidence: MFA-enrolment screenshots in `dspt-audit-2025-26/evidence/` (to be added before walkthrough). |

## 5.1 — Annual process reviews

| Item | Document |
|------|----------|
| 5.1.x | Annual security review schedule recorded in `dspt-verification-checklist.md` (next review March 2027). 4 March 2026 internal review record. `tabletop-exercise-record-2026-03-04.md` (post-incident review process). |

## 6.2 — AV and email gateway protection

| Item | Document |
|------|----------|
| 6.2.x | Windows Defender real-time protection ON (Windows 11). Malwarebytes (Premium licence pending — finding raised). NHSmail (`@wales.nhs.uk`) — DHCW-managed spam/anti-malware gateway. pharmstation.co.uk — SPF/DMARC pending (finding raised). |

## 7.1 — Incident response

| Item | Document |
|------|----------|
| 7.1.x | `documentation/legal-and-compliance/incident-response-plan.md` (24-hour customer notification commitment, ICO 72-hour, DSPT incident tool). `tabletop-exercise-record-2026-03-04.md`. Emergency contacts hardcopy printed and stored. |

## 8.2 — Unsupported systems register

| Item | Document |
|------|----------|
| 8.2.x | Asset register (`information-asset-register-ropa.md` Appendix A — assets and lifecycle). Currently zero assets are unsupported. Node 18 (NHS 111 Bridge container) flagged as approaching EOL — upgrade to Node 20/22 by 30 Apr 2026 (closed today). Windows 11 Pro — supported. |

## 9.2 — Penetration test

| Item | Document |
|------|----------|
| 9.2.x | Internal vulnerability assessment 4 March 2026 — `dspt-audit-2025-26/evidence/internal-vuln-assessment-2026-03-04.md`. **External CHECK/CREST pen test scheduled prior to production go-live** — finding raised. |

## 9.5 — Secure configuration

| Item | Document |
|------|----------|
| 9.5.x | BitLocker enabled (`manage-bde -status C:` evidence). UAC ON. SmartScreen ON. Find My Device ON. Dependabot enabled (champec/pharmstation). GitHub branch protection on `main`. Docker images pinned. Supabase RLS audit completed 31 Mar 2026. Zod input validation across web and edge functions. |

## 9.6 — Firewall

| Item | Document |
|------|----------|
| 9.6.x | Windows Defender Firewall ON (all profiles). Home router admin password changed; no inbound port-forwards. Supabase / Vercel / Railway managed firewalls (confirmed in supplier register). Quarterly service-exposure review scheduled (next: June 2026). |

## 10.2 — Supplier due diligence

| Item | Document |
|------|----------|
| 10.2.x | `documentation/legal-and-compliance/supplier-register.md` (full register of processors and sub-processors). Supplier DPAs / certifications recorded for: Supabase (SOC 2 Type II), Stripe (PCI DSS L1 / SOC 2 / ISO 27001), Vercel (SOC 2), Daily.co (SOC 2), Railway, GoDaddy, OpenAI (DPA, zero-retention), Anthropic, Google Gemini, Mapbox. |

## Cross-cutting evidence

| Topic | Document |
|------|----------|
| SIRO / DPO / Caldicott Guardian appointment | `clinical-safety-officer-appointment.md`; sole-director declarations |
| Hazard log / clinical safety | `hazard-log.md`; `clinical-safety-case-report.md`; `clinical-risk-management-plan.md` |
| Verification checklist (open actions) | `dspt-verification-checklist.md` |
| NHS onboarding status | `documentation/nhs/nhs-onboarding-master.md` |
