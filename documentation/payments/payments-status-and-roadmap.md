# PharmStation Payments — Status & Roadmap

> **Last updated:** 3 July 2026
> **Stripe account:** Pharmacyskills (`acct_1GPB3EJZmNRxvVF2`) — **test mode**
> **Supabase project:** `xsqwpmqfbirqdncoephf`
> **Working conventions:** DB changes via Supabase MCP only (no local SQL files);
> edge functions deployed via MCP; Stripe admin via Stripe CLI with `--api-key`
> (browser login doesn't work on this machine).

---

## 1. What's live today ✅

### Phase 1 — Patient payments for chargeable services

Patients booking a chargeable service on the public booking site pay by card
through **Stripe Checkout** (hosted page — no card data ever touches us).

**Flow:**
1. Pharmacy marks a service chargeable + sets a price (Services → detail → 💳 Payments card)
2. Public booking page shows the price; patient books a slot and enters details
3. Patient record found-or-created via `ps_public_find_or_create_patient` RPC
4. Appointment created (`pending`), then `stripe-checkout` creates a Checkout Session
   - price is **always read server-side** from `ps_services` — client can't tamper
   - a `ps_payments` ledger row is created *before* redirect (single source of truth)
5. Patient pays on Stripe; webhook flips payment → `succeeded`
6. Patient lands on `/book/:orgSlug/payment-result` which polls until confirmed
7. Pharmacy sees money in the 💳 Payments page (`/payments`)

### Phase 2 — Pharmacy onboarding (Stripe Connect Express)

Pharmacies connect their own bank account so patient money routes **directly to
them** (destination charges). PharmStation never holds funds.

**Flow:**
1. Settings → Payments tab → "🚀 Set up payments"
2. `stripe-connect` creates an Express account (GB, card_payments + transfers)
   and returns a hosted onboarding link (Stripe handles KYC/bank/ID)
3. `account.updated` webhook syncs status back to `ps_org_billing`
4. Once `charges_enabled`, checkout automatically adds
   `transfer_data.destination` → funds route to the pharmacy
5. Platform fee: `PLATFORM_FEE_PERCENT` env (currently **0** — free tier;
   note at 0% we absorb Stripe's ~1.5% + 20p per UK card charge)

### Database (all applied remotely via MCP)

| Table | Purpose |
|---|---|
| `ps_services` (+cols) | `is_chargeable`, `price_pence`, `currency` |
| `ps_org_billing` | per-org Stripe state: `stripe_customer_id`, `stripe_account_id`, `stripe_account_status` (not_onboarded/pending/active/restricted), `charges_enabled`, `payouts_enabled` |
| `ps_payments` | universal money ledger — `kind`: service/delivery/subscription/credits/locum/platform_fee/other; `status`: pending/processing/succeeded/failed/refunded/partially_refunded/canceled; stripe ids; jsonb metadata |
| `ps_stripe_webhook_events` | idempotency (unique `stripe_event_id`) |

Also: `ps_patients_nhs_unique` relaxed to a partial index (blank NHS numbers no
longer collide), and `ps_public_find_or_create_patient` SECURITY DEFINER RPC
(anon-safe patient creation; reuses record on NHS match; never overwrites PII).

### Edge functions (deployed via MCP)

| Function | Ver | JWT | Actions |
|---|---|---|---|
| `stripe-checkout` | v6 | ✅ | `create_checkout_session` (server-side pricing, destination charges, email validation — invalid emails skipped so Checkout collects instead of erroring), `get_payment` (polling) |
| `stripe-webhook` | v4 | ❌ (Stripe signature) | `checkout.session.completed/expired`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated` (Connect). Dual-secret verification, idempotent, 500-on-error so Stripe retries |
| `stripe-connect` | v3 | ✅ | `start_onboarding` (Express account + hosted link), `get_status` (live Stripe fetch + DB sync). Org-member auth (`ps_organisation_members` organisation_id/user_id/status=active, or org owner) |

### Stripe configuration

| Item | Value |
|---|---|
| Platform webhook | `we_1Tp5eSJZmNRxvVF2lFKtLA6z` → `/functions/v1/stripe-webhook` (4 events) |
| Connect webhook | `we_1Tp5lpJZmNRxvVF24MjzS04R` → same URL, `connect=true`, `account.updated` |
| Edge secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` |
| Optional env | `PLATFORM_FEE_PERCENT` (default 0) |
| Connect enabled | ✅ + platform-profile (loss liability) completed |
| Test connected account | `acct_1Tp6dMJhNkHGAw61` (Test Pharmacy — active, charges+payouts enabled) |

### Web UI

| Page | Route | What |
|---|---|---|
| Service detail | `/services/:id` | 💳 chargeable toggle + £ price |
| Public service | `/book/:org/service/:id` | price display, slot picker |
| Booking confirm | `/book/:org/service/:id/confirm` | RPC patient create → checkout redirect, real error surfacing |
| Payment result | `/book/:org/payment-result` | polls payment status (success/cancel/fail/timeout) |
| Payments (org) | `/payments` | ledger list, filters, collected total |
| Settings → Payments | `/settings?tab=payments` | onboarding button, status badge, refresh |

### Fixed along the way (regression watchlist)

- Public pages: `slug.eq.X,id.eq.X` OR-filter blew up on non-UUID slugs → `orgSlugOrIdFilter()` helper (`apps/web/src/lib/orgSlugFilter.ts`)
- Recurring slots were cosmetic (stored RRULE, created 1 row) → now materialised
  into real rows over an 8-week horizon at creation (`apps/web/src/lib/recurrence.ts`,
  `createSlotsBulk` in appointment store); past-dated occurrences skipped
- Anonymous patients couldn't book at all (no anon INSERT policy on `ps_patients`) → RPC
- NHS number blank collisions (NULLS NOT DISTINCT unique) → partial unique index

---

## 2. Roadmap — what's left 🚧

> Priority order agreed 3 Jul 2026. Next session starts with **Phase 3**.

### Phase 3 — Locum payments (locums sell services to pharmacies)

Locums are essentially micro-businesses selling shifts to pharmacies — same
Connect Express pattern as pharmacies, different direction of money.

**Phase 3a — locum onboarding: DONE (3 Jul 2026)**

- [x] Locum Stripe account stored on `ps_locum_profiles`
      (`stripe_account_id`, `stripe_onboarded`) — no new table needed
- [x] `stripe-connect` **v4** — entity adapter pattern: `entity: 'org' | 'locum'`.
      Locum accounts created as Express + `business_type: 'individual'`, metadata
      `{ locum_user_id }`. Caller auth = locum's own JWT (any client).
- [x] `stripe-webhook` **v5** — `account.updated` routes by metadata:
      `locum_user_id` → `ps_locum_profiles`, else org → `ps_org_billing`
- [x] Locum-side UI: `/locum/profile` → **💰 Get Paid** tab (status badge,
      Set up payments → Stripe, refresh; handles `?stripe_return=1`)
- [x] **Personal profile tier**: `/me` (personal details, workplace, locum
      section, billing placeholder) + `/me/login` (user-layer login that
      bypasses org login). Entry points: 👤 button in org TopNav, link on
      `/login/org`.

**Phase 3b — invoice payments: NEXT**

- [ ] Pharmacy-side: locum invoice list (`ps_locum_invoices` already has
      subtotal/platform_fee/total pence columns) → **authorize / adjust / pay**
      per invoice → `stripe-checkout` variant or PaymentIntent with
      `transfer_data.destination` = locum's account
- [ ] **"Pay all outstanding"** batch action (sequential PaymentIntents; simple v1)
- [ ] Webhook: mark invoice paid on success; ledger rows `kind='locum'`
- [ ] Deferred: tips (explicitly out of scope for launch), Bacs mandates
      (`ps_locum_payment_mandates`), invoice PDFs

### Phase 4 — Platform monetization (webmaster tooling)

PharmStation charges pharmacies: membership tiers + per-module add-ons.

- [ ] **Pricing catalog — hardcoded** in a shared package (e.g.
      `packages/core/src/pricing.ts`): tiers (free/standard/pro…) + module
      add-ons (SMS credits, NHS integrations, video, delivery…) with pence prices.
      No DB, no admin price-editing UI for v1 — change price = code change (auditable)
- [ ] Org subscription: Stripe **Billing subscriptions** on the platform account
      (`ps_org_billing.stripe_customer_id` already exists for this).
      Checkout in subscription mode → webhook `customer.subscription.*` → sync
      `ps_org_subscriptions` table (tier, module flags, current_period_end)
- [ ] SMS credits: charge via subscription metered usage OR monthly invoice from
      `ps_sms_usage_monthly` (decide next session)
- [ ] **Webmaster admin UI** (me-only): list all orgs with tier, module add-ons,
      Connect status, MRR; actions = comp a module, pause org, view Stripe links.
      Auth: platform-admin role check (new `ps_platform_admins` table or hardcoded
      user id list for v1)
- [ ] Module gating in-app: read org's subscription row → feature flags

### Phase 5 — Delivery payments (patients pay for deliveries)

- [ ] Wire the existing delivery system (`ps_service_deliveries`,
      documentation/delivery-expansion/) to `stripe-checkout`
- [ ] One-off per-delivery charge (ledger `kind='delivery'`) — reuses everything
      from Phase 1, just a different origin page
- [ ] Patient delivery subscriptions (weekly/monthly) — Stripe Billing
      subscriptions against the **connected account** (or platform with
      destination transfers — decide: subscriptions on connected accounts need
      `on_behalf_of`; simpler v1 = platform subscription + monthly transfer)

### Phase 6 — Personal payment profile (user-level, NOT org)

A user's own wallet/billing area, independent of any organisation.

- [ ] `/account/billing` (or `/profile?tab=billing`) — for patients and locums:
      saved cards, payment history, invoices/receipts
- [ ] Stripe **Customer** per auth user (`ps_user_billing`: user_id ↔
      stripe_customer_id) — distinct from org customers
- [ ] Saved cards via Stripe **Customer Portal** (hosted — zero PCI surface) or
      SetupIntent + `customer_sessions` if we want it in-app
- [ ] Payment history: `ps_payments` filtered by patient/user + Stripe-hosted
      invoice/receipt links (`invoice.hosted_invoice_url` / receipt_url)
- [ ] Checkout upgrade: pass `customer` so returning patients get saved cards

### Cross-cutting / housekeeping

- [ ] **Rotate Stripe test secret key** before go-live (was pasted in chat)
- [ ] Live-mode switch checklist: live keys, live webhooks (CLI), re-run
      Connect platform profile in live mode, real bank KYC
- [ ] Auto-cancel appointments whose payment never completes (webhook/cron on
      `checkout.session.expired` — currently appointment stays `pending`)
- [ ] Refunds from within PharmStation UI (currently: Stripe dashboard only)
- [ ] Slot series top-up cron (8-week recurrence horizon needs periodic regeneration)
- [ ] Supabase security advisory: **118 tables with RLS disabled** — dedicated pass
- [ ] Commit all of this to git (nothing is committed yet!)

---

## 3. Key IDs & test data (test mode)

| Thing | Value |
|---|---|
| Test org | `8c78fb31-8bd9-42f4-8bec-dbdfd8fb2fd1` (slug `test-pharmacy`) |
| Test user (owner) | `58514a87-2a0f-4c2d-8f98-d336db196fa5` |
| Connected account | `acct_1Tp6dMJhNkHGAw61` (active) |
| Chargeable services | Flu Vaccination £15 (`c9d42080…`), Chain-saw £15 (`1a2a3a06…`) |
| Test card | `4242 4242 4242 4242`, any future expiry, any CVC |
| Test sort code / account | `10-88-00` / `00012345` (Connect onboarding) |

## 4. Architecture principles (keep these)

1. **Stripe-hosted everything** — Checkout, Express onboarding, Customer Portal.
   We never render card fields; PCI scope stays SAQ-A.
2. **Server-side pricing** — amounts only ever come from our DB/hardcoded catalog.
3. **Ledger-first** — `ps_payments` row exists before any Stripe object; webhooks
   only ever *update* it. One table = whole money story.
4. **Idempotent webhooks** — unique `stripe_event_id`, 500-on-failure for retries.
5. **DB via MCP only** — no local migration files; history lives in Supabase.
6. **Surface real errors** — always bubble Stripe's message to the UI.
