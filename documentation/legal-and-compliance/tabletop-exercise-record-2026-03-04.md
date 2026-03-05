# Business Continuity / Incident Response Tabletop Exercise Record

**Organisation:** PharmStation (ODS: D8W5S)  
**Date:** 4 March 2026  
**Facilitator:** Champe Chilufya (SIRO)  
**Participants:** Champe Chilufya (SIRO / Founder / sole director / Caldicott Guardian / IG Lead)  
**Classification:** OFFICIAL — SENSITIVE  

---

## 1. Exercise Overview

**Type:** Desktop tabletop exercise  
**Duration:** 1 hour  
**Scenario:** Simulated Supabase database credential compromise  

**Scenario narrative:** A threat actor has obtained the Supabase service_role API key through a compromised developer environment. Unauthorised queries have been made against the production PostgreSQL database containing NHS patient data, controlled drug register entries, and staff records. The compromise was detected via anomalous query patterns in Supabase logs.

**Basis for scenario:** Based on real-world incidents affecting cloud-hosted healthcare applications (NCSC threat intelligence on credential theft via supply chain compromise and phishing) and NHS Digital cyber alert advisories on API key exposure.

---

## 2. Exercise Objectives

1. Test the incident detection and initial triage process
2. Validate credential rotation procedures for critical services
3. Assess ability to determine breach scope using the ROPA/IAR
4. Test ICO breach notification decision-making process
5. Validate customer communication procedures within 24-hour commitment
6. Confirm DSPT incident reporting tool awareness and access

---

## 3. Exercise Walkthrough

### Phase 1 — Detection

- SIRO reviews Supabase dashboard logs and identifies unusual API call patterns outside normal development hours
- Supabase audit log (`ps_audit_log`) confirms SELECT queries across patient tables not attributable to any known session
- **Outcome:** Incident confirmed — unauthorised access to production database

### Phase 2 — Containment

- SIRO initiates Supabase service_role key rotation via Supabase dashboard (Settings → API → Regenerate service_role key)
- All edge functions redeployed with new key
- Supabase anon key also rotated as precaution
- GitHub Codespaces environment variables updated
- Railway environment variables updated for NHS 111 pipeline
- Vercel environment variables updated
- **Outcome:** Confirmed that all credential rotation steps are understood and dashboards are accessible

### Phase 3 — Assessment

- ROPA (v1.0, 4 March 2026) consulted to identify data categories accessible via service_role key
- service_role key bypasses RLS — all tables accessible including: patient demographics, NHS numbers, CD register entries, staff profiles, locum data (DBS, NI numbers), NHS 111 referrals, claim submissions
- **Data subjects potentially affected:** All patients, staff, and locum pharmacists across all pharmacy organisations (multi-tenant data)
- **Special category data at risk:** Health data (prescriptions, clinical consultations, medications), DBS status, biometric-adjacent (signatures)
- **Outcome:** ROPA confirmed comprehensive and usable for rapid breach scope assessment. High risk to rights and freedoms — ICO notification required.

### Phase 4 — Reporting

- ICO breach notification required within 72 hours (Article 33 UK GDPR) — high risk to rights and freedoms
- DSPT incident reporting tool to be used for NHS health and care data element
- Affected individuals notification required (Article 34) — NHS numbers and health data exposed
- **Outcome:** SIRO confirmed awareness of ICO reporting portal and DSPT incident tool. Noted: URLs not bookmarked for rapid access (Action 5 raised).

### Phase 5 — Customer Communication

- All pharmacy customers (data controllers) must be notified within 24 hours per PharmStation's commitment
- Notification must include: nature of incident, data affected, actions taken, what customers need to do (e.g., notify their own patients, report to ICO as controllers)
- **Outcome:** No pre-drafted notification templates exist (Action 1 raised). Communication would need to be composed from scratch during an incident, which adds delay and risk of omission.

### Phase 6 — Recovery

- New credentials deployed across all services
- Enhanced monitoring of Supabase logs for 30 days post-incident
- Review of all GitHub Codespaces secrets and environment variable access
- Post-incident report drafted within 5 working days
- **Outcome:** Recovery steps understood. Noted: no documented step-by-step credential rotation procedure exists (Action 2 raised).

---

## 4. Issues and Actions

### Issue 1 — No customer incident notification templates

**Description:** No pre-drafted email templates exist for notifying pharmacy customers of security incidents. During an actual incident, composing communications from scratch would introduce delay and risk of omitting critical information.

**Action:** Draft incident notification email templates for three scenarios: (a) service outage, (b) personal data breach, (c) credential compromise.

