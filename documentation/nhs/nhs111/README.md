# NHS 111 Referral Integration

> **Last Updated:** 28 February 2026
> **Status:** Phase 1 — Planning & Foundation

## Overview

PharmStation needs to receive NHS 111 referral messages so pharmacies can provide Pharmacy First consultations (Minor Illness, Emergency Medicine, Clinical Pathways) and get paid for them.

When a patient calls 111 and is triaged to a community pharmacy, NHS 111 sends a referral message to the pharmacy's system. This message contains patient demographics, presenting complaint, triage outcome (disposition), care plan advice, and encounter history.

## How NHS 111 Messaging Works

### The Message Format

NHS 111 sends messages in a legacy format:

- **ITK 2.2** — the envelope/addressing standard
- **SOAP** — the transport protocol
- **CDA XML** — the clinical document inside (patient details, triage, disposition)

This is an old standard from ~2013 that all GP systems (EMIS, TPP) speak. NHS 111 has not been updated to send modern JSON/FHIR — it only speaks ITK SOAP/CDA.

### The 111 Report Adaptor

NHS Digital provides a free, open-source Docker-based adaptor that:

1. **Receives** ITK SOAP/CDA XML messages on a `/report` endpoint
2. **Validates** ITK headers (ODS codes, DoS service IDs)
3. **Converts** the CDA XML into a clean **FHIR STU3 JSON Bundle**
4. **Outputs** the JSON to an AMQP message queue (ActiveMQ or RabbitMQ)

**GitHub:** https://github.com/NHSDigital/integration-adaptor-111
**Docker Hub:** NHS 111 Report Adaptor image
**Status:** Live (Beta private)
**Latest version:** 1.0.5-arm64 / 1.0.5-amd64

### The FHIR Bundle Output

The adaptor converts each ITK message into a FHIR Bundle containing ~22 resources:

| Resource | Description |
|----------|-------------|
| `MessageHeader` | Event type: `referral-1` (actionable) or `discharge-details-1` (info only) |
| `Encounter` | The 111 call encounter — type, period, status |
| `Patient` | NHS number, name, DOB, address, GP practice |
| `Condition` | Clinical discriminator / presenting complaint |
| `ReferralRequest` | Disposition code + text (e.g. "Dx05 — To contact a Primary Care Service within 2 hours") |
| `CarePlan` | Self-care advice given to the patient |
| `Appointment` | If a slot was booked |
| `Questionnaire` | The pathways triage questions |
| `QuestionnaireResponse` | Patient's answers to triage questions |
| `Composition` | The full narrative report |
| `Consent` | Patient consent information |
| `Observation` | Presenting complaint (SNOMED: 33962009) |
| `Organization` | Referring org + destination org |
| `Practitioner` | 111 call handler / clinician |
| `Location` | Encounter location |
| `Device` | The adaptor itself |
| `ProcedureRequest` | Disposition / discharge code |
| `HealthcareService` | The healthcare service referred to |

### Event Types (from MessageHeader)

- **`referral-1` (Referral)** — Patient is being referred TO your pharmacy. You need to act on this.
- **`discharge-details-1` (Discharge Details)** — Copy for information only (e.g. patient's GP gets a copy). No action required.

## Architecture

### Production Architecture

```
NHS 111 Call Centre
       ↓ (ITK SOAP/CDA XML)
Railway.app (~$5/month):
  ┌──────────────────────────────────┐
  │  111 Adaptor (NHS Docker image)  │  ← receives SOAP, converts to FHIR JSON
  │         ↓                        │
  │  RabbitMQ (internal)             │  ← temporary buffer inside Docker
  │         ↓                        │
  │  Bridge script (20 lines)        │  ← reads queue, POSTs to Supabase
  └─────────────────┬────────────────┘
                    ↓ HTTPS POST
Supabase:
  ┌──────────────────────────────────┐
  │  Edge Function: nhs111-receive   │  ← receives FHIR JSON
  │         ↓                        │
  │  ps_nhs111_referrals table       │  ← permanent storage
  │         ↓                        │
  │  Supabase Realtime               │  ← push notification to UI
  └──────────────────────────────────┘
                    ↓
PharmStation UI: "🔔 New referral from 111!"
```

### Why This Architecture

1. **The 111 Adaptor is untouched** — we pull NHS Digital's Docker image as-is, never modify it, always get their updates
2. **RabbitMQ is internal** — it runs inside Docker because the adaptor expects AMQP output. It's not an external service.
3. **Bridge script is trivial** — ~20 lines that read from RabbitMQ and POST to Supabase. Rarely needs changes.
4. **Supabase does the real work** — Edge Function parses FHIR, stores referrals, triggers Realtime notifications

### Directory of Services (DoS)

NHS 111 looks up the pharmacy's endpoint in the **Directory of Services (DoS)** using the pharmacy's ODS code. The adaptor validates incoming messages against a list of allowed ODS codes and DoS service IDs.

The adaptor can fetch allowed ODS codes dynamically via `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` — our existing `get-ods-dos-codes` Edge Function serves this.

### TLS Mutual Authentication

Production requires TLS-MA (mutual certificate exchange) between NHS 111 and the adaptor. This is handled by the adaptor's nginx proxy component. Certificates are obtained during NHS onboarding.

Not required for testing.

## Testing Strategy

### Local Testing (Docker Desktop)

The adaptor repo includes a **test harness** (`test-suite/`) — a UI where you can send fake ITK messages:

1. Run adaptor + RabbitMQ + bridge via Docker Compose
2. Open test harness
3. Send test messages (encounter reports, referrals)
4. Verify they arrive in `ps_nhs111_referrals` and show in the UI

### Railway Testing

Same as above but the adaptor is on Railway. Send test messages from local test harness to the Railway URL.

### Test Data

Example ITK XML payloads and corresponding FHIR JSON outputs are in the adaptor's `doc/` directory:
- `doc/xml/` — example ITK XML inputs
- `doc/json/` — corresponding FHIR JSON outputs

## Key Configuration (Adaptor Environment Variables)

| Variable | Purpose |
|----------|---------|
| `PEM111_AMQP_BROKER` | RabbitMQ connection URL |
| `PEM111_AMQP_QUEUE_NAME` | Queue name (e.g. `encounter-report`) |
| `PEM111_AMQP_PROTOCOL` | `"0-9-1"` for RabbitMQ |
| `PEM111_ITK_ODS_CODE_LIST` | Comma-separated allowed ODS codes |
| `PEM111_ITK_DOS_ID_LIST` | Comma-separated allowed DoS service IDs |
| `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` | URL to fetch ODS/DoS config dynamically |
| `PEM111_SOAP_VALIDATION_ENABLED` | `true` / `false` |
| `NGINX_PUBLIC_CERT` | TLS-MA server certificate (production only) |
| `NGINX_PRIVATE_CERT` | TLS-MA server private key (production only) |
| `NGINX_CLIENT_PUBLIC_CERT` | TLS-MA client certificate (production only) |

## References

- [NHS 111 API Standard](https://digital.nhs.uk/developer/api-catalogue/nhs-111)
- [NHS 111 Report Adaptor — GitHub](https://github.com/NHSDigital/integration-adaptor-111)
- [ITK to FHIR Mapping](https://github.com/NHSDigital/integration-adaptor-111/blob/main/doc/ITK_FHIR_mapping.md)
- [NHS 111 Domain Message Specification V2.1](https://digital.nhs.uk) (zip download)
- [Directory of Services API](https://digital.nhs.uk/developer/api-catalogue/directory-of-services)
