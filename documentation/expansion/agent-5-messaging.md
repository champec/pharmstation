# Agent 5 — Messaging (NHS Notify / GOV.UK Notify)

> **Wave:** 2 (runs in PARALLEL with Agents 1, 2, 3, 4 — after Agent 0 completes)
> **Prerequisite:** Agent 0 (Foundation) must be complete
> **Base plan:** `documentation/expansion/expansion-plan.md` — Phase 5
> **Assumes:** All types already exist in `@pharmstation/types`, all routes already wired in `App.tsx`, all nav items already in `SideNav.tsx`, all placeholder pages already created by Agent 0.

This agent builds the **Messaging** feature using [GOV.UK Notify](https://api.notifications.service.gov.uk) (NHS Notify). Pharmacies can send SMS, emails, and letters to patients — individually or in bulk broadcasts. Each pharmacy provides their own NHS Notify API key, stored securely per-org.

---

## Critical Design Decision: Single Blank Template

**Each pharmacy uses a SINGLE blank GOV.UK Notify template** for each channel (SMS, email, letter). The template contains a single `((body))` personalisation placeholder that accepts any message content. This means:

- The pharmacy creates **one SMS template** on GOV.UK Notify with the body: `((body))`
- The pharmacy creates **one email template** on GOV.UK Notify with the body: `((body))` and subject: `((subject))`
- The pharmacy creates **one letter template** on GOV.UK Notify with the body: `((body))`
- When sending a message, the **full message content** is passed as the `body` personalisation value.
- This avoids creating dozens of templates on GOV.UK Notify per message type.
- The `ps_notify_settings` table stores the template IDs for each channel type.

---

## Scope Summary

1. Create the messaging database migration (3 tables)
2. Create the `nhs-notify` edge function (send SMS/email/letter, send broadcast, check status)
3. Implement `MessagingHubPage` — dashboard with stats and recent messages
4. Implement `ComposeMessagePage` — send a single message to a patient
5. Implement `BroadcastsPage` — list of bulk sends
6. Implement `NewBroadcastPage` — create and send a bulk broadcast
7. Implement `MessageHistoryPage` — full message log with filters
8. Add Messaging settings tab to `SettingsPage`

---

## 1. Database Migration

Create: `supabase/migrations/20260219_messaging.sql`

```sql
-- ===========================================
-- PharmStation: Messaging (NHS Notify / GOV.UK Notify)
-- ===========================================

-- Per-org NHS Notify credentials and template IDs
CREATE TABLE ps_notify_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE UNIQUE,
  api_key text NOT NULL, -- full GOV.UK Notify API key (never exposed to client)
  sms_template_id text, -- single blank SMS template ID
  email_template_id text, -- single blank email template ID
  letter_template_id text, -- single blank letter template ID
  is_active boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ps_notify_settings ENABLE ROW LEVEL SECURITY;

-- Only org members can CRUD their own settings
-- IMPORTANT: The api_key column must NEVER be returned to the client.
-- We use a view or column-level policy to exclude it.
CREATE POLICY "org_members_crud_notify_settings"
  ON ps_notify_settings FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));


-- Sent message log
CREATE TABLE ps_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  recipient_phone text,
  recipient_email text,
  recipient_address jsonb, -- for letters: { address_line_1, ..., address_line_7 }
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'letter')),
  subject text, -- for emails
  body text NOT NULL, -- the message content sent
  personalisation jsonb, -- full personalisation object sent to GOV.UK Notify
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'permanent-failure', 'temporary-failure', 'technical-failure')),
  notify_message_id text, -- GOV.UK Notify response ID
  broadcast_id uuid, -- FK added after ps_broadcasts table created
  sent_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_org ON ps_messages(org_id);
CREATE INDEX idx_messages_patient ON ps_messages(patient_id);
CREATE INDEX idx_messages_status ON ps_messages(org_id, status);
CREATE INDEX idx_messages_broadcast ON ps_messages(broadcast_id);

ALTER TABLE ps_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_messages"
  ON ps_messages FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));


-- Broadcasts (bulk sends)
CREATE TABLE ps_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'letter')),
  subject text, -- for email broadcasts
  body text NOT NULL, -- the message content
  recipient_filter jsonb NOT NULL DEFAULT '{}', -- criteria to select patients
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'cancelled')),
  total_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  created_by_user_id uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_broadcasts_org ON ps_broadcasts(org_id);

ALTER TABLE ps_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_broadcasts"
  ON ps_broadcasts FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));


-- Add FK from ps_messages to ps_broadcasts
ALTER TABLE ps_messages
  ADD CONSTRAINT fk_messages_broadcast
  FOREIGN KEY (broadcast_id) REFERENCES ps_broadcasts(id) ON DELETE SET NULL;


-- ===========================================
-- View: ps_notify_settings_safe (excludes api_key)
-- ===========================================
-- Client-side queries should use this view instead of the table directly.

CREATE VIEW ps_notify_settings_safe AS
  SELECT
    id,
    org_id,
    sms_template_id,
    email_template_id,
    letter_template_id,
    is_active,
    last_tested_at,
    created_at,
    CASE WHEN api_key IS NOT NULL AND api_key != '' THEN true ELSE false END AS has_api_key
  FROM ps_notify_settings;

-- Grant access to the view
GRANT SELECT ON ps_notify_settings_safe TO authenticated;
```

---

## 2. Edge Function: `nhs-notify`

Create: `supabase/functions/nhs-notify/index.ts`

This edge function handles all NHS Notify API interactions. The org's API key is fetched server-side from `ps_notify_settings` and is **never** exposed to the client.

### GOV.UK Notify JWT Authentication

The GOV.UK Notify API key has the format: `{key_name}-{iss_uuid}-{secret_key_uuid}`.

To authenticate:
1. Parse the API key to extract the `iss` (service ID) and `secret` (signing key).
2. Create a JWT with header `{ "typ": "JWT", "alg": "HS256" }` and payload `{ "iss": "<service_id>", "iat": <current_epoch_seconds> }`.
3. Sign the JWT using the secret key with HMAC-SHA256.
4. Include the JWT as `Authorization: Bearer <jwt>` header.

```typescript
import { encode as base64url } from 'https://deno.land/std@0.168.0/encoding/base64url.ts'

function parseNotifyApiKey(apiKey: string): { iss: string; secret: string } {
  // Format: key_name-iss_uuid-secret_uuid
  // The last two UUID segments (36 chars each, separated by -)
  // A UUID is 36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const parts = apiKey.split('-')
  // Last 5 segments form the secret UUID, previous 5 form the iss UUID
  // Actually: last 10 hyphen-separated parts form 2 UUIDs (5 parts each)
  const allParts = apiKey.split('-')
  const secretParts = allParts.slice(-5)
  const issParts = allParts.slice(-10, -5)
  return {
    iss: issParts.join('-'),
    secret: secretParts.join('-'),
  }
}

async function createNotifyJwt(apiKey: string): Promise<string> {
  const { iss, secret } = parseNotifyApiKey(apiKey)

  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'HS256' })))
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss,
    iat: Math.floor(Date.now() / 1000),
  })))

  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const sig = base64url(new Uint8Array(signature))

  return `${data}.${sig}`
}
```

### Request format

All requests are POST with JSON body: `{ action: string, org_id: string, ...params }`. Auth is always required (staff).

### Helper: Notify API call

```typescript
const NOTIFY_API_BASE = 'https://api.notifications.service.gov.uk'

async function notifyFetch(apiKey: string, path: string, options: RequestInit = {}) {
  const jwt = await createNotifyJwt(apiKey)

  const res = await fetch(`${NOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      ...options.headers,
    },
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errMsg = body.errors?.[0]?.message || `HTTP ${res.status}`
    throw new Error(`NHS Notify error: ${errMsg}`)
  }

  return body
}
```

### Helper: Fetch org API key

```typescript
async function getOrgApiKey(adminClient: any, orgId: string): Promise<string> {
  const { data, error } = await adminClient
    .from('ps_notify_settings')
    .select('api_key, is_active, sms_template_id, email_template_id, letter_template_id')
    .eq('org_id', orgId)
    .single()

  if (error || !data) throw new Error('Messaging not configured for this organisation')
  if (!data.is_active) throw new Error('Messaging is not active for this organisation')
  if (!data.api_key) throw new Error('NHS Notify API key not configured')

  return data
}
```

### Action: `send_sms`

**Input:**
```typescript
{
  action: 'send_sms',
  org_id: string,
  phone_number: string,     // e.g. "+447900900123"
  body: string,             // the full message content
  patient_id?: string,      // optional FK
  reference?: string,       // optional tracking reference
}
```

**Steps:**
1. Fetch org's settings (API key + `sms_template_id`).
2. Construct personalisation: `{ body: message_body }`.
3. POST to `https://api.notifications.service.gov.uk/v2/notifications/sms`:
   ```json
   {
     "phone_number": "+447900900123",
     "template_id": "<sms_template_id>",
     "personalisation": { "body": "Your prescription is ready for collection." },
     "reference": "<reference>"
   }
   ```
