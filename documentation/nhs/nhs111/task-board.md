# NHS 111 Referral Integration — Task Board

> **Managed by:** Lead Developer
> **Updated:** 28 February 2026
> **Statuses:** `🔲 Not Started` | `🔄 In Progress` | `✅ Complete` | `⛔ Blocked` | `📋 Review`

---

## PHASE 1 — Database, Types & Edge Function

> **Goal:** Supabase infrastructure to receive and store FHIR referral data.
> **Dependencies:** None — can start immediately.

### 1.1 — Database Schema

**Status:** ✅ Complete

- [x] Drop and recreate `ps_nhs111_referrals` table with proper schema (30+ columns)
- [x] Add RLS policies (`org_members_crud_referrals`, `service_role_insert_referrals`, `service_role_read_referrals`)
- [x] Add indexes on `org_id`, `status`, `case_id`, `patient_nhs_number`, `received_at`
- [x] Enable Supabase Realtime on `ps_nhs111_referrals`
- [x] Per-table updated_at trigger function `ps_nhs111_referrals_set_updated_at()`

### 1.2 — TypeScript Types

**Status:** ✅ Complete

- [x] Add `NHS111Referral` type to `packages/types/src/nhs.ts`
- [x] Add `NHS111ReferralStatus`, `NHS111EventType`, `NHS111Urgency`, `NHS111TriageQA` types
- [x] Add FHIR STU3 types (FhirBundle, FhirBundleEntry, FhirResource union, 12+ resource types)
- [x] Auto-exported via `export * from './nhs'` in `packages/types/src/index.ts`

### 1.3 — Edge Function: `nhs111-receive`

**Status:** ✅ Complete

- [x] Create `supabase/functions/nhs111-receive/index.ts`
- [x] Accept POST with FHIR JSON Bundle body
- [x] Extract all key fields from FHIR resources (Patient, Encounter, Condition, ReferralRequest, CarePlan, Composition, QuestionnaireResponse, MessageHeader, Organization)
- [x] Look up org via `ps_org_pharmacy_link` → `pharmacies.ods_code` join (not direct `ps_organisations.ods_code`)
- [x] Insert into `ps_nhs111_referrals`
- [x] Handle duplicates (check `case_id`)
- [x] JWT verification OFF (called by bridge script)
- [x] Deployed v2 to Supabase

### 1.4 — Update `get-ods-dos-codes` Edge Function

**Status:** ✅ Complete

- [x] Updated to dynamically query `ps_org_pharmacy_link` → `pharmacies.ods_code` join
- [x] Returns `{ odsCodes: [...], count: N }`
- [x] Deployed v6 to Supabase

---

## PHASE 2 — Frontend UI

> **Goal:** Pharmacists can see, manage, and act on incoming 111 referrals.
> **Dependencies:** Phase 1 complete.

### 2.1 — Referral Queue Page

**Status:** ✅ Complete

- [x] New page: `apps/web/src/pages/nhs111/ReferralQueuePage.tsx`
- [x] Route: `/services/111-referrals` (added to `App.tsx`)
- [x] Added to SideNav under Services section (📞 111 Referrals)
- [x] Table showing incoming referrals: patient name, complaint, disposition, urgency, time received, status
- [x] Filter by status (all / new / accepted / in_progress / completed / rejected)
- [x] Client-side search (patient name, NHS number, complaint, case ref, disposition)
- [x] Badge showing count of unactioned referrals
- [x] Click row → navigate to detail page
- [x] Urgency colour-coded badges (🚨 Emergency, ⚡ Urgent, 📋 Routine)

### 2.2 — Referral Detail Page

**Status:** ✅ Complete

- [x] New page: `apps/web/src/pages/nhs111/ReferralDetailPage.tsx`
- [x] Route: `/services/111-referrals/:referralId`
- [x] Two-column layout: Patient & Clinical (left) | Triage Q&A, Metadata, Notes (right)
- [x] Patient demographics card (name, NHS number, DOB, address, phone, GP)
- [x] Clinical card (presenting complaint, disposition, event type)
- [x] Care plan card (self-care advice)
- [x] Encounter summary card (narrative)
- [x] Triage Q&A card (collapsible questions/answers)
- [x] Action buttons: Accept / Start Consultation / Complete / Reject (with modals)
- [x] Notes section with add-note functionality
- [x] Raw FHIR bundle viewer (collapsible JSON)
- [x] Breadcrumb navigation

### 2.3 — Realtime Notifications

**Status:** ✅ Complete

- [x] Supabase Realtime subscription on `ps_nhs111_referrals` (filtered by org_id)
- [x] Audio alert (two-tone beep) when new referral arrives via Realtime INSERT
- [x] 📞 badge with unread count in TopNav (amber badge, navigates to queue)
- [x] Auto-refresh referral queue when new data arrives (Realtime INSERT/UPDATE handlers)
- [x] 111 Realtime subscription bootstrapped in TopNav alongside existing network subscription

### 2.4 — Zustand Store

**Status:** ✅ Complete

- [x] Created `packages/core/src/stores/nhs111-store.ts`
- [x] Actions: `fetchReferrals`, `fetchReferral`, `acceptReferral`, `rejectReferral`, `startConsultation`, `completeReferral`, `addNote`
- [x] Realtime subscription setup/teardown (`subscribeToReferrals` / `unsubscribeFromReferrals`)
- [x] Status filter with `setStatusFilter`
- [x] Unread count tracking (received status)
- [x] Exported as `useNHS111Store` from `packages/core/src/index.ts`

