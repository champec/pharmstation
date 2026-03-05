# PharmStation — Supplier Register

**Organisation:** PharmStation (ODS: D8W5S)  
**Owner:** Champe Chilufya (SIRO)  
**Last Reviewed:** 5 March 2026  
**Next Review Due:** 5 September 2026  
**Classification:** OFFICIAL — SENSITIVE  

---

## Purpose

This register lists all suppliers that process personal data on behalf of PharmStation or provide IT services on which PharmStation's critical services rely, in accordance with DSPT evidence item 10.1.1 and UK GDPR Article 28 (processor obligations).

---

## Suppliers That Process Personal Data

| # | Supplier | Product / Service | Personal Data Processed | Contract Type | Contract Start | Contract End / Renewal | DPA in Place | Contact |
|---|----------|-------------------|------------------------|---------------|----------------|----------------------|-------------|---------|
| 1 | **Supabase Inc.** | Cloud database hosting (PostgreSQL), authentication, file storage, edge functions, realtime | All patient data, staff data, NHS numbers, clinical records, CD register entries, audit logs, locum data, prescription images | Online terms of service + DPA | February 2025 | Rolling (monthly billing, cancel anytime) | Yes (Supabase standard DPA) | support@supabase.io |
| 2 | **Railway Corp** | Container hosting (PaaS) for NHS 111 pipeline | NHS 111 referral data transits through Railway-hosted containers (adaptor, RabbitMQ, bridge) | Online terms of service | February 2026 | Rolling (usage-based billing) | Yes (Railway standard terms) | support@railway.app |
| 3 | **Vercel Inc.** | Frontend web application hosting | No personal data stored — static frontend assets only. Session tokens transit via Vercel edge network. | Online terms of service | January 2025 | Rolling (monthly) | Yes (Vercel DPA) | privacy@vercel.com |
| 4 | **OpenAI** | AI chat and document scanning (GPT models) | Chat messages (may contain patient data if entered by user), prescription/invoice images containing patient names, addresses, prescriber details | API terms of service + DPA (zero data retention / no training) | March 2025 | Rolling (API usage-based) | Yes (OpenAI Business DPA) | support@openai.com |
| 5 | **Anthropic** | AI chat (Claude models) | Chat messages (may contain patient data if entered by user) | API terms of service | January 2026 | Rolling (API usage-based) | Yes (Anthropic API terms, no training on inputs) | support@anthropic.com |
| 6 | **Google (Gemini)** | AI chat and document scanning (Gemini models) | Chat messages, prescription/invoice images | Google Cloud API terms | February 2026 | Rolling (API usage-based) | Yes (Google Cloud DPA) | cloud-support@google.com |
| 7 | **GOV.UK Notify** | Patient messaging — SMS, email, letters | Patient phone numbers, email addresses, postal addresses, message content | GOV.UK Notify terms of use (government service) | Not yet live | N/A — government service, no commercial contract | Covered by GOV.UK Notify terms | govuk-notify-support@digital.cabinet-office.gov.uk |
| 8 | **Daily.co** | Video consultation infrastructure | Video/audio streams (real-time, not stored by PharmStation), patient name in room metadata | Online terms of service + DPA | March 2025 | Rolling (monthly) | Yes (Daily.co DPA) | support@daily.co |
| 9 | **Stripe** | Locum pharmacist payment processing | Locum names, bank details, NI numbers (via Stripe Connect), payment amounts, invoice data | Stripe Connected Account Agreement | March 2025 | Rolling | Yes (Stripe DPA, PCI DSS compliant) | support@stripe.com |
| 10 | **GitHub (Microsoft)** | Source code repository, CI/CD, Dependabot, Codespaces | Source code (no patient data in code). GitHub Codespaces environment variables may contain API keys. | GitHub terms of service | January 2025 | Rolling (monthly) | Yes (GitHub DPA / Microsoft DPA) | support@github.com |
| 11 | **GoDaddy** | Domain registration and DNS for pharmstation.co.uk | No personal data processed — DNS records only | Domain registration agreement | 2024 | Annual renewal | N/A (no personal data) | support@godaddy.com |
| 12 | **Mapbox** | Map rendering for delivery route visualisation | GPS coordinates of delivery locations (patient addresses displayed on map) | Mapbox terms of service | 2025 | Rolling | Yes (Mapbox DPA) | support@mapbox.com |

---

## NHS Services (Not Suppliers — Data Sharing Partners)

These are NHS services where PharmStation exchanges data under NHS data sharing frameworks, not commercial supplier relationships:

| # | NHS Service | Data Exchanged | Relationship |
|---|-------------|---------------|-------------|
| 1 | **NHS PDS (Personal Demographics Service)** | NHS number, patient name, DOB, address, GP practice | PharmStation queries PDS on behalf of pharmacy customers (not yet onboarded) |
| 2 | **NHSBSA MYS APIs** | NHS number, clinical service data, claim payloads | PharmStation submits claims on behalf of pharmacy customers (awaiting staging credentials) |
| 3 | **NHS 111 (via ITK SOAP)** | Patient demographics, clinical triage data, referral details | PharmStation receives referrals on behalf of pharmacy customers (pipeline built, not live) |
| 4 | **NHS ODS API** | Organisation ODS codes, names, addresses | Public API, no personal data |

---

## Suppliers Providing IT Services for Critical Functions

| # | Supplier | Critical Service Dependency | Impact if Unavailable |
|---|----------|---------------------------|----------------------|
| 1 | **Supabase** | Database, authentication, storage, edge functions | **Total service outage** — PharmStation cannot function without Supabase |
| 2 | **Railway** | NHS 111 referral pipeline | NHS 111 referrals cannot be received (other services unaffected) |
| 3 | **Vercel** | Web frontend hosting | Users cannot access the web application (data remains safe in Supabase) |
| 4 | **OpenAI / Anthropic / Google** | AI chat and document scanning | AI features unavailable; manual data entry still works |
| 5 | **Daily.co** | Video consultations | Video consultations unavailable; all other features unaffected |
| 6 | **Stripe** | Locum payments | Locum payment processing delayed; clinical services unaffected |
| 7 | **GOV.UK Notify** | Patient messaging (SMS/email/letters) | Patient messaging unavailable; clinical services unaffected |

---

## Data Processing Agreements (DPA) Status

| Supplier | DPA Status | Notes |
|----------|-----------|-------|
| Supabase | In place (standard online DPA) | Covers GDPR, data location (AWS eu-west-2) |
| Railway | In place (standard terms) | Review for explicit GDPR DPA clause |
| Vercel | In place (standard DPA) | Minimal personal data exposure |
| OpenAI | In place (API business terms, zero retention) | Confirm no-training clause covers image data |
| Anthropic | In place (API terms) | Confirm no-training clause |
| Google | In place (Google Cloud DPA) | Confirm Gemini API covered |
| Daily.co | In place (standard DPA) | Review video data retention terms |
| Stripe | In place (Stripe DPA, PCI DSS) | Covers financial and identity data |
| GitHub | In place (Microsoft DPA) | No patient data in repository |
| Mapbox | In place (standard DPA) | GPS coordinate data only |
| GOV.UK Notify | Government service terms | Not a commercial DPA — government terms apply |
| GoDaddy | N/A | No personal data processed |

---

## Review Record

| Date | Reviewer | Action |
|------|----------|--------|
| 5 March 2026 | Champe Chilufya (SIRO) | Created initial supplier register. All suppliers identified from ROPA and IAR. DPA status reviewed. |

---

*This register will be reviewed at minimum every 6 months, or when new suppliers are added.*
