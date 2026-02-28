# NHS 111 Referral Pipeline — Complete Documentation

> **Status:** ✅ End-to-End Working (28 February 2026)
> **Author:** PharmStation Engineering
> **Last Updated:** 28 February 2026
> **Classification:** Internal — Technical Documentation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Pipeline Components](#3-pipeline-components)
4. [Database Schema](#4-database-schema)
5. [Environment Variables Reference](#5-environment-variables-reference)
6. [Deployment (Railway)](#6-deployment-railway)
7. [Test Suite (NHS 111 Sandbox)](#7-test-suite-nhs-111-sandbox)
8. [Frontend Integration](#8-frontend-integration)
9. [Issues Encountered & Solutions](#9-issues-encountered--solutions)
10. [Go-Live Checklist](#10-go-live-checklist)
11. [Monitoring & Operations](#11-monitoring--operations)
12. [File Reference](#12-file-reference)

---

## 1. Overview

PharmStation receives NHS 111 patient referrals through a real-time pipeline. When NHS 111 triages a patient and identifies a pharmacy service need (e.g., urgent medication, minor illness), the system routes the referral directly to the pharmacy's queue in PharmStation.

### What Problem This Solves

Currently, NHS 111 referrals arrive via fax, email, or legacy systems like PharmOutcomes. PharmStation replaces this with a fully automated digital pipeline — referrals arrive in real-time, appear on the pharmacy dashboard instantly via Supabase Realtime, and can be actioned immediately.

### End-to-End Message Flow

```
NHS 111 System
    │
    │  ITK SOAP/CDA XML message (HL7 CDA R2 document)
    ▼
┌──────────────────────────────────────────────┐
│  NHS 111 Adaptor (nhsdev/nia-111-adaptor)    │
│  • Receives ITK SOAP on port 8080            │
│  • Validates incoming XML (when enabled)      │
│  • Checks ODS code is in allowed list         │
│  • Converts CDA XML → FHIR STU3 JSON Bundle  │
│  • Publishes to RabbitMQ via JMS/AMQP         │
└──────────────┬───────────────────────────────┘
               │
               │  FHIR STU3 JSON via AMQP (JMS)
               │  Exchange: jms.durable.queues
               │  Routing key: encounter-report
               ▼
┌──────────────────────────────────────────────┐
│  RabbitMQ (rabbitmq:3-management-alpine)     │
│  • Queue: encounter-report                   │
│  • Durable, persists across restarts         │
│  • Exchange: jms.durable.queues (direct)     │
└──────────────┬───────────────────────────────┘
               │
               │  AMQP consume (prefetch=1)
               ▼
┌──────────────────────────────────────────────┐
│  NHS 111 Bridge (Node.js / amqplib)          │
│  • Consumes from encounter-report queue      │
│  • Forwards FHIR JSON via HTTPS POST         │
│  • Acks on success, nacks+requeues on failure│
│  • Retry with backoff on errors              │
└──────────────┬───────────────────────────────┘
               │
               │  HTTPS POST (Bearer token auth)
               ▼
┌──────────────────────────────────────────────┐
│  Supabase Edge Function: nhs111-receive      │
│  • Parses FHIR STU3 Bundle                   │
│  • Extracts patient, encounter, conditions   │
│  • Maps ODS code → pharmacy org_id           │
│  • Inserts into ps_nhs111_referrals          │
│  • Returns 201 Created                       │
└──────────────┬───────────────────────────────┘
               │
               │  Database insert
               ▼
┌──────────────────────────────────────────────┐
│  Supabase Database (ps_nhs111_referrals)     │
│  • Realtime enabled → broadcasts changes     │
│  • RLS secured per organisation              │
│  • Trigger updates updated_at automatically  │
└──────────────┬───────────────────────────────┘
               │
               │  Realtime subscription (WebSocket)
               ▼
┌──────────────────────────────────────────────┐
│  PharmStation Web/Desktop UI                 │
│  • NHS 111 Queue page (real-time list)       │
│  • Referral Detail page (full patient info)  │
│  • Accept / Reject / Complete actions        │
└──────────────────────────────────────────────┘
```

---

## 2. Architecture

### Infrastructure Hosting

| Component | Host | Notes |
|-----------|------|-------|
| NHS 111 Adaptor | Railway (Docker) | `nhsdev/nia-111-adaptor:1.0.5-amd64` |
| RabbitMQ | Railway (Docker) | `rabbitmq:3-management-alpine` |
| Bridge | Railway (Docker) | Custom Node.js from `infrastructure/nhs111/bridge/` |
| Edge Functions | Supabase | `nhs111-receive`, `get-ods-dos-codes` |
| Database | Supabase | PostgreSQL with Realtime |
| Frontend | Vercel / Tauri | Web app + Desktop app |

### Railway Project

- **Project Name:** `pharmstation-nhs111`
- **Project ID:** `4fe56e81-4b20-458c-9f1d-1740c091152c`
- **Services:** 3 (rabbitmq, nhs111-adaptor, nhs111-bridge)
- **Internal Network:** All services communicate via `*.railway.internal` hostnames
- **Public Endpoint:** `https://nhs111-adaptor-production.up.railway.app/report`

### Supabase Project

- **Project Ref:** `xsqwpmqfbirqdncoephf`
- **Edge Functions:**
  - `nhs111-receive` (v2) — JWT verification OFF (bridge uses anon key)
  - `get-ods-dos-codes` (v7) — Returns allowed ODS codes and DoS IDs
- **Database Table:** `ps_nhs111_referrals` (Realtime enabled)

---

## 3. Pipeline Components

### 3.1 NHS 111 Adaptor

**Source:** [NHSDigital/integration-adaptor-111](https://github.com/NHSDigital/integration-adaptor-111)
**Image:** `nhsdev/nia-111-adaptor:1.0.5-amd64`

The NHS Digital open-source adaptor that:
1. Exposes an ITK SOAP endpoint on port 8080 at `/report`
2. Accepts CDA R2 XML documents wrapped in ITK SOAP envelopes
3. Validates ODS codes against an external configuration endpoint
4. Converts CDA XML to FHIR STU3 JSON Bundles
5. Publishes the FHIR JSON to RabbitMQ via the Java JMS client

**Critical Detail — JMS/AMQP Exchange:**
The adaptor uses the **RabbitMQ JMS client** (`com.rabbitmq.jms`), NOT raw AMQP. This means:
- It uses `RMQConnectionFactory` and `RMQDestination` classes
- When `PEM111_AMQP_EXCHANGE` is set to `jms.durable.queues`, the JMS client publishes to that exchange with the queue name as the routing key
- When `PEM111_AMQP_EXCHANGE` is empty/null, the client's `isAmqpWritable()` returns `false`, causing messages to go through a different (non-AMQP) JMS publishing path — **this is why the bridge couldn't receive messages initially**

### 3.2 RabbitMQ

**Image:** `rabbitmq:3-management-alpine`

Standard RabbitMQ broker with:
- **Exchange:** `jms.durable.queues` (type: direct, durable: true) — auto-created by the JMS client
- **Queue:** `encounter-report` (durable: true)
- **Binding:** Queue `encounter-report` bound to exchange `jms.durable.queues` with routing key `encounter-report`
- **Credentials:** `pharmstation` / (see Railway env vars)

### 3.3 Bridge (AMQP → Supabase)

**Source:** `infrastructure/nhs111/bridge/`
**Runtime:** Node.js 18 Alpine

The bridge is a lightweight service that:
1. Connects to RabbitMQ with retry logic (up to 10 retries with exponential backoff)
2. Asserts the `jms.durable.queues` exchange exists (direct, durable)
3. Asserts the `encounter-report` queue (durable)
4. Binds the queue to the exchange with routing key `encounter-report`
5. Consumes messages one at a time (prefetch=1) for reliability
6. Validates the message is parseable JSON
7. POSTs the FHIR Bundle to the `nhs111-receive` edge function
8. Acks the message on HTTP 2xx, nacks+requeues on failure (with 5s backoff)
9. Handles graceful shutdown on SIGINT/SIGTERM

### 3.4 Edge Function: `nhs111-receive`

**Deployed:** Supabase Edge Functions (Deno Deploy)
**Path:** `supabase/functions/nhs111-receive/index.ts` (~500 lines)
**JWT Verification:** OFF (bridge authenticates with anon key + RLS)

Processes the FHIR STU3 Bundle:
1. Extracts `Patient` resource → name, NHS number, date of birth, address, phone, gender
2. Extracts `Encounter` resource → encounter ID, class, period, status
3. Extracts `ReferralRequest` resource → referral reason, priority, referred-to service
4. Extracts `Condition` resources → condition codes and descriptions
5. Looks up the ODS code → maps to the pharmacy's `org_id` in `ps_organisations`
6. Inserts a row into `ps_nhs111_referrals` with status `received`
7. Returns `201 Created` with the referral ID

### 3.5 Edge Function: `get-ods-dos-codes`

**Deployed:** Supabase Edge Functions (Deno Deploy)
**Path:** `supabase/functions/get-ods-dos-codes/index.ts`
**JWT Verification:** OFF (called by adaptor without auth)

Returns the list of ODS codes and DoS service IDs that the adaptor should accept:
```json
{
  "odsCodes": ["FFQ69"],
  "dosIds": []
}
```

- `odsCodes` — The pharmacy's ODS code(s). Only messages addressed to these ODS codes will be processed.
- `dosIds` — Directory of Services IDs (currently empty, populated when registered with DoS).

**Important:** Returns `dosIds: []` (empty array, NOT null) to prevent a NullPointerException in the adaptor's Java code.

---

## 4. Database Schema

### Table: `ps_nhs111_referrals`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `org_id` | UUID (FK) | Links to `ps_organisations` |
| `status` | TEXT | `received`, `accepted`, `rejected`, `completed`, `expired` |
| `priority` | TEXT | From FHIR referral priority |
| `patient_name` | TEXT | Full name from FHIR Patient |
| `patient_nhs_number` | TEXT | 10-digit NHS number |
| `patient_dob` | DATE | Date of birth |
| `patient_gender` | TEXT | Gender |
| `patient_phone` | TEXT | Contact number |
| `patient_address` | JSONB | Structured address |
| `encounter_id` | TEXT | FHIR Encounter ID |
| `encounter_class` | TEXT | e.g., ambulatory |
| `encounter_start` | TIMESTAMPTZ | When the 111 encounter started |
| `encounter_end` | TIMESTAMPTZ | When the 111 encounter ended |
| `referral_reason` | TEXT | Why the patient was referred |
| `conditions` | JSONB | Array of condition codes and descriptions |
| `fhir_bundle` | JSONB | Full original FHIR Bundle (for audit) |
| `source_ods_code` | TEXT | Sending organisation's ODS code |
| `destination_ods_code` | TEXT | Pharmacy's ODS code (FFQ69) |
| `disposition_code` | TEXT | NHS 111 disposition code |
| `disposition_name` | TEXT | Human-readable disposition |
| `notes` | TEXT | Internal pharmacy notes |
| `actioned_by` | UUID (FK) | Staff member who actioned |
| `actioned_at` | TIMESTAMPTZ | When it was actioned |
| `created_at` | TIMESTAMPTZ | Auto-set on insert |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

### Security

- **RLS enabled** — pharmacy staff can only see referrals for their organisation
- **Realtime enabled** — UI receives INSERT/UPDATE events instantly
- **Indexes** on `org_id`, `status`, `created_at`, `patient_nhs_number`

---

## 5. Environment Variables Reference

### NHS 111 Adaptor (Railway)

| Variable | Value | Purpose |
|----------|-------|---------|
| `PEM111_AMQP_BROKER` | `amqp://rabbitmq.railway.internal:5672` | RabbitMQ internal hostname |
| `PEM111_AMQP_PORT` | `5672` | AMQP port |
| `PEM111_AMQP_PROTOCOL` | `0-9-1` | AMQP protocol version |
| `PEM111_AMQP_QUEUE_NAME` | `encounter-report` | Queue to publish to |
| `PEM111_AMQP_USERNAME` | `pharmstation` | RabbitMQ username |
| `PEM111_AMQP_PASSWORD` | `(see Railway)` | RabbitMQ password |
| `PEM111_AMQP_EXCHANGE` | **`jms.durable.queues`** | ⚠️ **CRITICAL** — must be set, see §9 |
| `PEM111_AMQP_ROUTING_KEY` | `encounter-report` | AMQP routing key |
| `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` | `https://xsqwpmqfbirqdncoephf.supabase.co/functions/v1/get-ods-dos-codes` | ODS codes endpoint |
| `PEM111_ITK_FETCH_INTERVAL_MIN` | `60` | How often to refresh ODS codes (minutes) |
| `PEM111_SOAP_VALIDATION_ENABLED` | `false` | ⚠️ Set to `true` for production |
| `LOG_LEVEL` | `INFO` | Java log level |
| `JAVA_TOOL_OPTIONS` | `-XX:-UseContainerSupport` | Fixes CgroupV2 crash (see §9) |
| `MANAGEMENT_METRICS_BINDERS_PROCESSOR_ENABLED` | `false` | Disables processor metrics to reduce overhead |

### RabbitMQ (Railway)

| Variable | Value | Purpose |
|----------|-------|---------|
| `RABBITMQ_DEFAULT_USER` | `pharmstation` | Admin username |
| `RABBITMQ_DEFAULT_PASS` | `(see Railway)` | Admin password |

### Bridge (Railway)

| Variable | Value | Purpose |
|----------|-------|---------|
| `RABBITMQ_URL` | `amqp://pharmstation:(pass)@rabbitmq.railway.internal:5672` | Full connection string |
| `RABBITMQ_QUEUE` | `encounter-report` | Queue to consume from |
| `SUPABASE_FUNCTION_URL` | `https://xsqwpmqfbirqdncoephf.supabase.co/functions/v1/nhs111-receive` | Edge function URL |
| `SUPABASE_ANON_KEY` | `(see Supabase dashboard)` | Auth for edge function |
| `LOG_LEVEL` | `info` | Bridge log level |

---

## 6. Deployment (Railway)

### Prerequisites

- Railway account (Hobby plan, ~$5/month)
- Railway CLI installed (`npm i -g @railway/cli`)
- Authenticated: `railway login`

### Service Setup Order

1. **RabbitMQ** — Deploy first (other services depend on it)
2. **NHS 111 Adaptor** — Deploy second (needs RabbitMQ internal URL)
3. **Bridge** — Deploy last (needs RabbitMQ internal URL + Supabase URLs)

### Deploying the Bridge

The bridge is deployed from the local `infrastructure/nhs111/bridge/` directory:

```powershell
cd infrastructure\nhs111\bridge
railway link    # Link to the bridge service
railway up      # Deploy from local directory
```

**Important:** If the bridge was previously deployed from GitHub with a root directory set, you must **clear the Root Directory** setting in the Railway dashboard (Settings → Build → Root Directory → clear it) before using `railway up` from the subdirectory.

### Deploying Edge Functions

```bash
# nhs111-receive
supabase functions deploy nhs111-receive --no-verify-jwt

# get-ods-dos-codes
supabase functions deploy get-ods-dos-codes --no-verify-jwt
```

---

## 7. Test Suite (NHS 111 Sandbox)

**Location:** `apps/nhs111-sandbox/`

A standalone React + Express test application for sending ITK SOAP messages to the adaptor.

### Structure

```
apps/nhs111-sandbox/
├── package.json           # Root — runs client + server concurrently
├── client/                # React/Webpack app (port 3000)
│   ├── src/
│   │   ├── data/
│   │   │   ├── globals.ts    # URL defaults (points to Railway adaptor)
│   │   │   └── schema.ts     # Message schemas with 7 URL configs
│   │   └── ...
│   └── ...
└── server/                # Express proxy (port 7070)
    ├── src/
    │   └── rest/
    │       └── api.ts     # Proxy endpoint (mTLS certs optional for dev)
    └── ...
```

### Running the Test Suite

```powershell
cd apps\nhs111-sandbox
npm install
npm start                  # Starts client (3000) + server (7070)
```

Open `http://localhost:3000` in your browser. The test UI allows you to:
1. Configure the target URL (defaults to Railway adaptor)
2. Select a test scenario
3. Send ITK SOAP messages
4. See the response

### Default Target URL

```
https://nhs111-adaptor-production.up.railway.app/report
```

### Test Payload

A sample ITK SOAP message is also available at `infrastructure/nhs111/test-payload.xml` for `curl`-based testing:

```powershell
curl -i -X POST "https://nhs111-adaptor-production.up.railway.app/report" `
  -H "Content-Type: application/xml" `
  --data-binary "@infrastructure/nhs111/test-payload.xml"
```

### Expected Flow When Testing

1. Send message → Adaptor returns `HTTP 200 SimpleMessageResponse OK`
2. Adaptor converts CDA → FHIR → publishes to RabbitMQ
3. Bridge consumes from RabbitMQ → POSTs to `nhs111-receive`
4. Edge function inserts into `ps_nhs111_referrals`
5. PharmStation UI updates in real-time via Supabase Realtime

---

## 8. Frontend Integration

### Store: `packages/core/src/stores/nhs111-store.ts`

Zustand store managing:
- Real-time queue of referrals (subscribed via Supabase Realtime)
- Filtering by status
- Accept/reject/complete actions
- Fetching referral details

### Pages

- **Queue Page** — Lists all incoming referrals with real-time updates, colour-coded by priority
- **Detail Page** — Full patient information, encounter details, conditions, action buttons

### Routing

- `/services/nhs111` — Queue page
- `/services/nhs111/:id` — Detail page

### SideNav

NHS 111 Referrals link added under Services section.

---

## 9. Issues Encountered & Solutions

### Issue 1: Adaptor CgroupV2 NullPointerException

**Symptom:** Adaptor container crashed immediately on Railway with a `NullPointerException` in the JVM processor metrics.

**Root Cause:** Railway uses CgroupV2 for container isolation. The `nia-111-adaptor` Docker image (based on older JVM) doesn't properly handle CgroupV2, causing the JVM's `ProcessorMetrics` to fail when reading `/proc` pseudo-files.

**Fix:** Add environment variable:
```
JAVA_TOOL_OPTIONS=-XX:-UseContainerSupport
```
This tells the JVM to ignore container cgroup limits and use the host's processor info instead.

---

### Issue 2: `get-ods-dos-codes` Returning `dosIds: null`

**Symptom:** Adaptor started successfully but threw a `NullPointerException` when processing its first message — specifically when iterating over the DoS IDs list.

**Root Cause:** The `get-ods-dos-codes` edge function was returning `{ odsCodes: ['FFQ69'], dosIds: null }`. The adaptor's Java code called `.iterator()` on the null list.

**Fix:** Updated the edge function to always return an empty array instead of null:
```json
{ "odsCodes": ["FFQ69"], "dosIds": [] }
```
Redeployed as v7.

---

### Issue 3: ITK SOAP Service/Profile Mismatch

**Symptom:** Adaptor returned validation errors when receiving test messages.

**Root Cause:** The test payload had incorrect ITK service and profile URNs.

**Fix:** Both the SOAP service and profile must be:
- **Service:** `urn:nhs-itk:services:201005:SendNHS111Report-v2-0`
- **Profile:** `urn:nhs-en:profile:nhs111CDADocument-v2-0`

---

### Issue 4: mTLS Certificate Requirement in Test Suite

**Symptom:** The NHS 111 sandbox Express proxy failed to start because it required mTLS certificates that don't exist in development.

**Root Cause:** The `api.ts` proxy code expected TLS client certificates (designed for the live NHS 111 network).

**Fix:** Modified `apps/nhs111-sandbox/server/src/rest/api.ts` to make certificates optional — when not provided, it proceeds without mTLS. This is correct for development since Railway handles TLS termination.

---

### Issue 5: ⚠️ Bridge Not Receiving Messages (THE BIG ONE)

**Symptom:** After the adaptor successfully converted CDA→FHIR and logged "Successfully sent FHIR message to queue", the bridge showed "Waiting for messages" forever. Messages never arrived.

**Investigation Steps:**
1. Checked bridge could connect to RabbitMQ ✅
2. Checked queue existed ✅
3. Checked adaptor logs confirmed successful publish ✅
4. Checked RabbitMQ queue — **0 messages** despite adaptor claiming success

**Root Cause (Two Parts):**

**Part A — JMS Exchange Mismatch:**
The NHS 111 adaptor uses the **RabbitMQ JMS client** (`com.rabbitmq.jms` library), not raw AMQP. The JMS client uses a special exchange called `jms.durable.queues` to route messages. The bridge was consuming from the default AMQP exchange, which is a completely different routing path.

**Part B — The `PEM111_AMQP_EXCHANGE` Variable:**
Even after the bridge was updated to bind to `jms.durable.queues`, messages still didn't arrive. The queue showed 0 messages. The critical discovery:

The adaptor's `RMQDestination` class has an `isAmqpWritable()` method:
```java
public boolean isAmqpWritable() {
    return this.amqp && this.amqpExchangeName != null;
}
```

When `PEM111_AMQP_EXCHANGE` was empty/not set, `amqpExchangeName` was `null`, so `isAmqpWritable()` returned `false`. This caused the JMS client to use an internal JMS publishing mechanism instead of the AMQP exchange path — messages were technically "sent" from the adaptor's perspective but routed to a JMS-internal destination that our bridge didn't consume from.

**Fix (Two Parts):**

1. **Bridge code** — Updated `infrastructure/nhs111/bridge/index.js` to:
   - Assert exchange `jms.durable.queues` (type: direct, durable: true)
   - Assert queue `encounter-report` (durable: true)
   - Bind queue to exchange with routing key `encounter-report`

2. **Adaptor environment variable** — Set on Railway:
   ```
   PEM111_AMQP_EXCHANGE=jms.durable.queues
   ```
   This ensures the adaptor's JMS client publishes to the correct AMQP exchange.

**Verification:**
After both fixes were deployed, sending a test message resulted in:
```
[INFO] Successfully forwarded FHIR bundle to Supabase {"messageId":"unknown","status":201,"totalForwarded":1}
```
Database confirmed: patient "Blogg Joe", NHS 1112223344, status "received".

**Lesson Learned:** When using the NHS 111 adaptor, `PEM111_AMQP_EXCHANGE` must ALWAYS be set to `jms.durable.queues`. The documentation and env.example files originally had this empty, which is incorrect. **Never leave it empty.**

---

### Issue 6: Railway Root Directory Conflict

**Symptom:** `railway up` from the `infrastructure/nhs111/bridge/` directory deployed but the container couldn't find files.

**Root Cause:** A previous GitHub-based deployment had set "Root Directory" to `infrastructure/nhs111/bridge` in Railway settings. When deploying locally with `railway up` from inside that directory, Railway applied the root directory setting on top of the already-correct local context, causing a double-nesting issue.

**Fix:** Clear the "Root Directory" field in Railway dashboard → Service Settings → Build section. Then `railway up` works correctly from the bridge subdirectory.

---

## 10. Go-Live Checklist

When transitioning from the test/sandbox environment to receiving real NHS 111 messages from the live NHS network, the following changes are required:

### 10.1 NHS Registration & Onboarding

- [ ] **Register with NHS Digital** for NHS 111 integration programme
- [ ] **Complete the Connection Agreement** process with NHS Digital
- [ ] **Register pharmacy in DoS** (Directory of Services) — this is how NHS 111 knows to route patients to your pharmacy
- [ ] **Obtain your DoS Service ID(s)** and update `get-ods-dos-codes` to return them in the `dosIds` array
- [ ] **Confirm ODS code** (currently `FFQ69`) is correctly registered

### 10.2 TLS Mutual Authentication (mTLS)

The live NHS 111 network requires mutual TLS. You need to:

- [ ] **Obtain TLS-MA certificates** from NHS Digital (server cert, private key, client cert, CA cert)
- [ ] **Deploy NGINX reverse proxy** in front of the adaptor on Railway:
  - Image: `nhsdev/nia-111-nginx-adaptor`
  - Configure these environment variables:
    ```
    NGINX_PUBLIC_CERT=<your-server-public-cert-pem>
    NGINX_PRIVATE_CERT=<your-server-private-key-pem>
    NGINX_CLIENT_PUBLIC_CERT=<nhs-client-cert-pem>
    NGINX_CA_CERT=<root-ca-cert-pem>
    NGINX_ADAPTER_HOSTNAME=nhs111-adaptor.railway.internal
    NGINX_ADAPTER_PORT=8080
    ```
- [ ] **Update Railway networking** so the NGINX proxy gets the public domain, not the adaptor directly
- [ ] **Update NHS endpoint registration** to point to the NGINX proxy's public URL

### 10.3 Adaptor Configuration Changes

| Variable | Current (Dev) | Production |
|----------|--------------|------------|
| `PEM111_SOAP_VALIDATION_ENABLED` | `false` | **`true`** — validates incoming XML against schema |
| `PEM111_SOAP_SEND_TO` | *(not set)* | Set to the registered endpoint URL if required |
| `PEM111_AMQP_EXCHANGE` | `jms.durable.queues` | `jms.durable.queues` (**keep as-is**) |
| `LOG_LEVEL` | `INFO` | `WARN` (reduce noise in production) |

### 10.4 Security Hardening

- [ ] **Rotate RabbitMQ password** — replace the development password with a cryptographically strong one
- [ ] **Rotate Supabase anon key** if it was committed to any public repo
- [ ] **Enable JWT verification** on `nhs111-receive` edge function and issue a service-role key for the bridge (or keep anon key with strict RLS)
- [ ] **Review RLS policies** on `ps_nhs111_referrals` — ensure pharmacies can only see their own referrals
- [ ] **Remove test data** from the database before going live

### 10.5 Edge Function Updates

- [ ] **Update `get-ods-dos-codes`** to dynamically query `ps_organisations` for all registered pharmacies' ODS codes (currently hardcoded to `FFQ69`)
- [ ] **Add DoS IDs** once registered with the Directory of Services
- [ ] **Consider JWT verification** on `get-ods-dos-codes` if the URL is sensitive

### 10.6 Multi-Pharmacy Support

The current setup assumes a single pharmacy (ODS: FFQ69). For multi-pharmacy:

- [ ] **Update `get-ods-dos-codes`** to return ODS codes for ALL pharmacies on the platform
- [ ] **Update `nhs111-receive`** to correctly map each incoming ODS code to the right pharmacy `org_id`
- [ ] **Test with multiple ODS codes** to ensure routing works correctly

### 10.7 Monitoring & Alerting

- [ ] **Set up Railway alerts** for service crashes / restarts
- [ ] **Monitor bridge `failed` counter** — any non-zero value needs investigation
- [ ] **Set up Supabase log monitoring** for `nhs111-receive` errors
- [ ] **Add health-check endpoint** to the bridge (e.g., `/health` returning 200)
- [ ] **Set up uptime monitoring** for the adaptor's `/actuator/health` endpoint
- [ ] **Database monitoring** — alert if referrals stay in `received` status for >30 minutes (not being actioned)

### 10.8 Data Retention & Compliance

- [ ] **Define data retention policy** for NHS 111 referral data (NHS requires minimum retention periods)
- [ ] **Implement automated archival** of completed/expired referrals
- [ ] **Ensure GDPR compliance** — patient data handling, right to erasure considerations
- [ ] **Audit logging** — track who viewed/actioned each referral
- [ ] **Review `fhir_bundle` storage** — the full FHIR bundle is stored in JSONB for audit; ensure this aligns with data minimisation principles

### 10.9 Performance & Scaling

- [ ] **Load test** the pipeline with realistic message volumes
- [ ] **Consider Railway scaling** — the bridge processes one message at a time; for high volume, consider increasing prefetch or running multiple instances
- [ ] **Database indexes** — already in place for common queries; monitor query performance as data grows

### 10.10 Go-Live Day

1. Deploy all production configuration changes
2. Enable SOAP validation (`PEM111_SOAP_VALIDATION_ENABLED=true`)
3. Deploy NGINX mTLS proxy
4. Notify NHS Digital that the endpoint is ready
5. NHS Digital performs their connectivity test
6. Monitor first real messages end-to-end
7. Confirm referrals appear in PharmStation UI
8. Sign off go-live ✅

---

## 11. Monitoring & Operations

### Checking Service Health

**Adaptor:**
```
GET https://nhs111-adaptor-production.up.railway.app/actuator/health
→ {"status":"UP"}
```

**Bridge:** Check Railway dashboard logs for:
```
[INFO] PharmStation NHS 111 Bridge starting
[INFO] Connected to RabbitMQ
[INFO] Exchange "jms.durable.queues" confirmed
[INFO] Queue "encounter-report" bound to exchange "jms.durable.queues"
[INFO] Waiting for messages on queue "encounter-report"...
```

**RabbitMQ:** If management UI is exposed (port 15672):
- Check `encounter-report` queue exists
- Monitor message rates
- Check consumer count (should be ≥1 when bridge is running)

### Checking Database

```sql
-- Recent referrals
SELECT id, status, patient_name, patient_nhs_number, created_at
FROM ps_nhs111_referrals
ORDER BY created_at DESC
LIMIT 10;

-- Count by status
SELECT status, COUNT(*)
FROM ps_nhs111_referrals
GROUP BY status;
```

### Common Railway CLI Commands

```powershell
# Set PATH for Railway CLI
$env:Path = "$env:APPDATA\npm;$env:Path"

# View adaptor logs
railway logs --service nhs111-adaptor

# View bridge logs
railway logs --service nhs111-bridge

# Restart a service
railway service restart --service nhs111-bridge

# Set an environment variable
railway variables set PEM111_SOAP_VALIDATION_ENABLED=true --service nhs111-adaptor
```

---

## 12. File Reference

### Infrastructure

```
infrastructure/nhs111/
├── docker-compose.yml          # Local development compose (3 services)
├── .env.example                # Environment variable template
├── test-payload.xml            # Sample ITK SOAP message for testing
├── README.md                   # Railway deployment guide
└── bridge/
    ├── Dockerfile              # Node.js 18 Alpine container
    ├── index.js                # AMQP consumer + HTTP forwarder (~220 lines)
    └── package.json            # Dependencies: amqplib
```

### Supabase Edge Functions

```
supabase/functions/
├── nhs111-receive/
│   └── index.ts                # FHIR→Database processor (~500 lines)
└── get-ods-dos-codes/
    └── index.ts                # ODS/DoS codes endpoint
```

### Database

```
supabase/migrations/
└── (NHS 111 referrals migration)   # Creates ps_nhs111_referrals table
```

### Frontend

```
packages/core/src/stores/
└── nhs111-store.ts             # Zustand store with Realtime subscription

apps/web/src/pages/services/
├── NHS111QueuePage.tsx         # Real-time referral queue
└── NHS111DetailPage.tsx        # Individual referral detail
```

### Test Suite

```
apps/nhs111-sandbox/
├── package.json                # Concurrently runs client + server
├── client/                     # React/Webpack (port 3000)
│   └── src/data/
│       ├── globals.ts          # Default URL: Railway adaptor
│       └── schema.ts           # Message schemas
└── server/                     # Express proxy (port 7070)
    └── src/rest/api.ts         # Proxy with optional mTLS
```

### Documentation

```
documentation/nhs/
└── nhs111-pipeline.md          # This file

infrastructure/nhs111/
└── README.md                   # Railway deployment guide (step-by-step)
```

---

## Appendix: First Successful End-to-End Message

**Date:** 28 February 2026

**Test Message Sent:** ITK SOAP CDA document for patient "Blogg Joe" (NHS: 1112223344)

**Result:**
- Adaptor: HTTP 200, converted CDA→FHIR, published to RabbitMQ
- Bridge: Consumed from queue, forwarded to Supabase
- Edge Function: Parsed FHIR, inserted into database
- Database row:
  ```
  id:                 cc659d97-3597-4646-bda0-f4f4af1a9718
  status:             received
  patient_name:       Blogg Joe
  patient_nhs_number: 1112223344
  created_at:         2026-02-28 16:49:29
  ```

**Pipeline latency:** < 2 seconds end-to-end.