4. On success (201): log to `ps_messages` with `notify_message_id` from response, `status: 'sending'`.
5. Return the message record.

### Action: `send_email`

**Input:**
```typescript
{
  action: 'send_email',
  org_id: string,
  email_address: string,
  subject: string,
  body: string,
  patient_id?: string,
  reference?: string,
}
```

**Steps:**
1. Fetch org's settings (API key + `email_template_id`).
2. Personalisation: `{ subject: subject, body: message_body }`.
3. POST to `/v2/notifications/email`:
   ```json
   {
     "email_address": "patient@example.com",
     "template_id": "<email_template_id>",
     "personalisation": { "subject": "Pharmacy Update", "body": "Your prescription is ready." },
     "reference": "<reference>"
   }
   ```
4. Log to `ps_messages`, return record.

### Action: `send_letter`

**Input:**
```typescript
{
  action: 'send_letter',
  org_id: string,
  address: {               // GOV.UK Notify address format
    address_line_1: string, // name
    address_line_2: string, // street
    address_line_3: string, // city/postcode
    address_line_4?: string,
    address_line_5?: string,
    address_line_6?: string,
    address_line_7?: string,
  },
  body: string,
  patient_id?: string,
  reference?: string,
}
```

**Steps:**
1. Fetch org's settings (API key + `letter_template_id`).
2. Personalisation: `{ ...address, body: message_body }`.
3. POST to `/v2/notifications/letter`:
   ```json
   {
     "template_id": "<letter_template_id>",
     "personalisation": {
       "address_line_1": "John Smith",
       "address_line_2": "123 High Street",
       "address_line_3": "SW1A 1AA",
       "body": "Dear Mr Smith, your prescription is ready for collection."
     },
     "reference": "<reference>"
   }
   ```
