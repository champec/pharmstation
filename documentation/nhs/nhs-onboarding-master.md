# PharmStation — NHS Onboarding Master Plan

> **Status:** 🔄 In Progress
> **Owner:** Champe Chilufya (GPhC: 2226350)
> **Created:** 28 February 2026
> **Last Updated:** 28 February 2026
> **Classification:** Internal — Onboarding Tracker

---

> ### ⚠️ CRITICAL CONTEXT — Software Supplier, Not a Pharmacy
>
> **PharmStation is a software product (PMR/clinical services platform), not a pharmacy.**
> Champe Chilufya is the developer and a registered pharmacist, but is onboarding as an **IT supplier / system vendor** — not as a pharmacy organisation.
>
> **Key implications:**
> - **PharmStation does NOT have its own ODS code.** ODS codes belong to pharmacies (our future customers). `FFQ69` is a sample/test ODS code used during development only.
> - **DSPT** is completed as a software supplier organisation, not as a pharmacy.
> - **NHSBSA MYS** onboarding is as an IT supplier (email already sent ✅ — correctly framed).
> - **DoS registration** is done by each pharmacy customer with their local ICS — not by PharmStation.
> - **PDS / NHS API access** is for PharmStation as an application, acting on behalf of pharmacy customers.
> - **NHS 111 referrals** are received by PharmStation on behalf of pharmacies registered in DoS.
> - **NHS Notify** is NOT a PharmStation onboarding item — it's an organisation-level service where each pharmacy customer onboards themselves.
>
> The onboarding route for most NHS APIs is: **PharmStation registers as a software supplier → passes assurance → pharmacy customers use PharmStation to interact with NHS services using their own ODS codes.**

---

## Table of Contents

