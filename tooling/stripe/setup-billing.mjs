#!/usr/bin/env node
// ============================================================
// PharmStation Stripe billing setup — run once per Stripe mode (test, then live).
//
//   STRIPE_SECRET_KEY=sk_test_... node tooling/stripe/setup-billing.mjs
//   STRIPE_SECRET_KEY=sk_live_... node tooling/stripe/setup-billing.mjs \
//       --webhook-url https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//
// Safe to run again: everything is found by lookup key / metadata first.
// What it does:
//   1. Products + monthly GBP prices for Essential and Complete, with the
//      lookup keys the stripe-billing function asks for. If a plan's price
//      changes, a new Price takes over the lookup key; existing subscribers
//      stay on their old price (that is the founding price lock).
//   2. A customer-portal configuration for PharmStation (switch plan, update
//      card, cancel at period end, invoices). Prints its id for the
//      STRIPE_PORTAL_CONFIGURATION secret, so other businesses on the same
//      Stripe account keep their own default portal.
//   3. With --webhook-url: the platform and Connect webhook endpoints, and
//      prints their signing secrets (only shown when first created).
//
// No dependencies. Prices must match packages/core/src/billing/plans.ts.
// ============================================================

const ESSENTIAL = { plan: 'essential', name: 'PharmStation Essential',
  description: 'Paperless compliance: CD register, RP log, returns, logs, SOPs.' }
const COMPLETE = { plan: 'complete', name: 'PharmStation Complete',
  description: 'Everything in Essential plus booking, payments, video, messaging and deliveries.' }

const PLANS = [
  { ...ESSENTIAL, interval: 'month', amount: 1500, lookupKey: 'pharmstation_essential_monthly' },
  { ...ESSENTIAL, interval: 'year', amount: 15000, lookupKey: 'pharmstation_essential_annual' },
  { ...COMPLETE, interval: 'month', amount: 2900, lookupKey: 'pharmstation_complete_monthly' },
  { ...COMPLETE, interval: 'year', amount: 29000, lookupKey: 'pharmstation_complete_annual' },
]

// Product per plan, remembered within a run (Stripe search is eventually consistent).
const productByPlan = {}

const PLATFORM_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
]
const CONNECT_EVENTS = ['account.updated']

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('Set STRIPE_SECRET_KEY first.')
  process.exit(1)
}
const mode = /^(sk|rk)_live_/.test(key) ? 'LIVE' : 'TEST'
const args = process.argv.slice(2)
const webhookUrl = args.includes('--webhook-url') ? args[args.indexOf('--webhook-url') + 1] : null
const dryRun = args.includes('--dry-run')

// ---------- tiny Stripe client ----------
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const name = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encode(item, `${name}[${i}]`, out)
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(item)}`)
      })
    } else if (typeof v === 'object') {
      encode(v, name, out)
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(v)}`)
    }
  }
  return out
}

async function stripe(method, path, params) {
  const body = params ? encode(params).join('&') : undefined
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`
  if (dryRun && method !== 'GET') {
    console.log(`  [dry run] ${method} ${path}`)
    return { id: '(dry-run)' }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-02-24.acacia',
    },
    body: method === 'GET' ? undefined : body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message ?? res.status}`)
  return json
}

// ---------- 1. products + prices ----------
async function ensurePlan(p) {
  const existing = (await stripe('GET', '/prices', { 'lookup_keys[]': p.lookupKey, active: 'true', expand: ['data.product'] })).data[0]
  const label = `${p.name} £${p.amount / 100}/${p.interval}`
  if (existing && existing.unit_amount === p.amount && existing.currency === 'gbp' && existing.recurring?.interval === p.interval) {
    console.log(`  ✓ ${label}: ${existing.id} already set up`)
    productByPlan[p.plan] = existing.product.id ?? existing.product
    return { productId: productByPlan[p.plan], priceId: existing.id }
  }

  let productId = productByPlan[p.plan] ?? (existing ? (existing.product.id ?? existing.product) : null)
  if (!productId) {
    const found = await stripe('GET', '/products/search', { query: `metadata['ps_plan']:'${p.plan}' AND active:'true'` })
    productId = found.data[0]?.id ?? null
  }
  if (!productId) {
    const product = await stripe('POST', '/products', {
      name: p.name,
      description: p.description,
      statement_descriptor: 'PHARMSTATION',
      metadata: { ps_plan: p.plan, app: 'pharmstation' },
    })
    productId = product.id
    console.log(`  + product ${p.name}: ${productId}`)
  }

  const price = await stripe('POST', '/prices', {
    product: productId,
    currency: 'gbp',
    unit_amount: p.amount,
    recurring: { interval: p.interval },
    tax_behavior: 'exclusive',
    lookup_key: p.lookupKey,
    transfer_lookup_key: 'true',
    nickname: `${p.name} ${p.interval === 'year' ? 'annual' : 'monthly'}`,
    metadata: { ps_plan: p.plan, app: 'pharmstation' },
  })
  console.log(`  + price ${label}: ${price.id}${existing ? ` replaces ${existing.id}` : ''}`)
  productByPlan[p.plan] = productId
  return { productId, priceId: price.id }
}

