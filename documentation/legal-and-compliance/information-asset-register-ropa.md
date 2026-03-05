# Information Asset Register / Record of Processing Activities (ROPA)

**System:** PharmStation  
**Organisation:** PharmStation (ODS: D8W5S)  
**Last Updated:** 4 March 2026  
**Version:** 1.0  
**Classification:** OFFICIAL — SENSITIVE  
**Reviewed & Approved By:** Champe Chilufya (SIRO, IG Lead, Caldicott Guardian)  
**Review Date:** 4 March 2026  
**Next Review Due:** 4 September 2026  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Data Controller Details](#2-data-controller-details)
3. [Categories of Data Subjects](#3-categories-of-data-subjects)
4. [Complete Personal Data Inventory](#4-complete-personal-data-inventory)
   - 4.1 [Staff & User Data](#41-staff--user-data)
   - 4.2 [Patient Data](#42-patient-data)
   - 4.3 [Prescriber / Healthcare Professional Data](#43-prescriber--healthcare-professional-data)
   - 4.4 [Locum Pharmacist Data](#44-locum-pharmacist-data)
   - 4.5 [Controlled Drug Register Data](#45-controlled-drug-register-data)
   - 4.6 [NHS PDS & Claims Data](#46-nhs-pds--claims-data)
   - 4.7 [NHS 111 Referral Data](#47-nhs-111-referral-data)
   - 4.8 [Messaging & Communication Data](#48-messaging--communication-data)
   - 4.9 [Video Consultation Data](#49-video-consultation-data)
   - 4.10 [AI Chat & Document Scanning Data](#410-ai-chat--document-scanning-data)
   - 4.11 [Operational & Audit Data](#411-operational--audit-data)
   - 4.12 [Delivery System Data](#412-delivery-system-data)
   - 4.13 [Pharmacy Network (P2P) Data](#413-pharmacy-network-p2p-data)
   - 4.14 [Log System Data](#414-log-system-data)
   - 4.15 [Locum Financial Data](#415-locum-financial-data)
5. [External Data Flows & Third-Party Sharing](#5-external-data-flows--third-party-sharing)
6. [Storage & Retention](#6-storage--retention)
7. [Technical & Organisational Security Measures](#7-technical--organisational-security-measures)
8. [Special Category Data Assessment](#8-special-category-data-assessment)
9. [Hardware & Software Asset Register](#9-hardware--software-asset-register)
   - 9.1 [Cloud Services & Hosting Platforms](#91-cloud-services--hosting-platforms)
   - 9.2 [NHS 111 Pipeline Infrastructure](#92-nhs-111-pipeline-infrastructure)
   - 9.3 [Supabase Edge Functions](#93-supabase-edge-functions)
   - 9.4 [Database & Managed Services](#94-database--managed-services)
   - 9.5 [Application Software](#95-application-software)
   - 9.6 [Internal Shared Packages](#96-internal-shared-packages)
   - 9.7 [Build Tools & Developer Infrastructure](#97-build-tools--developer-infrastructure)
   - 9.8 [Key Third-Party Libraries](#98-key-third-party-libraries)
   - 9.9 [NHS API & External Service Integrations](#99-nhs-api--external-service-integrations)
   - 9.10 [Asset Summary](#910-asset-summary)

---

## 1. Executive Summary

PharmStation is a multi-tenant pharmacy management platform processing personal data across the following domains:

- **Staff/user management** — pharmacy employees, locum pharmacists
- **Patient records** — demographics, NHS numbers, prescriptions, medications, appointments
- **Controlled drug registers** — legal requirement under Misuse of Drugs Regulations 2001
- **NHS integrations** — PDS lookups, NHSBSA claim submissions, NHS 111 referrals
- **Clinical services** — Pharmacy First, NMS, vaccinations, consultations
- **Drug delivery** — patient addresses, medications, GPS tracking, delivery signatures
- **Communications** — SMS, email, letters via GOV.UK Notify
- **Video consultations** — real-time patient video sessions
- **AI-powered document scanning** — prescription/invoice images containing patient/prescriber data
- **Locum marketplace** — DBS checks, professional credentials, financial data
- **Audit trail** — complete immutable record of all data modifications

**Sensitive/special category data processed:** Health data (prescription data, diagnoses, clinical consultations, medication records), professional registration numbers, DBS certificates, National Insurance numbers, biometric-adjacent data (signatures, GPS location).

---

## 2. Data Controller Details

Each pharmacy organisation using PharmStation is a **data controller** for the personal data of their patients and staff. PharmStation (the platform operator) acts as a **data processor** on behalf of each pharmacy organisation.

For locum pharmacist data and platform-level user accounts, PharmStation may also act as a **joint controller** or **independent controller** depending on the processing purpose.

---

## 3. Categories of Data Subjects

| Category | Description |
|---|---|
| **Pharmacy Staff** | Owners, managers, pharmacists, technicians, dispensers employed by pharmacy organisations |
| **Locum Pharmacists** | Self-employed pharmacists using the locum marketplace |
| **Patients** | Individuals registered at a pharmacy, receiving prescriptions, appointments, services, or deliveries |
| **Prescribers** | Doctors, dentists, nurse prescribers who issue prescriptions (their details appear on CD register entries) |
| **Suppliers** | Pharmaceutical wholesaler contacts (name on invoices/register entries) |
| **Visitors** | Individuals recorded in visitor logs |
| **Children** | Patients under 12 whose age is recorded on CD prescriptions (legal requirement) |

---

## 4. Complete Personal Data Inventory

### 4.1 Staff & User Data

#### Table: `auth.users` (Supabase Auth)

| Data Element | Column/Field | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Email address | `email` | User input at registration | Authentication, account management | Art. 6(1)(b) Contract | None external |
| Phone number | `phone` | User input | 2FA, account recovery | Art. 6(1)(b) Contract | None external |
| Password hash | `encrypted_password` | User input | Authentication | Art. 6(1)(b) Contract | None external |
| Account type | `raw_user_meta_data.account_type` | System | Route to correct profile table | Art. 6(1)(b) Contract | None external |
| Full name | `raw_user_meta_data.full_name` | User input | Profile creation trigger | Art. 6(1)(b) Contract | None external |
| GPhC number | `raw_user_meta_data.gphc_number` | User input | Professional verification | Art. 6(1)(c) Legal obligation (GPhC) | None external |
| Organisation name | `raw_user_meta_data.org_name` | User input | Org creation trigger | Art. 6(1)(b) Contract | None external |
| GPhC premises number | `raw_user_meta_data.gphc_premises_number` | User input | Regulatory compliance | Art. 6(1)(c) Legal obligation | None external |

#### Table: `ps_user_profiles`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Full name | `full_name` | User input / auth trigger | Display name, CD register attribution | Art. 6(1)(b) Contract | Visible to org members |
| Email | `email` | Auth trigger | Contact, notifications | Art. 6(1)(b) Contract | Visible to org members |
| GPhC registration number | `gphc_number` | User input | RP log entries, professional verification | Art. 6(1)(c) Legal obligation | Stored in register entries, NHS claims |
| Phone number | `phone` | User input | Contact | Art. 6(1)(b) Contract | None external |
| Job role | `default_role` | User/admin input | RBAC, permissions | Art. 6(1)(b) Contract | None external |
| Avatar URL | `avatar_url` | User upload | Profile display | Art. 6(1)(a) Consent | None external |

#### Table: `ps_organisation_members`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| User-organisation link | `user_id`, `organisation_id` | Admin action | Multi-tenancy, access control | Art. 6(1)(b) Contract | None external |
| Role & permissions | `role`, `permissions` | Admin set | RBAC | Art. 6(1)(b) Contract | None external |
| Approval record | `approved_by`, `approved_at` | Admin action | Governance trail | Art. 6(1)(f) Legitimate interest | None external |
| Activity timestamp | `last_active_at` | System | Session management | Art. 6(1)(f) Legitimate interest | None external |

#### Table: `ps_public_pharmacists`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| GPhC number | `gphc_number` | User input | Public RP certificate lookup | Art. 6(1)(c) Legal obligation (RP Regs) | **Publicly accessible** (anon read) |
| Full name | `full_name` | User input | RP certificate display | Art. 6(1)(c) Legal obligation | **Publicly accessible** |

> **Note:** This table has fully public RLS policies (anyone can read, insert, update). This is by design for the Responsible Pharmacist certificate tool, but represents a public-facing personal data exposure.

---

### 4.2 Patient Data

#### Table: `ps_patients`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| First name | `first_name` | User input, patient self-registration, NHS PDS | Patient identification | Art. 6(1)(c) Legal obligation / Art. 9(2)(h) Healthcare | NHSBSA (in claims) |
| Last name | `last_name` | User input, patient self-registration, NHS PDS | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA (in claims) |
| Date of birth | `dob` | User input, NHS PDS | Patient identification, age verification for CDs | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA (in claims) |
| NHS number | `nhs_number` | User input, NHS PDS lookup | Unique patient identifier for NHS services/claims | Art. 6(1)(c) Legal obligation | NHS PDS, NHSBSA, NHS 111 |
| Email | `email` | Patient input | Patient portal login, messaging | Art. 6(1)(b) Contract / Art. 6(1)(a) Consent | GOV.UK Notify (for email delivery) |
| Phone | `phone` | Patient input | SMS notifications, contact | Art. 6(1)(b) / Art. 6(1)(a) | GOV.UK Notify (for SMS delivery) |
| Address line 1 | `address_line_1` | Patient input, NHS PDS | Delivery address, CD register requirement, letter sending | Art. 6(1)(c) Legal obligation | GOV.UK Notify (letters), NHSBSA |
| Address line 2 | `address_line_2` | Patient input | Delivery address | Art. 6(1)(c) | GOV.UK Notify (letters) |
| City | `city` | Patient input | Address | Art. 6(1)(c) | GOV.UK Notify (letters) |
| Postcode | `postcode` | Patient input, NHS PDS | Address, delivery routing | Art. 6(1)(c) | GOV.UK Notify (letters), NHSBSA |
| Auth user link | `auth_user_id` | System | Patient portal authentication | Art. 6(1)(b) Contract | None external |

**Special category note:** Patient records inherently relate to healthcare provision. Processing relies on **Art. 9(2)(h)** — necessary for healthcare purposes, managed by a health professional bound by confidentiality.

---

### 4.3 Prescriber / Healthcare Professional Data

#### Table: `ps_known_contacts` (contact_type = 'prescriber')

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Full name | `full_name`, `first_name`, `last_name` | CD register entries (auto-learned), manual input | Prescriber identification on register | Art. 6(1)(c) Legal obligation (MDR 2001) | None external |
| Address | `address_line_1`, `address_line_2`, `city`, `postcode` | CD register entries, manual input | Legal requirement for CD register | Art. 6(1)(c) Legal obligation | None external |
| GMC number | `gmc_number` | Manual input, AI scan | Professional identification | Art. 6(1)(c) Legal obligation | None external |
| GPhC number | `gphc_number` | Manual input | Professional identification (pharmacist prescribers) | Art. 6(1)(c) | None external |
| Prescriber type | `prescriber_type` | Manual input | Categorisation | Art. 6(1)(c) | None external |

#### Table: `ps_known_contacts` (contact_type = 'patient')

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Full name | `full_name` | Auto-learned from register entries | Autocomplete in register entry forms | Art. 6(1)(f) Legitimate interest | None |
| NHS number | `nhs_number` | Manual input | Patient lookup | Art. 6(1)(c) | None external |
| Date of birth | `date_of_birth` | Manual input | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | None external |
| Address | `address_line_1` etc. | Auto-learned | Autocomplete | Art. 6(1)(f) | None external |

---

### 4.4 Locum Pharmacist Data

#### Table: `ps_locum_profiles` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| GPhC number | `gphc_number` | Locum input | Professional verification | Art. 6(1)(c) Legal obligation | Pharmacy organisations (when booked) |
| GPhC expiry | `gphc_expiry` | Locum input | Compliance checking | Art. 6(1)(c) | Pharmacy organisations |
| Indemnity provider | `indemnity_provider` | Locum input | Insurance verification | Art. 6(1)(c) | Pharmacy organisations |
| Indemnity expiry | `indemnity_expiry` | Locum input | Insurance compliance | Art. 6(1)(c) | Pharmacy organisations |
| Smart card status | `smart_card_held` | Locum input | NHS system access capability | Art. 6(1)(b) Contract | Pharmacy organisations |
| NHS email | `nhs_email` | Locum input | NHS system access | Art. 6(1)(b) | None external |
| DBS certificate number | `dbs_number` | Locum input | Criminal record check | Art. 6(1)(c) Legal obligation | Pharmacy organisations |
| DBS expiry | `dbs_expiry` | Locum input | DBS validity | Art. 6(1)(c) | Pharmacy organisations |
| **National Insurance number** | `ni_number` | Locum input | **Tax/payroll purposes** | Art. 6(1)(c) Legal obligation (HMRC) | Potentially Stripe (payments) |
| Address | `address_line_1`, `address_line_2`, `city`, `postcode` | Locum input | Contact, invoicing | Art. 6(1)(b) Contract | None external |
| Stripe account ID | `stripe_account_id` | Stripe Connect onboarding | Payment processing | Art. 6(1)(b) Contract | **Stripe** |
| Stripe onboarding status | `stripe_onboarded` | Stripe | Payment readiness | Art. 6(1)(b) | None external |

> **High-risk data:** NI numbers and DBS numbers are sensitive identifiers. DBS data falls under the Rehabilitation of Offenders Act — special handling required.

#### Table: `ps_locum_documents` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Document files | `file_url` | Locum upload | Verification (Gov ID, DBS, Insurance, GPhC cert, Smart card, Qualifications) | Art. 6(1)(c) Legal obligation | Pharmacy organisations reviewing bookings |
| Document type | `doc_type` | System | Categorisation: `gov_id`, `dbs`, `insurance`, `gphc_cert`, `smart_card`, `qualification`, `other` | Art. 6(1)(c) | None external |
| Expiry date | `expiry_date` | Locum input | Compliance monitoring | Art. 6(1)(c) | None external |

> **Note:** Government-issued photo ID is uploaded as part of `gov_id` document type. This is sensitive identity documentation.

---

### 4.5 Controlled Drug Register Data

#### Table: `ps_register_entries`

This table contains **legally mandated** records under the Misuse of Drugs Regulations 2001. Entries are **immutable** (UPDATE/DELETE triggers raise exceptions). All entries are audit-logged.

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| **Patient name** | `patient_name` | Manual input, AI scan | **Legal requirement** for CD supply entries | Art. 6(1)(c) MDR 2001 Reg. 19 | None external (inspectable by GPhC/HO) |
| **Patient address** | `patient_address` | Manual input, AI scan | **Legal requirement** for CD supply entries | Art. 6(1)(c) MDR 2001 Reg. 19 | None external (inspectable) |
| **Prescriber name** | `prescriber_name` | Manual input, AI scan | **Legal requirement** for CD entries | Art. 6(1)(c) MDR 2001 | None external (inspectable) |
| **Prescriber address** | `prescriber_address` | Manual input, AI scan | **Legal requirement** | Art. 6(1)(c) MDR 2001 | None external (inspectable) |
| Prescriber registration | `prescriber_registration` | Manual input, AI scan | GMC/GPhC number | Art. 6(1)(c) | None external |
| Prescription date | `prescription_date` | Manual input, AI scan | Legal register requirement | Art. 6(1)(c) | None external |
| Prescription image | `prescription_image_path` | Camera capture | Evidence/audit trail | Art. 6(1)(c) | None external |
| **Witness name** | `witness_name` | Manual input | CD destruction witness (legal requirement) | Art. 6(1)(c) MDR 2001 | None external |
| Witness role | `witness_role` | Manual input | Witness qualification | Art. 6(1)(c) | None external |
| Authorised by | `authorised_by` | Manual input | Authorisation trail | Art. 6(1)(c) | None external |
| **Pharmacist name** (RP entries) | `pharmacist_name` | Manual input | Responsible Pharmacist log | Art. 6(1)(c) RP Regulations 2008 | None external |
| **GPhC number** (RP entries) | `gphc_number` | Manual input | Responsible Pharmacist identification | Art. 6(1)(c) RP Regs | None external |
| RP sign-in/out times | `rp_signed_in_at`, `rp_signed_out_at` | Manual input | Legal RP duty period recording | Art. 6(1)(c) | None external |
| **Return patient name** | `return_patient_name` | Manual input | Patient returns register | Art. 6(1)(c) | None external |
| Return received by | `return_received_by` | Manual input | Staff attribution | Art. 6(1)(c) | None external |
| Disposal witness | `disposal_witness` | Manual input | CD destruction witness | Art. 6(1)(c) | None external |
| Supplier name | `supplier_name` | Manual input, AI scan | Receipt entries | Art. 6(1)(c) | None external |
| ID requested/provided flags | `was_id_requested`, `was_id_provided` | Manual input | CD collection ID verification | Art. 6(1)(c) | None external |
| Who entered the entry | `entered_by` (FK to user) | System | Audit attribution | Art. 6(1)(c) | None external |
| Scan image path | `scan_image_path` | Camera capture | Source document reference | Art. 6(1)(c) | None external |

> **CRITICAL:** CD register entries are legally required to be retained for **2 years** from the date of the last entry in the register (Misuse of Drugs Regulations 2001, Reg. 23). Entries are immutable in the system — corrections are made via new correction entries, never by modifying originals.

---

### 4.6 NHS PDS & Claims Data

#### Table: `nhs_patient_pds_cache`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| **NHS number** | `nhs_number` (PK) | **NHS PDS FHIR API** | Unique NHS patient identifier | Art. 6(1)(c) NHS legal framework | NHS PDS (source), NHSBSA (claims) |
| Family name | `pds_family_name` | NHS PDS API | Patient identification for claims | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA |
| Given names | `pds_given_names` (text[]) | NHS PDS API | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA |
| Date of birth | `pds_dob` | NHS PDS API | Patient verification | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA |
| Gender | `pds_gender` | NHS PDS API | NHS reporting | Art. 6(1)(c) / Art. 9(2)(h) | NHSBSA |
| Address line 1 | `pds_address_line1` | NHS PDS API | Correspondence | Art. 6(1)(c) | NHSBSA |
| Postcode | `pds_address_postcode` | NHS PDS API | Address verification | Art. 6(1)(c) | NHSBSA |
| GP practice ODS code | `pds_gp_ods` | NHS PDS API | Claim routing, GP identification | Art. 6(1)(c) | NHSBSA |
| Restricted patient flag | `pds_restricted` | NHS PDS API | Confidentiality flag (S-flagged patients) | Art. 6(1)(c) | None — prevents data display |
| Full PDS FHIR response | `full_pds_response` (JSONB) | NHS PDS API | **Raw FHIR Patient resource** — may contain additional demographics | Art. 6(1)(c) | None external |
| Verified by (user) | `verified_by` | System | Audit trail | Art. 6(1)(c) | None external |

> **Cache TTL:** PDS cache entries are considered stale after 24 hours. Re-verification occurs before claim submission.

#### Table: `nhs_claim_submissions`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Patient reference | `patient_id` (FK) | System | Link to patient record | Art. 6(1)(c) | None external |
| **Full claim payload** | `payload` (JSONB) | System-constructed | **Contains: NHS number, GP ODS code, assessment date, consultation method, clinical outcomes, drug codes, quantities** | Art. 6(1)(c) NHS Advanced Service specifications | **NHSBSA** |
| BSA response | `bsa_response` (JSONB) | **NHSBSA API** | Claim acceptance/rejection | Art. 6(1)(c) | None external |
| Platform deposit ID | `platform_deposit_id` | System-generated | Unique claim identifier | Art. 6(1)(c) | **NHSBSA** |

**Payload contents by service type (all shared with NHSBSA):**

| Service | Additional Personal Data in Payload |
|---|---|
| **CPCS (Emergency Medicine / Minor Illness)** | NHS number, GP ODS, referral source ODS, disposition code, consultation outcome, drug supply details |
| **Pharmacy First (CCS)** | NHS number, GP ODS, presenting complaint, professional GPhC number, consultation outcome, drug supply, no-supply reason |
| **Flu/COVID Vaccination** | NHS number, GP ODS, dose number, vaccine product code, batch number |
| **NMS (New Medicines Service)** | NHS number, GP ODS, prescription date, medical conditions, medicine products, patient adherence |
| **Smoking Cessation (SCS)** | NHS number, GP ODS, quit date, NRT products, pregnancy status, e-cigarette use |
| **Contraception** | NHS number, GP ODS, service type (initiation/ongoing/emergency), contraception method, products, professional GPhC |
| **CVD Hypertension** | NHS number, GP ODS, blood pressure readings (systolic/diastolic/pulse), clinic test details, ABPM results |

#### Table: `nhs_submission_attempts`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Request payload | `request_payload` (JSONB) | System | **Full NHSBSA payload including patient NHS number, clinical data** | Art. 6(1)(c) | None (internal audit) |
| Response body | `response_body` (JSONB) | NHSBSA API | API response including any error details | Art. 6(1)(c) | None |
| Endpoint URL | `endpoint_url` | System | Which NHSBSA endpoint was called | Art. 6(1)(c) | None |

---

### 4.7 NHS 111 Referral Data

#### Table: `ps_nhs111_referrals` (inferred from edge function + types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| **Patient NHS number** | `patient_nhs_number` | **NHS 111 FHIR Bundle** | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | None further (received from NHS 111) |
| **Patient name** | `patient_name` | NHS 111 FHIR Bundle | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | None further |
| **Patient DOB** | `patient_dob` | NHS 111 FHIR Bundle | Patient identification | Art. 6(1)(c) / Art. 9(2)(h) | None further |
| **Patient address** | `patient_address` (JSONB) | NHS 111 FHIR Bundle | Contact/location | Art. 6(1)(c) / Art. 9(2)(h) | None further |
| **Patient phone** | `patient_phone` | NHS 111 FHIR Bundle | Contact | Art. 6(1)(c) / Art. 9(2)(h) | None further |
| GP ODS code | `patient_gp_ods_code` | NHS 111 FHIR Bundle | GP identification | Art. 6(1)(c) | None further |
| GP name | `patient_gp_name` | NHS 111 FHIR Bundle | GP identification | Art. 6(1)(c) | None further |
| **Disposition code/text** | `disposition_code`, `disposition_text` | NHS 111 CDSS | Clinical triage outcome | Art. 6(1)(c) / Art. 9(2)(h) | None further |
| **Presenting complaint** | `presenting_complaint` | NHS 111 FHIR Bundle | Clinical information | Art. 9(2)(h) | None further |
| **Encounter summary** | `encounter_summary` | NHS 111 FHIR Bundle | Clinical narrative | Art. 9(2)(h) | None further |
| **Care plan** | `care_plan` | NHS 111 FHIR Bundle | Treatment plan | Art. 9(2)(h) | None further |
| **Triage Q&A** | `triage_questions` (JSONB) | NHS 111 FHIR Bundle | Clinical assessment questions/answers | Art. 9(2)(h) | None further |
| Source ODS code | `source_ods_code` | NHS 111 FHIR Bundle | Referring organisation | Art. 6(1)(c) | None |
| **Raw FHIR bundle** | `raw_fhir_bundle` (JSONB) | **NHS 111 Report Adaptor** | Complete clinical referral bundle | Art. 9(2)(h) | None (stored as received) |

> **High sensitivity:** NHS 111 referrals contain detailed clinical triage data including symptoms, clinical assessments, and care plans. This is special category health data.

---

### 4.8 Messaging & Communication Data

#### Table: `ps_messages` (inferred from edge function)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Recipient phone number | `recipient_phone` | Patient record | SMS delivery | Art. 6(1)(b) / Art. 6(1)(a) Consent | **GOV.UK Notify** (SMS delivery) |
| Recipient email | `recipient_email` | Patient record | Email delivery | Art. 6(1)(b) / Art. 6(1)(a) | **GOV.UK Notify** (email delivery) |
| Recipient address | `recipient_address` (JSONB) | Patient record | Letter delivery | Art. 6(1)(b) / Art. 6(1)(a) | **GOV.UK Notify** (letter printing/postal) |
| Message body | `body` | Staff input | Communication content | Art. 6(1)(b) | **GOV.UK Notify** |
| Patient link | `patient_id` | System | Message attribution | Art. 6(1)(b) | None external |
| GOV.UK Notify message ID | `notify_message_id` | GOV.UK Notify | Delivery tracking | Art. 6(1)(b) | None external |

#### Table: `ps_broadcasts` (inferred from edge function)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Recipient filter | `recipient_filter` | Staff input | Determines which patients receive broadcast | Art. 6(1)(a) Consent | None external |
| Message content | `body`, `subject` | Staff input | Broadcast message text | Art. 6(1)(a) | **GOV.UK Notify** |

#### Table: `ps_notify_settings` (inferred from edge function)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| **GOV.UK Notify API key** | `api_key` | Admin input | **Contains cryptographic secrets for messaging** | Art. 6(1)(b) Contract | Used to authenticate with GOV.UK Notify |

---

### 4.9 Video Consultation Data

#### Table: `ps_video_consultations` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Patient name | `patient_name` | System/input | Consultation identification | Art. 6(1)(b) / Art. 9(2)(h) | **Daily.co** (room metadata) |
| Patient phone | `patient_phone` | Patient record | Access code delivery | Art. 6(1)(b) | None external |
| Daily.co room URL | `daily_room_url` | **Daily.co API** | Video session | Art. 6(1)(b) | **Daily.co** |
| Organisation token | `org_token` | Daily.co | Staff access | Art. 6(1)(b) | **Daily.co** |
| Patient token | `patient_token` | Daily.co | Patient access | Art. 6(1)(b) | **Daily.co** |
| Patient access code | `patient_access_code` | System-generated | Patient video room access | Art. 6(1)(b) | Shared with patient |

> **Note:** Video/audio streams flow through Daily.co infrastructure. While not stored in PharmStation's database, real-time health consultation content transits through a third-party processor.

---

### 4.10 AI Chat & Document Scanning Data

#### Table: `ps_chat_conversations` / `ps_chat_messages`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Chat messages | `content` | User input | AI-assisted pharmacy queries | Art. 6(1)(f) Legitimate interest | **OpenAI / Anthropic / Google** (AI providers) |
| Attachments | `attachments` (JSONB) | User upload | Image/PDF analysis | Art. 6(1)(f) | **AI providers** |
| Tool calls/results | `tool_calls`, `tool_name` | AI system | Function calling | Art. 6(1)(f) | **AI providers** |

> **Risk:** Users may input patient data into chat messages. This data is sent to third-party AI providers (OpenAI, Anthropic, Google) for processing. Data processing agreements with all providers should be in place.

#### Table: `ps_ai_scan_queue`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Scan image | `image_path`, `image_url` | Camera/upload | **Prescription/invoice images containing patient names, addresses, prescriber details** | Art. 6(1)(c) / Art. 9(2)(h) | **AI provider** (image sent for analysis) |
| Patient name (extracted) | `patient_name` | AI extraction | Pre-fill register | Art. 6(1)(c) | **AI provider** (in image) |
| Patient address (extracted) | `patient_address` | AI extraction | Pre-fill register | Art. 6(1)(c) | **AI provider** (in image) |
| Prescriber name (extracted) | `prescriber_name` | AI extraction | Pre-fill register | Art. 6(1)(c) | **AI provider** (in image) |
| Prescriber address (extracted) | `prescriber_address` | AI extraction | Pre-fill register | Art. 6(1)(c) | **AI provider** (in image) |
| Prescriber GMC/GPhC (extracted) | `prescriber_registration` | AI extraction | Pre-fill register | Art. 6(1)(c) | **AI provider** (in image) |
| Handwritten notes | `handwritten_notes` | AI extraction | Clinical annotations | Art. 6(1)(c) | **AI provider** (in image) |
| Raw AI response | `raw_ai_response` (JSONB) | AI provider | Full structured extraction | Art. 6(1)(c) | None (received from AI) |

#### Storage Bucket: `scan-images`

| Data Element | Details |
|---|---|
| Content | **Photographs of prescriptions and invoices** |
| Personal data contained | Patient names, patient addresses, prescriber details, drug details, dates, possibly patient NHS numbers |
| Max file size | 10 MB |
| Allowed types | JPEG, PNG, WebP, HEIC, HEIF |
| Access | Private bucket (not public), org-scoped |

---

### 4.11 Operational & Audit Data

#### Table: `ps_audit_log`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Full old record | `old_data` (JSONB) | Trigger | **Contains complete previous state of modified records — may contain patient names, addresses, NHS numbers** | Art. 6(1)(c) Legal obligation (audit trail) | None external |
| Full new record | `new_data` (JSONB) | Trigger | **Contains complete new state — same risk as above** | Art. 6(1)(c) | None external |
| Who made the change | `performed_by` | System | User attribution | Art. 6(1)(c) | None external |
| **IP address** | `ip_address` (INET) | System | Security audit | Art. 6(1)(f) Legitimate interest | None external |

> **Note:** The audit log effectively duplicates all personal data from every tracked table via JSONB snapshots. This is by design for legal compliance but must be considered in retention and access policies.

#### Table: `ps_active_sessions`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Terminal/device info | `terminal_id`, `terminal_name`, `platform` | System | Device tracking, concurrent session management | Art. 6(1)(f) | None external |
| Geolocation verification | `geo_verified` | System | Location-based security | Art. 6(1)(f) | None external |
| 2FA verification | `twofa_verified` | System | Authentication strength | Art. 6(1)(f) | None external |

#### Table: `ps_organisations`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Organisation name | `name` | Registration | Business identification | Art. 6(1)(b) | Public (if `is_public = true`) |
| GPhC premises number | `gphc_premises_number` | Registration | Regulatory identification | Art. 6(1)(c) | None |
| Address | `address` (JSONB) | Registration | Business address | Art. 6(1)(b) | Public (if `is_public = true`) |
| Geolocation | `geolocation` (POINT) | Registration/geocoding | Geo-fencing, delivery routing | Art. 6(1)(f) | None external |
| **ODS code** | `ods_code` | Admin input | NHS organisation identifier | Art. 6(1)(c) | NHSBSA, NHS PDS, NHS 111 |
| NHS BSA environment | `nhs_bsa_environment` | Admin input | Staging/production routing | Art. 6(1)(b) | None |
| Public slug | `slug` | Admin input | Public URL | Art. 6(1)(b) | Public |
| Public logo URL | `public_logo_url` | Admin upload | Branding | Art. 6(1)(b) | Public |

---

### 4.12 Delivery System Data

#### Table: `ps_patient_medications`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Drug name, form, strength | `drug_name`, `drug_form`, `drug_strength` | Staff input | **Patient's regular medication list — health data** | Art. 9(2)(h) Healthcare | None external |
| Dose | `dose` | Staff input | Dosage instructions | Art. 9(2)(h) | None external |
| Quantity | `quantity` | Staff input | Supply quantity | Art. 9(2)(h) | None external |
| Notes | `notes` | Staff input | May contain clinical notes | Art. 9(2)(h) | None external |

#### Table: `ps_delivery_rounds`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Driver assignment | `driver_id` | Staff input | Delivery allocation | Art. 6(1)(b) | None external |

#### Table: `ps_delivery_round_patients`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Delivery address | `delivery_address_line_1`, `delivery_address_line_2`, `delivery_city`, `delivery_postcode` | Patient record / manual override | **Physical delivery location** | Art. 6(1)(b) / Art. 9(2)(h) | None external |
| **Signature data** | `signature_data` | Patient/recipient capture | **Proof of delivery — handwriting biometric** | Art. 6(1)(b) Contract | None external |
| Delivery timestamp | `delivered_at` | System | Proof of delivery | Art. 6(1)(b) | None external |
| Failure reason | `failure_reason` | Driver input | Failed delivery documentation | Art. 6(1)(b) | None external |

#### Table: `ps_delivery_location_updates`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| **GPS coordinates** | `latitude`, `longitude` | **Driver device GPS** | Real-time delivery tracking | Art. 6(1)(f) Legitimate interest | None external |
| Timestamps | `recorded_at` | System | Location history | Art. 6(1)(f) | None external |

> **Worker monitoring:** GPS tracking of delivery drivers constitutes employee monitoring. Requires clear staff privacy notice and potentially DPIA.

---

### 4.13 Pharmacy Network (P2P) Data

#### Table: `ps_network_messages` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Message body | `body` | Staff input | Inter-pharmacy communication — **may contain patient-identifiable information in prescription queries** | Art. 6(1)(f) Legitimate interest | Receiving pharmacy organisation |
| Subject | `subject` | Staff input | Message categorisation | Art. 6(1)(f) | Receiving pharmacy |

#### Table: `ps_network_sms_contacts` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Phone number | `phone_number` | Staff input | SMS ping notifications when network messages arrive | Art. 6(1)(b) | **GOV.UK Notify** (SMS delivery) |
| Availability hours | `notify_start`, `notify_end` | Staff input | Do-not-disturb preferences | Art. 6(1)(f) | None |

---

### 4.14 Log System Data

#### Table: `ps_log_entries`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Entry data | `data` (JSONB) | Staff input | **Dynamic fields — may contain personal data depending on log template** | Varies by template | None external |
| Entered by | `entered_by_user_id` | System | Staff attribution | Art. 6(1)(c) | None external |

**Log templates that collect personal data:**

| Template | Personal Data Fields | Category |
|---|---|---|
| **Visitor Log** | Visitor name, address/company, signature (canvas) | Art. 6(1)(f) Legitimate interest (security) |
| **CD Keys Log** | Received by (name), handed over by (name), signature (canvas) | Art. 6(1)(c) Legal obligation |
| **Cleaning Log** | Cleaned by (name), signed off by (name) | Art. 6(1)(c) GPhC standards |
| **Fridge Temperature Log** | Checked by (name) | Art. 6(1)(c) GPhC standards |
| **Date Checking Log** | Checked by (name) | Art. 6(1)(c) GPhC standards |

> **Canvas/signature fields** capture handwriting data which may be considered biometric-adjacent.

---

### 4.15 Locum Financial Data

#### Tables: `ps_locum_invoices`, `ps_locum_invoice_lines`, `ps_locum_payments`, `ps_locum_payment_mandates` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Invoice amounts | `subtotal_pence`, `platform_fee_pence`, `total_pence` | System-calculated | Payment processing | Art. 6(1)(b) Contract | None external |
| Invoice PDF | `pdf_url` | System-generated | Financial record | Art. 6(1)(b) | Locum + pharmacy |
| Stripe payment intent | `stripe_payment_intent` | **Stripe** | Payment processing | Art. 6(1)(b) | **Stripe** |
| Stripe transfer ID | `stripe_transfer_id` | **Stripe** | Payout tracking | Art. 6(1)(b) | **Stripe** |
| Stripe customer ID | `stripe_customer_id` | **Stripe** | Customer identification | Art. 6(1)(b) | **Stripe** |
| Stripe mandate ID | `stripe_mandate_id` | **Stripe** | Direct debit mandate | Art. 6(1)(b) | **Stripe** |
| Stripe payment method | `stripe_payment_method` | **Stripe** | Payment method reference | Art. 6(1)(b) | **Stripe** |

#### Table: `ps_locum_reviews`, `ps_locum_pharmacy_feedback`, `ps_locum_notes`

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Review scores | `score`, `punctuality`, `professionalism` | Staff/locum input | Performance evaluation | Art. 6(1)(f) Legitimate interest | Locum (aggregated), pharmacy (for reviews they gave) |
| Review notes | `notes` | Staff/locum input | Qualitative feedback — may contain personal opinions | Art. 6(1)(f) | As above |
| Internal notes | `note` (ps_locum_notes) | Staff input | **Private staff notes about locum — not visible to locum** | Art. 6(1)(f) | Within pharmacy org only |

#### Table: `ps_locum_blacklists` (inferred from types)

| Data Element | Column | Source | Purpose | Legal Basis | Shared With |
|---|---|---|---|---|---|
| Blacklist reason | `reason` | Staff input | Reason for blocking locum from shifts | Art. 6(1)(f) | Within pharmacy org only |

---

## 5. External Data Flows & Third-Party Sharing

| Third Party | Data Shared | Direction | Purpose | Contract Required |
|---|---|---|---|---|
| **NHS PDS (Personal Demographics Service)** | NHS number, patient name, DOB, address, gender, GP practice | Bidirectional (query → return) | Patient demographics verification | NHS Data Sharing Agreement |
| **NHSBSA (NHS Business Services Authority)** | NHS number, GP ODS code, clinical service data, drug codes/quantities, consultation dates/methods, professional identifiers | PharmStation → NHSBSA | Advanced service claim submission for payment | NHS Terms of Service, BSA registration |
| **NHS 111 (via FHIR Adaptor)** | Patient demographics, clinical triage data, disposition codes, care plans, encounter summaries | NHS 111 → PharmStation | Referral receipt for CPCS service | NHS 111 integration agreement |
| **GOV.UK Notify** | Patient phone numbers, email addresses, postal addresses, message content | PharmStation → GOV.UK Notify | SMS, email, letter delivery | GOV.UK Notify terms, DPIA |
| **Daily.co** | Video consultation room metadata, patient name (room context), real-time audio/video streams | PharmStation ↔ Daily.co | Video consultation infrastructure | Data Processing Agreement |
| **OpenAI** | Chat messages (may contain patient data), prescription/invoice images | PharmStation → OpenAI | AI chat, document scanning/OCR | Data Processing Agreement, Business Associate Agreement |
| **Anthropic** | Chat messages (may contain patient data), prescription/invoice images | PharmStation → Anthropic | AI chat, document scanning/OCR | Data Processing Agreement |
| **Google (Gemini)** | Chat messages (may contain patient data), prescription/invoice images | PharmStation → Google | AI chat, document scanning/OCR | Data Processing Agreement |
| **Stripe** | Locum NI number (potentially), payment amounts, bank details (via Stripe Connect), pharmacy payment methods | PharmStation ↔ Stripe | Locum payment processing | Stripe DPA, PCI DSS compliance |
| **Supabase (Hosting)** | All database data (as infrastructure provider) | Stored at rest | Database hosting, authentication, edge function execution | Supabase DPA |
| **NHS ODS API (Spine)** | GP practice ODS codes, practice names/addresses | PharmStation ← NHS ODS | GP practice lookup (public data, no auth) | None (public API) |

---

## 6. Storage & Retention

| Data Category | Storage Location | Retention Period | Legal Basis for Retention |
|---|---|---|---|
| **CD Register Entries** | Supabase PostgreSQL (`ps_register_entries`) | **Minimum 2 years** from last entry in register | Misuse of Drugs Regulations 2001, Reg. 23 |
| **RP Log Entries** | Supabase PostgreSQL (within `ps_register_entries` where `register_type = 'RP'`) | **Minimum 2 years** | Responsible Pharmacist Regulations 2008 |
| **Patient Records** | Supabase PostgreSQL (`ps_patients`) | **10 years** after last interaction (GPhC guidance) | GPhC Standards, NHS Records Management Code |
| **NHS Claim Submissions** | Supabase PostgreSQL (`nhs_claim_submissions`) | **6 years minimum** (NHS financial records) | NHS financial regulations |
| **NHS 111 Referrals** | Supabase PostgreSQL | **6 years** | NHS records retention |
| **PDS Cache** | Supabase PostgreSQL (`nhs_patient_pds_cache`) | **24-hour active cache** — historical entries retained for audit | NHS DSPT |
| **Prescription/Invoice Images** | Supabase Storage (`scan-images` bucket) | **To be determined** — recommend aligned with CD register retention | GPhC guidance |
| **Audit Logs** | Supabase PostgreSQL (`ps_audit_log`) | **Minimum 2 years**, recommend 7 years | Best practice, GPhC standards |
| **Chat Messages** | Supabase PostgreSQL (`ps_chat_messages`) | User-deletable (conversation deletion cascades) | Art. 5(1)(e) storage limitation |
| **Messaging Logs** | Supabase PostgreSQL (`ps_messages`) | **6 years** (NHS correspondence records) | NHS Records Management Code |
| **Locum Documents** | Supabase Storage | Until locum deactivates account + 6 years | Employment records, HMRC |
| **Locum Financial Data** | Supabase PostgreSQL | **6 years** (HMRC requirement) | Finance Act, HMRC regulations |
| **GPS Location Updates** | Supabase PostgreSQL (`ps_delivery_location_updates`) | **90 days** recommended, then purge | Data minimisation |
| **Video Consultation Records** | Supabase PostgreSQL (metadata only) | **10 years** (clinical record) | NHS Records Management Code |
| **Delivery Signatures** | Supabase PostgreSQL (`signature_data`) | Duration of patient relationship + 6 years | Proof of delivery |
| **User Profiles** | Supabase Auth + PostgreSQL | Until account deletion requested | Art. 6(1)(b) Contract |

---

## 7. Technical & Organisational Security Measures

### Database Security

- **Row Level Security (RLS):** Enabled on ALL tables. Policies enforce organisation-scoped access.
- **Multi-tenancy isolation:** `ps_get_user_org_ids()` SECURITY DEFINER function prevents RLS recursion while maintaining tenant isolation.
- **Immutable registers:** UPDATE and DELETE triggers raise exceptions on `ps_register_entries` and `ps_entry_annotations`.
- **Optimistic concurrency:** `lock_version` on ledgers prevents concurrent modification.
- **Audit triggers:** All critical tables have AFTER INSERT/UPDATE triggers writing to `ps_audit_log`.

### Authentication & Authorisation

- **Supabase Auth** with email/password + optional 2FA.
- **Three account types:** organisation, user (staff), patient — routed by auth trigger.
- **Role-based access control:** 6 roles (owner, manager, pharmacist, technician, dispenser, locum) with granular permissions.
- **Session tracking:** `ps_active_sessions` with geo-verification and 2FA verification flags.

### Data in Transit

- **HTTPS/TLS** for all API calls (Supabase enforces TLS).
- **NHS API calls:** TLS to PDS, NHSBSA, ODS endpoints.
- **Edge functions** execute in Supabase's Deno runtime (isolated per invocation).

### Access Controls

- Audit log access restricted to owner/manager roles only.
- Patient data scoped to organisation — cross-tenant queries impossible via RLS.
- `service_role` key used only by edge functions (server-side), never exposed to clients.

---

## 8. Special Category Data Assessment

Under **UK GDPR Article 9**, the following constitutes **special category data** processed by PharmStation:

| Special Category | Data Elements | Tables | Condition for Processing |
|---|---|---|---|
| **Health data** | Prescription details, medication records, clinical consultation outcomes, diagnoses (disposition codes), presenting complaints, triage data, care plans, blood pressure readings, vaccination records, smoking cessation data, contraception data, NMS adherence | `ps_register_entries`, `ps_patient_medications`, `nhs_claim_submissions`, `ps_nhs111_referrals`, `ps_service_deliveries`, `ps_ai_scan_queue` | **Art. 9(2)(h)** — necessary for healthcare provision under responsibility of health professional |
| **Biometric data (potential)** | Delivery signatures (`signature_data`), visitor log signatures (canvas fields) | `ps_delivery_round_patients`, `ps_log_entries` | **Art. 9(2)(h)** (delivery) / **Art. 9(2)(f)** (visitor security) — likely below biometric threshold but should be assessed |
| **Criminal conviction data** | DBS certificate number, DBS expiry (indicates existence of a check, not conviction content) | `ps_locum_profiles`, `ps_locum_documents` | **Art. 10** — Processing authorised by UK law. DBS numbers indicate a check was performed, not conviction data per se |
| **Trade union membership** | Not collected | N/A | N/A |
| **Genetic/racial/ethnic data** | Gender (from PDS) — may indirectly indicate; not explicitly collected | `nhs_patient_pds_cache` | Not explicitly processed for this purpose |

### Data Protection Impact Assessment (DPIA) Required For:

1. **NHS 111 referral processing** — Large-scale health data from automated clinical triage
2. **AI processing of prescription images** — Health data sent to third-party AI processors
3. **GPS tracking of delivery drivers** — Systematic monitoring of employees
4. **Patient broadcast messaging** — Large-scale automated communications
5. **PDS lookups and caching** — Accessing NHS national patient database
6. **Locum KYC data collection** — Government ID, DBS, NI numbers

---

## 9. Hardware & Software Asset Register

This section classifies all hardware, software, and cloud service assets used by PharmStation, with ownership and protection responsibilities assigned. All assets are owned and maintained by Champe Chilufya (SIRO) unless otherwise stated.

### 9.1 Cloud Services & Hosting Platforms

| ID | Asset | Type | Purpose | Location/Provider | Owner | Status |
|----|-------|------|---------|-------------------|-------|--------|
| CS-01 | **Supabase** (Project: xsqwpmqfbirqdncoephf) | Cloud BaaS | PostgreSQL database, RLS, auth, storage, edge functions, realtime | Supabase Cloud (AWS eu-west-2, London) | Champe Chilufya | Active |
| CS-02 | **Railway** (Project: pharmstation-nhs111) | Cloud PaaS | NHS 111 pipeline hosting (3 Docker services) | Railway Cloud | Champe Chilufya | Active |
| CS-03 | **Vercel** | Cloud PaaS | Production web frontend hosting | Vercel Edge Network | Champe Chilufya | Active |
| CS-04 | **GitHub** (champec/pharmstation) | Cloud SaaS | Source code repository, version control | GitHub Cloud | Champe Chilufya | Active |
| CS-05 | **GitHub Codespaces** | Cloud Dev Environment | Cloud-based development IDE | GitHub / Azure | Champe Chilufya | Active |
| CS-06 | **Hetzner VPS** (CX11, planned) | Cloud IaaS | Static IP reverse proxy (NGINX) for NHSBSA API access | Hetzner Cloud (UK) | Champe Chilufya | **Not yet provisioned** |
| CS-07 | **Mapbox** | Cloud SaaS | Map rendering for delivery route visualisation | Mapbox Cloud | Champe Chilufya | Active |
| CS-08 | **Daily.co** | Cloud SaaS | Video consultation room infrastructure | Daily.co Cloud | Champe Chilufya | Active |

### 9.2 NHS 111 Pipeline Infrastructure

All hosted on Railway. Containerised via Docker.

| ID | Asset | Image/Version | Purpose | Owner | Status |
|----|-------|---------------|---------|-------|--------|
| NP-01 | **NHS 111 Adaptor** | nhsdev/nia-111-adaptor:1.0.5-amd64 | Receives ITK SOAP/CDA XML, converts to FHIR STU3, publishes to RabbitMQ | Champe Chilufya | Active (development) |
| NP-02 | **RabbitMQ** | rabbitmq:3-management-alpine | AMQP message broker for FHIR encounter reports | Champe Chilufya | Active (development) |
| NP-03 | **NHS 111 Bridge** | Custom Node.js 18 Alpine | AMQP consumer → HTTPS forwarder to Supabase edge function | Champe Chilufya | Active (development) |
| NP-04 | **NGINX mTLS Proxy** (planned) | nhsdev/nia-111-nginx-adaptor | Mutual TLS termination for live NHS 111 network | Champe Chilufya | **Not yet deployed** |

### 9.3 Supabase Edge Functions

All Deno-based serverless functions deployed to Supabase Edge (Deno Deploy).

| ID | Function | Purpose | Owner | Status |
|----|----------|---------|-------|--------|
| EF-01 | nhs111-receive | Parses FHIR STU3 Bundle from NHS 111 pipeline | Champe Chilufya | Active |
| EF-02 | get-ods-dos-codes | Returns allowed ODS/DoS codes for adaptor validation | Champe Chilufya | Active |
| EF-03 | nhs-claim-cpcs | NHSBSA CPCS claim submission | Champe Chilufya | Stubbed |
| EF-04 | nhs-claim-nms | NHSBSA NMS claim submission | Champe Chilufya | Stubbed |
| EF-05 | nhs-claim-scs | NHSBSA Smoking Cessation claim submission | Champe Chilufya | Stubbed |
| EF-06 | nhs-claim-cvd | NHSBSA CVD/Hypertension claim submission | Champe Chilufya | Stubbed |
| EF-07 | nhs-claim-contraception | NHSBSA Contraception claim submission | Champe Chilufya | Stubbed |
| EF-08 | nhs-pds-lookup | NHS PDS FHIR patient demographics lookup | Champe Chilufya | Active |
| EF-09 | nhs-gp-search | DoHS API GP practice search | Champe Chilufya | Active |
| EF-10 | nhs-notify | GOV.UK Notify messaging integration | Champe Chilufya | Active |
| EF-11 | ai-chat | LLM-powered pharmacy assistant ("Genie") | Champe Chilufya | Active |
| EF-12 | ai-scan | AI prescription/invoice OCR and data extraction | Champe Chilufya | Active |

### 9.4 Database & Managed Services

| ID | Asset | Type | Purpose | Owner | Status |
|----|-------|------|---------|-------|--------|
| DB-01 | **PostgreSQL** (via Supabase) | Managed Database | Primary data store — 34+ tables, 18 migrations, RLS on all tables | Champe Chilufya | Active |
| DB-02 | **Supabase Realtime** | Managed Service | WebSocket change broadcasting for live UI updates | Champe Chilufya | Active |
| DB-03 | **Supabase Auth** | Managed Service | User authentication, sessions, 2FA | Champe Chilufya | Active |
| DB-04 | **Supabase Storage** | Managed Service | File storage (prescription images, locum documents, avatars) | Champe Chilufya | Active |

### 9.5 Application Software

| ID | Asset | Version | Purpose | Platform | Owner | Status |
|----|-------|---------|---------|----------|-------|--------|
| APP-01 | **@pharmstation/web** | 0.1.0 | Main web application (React 19, Vite, React Router v7) | Vercel / Browser | Champe Chilufya | Active |
| APP-02 | **@pharmstation/desktop** | 0.1.0 | Tauri desktop app (Rust + web frontend) | Windows/macOS/Linux | Champe Chilufya | Scaffolded |
| APP-03 | **@pharmstation/mobile** | 0.1.0 | React Native mobile app | iOS/Android | Champe Chilufya | Scaffolded |
| APP-04 | **nhs111-sandbox** | 1.0.0 | ITK SOAP test tool (React + Express) | Local dev only | Champe Chilufya | Active |

### 9.6 Internal Shared Packages

| ID | Package | Version | Purpose | Owner |
|----|---------|---------|---------|-------|
| PKG-01 | @pharmstation/core | 0.1.0 | Business logic, Zustand stores, Supabase API calls, Zod validation | Champe Chilufya |
| PKG-02 | @pharmstation/types | 0.1.0 | Shared TypeScript types and Zod schemas | Champe Chilufya |
| PKG-03 | @pharmstation/supabase-client | 0.1.0 | Typed Supabase client wrapper | Champe Chilufya |
| PKG-04 | @pharmstation/ui | 0.1.0 | Shared React UI component library | Champe Chilufya |
| PKG-05 | @pharmstation/ai | 0.1.0 | AI integration (OCR, chat, reconciliation) | Champe Chilufya |

### 9.7 Build Tools & Developer Infrastructure

| ID | Asset | Version | Purpose | Owner |
|----|-------|---------|---------|-------|
| BT-01 | Turborepo | ^2.8.7 | Monorepo build orchestration | Champe Chilufya |
| BT-02 | pnpm | 9.15.0 | Workspace-aware package manager | Champe Chilufya |
| BT-03 | Node.js | >=20.0.0 | JavaScript/TypeScript runtime | Champe Chilufya |
| BT-04 | Vite | ^6.0.0 | Frontend dev server and production bundler | Champe Chilufya |
| BT-05 | TypeScript | ^5.7.0 | Static type checking | Champe Chilufya |
| BT-06 | ESLint | Shared config | Code quality enforcement | Champe Chilufya |
| BT-07 | Prettier | Shared config | Code formatting | Champe Chilufya |
| BT-08 | Docker | System | Container runtime for NHS 111 pipeline | Champe Chilufya |
| BT-09 | Supabase CLI | Latest | Edge function deployment, local dev | Champe Chilufya |
| BT-10 | Tauri CLI | Latest | Desktop app build and development | Champe Chilufya |

### 9.8 Key Third-Party Libraries

| ID | Library | Version | Purpose | Classification |
|----|---------|---------|---------|----------------|
| LIB-01 | React | ^19.0.0 | UI framework | Supported |
| LIB-02 | React Router DOM | ^7.1.0 | Client-side routing | Supported |
| LIB-03 | Zustand | ^5.0.0 | State management | Supported |
| LIB-04 | @supabase/supabase-js | ^2.49.0 | Supabase SDK | Supported |
| LIB-05 | Zod | ^3.24.0 | Runtime schema validation | Supported |
| LIB-06 | React Hook Form | ^7.54.0 | Form management | Supported |
| LIB-07 | @tanstack/react-table | ^8.21.0 | Table component | Supported |
| LIB-08 | TipTap | ^3.20.0 | Rich text editor (SOPs) | Supported |
| LIB-09 | FullCalendar | ^6.1.20 | Calendar UI | Supported |
| LIB-10 | @daily-co/daily-js | ^0.87.0 | Video calling SDK | Supported |
| LIB-11 | mapbox-gl | ^3.19.0 | Map rendering | Supported |
| LIB-12 | amqplib | ^0.10.4 | AMQP client (NHS 111 Bridge) | Supported |

### 9.9 NHS API & External Service Integrations

| ID | Service | Type | Purpose | Owner | Status |
|----|---------|------|---------|-------|--------|
| NHS-01 | NHS PDS FHIR API | External API | Patient demographics lookup | Champe Chilufya | Not yet onboarded |
| NHS-02 | NHS DoHS v3 API | External API | GP practice search | Champe Chilufya | Not yet onboarded |
| NHS-03 | NHS DoS UEC REST API | External API | NHS 111 pharmacy routing | Champe Chilufya | Not yet onboarded |
| NHS-04 | NHSBSA MYS APIs | External API | NHS claim submission (CPCS, Flu, NMS, SCS, CVD, Contraception) | Champe Chilufya | Awaiting staging credentials |
| NHS-05 | NHS 111 ITK SOAP | External API | Receive ITK SOAP referrals | Champe Chilufya | Pipeline built, not live |
| NHS-06 | NHS Notify API | External API | Patient messaging via NHS App | Champe Chilufya | Feature built |
| NHS-07 | NHS ODS FHIR API | External API | Organisation lookup by ODS code | Champe Chilufya | Open access, active |
| NHS-08 | NHS Developer Portal | SaaS | App registration, API keys | Champe Chilufya | Active (App ID: 04cc89f0) |

### 9.10 Asset Summary

| Category | Count |
|----------|-------|
| Cloud services & hosting | 8 |
| NHS 111 pipeline components | 4 |
| Edge functions | 12 |
| Database & managed services | 4 |
| Application software | 4 |
| Internal packages | 5 |
| Build tools | 10 |
| Third-party libraries | 12 |
| NHS API integrations | 8 |
| **Total classified assets** | **67** |

**Unsupported systems:** None identified. All third-party libraries and services are current, maintained, and within vendor support periods. Node.js >=20 is an Active LTS release. All Docker images use current tags.

**Protection responsibilities:** All assets owned by Champe Chilufya (SIRO). As a sole-operator organisation, all protection responsibilities (patching, access control, credential management, monitoring) rest with the SIRO until additional team members are onboarded.

---

## Review & Approval Record

| Date | Reviewer | Role | Action |
|------|----------|------|--------|
| 4 March 2026 | Champe Chilufya | SIRO / IG Lead / Caldicott Guardian | Created and approved initial combined IAR/ROPA |
| 4 March 2026 | Champe Chilufya | SIRO | Added hardware & software asset classification (Section 9) |

This register will be reviewed at minimum every 6 months, or whenever significant changes are made to data processing activities (e.g., new NHS service integrations, new sub-processors, new data categories).

*Next scheduled review: 4 September 2026*