4. Log to `ps_messages` with `recipient_address` set, return record.

### Action: `send_broadcast`

**Input:**
```typescript
{
  action: 'send_broadcast',
  org_id: string,
  broadcast_id: string,     // FK to ps_broadcasts
}
```

**Steps:**
1. Fetch the broadcast record from `ps_broadcasts`.
2. Fetch patients matching `recipient_filter` from `ps_patients`:
   - Filter logic: `recipient_filter` is an object like `{ has_phone: true }` or `{ all: true }`.
   - For SMS: only patients with a phone number.
   - For email: only patients with an email address.
   - For letter: only patients with address fields.
3. Update broadcast `status: 'sending'`, `total_count: patients.length`.
4. Loop through patients, sending one message at a time:
   - For SMS: `send_sms` with patient's phone.
   - For email: `send_email` with patient's email.
   - For letter: `send_letter` with patient's address.
   - Each message gets `broadcast_id` set in `ps_messages`.
   - Increment `sent_count` on success, `failed_count` on failure.
   - **Rate limiting:** NHS Notify allows 3,000 requests/min for live keys. Add a small delay between sends (20ms) to stay well under.
5. Update broadcast `status: 'sent'` (or `'failed'` if all failed).
6. Return broadcast summary.

**Important:** Broadcasts may be large. For MVP, the edge function processes synchronously. For production, this should be moved to a background job (Supabase pg_cron or similar). The edge function has a 150-second timeout in hosted Supabase, which at 20ms/message allows ~7,500 messages per invocation — sufficient for most pharmacies.

### Action: `check_status`

**Input:**
```typescript
{
  action: 'check_status',
  org_id: string,
  message_id: string,       // ps_messages.id (our ID)
}
```