1. [Where We Are Now](#1-where-we-are-now)
2. [What We Need — Complete API Map](#2-what-we-need--complete-api-map)
3. [Dependency Graph](#3-dependency-graph)
4. [Prerequisites (Must Do First)](#4-prerequisites-must-do-first)
5. [Track A — NHS Digital Onboarding (APIs)](#5-track-a--nhs-digital-onboarding-apis)
6. [Track B — NHSBSA MYS Supplier Onboarding (Claims)](#6-track-b--nhsbsa-mys-supplier-onboarding-claims)
7. [Track C — NHS 111 Adaptor Onboarding](#7-track-c--nhs-111-adaptor-onboarding)
8. [Track D — NHS Notify Onboarding](#8-track-d--nhs-notify-onboarding)
9. [Track E — Infrastructure for Production](#9-track-e--infrastructure-for-production)
10. [Communications Log](#10-communications-log)
11. [Key Contacts](#11-key-contacts)
12. [Glossary](#12-glossary)

---

## 1. Where We Are Now

### ✅ Already Done

| Item | Status | Date | Details |
|------|--------|------|---------|
| Developer account created | ✅ | 26 Feb 2026 | `chronic2157@gmail.com` on developer.nhs.uk |
| App registered | ✅ | 26 Feb 2026 | "PharmStation", ID: `04cc89f0-3d9b-44d2-ba18-dd6ae18f9f7a`, Environment: Development |
| API key created | ✅ | 26 Feb 2026 | Active key exists |
| NHSBSA MYS supplier email sent | ✅ | 26 Feb 2026 | Sent to `mys-platform@nhsbsa.nhs.uk` from `champe.chilufya@wales.nhs.uk` |
| NHS 111 pipeline built | ✅ | 28 Feb 2026 | Full end-to-end working on Railway (adaptor + RabbitMQ + bridge + Supabase) |
| MYS claim edge functions built | ✅ | 26 Feb 2026 | 7 functions scaffolded (CPCS, NMS, SCS, CVD, Contraception, PDS, GP Search) — stubbed, not live |
| NHS 111 test suite | ✅ | 28 Feb 2026 | `apps/nhs111-sandbox` — can send test ITK messages |
| NSD Portal account created | ✅ | 28 Feb 2026 | Registered via NHSmail SSO at `https://nhsdigitallive.service-now.com/` — `champe.chilufya@wales.nhs.uk` |
| ODS code assigned | ✅ | 3 Mar 2026 | **D8W5S — PHARMSTATION**. Case CS1341956. Published on DSE/API from 4 March 2026. Champe Chilufya registered as OC1. |
| DSPT registration | ✅ | 3 Mar 2026 | NSD team registered PharmStation (D8W5S) on dsptoolkit.nhs.uk. Self-assessment not yet started. |

### 🔲 Not Done Yet

| Item | What's Needed |
|------|--------------|
| Digital Onboarding started | Haven't selected APIs or started the formal assurance process |
| PDS API access | Not applied — needed for patient lookup in service forms |
| DoS registration | N/A for PharmStation directly — each pharmacy customer registers in DoS via their local ICS. PharmStation needs to be listed as their system supplier in DoS. |
| NHSBSA staging credentials | Awaiting reply to 26 Feb email |
| NHS Notify | ℹ️ Not our responsibility — NHS Notify is an **organisation-level service**. Each pharmacy customer onboards themselves, creates their own templates, and manages their own API access. PharmStation could optionally integrate with their NHS Notify account via API/MESH. |
| DSPT completion | Data Security and Protection Toolkit — mandatory for all NHS API access. Must complete as a **software supplier organisation**, not as a pharmacy. |
| ODS code clarification | ⚠️ **PharmStation does NOT have an ODS code.** `FFQ69` is a sample/test code used in development. ODS codes belong to pharmacy customers. PharmStation onboards as a software supplier. |
| Connection Agreement | Not signed — required for several APIs (signed by PharmStation as software supplier) |
| mTLS certificates | Not obtained — required for live NHS 111 |
| Static IP proxy | Not provisioned — required for NHSBSA production |

---

## 2. What We Need — Complete API Map

Every NHS API PharmStation needs, why, and the access mode:

> **Note:** PharmStation onboards to these APIs as a **software supplier**. ODS codes referenced in API calls will be those of our **pharmacy customers**, not PharmStation itself. `FFQ69` is a test/sample ODS code used during development.

| # | API | Why We Need It | Access Mode | Onboarding Route | Priority |
|---|-----|----------------|-------------|------------------|----------|
| 1 | **Personal Demographics Service (PDS) — FHIR API** | Look up patient NHS number, name, DOB, address, GP practice for service delivery forms | **Application-restricted** (signed JWT) | NHS Digital Onboarding | 🔴 High |
| 2 | **Directory of Healthcare Services API v3** | Search for healthcare services, find GP practices by ODS code | **Application-restricted** (API key) | Email `ssd.nationalservicedesk@nhs.net` titled "Service Search v3 API onboarding" | 🟡 Medium |
| 3 | **Directory of Services (DoS) — UEC REST API** | Pharmacy customers register in DoS so NHS 111 can route referrals to them via PharmStation | **Onboarding required** | NHS Digital Onboarding (PharmStation as supplier) + each pharmacy registers via their local ICS DoS Lead | 🔴 High (for NHS 111 live) |
| 4 | **NHS 111 Adaptor** | Receive ITK SOAP referrals, convert to FHIR | **Self-hosted** (already deployed) | NHS Digital — need Connection Agreement + mTLS certs | 🔴 High |
| 5 | **NHSBSA MYS APIs** (CPCS, Flu, NMS, SCS, CVD, Contraception) | Submit NHS service claims for reimbursement | **IP whitelisted** | NHSBSA supplier onboarding (separate from NHS Digital) | 🔴 High |
| 6 | **NHS Notify** | Send NHS App messages, SMS, email, letters to patients | **Organisation-level service** — each pharmacy customer onboards themselves. PharmStation may integrate via NHS Notify API/MESH on their behalf. | Pharmacy customers onboard directly — no PharmStation supplier onboarding needed | � Low (customer responsibility) |
| 7 | **MESH API** | Secure file/message transfer (may be needed for some NHS 111 workflows) | **Onboarding required** | Apply via MESH mailbox form | 🟢 Low (only if needed) |
| 8 | **Booking and Referral (BaRS) — FHIR API (Referral Receiver GP-Pharmacy CPCS)** | Receive CPCS referrals via the newer BaRS standard (replacing ITK SOAP long-term) | **Email request** | Email `bookingandreferralstandard@nhs.net` | 🟢 Future |
| 9 | **Organisation Data Service (ODS) — FHIR API** | Look up organisation details by ODS code | **Open access** (no onboarding) | None — freely available | ✅ Free |

### APIs We Do NOT Need Right Now

| API | Why Not |
|-----|---------|
| NHS CIS2 Authentication | Only needed for healthcare worker access mode (PDS). We're using application-restricted mode. |
| NHS login | Only needed if patients log in with NHS credentials. We handle our own patient auth. |
| EPS (Electronic Prescription Service) | We're not a dispensing system (yet). |
| GP Connect | We don't need to read GP clinical records. |
| Summary Care Record | Not needed for our service delivery workflows. |

---

## 3. Dependency Graph

```
                    ┌─────────────────────────┐
                    │   PREREQUISITES          │
                    │   • DSPT (as supplier)    │
                    │   • Developer account ✅   │
                    │   • Connection Agreement  │
                    │   (No ODS code needed —   │
                    │    we onboard as supplier) │
                    └────────┬────────────────-─┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ TRACK A    │  │ TRACK B    │  │ TRACK C    │
     │ NHS Digital│  │ NHSBSA MYS │  │ NHS 111    │
     │ APIs       │  │ Claims     │  │ Live       │
     │            │  │            │  │            │
     │ • PDS      │  │ • CPCS     │  │ • DoS reg  │
     │ • DoHS v3  │  │ • Flu      │  │ • mTLS     │
     │ • DoS UEC  │  │ • NMS      │  │ • Endpoint │
     │            │  │ • SCS      │  │   register │
     │            │  │ • CVD      │  │            │
     │            │  │ • Contra   │  │            │
     └────────────┘  └────────────┘  └────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    ┌──────────────────────────────┐
                    │   TRACK D — NHS Notify        │
                    │   (NOT a PharmStation track —  │
                    │    per-pharmacy-customer       │
                    │    responsibility)             │
                    └──────────────────────────────-┘
                             │
                             ▼
                    ┌─────────────────────────┐
                    │   TRACK E — Production   │
                    │   Infrastructure          │
                    │   • Static IP proxy       │
                    │   • mTLS NGINX            │
                    │   • Security hardening    │
                    └─────────────────────────┘
```

**Key insight:** Tracks A, B, C, D can all run in parallel. Most share the same prerequisites (DSPT as supplier, Connection Agreement). PharmStation does NOT need its own ODS code — ODS codes belong to pharmacy customers. Start the prerequisites NOW.

---

## 4. Prerequisites (Must Do First)

These are mandatory for almost every NHS API. Do these before anything else.

> **Supplier context:** PharmStation completes these as a **software supplier organisation**, not as a pharmacy. You do NOT need an ODS code for your own organisation — ODS codes belong to the pharmacies that will use PharmStation.

### 4.1a — GET AN ODS CODE FOR PHARMSTATION (Blocker — Must Do Before DSPT)

**What:** The DSPT requires a valid ODS code to register. PharmStation does not have one. You need to request an ODS code for PharmStation as an **IT supplier / software company** — NOT as a pharmacy.

**Why needed:** DSPT registration is gated behind an ODS code. Without DSPT, no API access. This is the very first thing that must happen.

**How ODS codes work for IT suppliers:** ODS issues codes to non-NHS organisations too — including "independent sector healthcare providers" and technology companies that interact with NHS systems. PharmStation qualifies as a health IT supplier.

**Status:** � Submitted — Case CS1341956 — Awaiting ODS code assignment (submitted 28 Feb 2026)

**Action:**
1. Go to the NHS National IT Customer Support Portal: [https://www.support.digitalservices.nhs.uk/csm](https://www.support.digitalservices.nhs.uk/csm)
2. Create an account (click "Don't have an account? Register")
3. Once logged in, select **"Submit a Case"**
4. Select category: **"Data Services, Collections & Data sets"**
5. Select subcategory: **"Organisation Data Service (ODS)"**
6. Select the form: **"Create a new ODS code"** (or equivalent)
7. Fill in:
   - **Organisation name:** PharmStation
   - **Organisation type:** IT Supplier / Software Company (or closest available option)
   - **Address:** Your registered business address
   - **Contact:** Champe Chilufya, `champe.chilufya@wales.nhs.uk`
   - **Reason:** "PharmStation is a community pharmacy clinical services platform (PMR/clinical software). We need an ODS code to register on the Data Security and Protection Toolkit (DSPT) as part of our NHS API onboarding as a software supplier."
8. Submit the case and note the reference number below

**Alternative route (if portal is slow or confusing):**
- Phone the National Service Desk: **0300 303 5035** (Mon-Fri, 8am-5pm)
- Or email: **ssd.nationalservicedesk@nhs.net** with subject: "ODS code request — IT supplier — PharmStation"

**Expected timeline:** ODS typically processes new code requests within a few business days (bronze service level).

**Record here:**
```
NSD Portal account created: YES
Portal URL: https://nhsdigitallive.service-now.com/
Login: champe.chilufya@wales.nhs.uk (NHSmail SSO)
Case reference number: CS1341956
Date submitted: 28 February 2026
ODS code assigned: D8W5S — PHARMSTATION (assigned 3 March 2026)
Code active: Immediately (published on DSE/API from 4 March 2026)
OC1 (Organisation Contact): Champe Chilufya
DSPT registration: Also completed by NSD — PharmStation (D8W5S) registered on dsptoolkit.nhs.uk
```

**Case details submitted:**
- **Catalog item:** ODS Code Request
- **Request type:** New Organisation Code
- **Organisation category:** System or Software
- **Spine integration required:** No
- **Organisation name:** Pharmstation
- **HQ address:** 31 Norman Davies Gardens, Bilston, WV14 0BD
- **Website:** www.pharmstation.co.uk
- **Reason for code:** DSP Toolkit registration
- **OC1 nominated:** No (not applicable — IT supplier, not an NHS org)

**Next:** All done. ODS code assigned AND DSPT registration completed. Proceed to DSPT self-assessment (step 4.1b).

---

### 4.1b — Data Security and Protection Toolkit (DSPT) — Self-Assessment (IN PROGRESS)

**What:** An annual self-assessment tool that organisations complete to demonstrate they are practising good data security and handling information correctly.

**Why needed:** Mandatory for any NHS API access. You cannot pass assurance without it.

**Status:** � Profile created, self-assessment started 3 March 2026. 0 of 103 mandatory evidence items completed.

**DSPT login:** [dsptoolkit.nhs.uk](https://www.dsptoolkit.nhs.uk/) — ODS code D8W5S — admin: Champe Chilufya

**Assessment version:** 2025-26 (version 8) — HQ assessment

**Profile submitted:**
- Primary Sector: IT Supplier
- Caldicott Guardian: Champe Chilufya
- SIRO: Champe Chilufya
- IG Lead: Champe Chilufya
- DPO: Not provided (not required for non-public-authority small IT supplier)
- NHSmail only: Yes
- Cyber Essentials PLUS: No
- ISO 27001: No

**Scale:** 10 NDG Standards, 33 assertions, 103 mandatory evidence items

**The 10 Standards:**
1. Personal confidential data (assertions 1.1–1.4)
2. Staff responsibilities (assertion 2.2)
3. Training (assertions 3.1–3.2)
4. Managing data access (assertions 4.1–4.5)
5. Process reviews (assertions 5.1–5.2)
6. Responding to incidents (assertions 6.1–6.3)
7. Continuity planning (assertions 7.1–7.3)
8. Unsupported systems (assertions 8.1–8.4)
9. IT protection (assertions 9.1–9.6)
10. Accountable suppliers (assertions 10.1–10.3)

**Progress:** All 103 mandatory evidence items completed across all 10 standards (4–5 March 2026).

**Remaining before publication:**
1. ICO registration (£40/year) — needed for evidence item 1.1.1
2. Independent audit — required for IT Suppliers. Auditor identified, needs to be added as DSPT user and complete assessment using the Strengthening Assurance Guide.

**Supporting documents created:**
- Privacy Notice — published at pharmstation.co.uk/privacy (v1.0, 4 March 2026)
- Information Asset Register / ROPA — documentation/legal-and-compliance/information-asset-register-ropa.md
- Training Needs Analysis — documentation/legal-and-compliance/training-needs-analysis.md
- Tabletop Exercise Record — documentation/legal-and-compliance/tabletop-exercise-record-2026-03-04.md
- Supplier Register — documentation/legal-and-compliance/supplier-register.md
- DSPT Verification Checklist — documentation/legal-and-compliance/dspt-verification-checklist.md

**Action:**
- [x] Register PharmStation on DSPT (ODS: D8W5S) ✅ 3 March 2026
- [x] Complete organisation profile ✅ 3 March 2026
- [x] Complete all 103 mandatory evidence items ✅ 5 March 2026
- [ ] Register with ICO (£40/year) — needed for 1.1.1
- [ ] Arrange independent audit — add auditor as DSPT user, provide audit guide + report template
- [ ] Confirm all assertions
- [ ] Publish assessment
- [ ] Obtain "Standards Met" status

**Estimated time to completion:** ICO registration ~10 minutes + independent audit ~1 week

---

### 4.2 — ODS Code Clarification (⚠️ CORRECTED)

**What:** The Organisation Data Service code uniquely identifies NHS organisations (pharmacies, GP practices, etc.) in all NHS systems.

**Critical correction:** PharmStation is a **software product**, not a pharmacy. **PharmStation does NOT have and does NOT need its own ODS code for pharmacy operations.** ODS codes belong to the pharmacies that will be customers of PharmStation.

- `FFQ69` is a **sample/test ODS code** used during development and in the NHS 111 test suite. It is NOT PharmStation's code.
- When submitting claims via NHSBSA MYS, the ODS code in the payload will be the **customer pharmacy's** ODS code.
- When registering in DoS for NHS 111, each **customer pharmacy** registers their own ODS code.
- When looking up patients via PDS, PharmStation acts on behalf of a pharmacy identified by the pharmacy's ODS code.

**Do we need an ODS code for PharmStation itself (as a supplier)?**

Potentially, yes — for DSPT registration and some onboarding processes, NHS may require the software supplier company to have its own organisation identifier. This would be:
- A **company ODS code** (if PharmStation is a registered company), OR
- The process may accept Companies House registration or another identifier

**Status:** ✅ Clarified — no pharmacy ODS code needed. Investigate whether a supplier/company ODS code is needed for DSPT.

**Action:**
- [ ] Check DSPT registration requirements — does it accept non-pharmacy organisations without an ODS code?
- [ ] If an ODS code is needed for PharmStation as a company, apply at [digital.nhs.uk/services/organisation-data-service](https://digital.nhs.uk/services/organisation-data-service) under the appropriate organisation type (IT supplier / technology company)
- [ ] Keep `FFQ69` as the test ODS code in development/sandbox environments
- [ ] Ensure the app architecture supports dynamic ODS codes per pharmacy customer (already designed this way in `ps_organisations` table)

**Record here once resolved:**
```
PharmStation supplier ODS code (if needed): [TO FILL — may not be needed]
DSPT registration identifier used: [TO FILL]
Test ODS code for development: FFQ69 (sample — not a real pharmacy we own)
```

---

### 4.3 — Online Connection Agreement (OCA)

**What:** The legal agreement between your organisation and NHS England for using NHS systems/APIs.

**Why needed:** Required for PDS, DoS, NHS 111, and several other APIs. PharmStation signs this as a **software supplier** connecting to NHS systems on behalf of pharmacy customers.

**Status:** ⏳ Not needed yet — auto-generated when you start API onboarding

**How it actually works (clarified 28 Feb 2026):**
The Connection Agreement is NOT something you request separately. It is **automatically created** when you begin onboarding to specific APIs (e.g. PDS). The process is:
1. Start API onboarding on the developer portal (e.g. select PDS FHIR API)
2. NHS England **automatically generates** a Connection Agreement/Contract (reference starts with `CNTR` + 7 digits)
3. You receive a **notification email** directing you to the contract on the NSD portal under "My Extras"
4. Review the terms:
   - **Standard terms** — apply to all NHS APIs
   - **Special terms** — apply to specific APIs (shown in appendix headings)
   - **Appendix 1A (End User Organisation Acceptable Use Policy)** — you must share this with your pharmacy customers who use PharmStation to access NHS services
5. Tick the acceptance box at the bottom → auto-populates "Accepted By" and "Accepted On"
6. You have **90 days** from creation to accept, or the contract gets cancelled
7. Future updates to terms auto-accept after 30 days (you get 30 days to review/query)

**Action:**
- [ ] No action now — wait until PDS or another API onboarding generates the contract
- [ ] When notification email arrives, review and accept within 90 days
- [ ] Note and share Appendix 1A (Acceptable Use Policy) with pharmacy customers
- [ ] Set up a business-as-usual process for sharing that policy with new customers

---

### 4.4 — National Service Desk Customer Portal Registration

**What:** Support portal for NHS Digital services.

**Why needed:** Required before starting digital onboarding. Used for raising tickets, requesting access, reporting issues.

**Status:** 🔲 Not Started

**Action:**
- [ ] Go to the [NSD customer portal](https://digital.nhs.uk/services/national-service-desk)
- [ ] Register your organisation
- [ ] Note your customer reference number

---

## 5. Track A — NHS Digital Onboarding (APIs)

### How Digital Onboarding Works

From the NHS Digital onboarding portal (`onboarding.prod.api.platform.nhs.uk`):

1. **Register organisation + product** (PharmStation)
2. **Select APIs** you're onboarding to
3. **Complete assurance stages** (up to 4 stages per API):
   - Stage 1: Eligibility (must pass before other stages)
   - Stage 2: Technical conformance
   - Stage 3: Clinical safety (DCB0129 / DCB0160)
   - Stage 4: Information governance
4. **NHS reviewers assess** and may request more info
5. **Approval** → production credentials issued

---

### A.1 — Personal Demographics Service (PDS) FHIR API

**Priority:** 🔴 High — needed for patient lookup in every service form

**Access mode:** Application-restricted (signed JWT authentication)
- This means NO end user login (NHS CIS2) needed
- PharmStation authenticates as an application, not as individual healthcare workers
- Simpler to implement but limited to: search (single match only), get patient details, get related people

**What it gives us:**
- Search patient by NHS number → get name, DOB, address, GP practice
- Verify NHS numbers before claim submission
- Auto-populate service delivery forms

**Onboarding steps:**
- [ ] Start digital onboarding at developer.nhs.uk → select "Personal Demographics Service — FHIR API"
- [ ] Complete eligibility questionnaire (describe use case: pharmacy service delivery, patient lookup for claims)
- [ ] Demonstrate technical conformance ([PDS FHIR API technical conformance — application-restricted](https://digital.nhs.uk/developer/api-catalogue/personal-demographics-service-fhir/pds-fhir-api-technical-conformance-application-restricted))
- [ ] Complete clinical safety assessment (DCB0129)
- [ ] Complete information governance assessment
- [ ] Await approval
- [ ] Receive production credentials
- [ ] Configure signed JWT auth in Edge Function (`nhs-pds-lookup`)

**Testing (can do NOW before approval):**
- Sandbox: `https://sandbox.api.service.nhs.uk/personal-demographics/FHIR/R4/` — open access, no auth needed
- Integration: `https://int.api.service.nhs.uk/personal-demographics/FHIR/R4/` — needs dev API key

**Status:** 🔲 Not Started

**Reply/Notes:**
```
[Record any NHS replies or notes here as you progress]
```

---

### A.2 — Directory of Healthcare Services API v3

**Priority:** 🟡 Medium — useful for GP practice lookup, service search

**Access mode:** Application-restricted (API key)

**What it gives us:**
- Search for healthcare organisations by name, location, ODS code
- Find GP practices for patient referrals
- Find services near a patient

**Onboarding steps:**
- [ ] Email `ssd.nationalservicedesk@nhs.net` with subject: "Service Search v3 API onboarding"
- [ ] Include: organisation name (PharmStation — software supplier), use case description (community pharmacy platform needing GP/service lookup), developer contact
- [ ] Await response with onboarding instructions
- [ ] Complete any assurance requirements
- [ ] Receive production API key

**Testing (can do NOW):**
- Sandbox: `https://sandbox.api.service.nhs.uk/service-search-api/`
- Integration: `https://int.api.service.nhs.uk/service-search-api/`

**Status:** 🔲 Not Started

**Reply/Notes:**
```
[Record any NHS replies or notes here]
```

---

### A.3 — Directory of Services (DoS) — UEC REST API

**Priority:** 🔴 High for NHS 111 live — this is how NHS 111 finds pharmacies using PharmStation

**What it gives us:**
- Pharmacy customers register in DoS so NHS 111 call handlers can see them
- Manage service profiles (opening hours, service types, capacity)
- NHS 111 queries DoS to find which pharmacy to send referrals to

**Onboarding steps:**
- [ ] Start digital onboarding → select "Directory of Services — Urgent and Emergency Care — REST API"
- [ ] Complete assurance stages (PharmStation as software supplier)
- [ ] Document the process for pharmacy customers to register in DoS via their local ICS
- [ ] Each pharmacy customer works with their local ICS DoS Lead to create their DoS profile
- [ ] PharmStation listed as the pharmacy's system supplier in DoS, with our endpoint URL

**Important:** DoS registration is per-pharmacy and is managed through each pharmacy's local ICS/ICB (Integrated Care Board). PharmStation does NOT register itself in DoS — our pharmacy customers do. PharmStation needs to be recognised as an approved system supplier that can receive referrals on their behalf.

**Status:** 🔲 Not Started

**Reply/Notes:**
```
[Record any NHS replies or notes here]
```

---

## 6. Track B — NHSBSA MYS Supplier Onboarding (Claims)

This is a **separate process** from NHS Digital. NHSBSA has its own onboarding.

### B.1 — Supplier Registration (Email Sent ✅)

**Email sent:** 26 February 2026
**To:** `mys-platform@nhsbsa.nhs.uk`
**From:** `champe.chilufya@wales.nhs.uk`
**Content:** See `documentation/nhs-integration-expansion/agent-messages.md` ENTRY 005

**What we requested:**
1. Staging/test environment access for all 7 services
2. `PLATFORM_DEPOSIT_ID` prefix (`PSN-` requested)
3. IP whitelisting process and registration form
4. Supplier assurance documentation

**Status:** 🔄 Awaiting Reply (sent 26 Feb, expect response within 5-10 working days)

**Follow-up plan:**
- [ ] If no reply by **12 March 2026** → follow up by phone: 0300 330 1368
- [ ] Record NHSBSA contact name and reference number
- [ ] When reply received → fill in section below

**Reply Record:**
```
Date received: [TO FILL]
Contact name: [TO FILL]
Reference number: [TO FILL]
PLATFORM_DEPOSIT_ID prefix assigned: [TO FILL]
Staging URL: [TO FILL]
Staging credentials: [TO FILL]
IP whitelisting form: [TO FILL]
Additional requirements: [TO FILL]
```

---

### B.2 — Staging Integration & Testing

Once NHSBSA provides staging credentials:

- [ ] Configure staging URLs in Edge Function environment variables
- [ ] Replace stubbed HTTP calls with real NHSBSA endpoints
- [ ] Test CPCS claim submission (create, read, update, delete)
- [ ] Test Flu vaccination claim
- [ ] Test NMS claim
- [ ] Test SCS claim
- [ ] Test CVD/Hypertension claim
- [ ] Test Contraception claim
- [ ] Verify error handling (400, 403, 422, 500 responses)
- [ ] Document test results for NHSBSA assurance

---

### B.3 — Production Go-Live

- [ ] Provision static IP proxy (Hetzner CX11, UK region, Nginx)
- [ ] Register static IP with NHSBSA
- [ ] Configure Nginx proxy: `proxy_pass https://services.nhsbsa.nhs.uk/`
- [ ] Update Edge Functions to route through proxy for production
- [ ] NHSBSA production approval
- [ ] Switch to production URLs
- [ ] Monitor first real claims

---

## 7. Track C — NHS 111 Adaptor Onboarding

Our NHS 111 infrastructure is **built and tested** (see `documentation/nhs/nhs111-pipeline.md`). What's needed for live:

### C.1 — NHS 111 Integration Registration

- [ ] Contact NHS England about receiving NHS 111 referrals as a pharmacy system supplier
- [ ] Identify correct contact — likely via the [NHS 111 adaptor onboarding page](https://digital.nhs.uk/developer/api-catalogue/nhs-111-hl7-v3#api-description__onboarding)
- [ ] Complete the Connection Agreement for NHS 111
- [ ] Provide endpoint URL: `https://nhs111-adaptor-production.up.railway.app/report` (or NGINX proxy URL once mTLS is configured)

**Status:** 🔲 Not Started

**Reply/Notes:**
```
[Record communications here]
```

---

### C.2 — Directory of Services (DoS) Registration

> **Note:** DoS registration is per-pharmacy-customer, not for PharmStation itself. Each pharmacy that uses PharmStation must be registered in DoS by their local ICS DoS Lead, with PharmStation listed as their system supplier.

- [ ] Document the process for pharmacy customers to register in DoS via their local ICS
- [ ] For initial testing, identify a pilot pharmacy willing to register in DoS with PharmStation as their supplier
- [ ] Pilot pharmacy works with their ICS DoS Lead to configure their DoS service profile:
  - Service types offered (CPCS, Pharmacy First, etc.)
  - Opening hours
  - Endpoint URL for NHS 111 to send referrals (PharmStation's endpoint)
  - Capacity status
- [ ] Obtain the pilot pharmacy's DoS Service ID(s)
- [ ] Update `get-ods-dos-codes` edge function to dynamically query `ps_organisations` for registered pharmacies' ODS codes and DoS IDs (replacing hardcoded test data):
  ```json
  { "odsCodes": ["PHARMACY_ODS_CODE"], "dosIds": ["PHARMACY_DOS_ID"] }
  ```

**Status:** 🔲 Not Started

---

### C.3 — mTLS Certificates

The live NHS 111 network requires mutual TLS authentication.

- [ ] Request TLS-MA certificates from NHS Digital
- [ ] Receive: server public cert, server private key, NHS client cert, root CA cert
- [ ] Deploy NGINX reverse proxy on Railway (`nhsdev/nia-111-nginx-adaptor`)
- [ ] Configure certs as environment variables on the NGINX service
- [ ] Update public endpoint to point to NGINX (not directly to adaptor)
- [ ] Test mTLS handshake with NHS 111

**Status:** 🔲 Not Started

---

### C.4 — Enable SOAP Validation

Once live with real NHS 111 messages:

- [ ] Set `PEM111_SOAP_VALIDATION_ENABLED=true` on adaptor
- [ ] Set `PEM111_SOAP_SEND_TO` to the registered endpoint URL
- [ ] Test with NHS 111 connectivity test messages
- [ ] Verify adaptor correctly validates and routes messages

---

## 8. Track D — NHS Notify (⚠️ CORRECTED — Not a PharmStation Onboarding Track)

> **Correction (28 Feb 2026):** NHS Notify is NOT something PharmStation onboards to as a supplier. It is an **organisation-level service** where each pharmacy/organisation:
> - Onboards themselves directly with NHS Notify
> - Creates their own message templates
> - Gets their own API credentials
> - Is primarily responsible and accountable for their communications
>
> **PharmStation's role (optional, future):** We could build an integration feature where PharmStation connects to a pharmacy customer's NHS Notify account (via NHS Notify API or MESH) to send messages on their behalf — but the pharmacy owns the account and the accountability.

### What NHS Notify Actually Is

- Allows organisations to send **NHS App messages, emails, SMS, and letters** to patients
- Integrated with PDS — uses NHS numbers to find contact details
- Organisations create **reusable message templates** and manage their own sending
- Channels: NHS App messages, email, text (SMS), letters
- Multiple communication suppliers (NHS App, GOV.UK Notify, etc.)
- No service or integration fees — competitive message rates
- GDPR compliant, ISO 27001/2, Cyber Assessment Framework (CAF) compliant

### Who Can Use It

Any organisation that provides or supports health services in England. This includes community pharmacies — but **they onboard themselves**, not through PharmStation.

### How This Affects PharmStation

**No action needed now.** When we have pharmacy customers, we can:
1. Advise them to onboard with NHS Notify directly
2. Optionally build a PharmStation feature that integrates with their NHS Notify API to send messages from within our platform (e.g. appointment reminders, service follow-ups)
3. This would be a **product feature**, not an onboarding requirement

**Status:** ✅ Clarified — removed from onboarding pipeline. No PharmStation supplier onboarding required. PharmStation already has a working NHS Notify integration as a product feature — pharmacy customers connect their own NHS Notify accounts and PharmStation sends messages on their behalf.

---

## 9. Track E — Infrastructure for Production

### E.1 — Static IP Proxy (for NHSBSA)

- [ ] Provision Hetzner CX11 VPS (UK region, ~€4/month)
- [ ] Install Nginx
- [ ] Configure as reverse proxy to NHSBSA endpoints
- [ ] Note the static IP address
- [ ] Register IP with NHSBSA when they provide the whitelisting form
- [ ] Test connectivity from Edge Functions → Proxy → NHSBSA staging

### E.2 — mTLS NGINX Proxy (for NHS 111)

- [ ] Deploy `nhsdev/nia-111-nginx-adaptor` on Railway
- [ ] Configure TLS certificates (once received from NHS)
- [ ] Move public domain to NGINX service
- [ ] Test end-to-end with NHS 111 connectivity test

### E.3 — Security Hardening

- [ ] Rotate all development passwords (RabbitMQ, etc.)
- [ ] Review Supabase RLS policies
- [ ] Enable JWT verification on edge functions where appropriate
- [ ] Ensure audit logging is comprehensive
- [ ] Review GDPR compliance for patient data handling

---

## 10. Communications Log

Record ALL emails sent and received here in chronological order.

### Email 1 — NHSBSA MYS Supplier Request (SENT)

| Field | Value |
|-------|-------|
| **Date** | 26 February 2026 |
| **Direction** | SENT |
| **From** | `champe.chilufya@wales.nhs.uk` |
| **To** | `mys-platform@nhsbsa.nhs.uk` |
| **Subject** | IT Supplier Integration Request — PharmStation Clinical Services Platform |
| **Summary** | Requested staging access, PLATFORM_DEPOSIT_ID prefix (PSN-), IP whitelisting process, supplier assurance docs |
| **Full text** | See `documentation/nhs-integration-expansion/agent-messages.md` ENTRY 005 |
| **Reply received?** | 🔲 No — check by 12 March 2026 |

---

### Email 2 — ODS Code Request via NSD Portal (SUBMITTED)

| Field | Value |
|-------|-------|
| **Date** | 28 February 2026 |
| **Direction** | SUBMITTED (portal case) |
| **Portal** | `https://nhsdigitallive.service-now.com/` |
| **Contact** | Champe Chilufya (`champe.chilufya@wales.nhs.uk`) |
| **Case number** | **CS1341956** |
| **Catalog item** | ODS Code Request — New Organisation Code |
| **Organisation category** | System or Software |
| **Organisation name** | Pharmstation |
| **HQ address** | 31 Norman Davies Gardens, Bilston, WV14 0BD |
| **Website** | www.pharmstation.co.uk |
| **Spine integration** | No |
| **Reason** | DSP Toolkit registration (to begin NHS API onboarding as software supplier) |
| **Reply received?** | ✅ Yes — 3 March 2026. ODS code **D8W5S** assigned. DSPT registration completed. Case resolved. |

---

### Email 3 — ODS Code Assigned + DSPT Registered (RECEIVED)

| Field | Value |
|-------|-------|
| **Date** | 3 March 2026 |
| **Direction** | RECEIVED (NSD portal notification) |
| **From** | National Service Desk, NHS England |
| **To** | `champe.chilufya@wales.nhs.uk` |
| **Case** | CS1341956 |
| **Summary** | ODS code **D8W5S — PHARMSTATION** assigned and active immediately. Published on DSE/API from 4 March. Champe Chilufya set as OC1. Case then forwarded to DSPT team. |
| **Ref** | MSGNHSD27930539_FqmiRHYWxrdQ8je |

### Email 4 — DSPT Registration Confirmed (RECEIVED)

| Field | Value |
|-------|-------|
| **Date** | 3 March 2026 |
| **Direction** | RECEIVED (NSD portal notification) |
| **From** | National Service Desk, NHS England |
| **To** | `champe.chilufya@wales.nhs.uk` |
| **Case** | CS1341956 (resolution) |
| **Summary** | PharmStation (D8W5S) registered on DSPT at dsptoolkit.nhs.uk. First user to register should be main administrator. Quick start guide at https://www.dsptoolkit.nhs.uk/Help/3 |
| **Action required** | Accept the resolution within 7 days or case auto-closes |

---

### Email 5 — [TEMPLATE FOR NEXT EMAIL]

| Field | Value |
|-------|-------|
| **Date** | [TO FILL] |
| **Direction** | SENT / RECEIVED |
| **From** | |
| **To** | |
| **Subject** | |
| **Summary** | |
| **Reply received?** | |

---

## 11. Key Contacts

| Organisation | Purpose | Contact | Notes |
|-------------|---------|---------|-------|
| **NHSBSA MYS** | Claim submission API access | `mys-platform@nhsbsa.nhs.uk` / 0300 330 1368 | Email sent 26 Feb |
| **NHS Digital — NSD** | General API support + DoHS v3 | `ssd.nationalservicedesk@nhs.net` / 0300 303 5035 | |
| **NHS Digital — Onboarding** | Digital onboarding escalations | `shan.rahulan@nhs.net` | Strategic direction |
| **NHS Notify** | Patient comms (organisation-level) | `england.nhsnotifyonboarding@nhs.net` | NOT for PharmStation — each pharmacy customer onboards themselves |
| **BaRS (Booking & Referral)** | Future CPCS referral standard | `bookingandreferralstandard@nhs.net` | For future — not needed now |
| **NHS 111 Adaptor** | 111 integration support | GitHub issues on `NHSDigital/integration-adaptor-111` | |
| **DSPT** | Data security toolkit | [dsptoolkit.nhs.uk](https://www.dsptoolkit.nhs.uk/) | |
| **ODS Portal** | Organisation codes | [odsportal.digital.nhs.uk](https://odsportal.digital.nhs.uk/) | |
| **Developer Community** | Peer support | [digital.nhs.uk/developer-community](https://digital.nhs.uk/developer/developer-community) | |

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **DSPT** | Data Security and Protection Toolkit — annual self-assessment |
| **ODS** | Organisation Data Service — unique codes for NHS organisations. PharmStation does NOT have a pharmacy ODS code; ODS codes belong to pharmacy customers. `FFQ69` is a test code. |
| **OCA** | Online Connection Agreement — legal agreement with NHS England |
| **DoS** | Directory of Services — how NHS 111 finds pharmacies |
| **DoHS** | Directory of Healthcare Services — API for searching NHS organisations |
| **PDS** | Personal Demographics Service — patient demographics database |
| **MYS** | Manage Your Service — NHSBSA portal for pharmacy claims |
| **BaRS** | Booking and Referral Standard — newer FHIR-based referral API |
| **ITK** | Interoperability Toolkit — older SOAP-based messaging standard |
| **mTLS** | Mutual TLS — two-way certificate authentication |
| **MESH** | Message Exchange for Social Care and Health — secure file transfer |
| **ICS/ICB** | Integrated Care System / Integrated Care Board — regional NHS organisations |
| **GPhC** | General Pharmaceutical Council — pharmacy regulator |
| **NHSBSA** | NHS Business Services Authority — handles pharmacy reimbursement |
| **DCB0129** | Clinical Risk Management standard for health IT manufacturers |
| **FHIR** | Fast Healthcare Interoperability Resources — modern health data standard |

---

## Next Actions (Prioritised)

> **Remember:** PharmStation is a software supplier, not a pharmacy. You do NOT need a pharmacy ODS code. All onboarding is as a software/IT supplier.

**Do these NOW — they unblock everything:**

1. ~~**🔴 Register on NSD portal**~~ ✅ DONE — Registered via NHSmail SSO at `https://nhsdigitallive.service-now.com/`
2. ~~**🔴 Request ODS code for PharmStation**~~ ✅ DONE — **D8W5S — PHARMSTATION** assigned 3 March 2026 (Case CS1341956)
3. **🔴 Complete DSPT self-assessment** — 🔄 IN PROGRESS. Profile created. 103 mandatory evidence items to complete across 10 NDG standards. Working through with AI assistance. Quick start guide: [https://www.dsptoolkit.nhs.uk/Help/3](https://www.dsptoolkit.nhs.uk/Help/3)
4. ~~**🔴 Start Connection Agreement**~~ ℹ️ NOT A SEPARATE STEP — auto-generated when you start API onboarding (e.g. PDS). Will appear in NSD portal "My Extras" section. Accept within 90 days.

**Do these in parallel once prerequisites are in motion:**

5. **🔴 Begin PDS onboarding** — developer.nhs.uk → product onboarding → select PDS FHIR API (application-restricted mode)
6. **🟡 Email DoHS v3** — `ssd.nationalservicedesk@nhs.net` titled "Service Search v3 API onboarding" (nice-to-have, not blocking)
7. **🔴 Chase NHSBSA** if no reply by 12 March — phone 0300 330 1368

**Can wait until prerequisites done:**

8. **🟡 DoS supplier registration** — Get PharmStation recognised as an approved system supplier in DoS
9. **🟡 Identify pilot pharmacy** — Find a pharmacy willing to be your first customer / test site for NHS 111 live. They will register in DoS with their own ODS code, listing PharmStation as their system.
10. **🟡 NHS 111 Connection Agreement** — Once a pilot pharmacy is registered in DoS, proceed with NHS 111 live onboarding

**Removed from original list:**
- ~~🔴 Confirm ODS code FFQ69~~ — **NOT NEEDED.** `FFQ69` is a test/sample ODS code. PharmStation doesn't own a pharmacy and doesn't need a pharmacy ODS code.
- ~~🟡 Email NHS Notify~~ — **NOT OUR RESPONSIBILITY.** NHS Notify is an organisation-level service. Each pharmacy customer onboards themselves. PharmStation already has a working integration that connects to pharmacy customers' NHS Notify accounts — this is a shipped product feature, not an onboarding item.

---

> **This is a living document.** Update it every time you send an email, receive a reply, complete a step, or learn something new about the process. Paste email replies directly into the Communications Log section.