---

## PHASE 3 — Railway Deployment & End-to-End Testing

> **Goal:** 111 Adaptor running on Railway, full pipeline tested.
> **Dependencies:** Phase 1 + 2 complete.

### 3.1 — Docker Compose & Infrastructure Files

**Status:** ✅ Complete

- [x] Created `infrastructure/nhs111/docker-compose.yml` — 3 services (RabbitMQ, Adaptor, Bridge)
- [x] RabbitMQ with health checks, management UI
- [x] Adaptor using `nhsdev/nia-111-adaptor:1.0.5-amd64` with full RabbitMQ 0-9-1 config
- [x] Adaptor configured with `PEM111_ITK_EXTERNAL_CONFIGURATION_URL` pointing to `get-ods-dos-codes` edge function
- [x] Environment variable templating via `.env` file
- [x] Created `infrastructure/nhs111/.env.example` with all required variables documented

### 3.2 — Bridge Script

**Status:** ✅ Complete

- [x] Created `infrastructure/nhs111/bridge/index.js` (~170 lines)
- [x] Connects to RabbitMQ with retry logic (up to 10 retries with backoff)
- [x] Consumes from `encounter-report` queue (prefetch 1 for reliability)
- [x] On message: validates JSON, POSTs to Supabase Edge Function with Authorization header
- [x] On success: ack message, log referral ID
- [x] On failure: nack with requeue, 5s backoff before next message
- [x] Structured JSON logging with configurable log level
- [x] Graceful shutdown on SIGINT/SIGTERM
- [x] Stats tracking (forwarded/failed counts)
- [x] Created `infrastructure/nhs111/bridge/package.json` (amqplib dependency)
- [x] Created `infrastructure/nhs111/bridge/Dockerfile` (Node.js 18 Alpine, non-root user)

### 3.3 — Railway Deployment Guide

**Status:** ✅ Complete

- [x] Created `infrastructure/nhs111/README.md` — comprehensive step-by-step guide
- [x] Steps: Create Railway project → Deploy RabbitMQ → Deploy Adaptor → Deploy Bridge
- [x] Environment variable reference table for each service
- [x] Verification steps (health check, logs, test message)
- [x] Production considerations (TLS-MA, NHS onboarding, monitoring)
- [x] Troubleshooting guide
- [x] Cost estimate (~$5/month)

### 3.4 — End-to-End Testing

**Status:** 🔲 Not Started (awaiting Railway deployment)

- [ ] Deploy all 3 services to Railway
- [ ] Send test ITK messages from test harness → Railway adaptor
- [ ] Verify FHIR JSON arrives at Edge Function
- [ ] Verify referral appears in `ps_nhs111_referrals`
- [ ] Verify Realtime notification fires in UI
- [ ] Verify Accept → Start Consultation flow creates service delivery
- [ ] Test duplicate message handling (same case_id)
- [ ] Test invalid ODS code rejection
- [ ] Test message with missing patient data (graceful handling)

---

## PHASE 4 — NHS Onboarding & Production

> **Goal:** Go live with real NHS 111 traffic.
> **Dependencies:** Phase 3 complete + NHS approval.

### 4.1 — NHS Onboarding

**Status:** 🔲 Not Started

- [ ] Apply for NHS onboarding (separate from NHSBSA MYS onboarding)
- [ ] Register with Directory of Services (DoS)
- [ ] Obtain TLS-MA certificates
- [ ] Configure nginx proxy with certificates
- [ ] Register pharmacy endpoint URLs in DoS
- [ ] Engage with relevant ICS (Integrated Care System) for DoS lead

### 4.2 — Production Configuration

**Status:** 🔲 Not Started

- [ ] Switch adaptor to production configuration
- [ ] Enable SOAP validation (`PEM111_SOAP_VALIDATION_ENABLED=true`)
- [ ] Configure production ODS codes
- [ ] Set up monitoring/alerting on Railway
- [ ] Set up audit logging

---

## Decisions Log

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Use NHS 111 Adaptor (not direct ITK parsing) | Adaptor maintained by NHS Digital, handles CDA→FHIR conversion, we never touch XML | 28 Feb 2026 |
| 2 | Host adaptor on Railway from the start | Same architecture for dev and prod, minimal changes when going live | 28 Feb 2026 |
| 3 | Don't fork/modify the adaptor | Avoid maintenance burden — always pull latest NHS image | 28 Feb 2026 |
| 4 | Skip external message queue (CloudAMQP) | RabbitMQ runs internally in Docker, bridge POSTs directly to Supabase | 28 Feb 2026 |
| 5 | Use Supabase Realtime for notifications | Already in our stack, no extra infrastructure | 28 Feb 2026 |
| 6 | Direct insert (no pgmq queue initially) | Simpler architecture; can add pgmq later if retry logic needed | 28 Feb 2026 |
| 7 | ODS lookup via `ps_org_pharmacy_link` → `pharmacies` | ODS codes live on the `pharmacies` directory table, not directly on `ps_organisations`. Orgs link to pharmacies via `ps_org_pharmacy_link` | 28 Feb 2026 |
| 8 | Reverted `dos_service_ids` column on `ps_organisations` | DoS service IDs not yet needed; can add to `pharmacies` table later when DoS integration is built | 28 Feb 2026 |