// ---------- 2. customer portal ----------
async function ensurePortal(planIds) {
  const params = {
    business_profile: { headline: 'Manage your PharmStation subscription' },
    features: {
      customer_update: { enabled: 'true', allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: 'true' },
      payment_method_update: { enabled: 'true' },
      subscription_cancel: {
        enabled: 'true',
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: 'true',
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'],
        },
      },
      subscription_update: {
        enabled: 'true',
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: Object.entries(
          planIds.reduce((acc, p) => ({ ...acc, [p.productId]: [...(acc[p.productId] ?? []), p.priceId] }), {}),
        ).map(([product, prices]) => ({ product, prices })),
      },
    },
    metadata: { app: 'pharmstation' },
  }

  const configs = await stripe('GET', '/billing_portal/configurations', { active: 'true', limit: 100 })
  const ours = configs.data.find((c) => c.metadata?.app === 'pharmstation')
  if (ours) {
    await stripe('POST', `/billing_portal/configurations/${ours.id}`, params)
    console.log(`  ✓ portal configuration updated: ${ours.id}`)
    return ours.id
  }
  const created = await stripe('POST', '/billing_portal/configurations', params)
  console.log(`  + portal configuration: ${created.id}`)
  return created.id
}

// ---------- 3. webhooks ----------
async function ensureWebhook(url, events, connect) {
  const list = await stripe('GET', '/webhook_endpoints', { limit: 100 })
  const kind = connect ? 'connect' : 'platform'
  const sameUrl = list.data.filter((w) => w.url === url)
  // Match our tag first, then an older untagged endpoint of the same kind
  // (a Connect endpoint only listens to account.updated).
  const looksConnect = (w) => w.enabled_events.length === 1 && w.enabled_events[0] === 'account.updated'
  const existing =
    sameUrl.find((w) => w.metadata?.ps_kind === kind) ??
    sameUrl.find((w) => !w.metadata?.ps_kind && looksConnect(w) === connect)
  if (existing) {
    await stripe('POST', `/webhook_endpoints/${existing.id}`, { enabled_events: events, metadata: { ps_kind: kind, app: 'pharmstation' } })
    console.log(`  ✓ ${connect ? 'Connect' : 'platform'} webhook ${existing.id} updated (signing secret unchanged)`)
    return null
  }
  const created = await stripe('POST', '/webhook_endpoints', {
    url,
    enabled_events: events,
    connect: connect ? 'true' : undefined,
    api_version: '2025-02-24.acacia',
    description: `PharmStation ${connect ? 'Connect' : 'platform'} events`,
    metadata: { ps_kind: connect ? 'connect' : 'platform', app: 'pharmstation' },
  })
  console.log(`  + ${connect ? 'Connect' : 'platform'} webhook ${created.id}`)
  return created.secret
}

console.log(`\nPharmStation billing setup — Stripe ${mode} mode${dryRun ? ' (dry run)' : ''}\n`)
console.log('Plans:')
const planIds = []
for (const p of PLANS) planIds.push(await ensurePlan(p))

console.log('\nCustomer portal:')
const portalId = await ensurePortal(planIds)

const secrets = { STRIPE_PORTAL_CONFIGURATION: portalId }
if (webhookUrl) {
  console.log('\nWebhooks:')
  const platformSecret = await ensureWebhook(webhookUrl, PLATFORM_EVENTS, false)
  const connectSecret = await ensureWebhook(webhookUrl, CONNECT_EVENTS, true)
  if (platformSecret) secrets.STRIPE_WEBHOOK_SECRET = platformSecret
  if (connectSecret) secrets.STRIPE_CONNECT_WEBHOOK_SECRET = connectSecret
}

console.log('\nSet these Supabase edge function secrets (Dashboard → Edge Functions → Secrets):')
for (const [k, v] of Object.entries(secrets)) console.log(`  ${k}=${v}`)
console.log('  STRIPE_SECRET_KEY=<the key you ran this with>')
console.log('\nDone.\n')
