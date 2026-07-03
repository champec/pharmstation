# SMS Works Integration — PharmStation Messaging

**Status:** Live (deployed 2 July 2026)
**Last updated:** 3 July 2026

---

## 1. Why we switched

GOV.UK Notify (NHS Notify) **rejected our application** — they no longer support
pharmacies as a sending organisation. SMS Works is now the **primary SMS provider**
for the whole platform.

NHS Notify wiring is retained **only** for NHS-affiliated organisations that bring
their own NHS Notify API key, and only for **email and letter** channels. SMS always
goes through SMS Works.

### Architecture model

- **One platform SMS Works account** (ours). Pharmacies never hold their own SMS
  Works accounts or keys.
- Per-pharmacy identity is achieved via the **sender ID** on each message:
  - **Alphanumeric sender** (3–11 chars, e.g. `TestPharm`) — one-way, no replies.
  - **Dedicated reply number** — assigned from our pool, enables two-way SMS.
- Every outbound message is stamped with `metadata` (`org_id`, `message_id`,
  `patient_id`) which SMS Works echoes back on delivery reports and inbound
  replies — this is how multi-tenant routing works on a single account.
- **Usage is tracked per organisation per month** so pharmacies can be charged
  back for their consumption.

### Provider routing rules

| Channel | Org type                                   | Provider   |
|---------|--------------------------------------------|------------|
| SMS     | Everyone                                   | SMS Works  |
| Email   | `nhs_channels_enabled = true` + own key    | NHS Notify |
| Letter  | `nhs_channels_enabled = true` + own key    | NHS Notify |
| Email/Letter | everyone else                         | 🔒 locked in UI |

---

## 2. SMS Works API essentials

- **Base URL:** `https://api.thesmsworks.co.uk/v1`
- **Auth header:** `Authorization: JWT <token>` — the `JWT ` prefix is
  **mandatory**. A bare token returns `401`. (This cost us a debugging session;
  see §9 Troubleshooting.)
- **Platform customer ID:** `060ea4f6-6080-477f-9438-4491d2529652`
- The platform JWT is stored as the Supabase secret `SMSWORKS_JWT`
  (never commit it to the repo).
- Key endpoints used:
  - `POST /message/send` — single SMS
  - `POST /batch/send` — broadcast
  - `GET /messages/{messageid}` — status check
  - `GET /credits/balance` — connection test / balance
  - `GET /utils/test` — auth sanity check
- **Credits:** 1 credit ≈ 1 SMS segment (160 GSM chars, 153 per segment when
  multi-part). Balance currently **0** — live sends fail with error `4021`
  until topped up.
- **Delivery report webhook IPs** (allow-listed in our webhook):
  `18.170.59.20`, `35.176.98.85`, `52.56.112.179`

---

## 3. Database schema (applied via Supabase MCP — no local migration files)

All tables have RLS enabled, scoped by `org_id` membership.

### New tables

| Table | Purpose |
|-------|---------|
| `ps_sms_settings` | Per-org SMS config. `org_id` (PK), `sender_type` (`alpha` \| `number`), `sender_id`, `signature`, `reply_enabled`, `reply_number`, `reply_forward_email`, `is_active`, `last_tested_at` |
| `ps_sms_templates` | Org-scoped message templates. `body` supports `{{placeholder}}` syntax, `category`, `is_active` |
| `ps_sms_reply_numbers` | Pool of virtual numbers. `status` (`available` \| `assigned`), `org_id` when assigned |
| `ps_sms_inbound` | Received replies. `org_id`, `reply_number`, `from_number`, `patient_id`, `content`, `provider_message_id`, `outbound_message_id`, `metadata` |
| `ps_sms_usage_monthly` | Per-org, per-month rollups: messages sent, credits, segments, inbound count — the chargeback source of truth |

### Views

- `ps_sms_billing_summary` — joined billing view over usage + org details.
  Set to `security_invoker` (fixed after a security advisor warning).

### Extended existing tables

- `ps_messages` — added: `provider`, `credits`, `segments`, `sms_sender`,
  `reply_number`, `template_id`
- `ps_organisations` — added: `messaging_provider` (default `'smsworks'`),
  `nhs_channels_enabled` (default `false`)

### RPCs (security definer)

| Function | Purpose |
|----------|---------|
| `ps_sms_save_settings` | Upsert an org's SMS settings with validation |
| `ps_sms_assign_reply_number` | Atomically claim an available pool number for an org |
| `ps_sms_release_reply_number` | Return a number to the pool |
| `ps_sms_record_usage` | Increment monthly usage counters (called by edge function on every send/inbound) |

---

## 4. Edge functions

Both live in `supabase/functions/` and are deployed with the CLI
(`npx supabase functions deploy <name>`). Migrations go via MCP; functions go
via CLI — that's the split.

### `sms-works` (~753 lines, `verify_jwt` **on**)

Client-facing API, called from the messaging store with a Supabase user JWT.

**Actions:**