**Steps:**
1. Fetch the message from `ps_messages` to get `notify_message_id`.
2. GET `https://api.notifications.service.gov.uk/v2/notifications/{notify_message_id}`.
3. Map GOV.UK Notify status to our status:
   - `created`, `sending` → `'sending'`
   - `sent`, `delivered` → `'delivered'`
   - `permanent-failure` → `'permanent-failure'`
   - `temporary-failure` → `'temporary-failure'`
   - `technical-failure` → `'technical-failure'`
   - `failed` → `'failed'`
4. Update `ps_messages.status`.
5. Return updated message.

### Action: `test_connection`

**Input:**
```typescript
{
  action: 'test_connection',
  org_id: string,
}
```

**Steps:**
1. Fetch org's API key from `ps_notify_settings`.
2. Parse the key and create a JWT.
3. Call `GET https://api.notifications.service.gov.uk/v2/templates?template_type=sms` to verify the key works.
4. Update `ps_notify_settings.last_tested_at = now()`.
5. Return `{ valid: true, templates: data.templates }` on success.
6. On auth error: return `{ valid: false, error: '...' }`.

This is used by the Settings page "Test Connection" button and also returns the available templates so the pharmacy can pick which template ID to use for each channel.

---

## Edge Function File Structure

```
supabase/functions/nhs-notify/
  index.ts       — main handler, routes by action
```

### `index.ts` — Full structure

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64url } from 'https://deno.land/std@0.168.0/encoding/base64url.ts'

const NOTIFY_API_BASE = 'https://api.notifications.service.gov.uk'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- JWT helpers ---
function parseNotifyApiKey(apiKey: string) {
  const parts = apiKey.split('-')
  const secretParts = parts.slice(-5)
  const issParts = parts.slice(-10, -5)
  return { iss: issParts.join('-'), secret: secretParts.join('-') }
}

async function createNotifyJwt(apiKey: string): Promise<string> {
  const { iss, secret } = parseNotifyApiKey(apiKey)
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'HS256' })))
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss,
    iat: Math.floor(Date.now() / 1000),
  })))
  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = base64url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  ))
  return `${data}.${sig}`
}

