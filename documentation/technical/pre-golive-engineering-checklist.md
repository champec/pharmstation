# Pre-Go-Live Engineering Checklist

**Document:** Pharmstation — things that must be built/configured before first live pharmacy deployment
**Created:** 13 May 2026
**Owner:** Champe Chilufya
**Last Updated:** 13 May 2026

This is the single source of truth for outstanding engineering work required before Pharmstation can go live with a real pharmacy treating NHS patients. Items are grouped by area. Every item has a source (why it's required) and a priority.

---

## How to use this

- **P1 — Hard blocker:** Cannot go live without this. NHS England or a patient safety requirement.
- **P2 — Required before first pharmacy:** Needed for correct operation but not a portal submission blocker.
- **P3 — Required before scale:** Can go live with 1 pharmacy without this but must be done before broader rollout.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

---

## 1. PDS FHIR — NHS Conformance Requirements

These were committed to on the NHS Digital Onboarding portal (PDS technical conformance section, 13 May 2026). They must be implemented before witness testing.

### 1.1 Sensitive patient handling

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Display warning banner when a sensitive (`restrictedPatient: true`) patient record is selected — before the pharmacist can proceed | P1 | PDS-FHIR-FLGSEN-3 |
| `[ ]` | Warning must include: (1) access may be restricted by RBAC, (2) updates will not be sent to PDS, (3) no new NHS number should be allocated | P1 | PDS-FHIR-FLGSEN-3.1-1 |
| `[ ]` | Restrict display of address, telecoms, related persons, GP practice data for sensitive patients to authorised roles only (pharmacist/manager) | P1 | PDS-FHIR-FLGSEN-1.1 |
| `[ ]` | Do NOT overwrite locally-held location data for a sensitive patient with blank PDS data during re-sync | P1 | PDS-FHIR-FLGSEN-6 |
| `[ ]` | Do NOT display sensitive flag on search results screen | P1 | PDS-FHIR-TRCDPY-4 |

**Current state:** `pds_restricted` boolean is stored in `ps_nhs_patient_pds_cache` and returned from `nhs-pds-lookup`. The UI does **not yet** act on it — no warning banner, no field suppression.

---

### 1.2 Superseded NHS number handling

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Detect when PDS returns a superseded NHS number response (HTTP 200 with a different `id` than queried) | P1 | PDS-FHIR-FLGSUP-1 |
| `[ ]` | Display warning: (1) NHS number has been replaced, (2) patient should be informed of new number | P1 | PDS-FHIR-FLGSUP-1.1 |
| `[ ]` | If new NHS number is NOT present on another local record → replace the superseded number in `ps_nhs_patient_pds_cache` | P1 | PDS-FHIR-FLGSUP-2 |
| `[ ]` | If new NHS number IS already present on another local record → keep old record for current episode, flag conflict, notify pharmacist to refer to Local Back Office | P1 | PDS-FHIR-FLGSUP-3 |

**Current state:** Not implemented. `handleLookup` does not check for NHS number supersession in the PDS response.

---

### 1.3 Invalidated NHS number handling

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Detect when PDS returns an invalidated NHS number code | P1 | PDS-FHIR-FLGINV-1 |
| `[ ]` | Display warning: (1) NHS number is no longer valid, (2) record referred to Local Back Office, (3) all demographic/clinical info should be regarded with caution | P1 | PDS-FHIR-FLGINV-1.1 |
| `[ ]` | Continue to display warnings: (1) data anomalies may constitute clinical risk, (2) anomalies may be clinical as well as demographic | P1 | PDS-FHIR-FLGINV-1.2 |
| `[ ]` | De-couple the local record from PDS synchronisation (exempt from further sync until re-coupled, reset Version ID to 0, trigger Local Back Office task) | P1 | PDS-FHIR-FLGINV-2 |

**Current state:** Not implemented. `handleLookup` throws a generic error on non-200 PDS responses but does not handle specific PDS error codes.

---

### 1.4 Key field change detection on re-sync

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | When re-syncing a patient (lookup on a cached record), compare returned PDS data against cached data for key field changes (death status, gender, NHS number supersession) | P1 | PDS-FHIR-SNCSCN-5 |
| `[ ]` | If key field changes detected → display notification to pharmacist before updating local cache | P1 | PDS-FHIR-SNCSCN-5 |
| `[ ]` | Pharmacist must be able to review and if necessary reject the change before it is applied | P1 | PDS-FHIR-SNCSCN-5.1 |

**Current state:** `handleLookup` upserts PDS data directly to cache without comparing against existing cached values.

---

### 1.5 Search results display

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Display search results in the exact order returned by PDS (no client-side resorting) | P1 | PDS-FHIR-TRCDPY-2.1 |
| `[ ]` | Do NOT display PDS matching level/score to end users | P1 | PDS-FHIR-TRCDPY-2 |

**Current state:** Search results are returned from `handleSearch` in PDS order. UI needs to be verified not to re-sort or display match scores.

---

### 1.6 PDS sync on significant events

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Force fresh PDS lookup (bypass cache) at commencement of each new service delivery episode | P1 | PDS-FHIR-PDSPCP-3 |
| `[ ]` | Force fresh PDS lookup before using patient communication information (e.g. before sending NHS Notify message) | P1 | PDS-FHIR-PDSPCP-3 |
| `[ ]` | If PDS sync fails at a significant event → allow pharmacist to continue with manually-entered/cached data and display clear warning | P1 | PDS-FHIR-PDSPCP-3.1 |

**Current state:** Cache bypass is implemented for claim submission. Episode commencement and pre-communication bypass not yet explicitly enforced.

---

### 1.7 EUO ODS code in headers

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | Include `NHSD-End-User-Organisation-ODS` header in all PDS API calls, populated with the deploying pharmacy's ODS code | P1 | PDS-FHIR-EUOODS-1 |

**Current state:** `nhs-pds-lookup` does not currently add the EUO ODS header. This is required for all multi-organisation deployments.

---

## 2. Infrastructure

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **Supabase region migration** — migrate project from `us-east-1` (USA) to `eu-west-2` (London). Required before live patient data is processed. New project, run all migrations, update all env vars in Vercel + Railway. | P1 | NHS Notify Q3, PDS IG Q3, ROPA |
| `[ ]` | **HAZ-014 closed** — configure Vercel "Failed Deployment" email alert to CSO email | P2 | DCB0129 Hazard Log HAZ-014 |
| `[ ]` | **HAZ-006 closed** — NHS 111 ACK reconciliation SOP — document and sign off with deploying pharmacy at go-live | P2 | DCB0129 Hazard Log HAZ-006 |
| `[ ]` | **Static IP for NHSBSA** — provision a static IP proxy (Railway static IP or similar) for NHSBSA MYS production IP whitelisting | P2 | NHSBSA MYS integration |
| `[ ]` | **mTLS certificates** — obtain mTLS certs for live NHS 111 connection (after DoS registration + pilot pharmacy identified) | P3 | NHS 111 adaptor |

---

## 3. Data Management

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **IS-007 — Automated data purge scripts** — implement automated purge of patient data beyond NHS retention period (8 years). Required before live patient data accumulates. | P2 | ISMS IS risk register IS-007 |
| `[ ]` | **ROPA update** — update `information-asset-register-ropa.md` to reflect PDS data retention policy (8 years) and Supabase region once migrated | P2 | UK GDPR Art. 30 |
| `[ ]` | **Deputy CSO countersignature** — obtain signed copy of `deputy-clinical-safety-officer-appointment.md` from Biniam Fesseha (GPhC 2221360). Store signed PDF. | P1 | DCB0129 PS-CSO-002 |

---

## 4. Security

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **IS-008 — Penetration test** — 🔴 SLIPPED (twice). Original 08/07/2026 date passed with no tester engaged. NHS DoS Data Security approver flagged this 22 Jul 2026. Revised plan: engagement signed by 29/07/2026, test executed by 18/08/2026, Management Summary uploaded by 25/08/2026. Informal "friend/colleague" plan is NOT viable — NHS explicitly requires CHECK/CREST accreditation. | P1 | ISMS IS-008, portal Data Security section, DoS Q5, PDS Q5 |
| `[ ]` | **Vercel security headers** — verify CSP, X-Frame-Options, X-Content-Type-Options configured on Vercel deployment | P2 | DSPT 9.3.1 |
| `[ ]` | **HTTPS redirect** — verify HTTP → HTTPS redirect enforced on Vercel | P2 | DSPT 9.3.6 |
| `[ ]` | **DMARC record** — add `_dmarc.pharmstation.co.uk` TXT record in GoDaddy DNS | P2 | DSPT 6 |
| `[ ]` | **SPF record** — verify `pharmstation.co.uk` SPF record in GoDaddy DNS | P2 | DSPT 6 |
| `[ ]` | **MFA on all critical accounts** — verify MFA enabled on GitHub, Supabase, Vercel, Railway, GoDaddy | P2 | DSPT 9.5.8 |

---

## 5. NHS 111 / DoS

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **DoS REST witness testing** — await NHS England to propose a date after DoS technical conformance approved. Prepare live demo of `nhs-dos-lookup` byODSCode and byServiceId against INT environment. | P1 | Portal — Witness Testing section |
| `[ ]` | **NHSBSA MYS staging credentials** — no reply since 26 Feb. Phone chase 0300 330 1368. Needed before NHSBSA claim integration can be tested. | P2 | NHSBSA MYS |
| `[ ]` | **BaRS Connection Agreement** — no reply since 5 Mar. Chase `bookingandreferralstandard@nhs.net`. Needed for NHS 111 Referral Receiver live. | P3 | BaRS |

---

## 6. Business / Operational

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **Identify pilot pharmacy** — first pharmacy customer willing to go live. Needs their own ODS code, DoS registration via local ICS, and DCB0160 deployment safety case. | P1 | Go-live dependency |
| `[ ]` | **Deputy CSO briefing** — brief Biniam Fesseha on CRMP, hazard log, and CSCR before first PROD release. Document in CRMP review record. | P1 | DCB0129 PS-CSO-002 §4.1 |
| `[ ]` | **Business continuity contact list published** — publish substantive + deputy CSO contact details to deploying pharmacies before go-live | P2 | DCB0129 HAZ-016 |
| `[ ]` | **Terms of Service / DPA for pharmacy customers** — draft and have pharmacy customers sign before processing their patient data | P1 | UK GDPR processor obligations |
| `[ ]` | **CSCR v1.1** — reissue Clinical Safety Case Report after all P1 items above are closed and open hazards resolved. Required before first PROD release. | P1 | DCB0129 PS-CSCR-001 |

---

## 7. NHS Notify integration testing

| # | Item | Priority | Source |
|---|---|---|---|
| `[ ]` | **Complete NHS Notify integration testing** in INT environment — required for Q4 on NHS Notify technical conformance portal section (currently answered No — testing not yet done) | P1 | NHS Notify portal Q4 |
| `[ ]` | **NHS Notify message templates** — create and get NHS Notify team approval for message templates (appointment reminders, consultation outcomes, referral notifications) | P1 | NHS Notify onboarding |
| `[ ]` | **Equality Impact Assessment (EIA)** — required before NHS Notify go-live (committed to in portal terms acceptance) | P2 | NHS Notify portal Q14 |
| `[ ]` | **DPIA update** — update Data Protection Impact Assessment to cover NHS Notify use (committed to in portal terms acceptance) | P2 | NHS Notify portal Q14 |

---

## Summary counts

| Priority | Total | Done | Remaining |
|---|---|---|---|
| P1 — Hard blocker | 25 | 0 | 25 |
| P2 — Required before first pharmacy | 12 | 0 | 12 |
| P3 — Required before scale | 3 | 0 | 3 |
| **Total** | **40** | **0** | **40** |

---

## Review record

| Date | Reviewer | Changes |
|---|---|---|
| 13 May 2026 | Champe Chilufya | Initial creation. Pulled from PDS conformance portal answers (13 May), DCB0129 hazard log, ISMS risk register, and known infrastructure gaps. |