| Action | Purpose |
|--------|---------|
| `send_sms` | Send a single SMS |
| `notify` | Template-driven send (used by app flows, e.g. "prescription ready") |
| `send_broadcast` | Batch send to multiple recipients |
| `check_status` | Poll SMS Works for a message's current status |
| `test_connection` | Auth check + returns credit balance |
| `save_settings` / `get_settings` | Org SMS settings CRUD |
| `get_webhook_info` | Returns the webhook URL (incl. token) for dashboard registration |
| `list_templates` / `save_template` / `delete_template` | Template CRUD |
| `assign_reply_number` / `release_reply_number` | Reply number pool management |
| `usage_summary` | Monthly usage for the billing UI |

**Key internals:**

- `getPlatformJwt()` — returns `JWT <token>` (prefix included).
- `normaliseDestination()` — accepts `07…`, `+44…`, `44…` → normalises to
  `44…`; validates 8–15 digits.
- `validateAlphaSender()` — 3–11 chars, alphanumeric, rejects restricted terms
  (bank names, "NHS", etc. per SMS Works rules).
- `buildContent()` — renders template placeholders, appends the org signature.
- `sendSms()` flow:
  1. Insert `ps_messages` row with status `pending` **before** sending
  2. Stamp `metadata: [org_id, message_id, patient_id]`
  3. POST to SMS Works
  4. Update row with provider `messageid`, `credits`, `segments`, status `sent`
  5. Call `ps_sms_record_usage`

> Note: the editor shows "Cannot find name 'Deno'" in these files — that's
> normal for Deno edge functions and does not affect deployment.

### `sms-works-webhook` (256 lines, deployed with `--no-verify-jwt`)

Receives delivery reports and inbound replies from SMS Works.

**Auth (either):**
1. `?token=<SMSWORKS_WEBHOOK_SECRET>` query param match, **or**
2. Source IP in the SMS Works allow-list (see §2)

**Delivery reports:**
- Match `ps_messages` on `notify_message_id` + `provider = 'smsworks'`
- Status mapping: `DELIVERED → delivered`, `UNDELIVERABLE → permanent-failure`,
  `REJECTED → permanent-failure`, `EXPIRED → temporary-failure`, etc.
- Updates credits/segments/timestamps on the row

**Inbound replies — routing order:**
1. Echoed `metadata.org_id` (most reliable)
2. `to` number lookup in `ps_sms_reply_numbers`
3. Fallback: match against a recent outbound message
- Patient matched by normalised phone; row inserted into `ps_sms_inbound`;
  usage counted.

---

## 5. Secrets & configuration

Set via `npx supabase secrets set` on project `xsqwpmqfbirqdncoephf`:

| Secret | Purpose |
|--------|---------|
| `SMSWORKS_JWT` | Platform API token (stored **without** the `JWT ` prefix; the function adds it) |
| `SMSWORKS_WEBHOOK_SECRET` | Shared secret for webhook URL auth: `f5142aab0a8a1c8ba610b8d9bee30571de0b46b7268a9689` |

**Webhook URL to register (see §8):**

```
https://xsqwpmqfbirqdncoephf.supabase.co/functions/v1/sms-works-webhook?token=f5142aab0a8a1c8ba610b8d9bee30571de0b46b7268a9689
```

---

## 6. Client-side changes

### `packages/types/src/index.ts`
- New: `SmsSettings`, `SmsTemplate`, `SmsReplyNumber`, `SmsInbound`,
  `SmsUsageSummary`
- `NotifyMessage` extended: `provider`, `credits`, `segments`, `sms_sender`,
  `reply_number`, `template_id`, `feature`, `reference`, patient join
- `Organisation` extended with routing fields

### `packages/core/src/stores/messaging-store.ts`
- **Provider routing:** SMS → `sms-works` function; email/letter →
  `nhs-notify` function (only if `nhs_channels_enabled`)
- Existing signatures preserved (`notify`, `sendMessage`, `sendBroadcast`) so
  call-sites didn't change
- New state/actions: `routing`/`fetchRouting`, `smsSettings`/`fetchSmsSettings`/
  `saveSmsSettings`/`testSmsConnection`, `smsTemplates` + CRUD,
  `assignReplyNumber`/`releaseReplyNumber`, `usage`/`fetchSmsUsage`
- `checkStatus(orgId, messageId)` takes **our row id** and resolves provider
  internally (state → DB fallback)

### Web app pages (`apps/web/src/`)

