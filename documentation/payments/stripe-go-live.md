# Switching Stripe to live and launching subscriptions

> Written 2 November 2026 with the subscription billing PR. Steps marked **(you)**
> need a person with the Stripe and Supabase dashboards; nothing here can be
> done from code alone.

Plans: **Network £0**, **Essential £39/month**, **Complete £79/month**, 30-day free
trial on a pharmacy's first subscription. Catalogue: `packages/core/src/billing/plans.ts`.

## 0. Decide first

- **Which Stripe account.** The only account connected today is *Pharmacyskills*
  (`acct_1GPB3EJZmNRxvVF2`), which also bills other, older products. That works
  (everything PharmStation creates is tagged and the webhook ignores the rest),
  but card statements and receipts will say the account's business name unless
  you change it. A separate Stripe account for PharmStation is cleaner for
  accounts and VAT. Decide before step 2, because customers and Connect accounts
  can't be moved between Stripe accounts later.
- **VAT.** Prices are set as *exclusive* of tax. If PharmStation is VAT
  registered, turn on Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`; otherwise
  leave it off and no VAT is added.
- **Where the app runs.** Do this after the London cutover so the live webhook
  points at the London project and you set secrets only once.

## 1. Database

Run `documentation/payments/subscriptions-schema.sql` in the SQL editor of the
project the app uses (London: `dbgwfdrvqzuevbfrmsdt`). It creates
`ps_org_subscriptions`, `ps_org_effective_plan()`, adds a retry counter to
`ps_stripe_webhook_events`, and gives every existing organisation complimentary
Complete until 31 Jan 2027 so nobody is locked out.

## 2. Try it end to end in test mode first (you, ~15 minutes)

```bash
STRIPE_SECRET_KEY=sk_test_... node tooling/stripe/setup-billing.mjs \
  --webhook-url https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

Set the secrets it prints, deploy `stripe-billing`, `stripe-webhook` and
`stripe-connect` (`stripe-webhook` keeps `verify_jwt = false`), then in the app go
to **Settings → Plan & billing**, start a trial with card 4242 4242 4242 4242,
and check the plan shows as Essential/Complete with "Free trial". Open "Manage
billing" and switch plan and cancel once each.

## 3. Go live (you)

1. In the Stripe dashboard, finish live activation: business details, bank
   account, identity, and **Connect → platform profile** again in live mode.
2. **Rotate the old test secret key** (it was pasted in a chat in July).
3. Create a **restricted live key** or use the live secret key, then run:
   ```bash
   STRIPE_SECRET_KEY=sk_live_... node tooling/stripe/setup-billing.mjs \
     --webhook-url https://<project-ref>.supabase.co/functions/v1/stripe-webhook
   ```
4. Set Supabase edge function secrets (replace the test values):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`,
   `STRIPE_PORTAL_CONFIGURATION`. Optional: `BILLING_TRIAL_DAYS` (default 30),
   `STRIPE_AUTOMATIC_TAX`, `APP_ORIGINS`.
5. Clear test-mode Stripe ids, which don't exist in live mode:
   ```sql
   update ps_org_billing set stripe_customer_id = null, stripe_account_id = null,
     stripe_account_status = 'not_onboarded', charges_enabled = false, payouts_enabled = false;
   update ps_locum_profiles set stripe_account_id = null, stripe_onboarded = false;
   update ps_org_subscriptions set plan = 'network', status = 'none', stripe_subscription_id = null,
     stripe_price_id = null, current_period_end = null, trial_end = null,
     cancel_at_period_end = false, canceled_at = null;
   ```
   (The billing function also recovers on its own if it meets an old test
   customer id, but Connect onboarding needs the reset.)
6. Each pharmacy that takes card payments redoes **Settings → Payments → Set up
   payments** (live Connect onboarding with their real bank).
7. Make a real £39 purchase on your own card, check it appears in Stripe, in
   `ps_org_subscriptions` and as a `subscription` row on the Payments ledger, then
   refund and cancel it.

## 4. Turn on plan enforcement

When every existing organisation has a subscription or a comp, set
`VITE_ENFORCE_PLANS=true` in Vercel and redeploy. Until then the app shows the
Plan & billing page but doesn't lock anything.

- Locked pages show an upgrade card; side menu items show a 🔒.
- Enforcement is in the web app only. Server-side checks for costly actions
  (SMS sends, video rooms) should call `ps_org_effective_plan(org_id)`; that is
  the follow-up before charging for SMS.

## Founding pharmacies

- **Price lock**: automatic. Stripe keeps existing subscribers on the price they
  signed up at, even if the plan price changes later.
- **Mark as founding member**: `update ps_org_subscriptions set is_founding_member = true where org_id = '…';`
  (or set `founding=true` in the subscription's metadata in Stripe).
- **Comp a plan without Stripe** (demos, friends):
  `update ps_org_subscriptions set override_plan = 'complete', override_until = '2027-03-31', override_reason = 'demo' where org_id = '…';`
- **Discounts**: create a coupon + promotion code in Stripe; Checkout accepts codes.