**Owner:** Champe Chilufya  
**Timescale:** By 31 March 2026  
**Status:** Open

---

### Issue 2 — No documented credential rotation procedure

**Description:** Credential rotation steps are known to the SIRO but not documented. If the SIRO were incapacitated, no one else could perform these steps. Even for the SIRO, a documented checklist prevents steps being missed under pressure.

**Action:** Document step-by-step credential rotation procedures for all critical services: Supabase (service_role, anon key, JWT secret), NHS API keys, Stripe keys, Railway environment variables, Vercel environment variables, GitHub secrets.

**Owner:** Champe Chilufya  
**Timescale:** By 31 March 2026  
**Status:** Open

---

### Issue 3 — No offline copy of emergency access information

**Description:** All credential access depends on online services (password manager, browser). If internet access or the password manager itself were compromised, emergency access would be impossible.

**Action:** Create an encrypted offline backup (e.g., encrypted USB drive or printed sealed envelope) containing: emergency access credentials for all critical dashboards, ICO breach reporting portal URL and login, DSPT incident tool URL, NHS service desk contact number, Supabase support contact.

**Owner:** Champe Chilufya  
**Timescale:** By 14 March 2026  
**Status:** Open

---

### Issue 4 — ROPA confirmed adequate for breach scope assessment

**Description:** The ROPA/IAR (v1.0, 4 March 2026) was tested during the exercise and confirmed to be comprehensive, current, and usable for rapid identification of affected data categories, data subjects, and third-party data flows.

**Action:** No further action required.

**Owner:** N/A  
**Timescale:** N/A  
**Status:** Complete

---

### Issue 5 — ICO and DSPT reporting tools not bookmarked

**Description:** During the exercise, the SIRO needed to look up the ICO breach reporting portal URL and the DSPT incident reporting tool location. In a real incident, this adds unnecessary friction.

**Action:** Bookmark ICO breach reporting portal (https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/) and DSPT incident reporting tool in browser. Add both URLs plus key phone numbers to an incident response quick-reference card.

**Owner:** Champe Chilufya  
**Timescale:** By 7 March 2026  
**Status:** Open

---

### Issue 6 — No standalone Business Continuity Plan document

**Description:** Business continuity arrangements are described across multiple documents (IAR/ROPA, onboarding master, TNA) but no single standalone BCP document exists. A consolidated BCP would be easier to follow during an actual incident.

**Action:** Write a standalone Business Continuity Plan consolidating service continuity arrangements, recovery procedures, communication plans, and contact information into one document.

**Owner:** Champe Chilufya  
**Timescale:** By 30 April 2026  
**Status:** Open

---

## 5. Action Summary

| # | Action | Owner | Due | Status |
|---|--------|-------|-----|--------|
| 1 | Draft customer incident notification templates | Champe Chilufya | 31 Mar 2026 | Open |
| 2 | Document credential rotation procedures | Champe Chilufya | 31 Mar 2026 | Open |
| 3 | Create encrypted offline emergency access backup | Champe Chilufya | 14 Mar 2026 | Open |
| 4 | ROPA adequacy confirmed | N/A | N/A | Complete |
| 5 | Bookmark ICO/DSPT reporting tools + quick-ref card | Champe Chilufya | 7 Mar 2026 | Open |
| 6 | Write standalone BCP document | Champe Chilufya | 30 Apr 2026 | Open |

---

## 6. Lessons Learned

1. **ROPA is effective** — The detailed data inventory enabled rapid breach scope assessment within minutes.
2. **Credential rotation is achievable but undocumented** — All steps could be performed, but reliance on memory under pressure is a risk.
3. **Communication is the weakest link** — No templates means composing critical customer notifications under time pressure.
4. **Single point of failure** — All incident response capability rests with one person. Documentation must be sufficient for an external responder.
5. **Cloud-native architecture is an advantage** — No physical hardware to secure, credential rotation is dashboard-based, and services can be redeployed quickly.

---

## 7. Board Endorsement

As a sole-director organisation, board oversight is exercised directly by the SIRO. This exercise record and its actions have been reviewed and endorsed at board level.

| Date | Name | Role | Action |
|------|------|------|--------|
| 4 March 2026 | Champe Chilufya | SIRO / Sole Director | Conducted exercise, documented findings, endorsed action plan |

---

## 8. Next Exercise

**Scheduled:** By March 2027 (annual)  
**Proposed scenario:** Ransomware attack on development environment / supply chain compromise via compromised npm package  

---

*Document ends.*