| File | Change |
|------|--------|
| `pages/settings/MessagingSettingsTab.tsx` | New SMS Works-first settings UI: connection test (shows balance), sender identity (alpha/number), signature, two-way replies (request/release number, forward email), template manager with segment estimator, usage & billing table. NHS Notify section only rendered for NHS-affiliated orgs; locked info card otherwise |
| `pages/SettingsPage.tsx` | Old inline messaging tab removed; imports the new tab |
| `pages/messaging/MessagingHubPage.tsx` | Provider-aware `isConfigured` check; recent messages rows **clickable** → opens shared detail modal; status badges use pending semantics |
| `pages/messaging/ComposeMessagePage.tsx` | Provider-aware gating with channel-specific banners; 🔒 on email/letter for non-NHS orgs; reuse-prefill via router state; success modal says **"Message Queued"** (pending-honest wording) |
| `pages/messaging/NewBroadcastPage.tsx` | Same provider-aware gating + locked channels |
| `pages/messaging/MessageHistoryPage.tsx` | Clickable rows → detail modal (check status / retry / reuse / copy provider id), status filter, CSV export, pending labels |
| `components/messaging/MessageDetailModal.tsx` | **New shared modal**: message detail, check-status, retry (failed only), reuse-as-new, copy provider ID. Exports `STATUS_BADGES`, `STATUS_LABELS`, `FAILED_STATUSES` |

### Status display semantics (important)

A message is only shown as **Delivered** when the webhook confirms it.
Until then the API-accepted state renders as **⏳ Pending**:

| DB status | UI label |
|-----------|----------|
| `created` | Created |
| `sending` | ⏳ Pending |
| `sent` | ⏳ Pending *(accepted by gateway, not yet confirmed)* |
| `delivered` | ✓ Delivered |
| `failed` / `technical-failure` | Failed / Tech. failure |
| `permanent-failure` | Perm. failure *(carrier rejected — credit refunded by SMS Works)* |
| `temporary-failure` | Temp. failure |

---

## 7. Billing / chargeback

- Every send calls `ps_sms_record_usage(org_id, credits, segments, …)`.
- `ps_sms_usage_monthly` holds one row per org per calendar month.
- `ps_sms_billing_summary` view joins in org names for reporting.
- Settings UI shows the org its own usage; the platform owner queries the
  view for invoicing.
- Inbound replies are also counted (reply numbers carry a monthly cost worth
  passing through).

---

## 8. Manual setup steps (SMS Works dashboard)

These **cannot be done via API** — the account owner must:

1. **Register the delivery-report webhook**
   Dashboard → *Delivery Reports* → *Webhook Configuration* → paste the URL
   from §5. Without this, messages stay ⏳ Pending forever.
2. **Register the same URL for inbound** on any reply number when one is
   purchased (per-number inbound webhook setting).
3. **Top up credits** — balance is currently **0**; live sends fail with
   error `4021` until funded.
4. When buying reply numbers, insert them into the pool:
   ```sql
   insert into ps_sms_reply_numbers (number, status) values ('447700900123', 'available');
   ```

---

## 9. Troubleshooting log (issues hit during build)

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| All API calls `401` despite valid credentials | Auth header needs the literal prefix: `Authorization: JWT <token>` | `getPlatformJwt()` prepends `JWT ` |
| App showed "sent" but SMS Works dashboard showed `UNDELIVERABLE` | Webhook not registered, so delivery reports never arrived; separately the carrier rejected that specific number (failure code 4, permanent, credit auto-refunded) | Register webhook (§8); number formatting was verified correct (`447989224165`) |
| "Messaging not configured" banner despite SMS enabled | Three pages still gated on the legacy NHS Notify `has_api_key` check | Replaced with provider-aware checks (`smsSettings.is_active` OR NHS path) |
| Status "Check" button did nothing | Passed the provider message id where the store expects our row id | `checkStatus(orgId, m.id)` |
| Test user couldn't log in | Password drift in DB | Reset via SQL `extensions.crypt()`; creds: `testuser@pharmstation.dev` / `TestUser123!` |
| Security advisor warning on billing view | View defaulted to `security definer` | Recreated with `security_invoker` |

### Smoke tests performed

- `GET /utils/test` + `GET /credits/balance` with platform JWT → ✅ (balance 0)
- Webhook, no token → `401` ✅
- Webhook, valid token + synthetic delivery report → `{"received":true,"updated":0}` ✅
- Edge function without user JWT → `401` (verify_jwt working) ✅
- Settings save / template CRUD / reply number assign-release → ✅ via UI

---

## 10. Test fixtures

| Item | Value |
|------|-------|
| Test org | `8c78fb31-8bd9-42f4-8bec-dbdfd8fb2fd1` ("PharmStation Test Pharmacy") |
| Sender ID | `TestPharm` (alpha, active) |
| Test login | `testuser@pharmstation.dev` / `TestUser123!` |

---

## 11. Deployment reference

```powershell
# Deploy client-facing function (JWT verification on)
npx supabase functions deploy sms-works --project-ref xsqwpmqfbirqdncoephf

# Deploy webhook (no JWT — SMS Works can't send one)
npx supabase functions deploy sms-works-webhook --project-ref xsqwpmqfbirqdncoephf --no-verify-jwt

# Secrets
npx supabase secrets set SMSWORKS_JWT="<token-without-prefix>" --project-ref xsqwpmqfbirqdncoephf
npx supabase secrets set SMSWORKS_WEBHOOK_SECRET="<secret>" --project-ref xsqwpmqfbirqdncoephf
```

Database changes: **always via Supabase MCP** (`apply_migration`) — this repo
intentionally has no local migration files for this work.