// --- Notify API caller ---
async function notifyFetch(apiKey: string, path: string, options: RequestInit = {}) {
  const jwt = await createNotifyJwt(apiKey)
  const res = await fetch(`${NOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      ...options.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errMsg = body.errors?.[0]?.message || `HTTP ${res.status}`
    throw new Error(`NHS Notify: ${errMsg}`)
  }
  return body
}

// --- Supabase admin client ---
function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// --- Get org settings ---
async function getOrgSettings(admin: any, orgId: string) {
  const { data, error } = await admin
    .from('ps_notify_settings')
    .select('*')
    .eq('org_id', orgId)
    .single()
  if (error || !data) throw new Error('Messaging not configured')
  if (!data.is_active) throw new Error('Messaging not active')
  if (!data.api_key) throw new Error('API key not set')
  return data
}

// --- Log message to DB ---
async function logMessage(admin: any, msg: any) {
  const { data, error } = await admin
    .from('ps_messages')
    .insert(msg)
    .select()
    .single()
  if (error) throw error
  return data
}

// --- Sleep helper for rate limiting ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// --- Action: send_sms ---
async function handleSendSms(body: any, userId: string) {
  const { org_id, phone_number, body: msgBody, patient_id, reference } = body
  if (!org_id || !phone_number || !msgBody) throw new Error('Missing org_id, phone_number, or body')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  if (!settings.sms_template_id) throw new Error('SMS template not configured')

  const result = await notifyFetch(settings.api_key, '/v2/notifications/sms', {
    method: 'POST',
    body: JSON.stringify({
      phone_number,
      template_id: settings.sms_template_id,
      personalisation: { body: msgBody },
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_phone: phone_number,
    channel: 'sms',
    body: msgBody,
    personalisation: { body: msgBody },
    status: 'sending',
    notify_message_id: result.id,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// --- Action: send_email ---
async function handleSendEmail(body: any, userId: string) {
  const { org_id, email_address, subject, body: msgBody, patient_id, reference } = body
  if (!org_id || !email_address || !msgBody) throw new Error('Missing required fields')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  if (!settings.email_template_id) throw new Error('Email template not configured')

  const result = await notifyFetch(settings.api_key, '/v2/notifications/email', {
    method: 'POST',
    body: JSON.stringify({
      email_address,
      template_id: settings.email_template_id,
      personalisation: { subject: subject || 'Message from your pharmacy', body: msgBody },
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_email: email_address,
    channel: 'email',
    subject,
    body: msgBody,
    personalisation: { subject, body: msgBody },
    status: 'sending',
    notify_message_id: result.id,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// --- Action: send_letter ---
async function handleSendLetter(body: any, userId: string) {
  const { org_id, address, body: msgBody, patient_id, reference } = body
  if (!org_id || !address || !msgBody) throw new Error('Missing required fields')
  if (!address.address_line_1 || !address.address_line_2 || !address.address_line_3) {
    throw new Error('Letters require at least 3 address lines')
  }

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)
  if (!settings.letter_template_id) throw new Error('Letter template not configured')

  const personalisation = { ...address, body: msgBody }
  const result = await notifyFetch(settings.api_key, '/v2/notifications/letter', {
    method: 'POST',
    body: JSON.stringify({
      template_id: settings.letter_template_id,
      personalisation,
      reference: reference || undefined,
    }),
  })

  return logMessage(admin, {
    org_id,
    patient_id: patient_id || null,
    recipient_address: address,
    channel: 'letter',
    body: msgBody,
    personalisation,
    status: 'sending',
    notify_message_id: result.id,
    sent_at: new Date().toISOString(),
    created_by_user_id: userId,
  })
}

// --- Action: send_broadcast ---
async function handleSendBroadcast(body: any, userId: string) {
  const { org_id, broadcast_id } = body
  if (!org_id || !broadcast_id) throw new Error('Missing org_id or broadcast_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  // Fetch the broadcast
  const { data: broadcast, error: bErr } = await admin
    .from('ps_broadcasts')
    .select('*')
    .eq('id', broadcast_id)
    .eq('org_id', org_id)
    .single()
  if (bErr || !broadcast) throw new Error('Broadcast not found')
  if (broadcast.status !== 'draft') throw new Error('Broadcast already processed')

  // Fetch matching patients
  let query = admin.from('ps_patients').select('*').eq('organisation_id', org_id)
  if (broadcast.channel === 'sms') query = query.not('phone', 'is', null)
  if (broadcast.channel === 'email') query = query.not('email', 'is', null)
  if (broadcast.channel === 'letter') query = query.not('address_line_1', 'is', null)

  const { data: patients, error: pErr } = await query
  if (pErr) throw pErr
  if (!patients || patients.length === 0) throw new Error('No matching patients found')

  // Update broadcast status
  await admin.from('ps_broadcasts').update({
    status: 'sending',
    total_count: patients.length,
  }).eq('id', broadcast_id)

  let sentCount = 0
  let failedCount = 0

  for (const patient of patients) {
    try {
      if (broadcast.channel === 'sms' && patient.phone) {
        await handleSendSms({
          org_id, phone_number: patient.phone,
          body: broadcast.body, patient_id: patient.id,
          reference: `broadcast-${broadcast_id}`,
        }, userId)
        // Update the message's broadcast_id
      } else if (broadcast.channel === 'email' && patient.email) {
        await handleSendEmail({
          org_id, email_address: patient.email,
          subject: broadcast.subject || 'Message from your pharmacy',
          body: broadcast.body, patient_id: patient.id,
          reference: `broadcast-${broadcast_id}`,
        }, userId)
      }
      sentCount++
    } catch (_) {
      failedCount++
    }
    await sleep(20) // Rate limiting: ~50/sec, well under 3000/min
  }

  // Update broadcast final status
  await admin.from('ps_broadcasts').update({
    status: failedCount === patients.length ? 'failed' : 'sent',
    sent_count: sentCount,
    failed_count: failedCount,
  }).eq('id', broadcast_id)

  return { sent_count: sentCount, failed_count: failedCount, total_count: patients.length }
}

// --- Action: check_status ---
async function handleCheckStatus(body: any) {
  const { org_id, message_id } = body
  if (!org_id || !message_id) throw new Error('Missing org_id or message_id')

  const admin = getAdminClient()
  const settings = await getOrgSettings(admin, org_id)

  const { data: msg, error } = await admin
    .from('ps_messages')
    .select('notify_message_id')
    .eq('id', message_id)
    .eq('org_id', org_id)
    .single()
  if (error || !msg?.notify_message_id) throw new Error('Message not found')

  const result = await notifyFetch(
    settings.api_key,
    `/v2/notifications/${msg.notify_message_id}`,
  )

  // Map status
  let status = 'sending'
  if (['delivered', 'sent'].includes(result.status)) status = 'delivered'
  else if (result.status === 'permanent-failure') status = 'permanent-failure'
  else if (result.status === 'temporary-failure') status = 'temporary-failure'
  else if (result.status === 'technical-failure') status = 'technical-failure'
  else if (result.status === 'failed') status = 'failed'

  await admin.from('ps_messages').update({ status }).eq('id', message_id)
  return { status, notify_status: result.status }
}

// --- Action: test_connection ---
async function handleTestConnection(body: any) {
  const { org_id } = body
  if (!org_id) throw new Error('Missing org_id')

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('ps_notify_settings')
    .select('api_key')
    .eq('org_id', org_id)
    .single()
  if (error || !data?.api_key) throw new Error('API key not configured')

  try {
    const templates = await notifyFetch(data.api_key, '/v2/templates')
    await admin.from('ps_notify_settings')
      .update({ last_tested_at: new Date().toISOString(), is_active: true })
      .eq('org_id', org_id)
    return { valid: true, templates: templates.templates }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}

// --- Main handler ---
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    // All actions require auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    let result: any
    switch (action) {
      case 'send_sms': result = await handleSendSms(body, user.id); break
      case 'send_email': result = await handleSendEmail(body, user.id); break
      case 'send_letter': result = await handleSendLetter(body, user.id); break
      case 'send_broadcast': result = await handleSendBroadcast(body, user.id); break
      case 'check_status': result = await handleCheckStatus(body); break
      case 'test_connection': result = await handleTestConnection(body); break
      default: throw new Error(`Unknown action: ${action}`)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
```

---

## GOV.UK Notify API Reference (Key Endpoints)

| Endpoint | Method | Purpose |
|---|---|---|
| `/v2/notifications/sms` | POST | Send an SMS |
| `/v2/notifications/email` | POST | Send an email |
| `/v2/notifications/letter` | POST | Send a letter |
| `/v2/notifications/{id}` | GET | Check notification status |
| `/v2/templates` | GET | List all templates (used by test_connection) |

**Auth:** All use JWT auth — parse API key, sign JWT with HS256, include as Bearer token.

**Rate limits:** 3,000 requests/min for live keys. The `send_broadcast` action adds a 20ms delay between sends.

**Response (SMS example):**
```json
{
  "id": "740e5834-3a29-46b4-9a6f-16142fde533a",
  "reference": "your reference",
  "content": { "body": "...", "from_number": "GOVUK" },
  "template": { "id": "...", "version": 3 }
}
```

**Statuses:** `created` → `sending` → `delivered` | `permanent-failure` | `temporary-failure` | `technical-failure`

---

## 3. MessagingHubPage

Replace placeholder at: `apps/web/src/pages/messaging/MessagingHubPage.tsx`

**Requirements:**

- On mount, fetch messaging stats and recent messages for the org.
- **Header:** "Messaging" with "Compose Message" button → `/messaging/compose`.

- **Stats cards row:**
  | Card | Content |
  |---|---|
  | Today | Count of messages sent today |
  | This Week | Count of messages sent this week |
  | This Month | Count of messages sent this month |
  | Delivery Rate | % of (delivered / total excluding pending) |

  Stats fetched via Supabase count queries on `ps_messages`.

- **Quick actions:** "Send SMS" → `/messaging/compose?channel=sms`, "Send Letter" → `/messaging/compose?channel=letter`, "New Broadcast" → `/messaging/broadcasts/new`.

- **Recent messages table** (last 20):
  | Column | Content |
  |---|---|
  | Recipient | patient name or phone/email/address |
  | Channel | sms / email / letter badge |
  | Body | truncated preview (first 80 chars) |
  | Status | colour-coded badge |
  | Sent | relative time |

- **Setup prompt:** if `ps_notify_settings_safe` shows `has_api_key: false` or `is_active: false`, show a prominent banner: "Messaging is not configured. Go to Settings → Messaging to set up your NHS Notify API key."

---

## 4. ComposeMessagePage

Replace placeholder at: `apps/web/src/pages/messaging/ComposeMessagePage.tsx`

**Requirements:**

- **Channel selector:** tabs or radio buttons: SMS | Email | Letter. Pre-selected from URL query param if provided.

- **Recipient section:**
  - Patient search (typeahead against `ps_patients` for org). On select, auto-fills phone/email/address.
  - Or manual entry: phone number (for SMS), email address (for email), address lines (for letter).

- **Message body:**
  - Subject line (email only).
  - Large textarea for the message body.
  - Character count for SMS (NHS Notify SMS limit: each SMS fragment is 160 chars. Show "1 SMS" / "2 SMS" etc. based on length).
  - Preview panel: shows how the message will look (for letters: show address block + body).

- **Send button:** calls `nhs-notify` edge function with the appropriate action (`send_sms`, `send_email`, or `send_letter`).

- **On success:** show toast "Message sent", option to "Send another" or go to message history.

- **Validation:**
  - SMS: phone number is required, body is required.
  - Email: email address is required, body is required.
  - Letter: at least 3 address lines required, last line must look like a postcode or country, body is required.

---

## 5. BroadcastsPage

Replace placeholder at: `apps/web/src/pages/messaging/BroadcastsPage.tsx`

**Requirements:**

- On mount, fetch broadcasts from `ps_broadcasts` for the org, ordered by `created_at DESC`.
- **Header:** "Broadcasts" with "New Broadcast" button → `/messaging/broadcasts/new`.

- **Broadcasts table** (TanStack Table):
  | Column | Content |
  |---|---|
  | Name | broadcast name |
  | Channel | sms / email / letter badge |
  | Status | draft (grey) / sending (blue pulse) / sent (green) / failed (red) / cancelled (grey) |
  | Recipients | `sent_count / total_count` (e.g. "142/150") |
  | Failed | `failed_count` (red if > 0) |
  | Created | formatted date |
  | Actions | "Send" (if draft), "View" |

- "Send" action: confirm dialog → calls `nhs-notify` edge function with `send_broadcast`.
- "View" action: expand row or navigate to detail showing individual messages for this broadcast.

---

## 6. NewBroadcastPage

Replace placeholder at: `apps/web/src/pages/messaging/NewBroadcastPage.tsx`

**Requirements:**

- **Form fields:**
  - **Name:** descriptive name for the broadcast (e.g. "Flu Jab Reminder 2026").
  - **Channel:** SMS | Email | Letter radio.
  - **Subject:** (email only).
  - **Message body:** large textarea.
  - **Recipient filter:** for MVP, simple options:
    - "All patients" (with phone/email/address depending on channel).
    - "All patients" is the default. More filters (by age, postcode, etc.) are future enhancements.

- **Preview section:**
  - Recipient count: "This broadcast will be sent to X patients."
  - Sample message with the body text.
  - Character/SMS count for SMS.

- **Actions:**
  - "Save as Draft" → inserts to `ps_broadcasts` with `status: 'draft'`, navigates to `/messaging/broadcasts`.
  - "Send Now" → inserts as draft, then immediately calls `send_broadcast` edge function action.
  - "Cancel" → navigate back.

---

## 7. MessageHistoryPage

Replace placeholder at: `apps/web/src/pages/messaging/MessageHistoryPage.tsx`

**Requirements:**

- Paginated table of all messages from `ps_messages` for the org, ordered by `created_at DESC`.

- **Filters:**
  - Channel: All | SMS | Email | Letter.
  - Status: All | Sending | Delivered | Failed.
  - Date range: from/to date pickers.
  - Search: by recipient phone/email or patient name (join to `ps_patients`).

- **Table columns** (TanStack Table):
  | Column | Content |
  |---|---|
  | Recipient | phone/email/address_line_1 + patient name if linked |
  | Channel | badge |
  | Body | truncated preview |
  | Status | colour-coded badge with tooltip showing full status |
  | Sent | formatted datetime |
  | Actions | "Check Status" (refresh from NHS Notify), "View" (expand/modal) |

- **"Check Status" action:** calls `check_status` edge function action, updates the row in-place.

- **Pagination:** 50 rows per page, using Supabase `.range()`.

- **Export:** "Download CSV" button for the filtered results.

---

## 8. Settings: Messaging Tab

**Edit existing:** `apps/web/src/pages/SettingsPage.tsx` — add a "Messaging" tab.

**Requirements:**

- **API Key section:**
  - Input field for the NHS Notify API key. Masked display (only show last 4 chars if already set). Full key visible during entry.
  - "Save API Key" button → upserts to `ps_notify_settings`. The API key is sent to the edge function, **not** stored via the client Supabase query (the client should call a dedicated edge function action or use a service-role update). For MVP, the Settings page calls the `nhs-notify` edge function with a `save_settings` action.
  - Alternatively: the client can insert/update `ps_notify_settings` directly since RLS allows it — but the key is stored in plaintext. **For MVP this is acceptable.** In production, encrypt at rest or use Supabase Vault.

- **"Test Connection" button:**
  - Calls `test_connection` edge function action.
  - On success: shows green "Connected ✓" with template list from GOV.UK Notify.
  - On failure: shows red error message.

- **Template configuration:**
  - After successful test, show the templates fetched from GOV.UK Notify.
  - For each channel (SMS, Email, Letter): dropdown of available templates from that service.
  - The pharmacy selects which template to use for each channel.
  - "Save Templates" button → updates `ps_notify_settings.sms_template_id`, `email_template_id`, `letter_template_id`.

- **Setup instructions:**
  - Clear guidance text explaining: "Each pharmacy needs its own GOV.UK Notify account and API key."
  - Link to: https://www.notifications.service.gov.uk
  - Instructions: "Create a single SMS template with the body `((body))`. Create a single email template with the subject `((subject))` and body `((body))`. Create a single letter template with the body `((body))`."
  - Step-by-step with screenshots/descriptions.

---

## Verification Checklist

After completing all work:

- [ ] Migration applies cleanly — 3 tables created, view created, indexes and RLS policies set
- [ ] Edge function `nhs-notify` deploys and handles all 6 actions
- [ ] `send_sms` sends via GOV.UK Notify, logs to `ps_messages`
- [ ] `send_email` sends via GOV.UK Notify, logs to `ps_messages`
- [ ] `send_letter` sends via GOV.UK Notify, logs to `ps_messages`
- [ ] `send_broadcast` iterates patients, sends per-patient, updates broadcast counts
- [ ] `check_status` fetches from GOV.UK Notify and updates `ps_messages.status`
- [ ] `test_connection` validates API key and returns templates
- [ ] JWT auth for GOV.UK Notify works (parse key → extract iss/secret → sign HS256)
- [ ] `MessagingHubPage` shows stats, recent messages, setup prompt if not configured
- [ ] `ComposeMessagePage` sends SMS/email/letter with patient search and preview
- [ ] `BroadcastsPage` lists broadcasts with status and send action
- [ ] `NewBroadcastPage` creates and sends broadcasts
- [ ] `MessageHistoryPage` shows paginated filtered message log with status refresh
- [ ] Settings Messaging tab saves API key, tests connection, configures templates
- [ ] API key is never exposed to the client (fetched server-side in edge function only; view excludes it)
- [ ] No typescript errors — `pnpm build` succeeds

---

## Files Modified

| File | Action |
|---|---|
| `supabase/migrations/20260219_messaging.sql` | **CREATE** |
| `supabase/functions/nhs-notify/index.ts` | **CREATE** |
| `apps/web/src/pages/messaging/MessagingHubPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/messaging/ComposeMessagePage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/messaging/BroadcastsPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/messaging/NewBroadcastPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/messaging/MessageHistoryPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/SettingsPage.tsx` | **EDIT** — add "Messaging" tab |

**DO NOT modify** `App.tsx`, `SideNav.tsx`, or `packages/types/src/index.ts` — Agent 0 handles those.
