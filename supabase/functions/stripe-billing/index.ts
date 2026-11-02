// ============================================================
// PharmStation Edge Function: stripe-billing
// Platform subscriptions: pharmacies paying PharmStation for a plan.
// (Patient payments are stripe-checkout; pharmacy payouts are stripe-connect.)
//
// Actions (all need a signed-in user who belongs to org_id):
//   get_mode         → { mode: 'test' | 'live' }            any member
//   create_checkout  → { url }  Stripe Checkout, subscription mode
//                      body: { org_id, plan: 'essential'|'complete',
//                              interval?: 'month'|'year' (default month),
//                              success_url, cancel_url }      owner/manager
//   create_portal    → { url }  Stripe customer portal (change plan, card,
//                      cancel, invoices). body: { org_id, return_url }
//                                                             owner/manager
//   refresh          → { subscription } re-read the org's subscription from
//                      Stripe and store it (backup if a webhook is late)
//                                                             any member
//
// Prices are never taken from the client: the plan name is mapped to a
// Stripe Price lookup key (see _shared/billing-plans.ts).
//
// Secrets: STRIPE_SECRET_KEY. Optional: BILLING_TRIAL_DAYS (default 0 = no trial),
// STRIPE_AUTOMATIC_TAX ('true' once VAT registered + Stripe Tax set up),
// APP_ORIGINS (comma-separated allowed redirect origins).
// ============================================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { PLAN_LOOKUP_KEYS, isInterval, isPaidPlan, trialDays, type BillingInterval, type PaidPlan } from '../_shared/billing-plans.ts'
import { syncSubscription } from '../_shared/billing-sync.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BILLING_ROLES = new Set(['owner', 'manager'])
const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete']

const DEFAULT_APP_ORIGINS = [
  'https://pharmstation.co.uk',
  'https://www.pharmstation.co.uk',
  'https://pharmstation-web.vercel.app',
  'http://localhost:3000',
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function stripeKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new HttpError(503, 'Billing is not configured yet (missing STRIPE_SECRET_KEY).')
  return key
}

function getStripe(): Stripe {
  return new Stripe(stripeKey(), {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  })
}

function billingMode(): 'test' | 'live' {
  return /^(sk|rk)_live_/.test(stripeKey()) ? 'live' : 'test'
}

function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
type Db = ReturnType<typeof getAdminClient>

function isAllowedRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const configured = (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',').map((o) => o.trim()).filter(Boolean)
  const origins = configured.length ? configured : DEFAULT_APP_ORIGINS
  try {
    return origins.includes(new URL(url).origin)
  } catch {
    return false
  }
}

// ------------------------------------------------------------
// Caller + permission checks
// ------------------------------------------------------------
interface Caller {
  id: string
  email: string | null
}

async function getCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new HttpError(401, 'Not signed in')
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data?.user) throw new HttpError(401, 'Not signed in')
  return { id: data.user.id, email: data.user.email ?? null }
}

/** Returns the caller's role in the org, 'org_account' for the org login itself, or throws. */
async function requireMember(db: Db, callerId: string, orgId: string): Promise<string> {
  const { data: org } = await db
    .from('ps_organisations')
    .select('id, auth_user_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) throw new HttpError(404, 'Organisation not found')
  if (org.auth_user_id === callerId) return 'org_account'

  const { data: member } = await db
    .from('ps_organisation_members')
    .select('role')
    .eq('organisation_id', orgId)
    .eq('user_id', callerId)
    .eq('status', 'active')
    .maybeSingle()
  if (!member) throw new HttpError(403, 'You are not a member of this organisation')
  return member.role as string
}

async function requireBillingManager(db: Db, callerId: string, orgId: string): Promise<void> {
  const role = await requireMember(db, callerId, orgId)
  if (role !== 'org_account' && !BILLING_ROLES.has(role)) {
    throw new HttpError(403, 'Only the pharmacy owner or a manager can change the subscription.')
  }
}

// ------------------------------------------------------------
// Stripe customer for the org (stored on ps_org_billing)
// ------------------------------------------------------------
async function ensureCustomer(db: Db, stripe: Stripe, orgId: string, email: string | null): Promise<string> {
  const { data: billing } = await db
    .from('ps_org_billing')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle()

  const existing = billing?.stripe_customer_id as string | null | undefined
  if (existing) {
    // A test-mode customer id is unknown once live keys are in: make a new one.
    try {
      const c = await stripe.customers.retrieve(existing)
      if (!(c as Stripe.DeletedCustomer).deleted) return existing
    } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e
    }
  }

  const { data: org } = await db
    .from('ps_organisations')
    .select('name, address, gphc_premises_number')
    .eq('id', orgId)
    .maybeSingle()
  const addr = (org?.address ?? {}) as Record<string, string | undefined>

  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    email: email ?? undefined,
    address: addr.line_1
      ? {
          line1: addr.line_1,
          line2: addr.line_2,
          city: addr.city,
          state: addr.county,
          postal_code: addr.postcode,
          country: 'GB',
        }
      : undefined,
    metadata: {
      org_id: orgId,
      ...(org?.gphc_premises_number ? { gphc_premises_number: org.gphc_premises_number } : {}),
    },
  })

  const { error } = await db
    .from('ps_org_billing')
    .upsert(
      { org_id: orgId, stripe_customer_id: customer.id, updated_at: new Date().toISOString() },
      { onConflict: 'org_id' },
    )
  if (error) throw new Error(`Could not save Stripe customer: ${error.message}`)
  return customer.id
}

async function priceForPlan(stripe: Stripe, plan: PaidPlan, interval: BillingInterval): Promise<Stripe.Price> {
  const key = PLAN_LOOKUP_KEYS[plan][interval]
  const prices = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
  const price = prices.data[0]
  if (!price) {
    throw new HttpError(
      503,
      `The ${plan} plan has no Stripe price yet (lookup key ${key}). Run tooling/stripe/setup-billing.mjs.`,
    )
  }
  return price
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------
async function createCheckout(db: Db, caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const orgId = body.org_id as string
  const plan = body.plan
  if (!isPaidPlan(plan)) throw new HttpError(400, 'plan must be "essential" or "complete"')
  const interval = body.interval ?? 'month'
  if (!isInterval(interval)) throw new HttpError(400, 'interval must be "month" or "year"')
  if (!isAllowedRedirect(body.success_url) || !isAllowedRedirect(body.cancel_url)) {
    throw new HttpError(400, 'success_url and cancel_url must be PharmStation addresses')
  }
  await requireBillingManager(db, caller.id, orgId)

  const { data: current } = await db
    .from('ps_org_subscriptions')
    .select('status, stripe_subscription_id')
    .eq('org_id', orgId)
    .maybeSingle()
  if (current?.stripe_subscription_id && LIVE_STATUSES.includes(current.status as string)) {
    throw new HttpError(
      409,
      'This pharmacy already has a subscription. Use "Manage billing" to change plan or payment details.',
    )
  }

  const stripe = getStripe()
  const [customerId, price] = await Promise.all([
    ensureCustomer(db, stripe, orgId, caller.email),
    priceForPlan(stripe, plan, interval),
  ])

  // Free trial only on the first subscription an org ever starts.
  const days = !current?.stripe_subscription_id ? trialDays() : 0

  const successUrl = new URL(body.success_url as string)
  successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}')

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: orgId,
    line_items: [{ price: price.id, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    ...(Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true' ? { automatic_tax: { enabled: true } } : {}),
    subscription_data: {
      metadata: { org_id: orgId, plan },
      ...(days > 0
        ? {
            trial_period_days: days,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
          }
        : {}),
    },
    metadata: { org_id: orgId, plan, kind: 'subscription' },
    // Stripe swaps in the real id; URL-encoding would break the placeholder.
    success_url: successUrl.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
    cancel_url: body.cancel_url as string,
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  return json({ url: session.url })
}

async function createPortal(db: Db, caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const orgId = body.org_id as string
  if (!isAllowedRedirect(body.return_url)) throw new HttpError(400, 'return_url must be a PharmStation address')
  await requireBillingManager(db, caller.id, orgId)

  const stripe = getStripe()
  const customerId = await ensureCustomer(db, stripe, orgId, caller.email)
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: body.return_url as string,
    ...(Deno.env.get('STRIPE_PORTAL_CONFIGURATION')
      ? { configuration: Deno.env.get('STRIPE_PORTAL_CONFIGURATION')! }
      : {}),
  })
  return json({ url: portal.url })
}

async function refresh(db: Db, caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const orgId = body.org_id as string
  await requireMember(db, caller.id, orgId)

  const { data: billing } = await db
    .from('ps_org_billing')
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .maybeSingle()
  const customerId = billing?.stripe_customer_id as string | undefined

  if (customerId) {
    const stripe = getStripe()
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
      // Newest PharmStation subscription wins.
      const ours = subs.data
        .filter((s) => s.metadata?.org_id === orgId || !s.metadata?.org_id)
        .sort((a, b) => b.created - a.created)[0]
      if (ours) await syncSubscription(db, ours)
    } catch (e) {
      if ((e as { code?: string }).code !== 'resource_missing') throw e
    }
  }

  const { data } = await db.from('ps_org_subscriptions').select('*').eq('org_id', orgId).maybeSingle()
  return json({ subscription: data ?? null })
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const caller = await getCaller(req)
    if (typeof body.org_id !== 'string' || !body.org_id) throw new HttpError(400, 'org_id is required')
    const db = getAdminClient()

    switch (body.action) {
      case 'get_mode':
        await requireMember(db, caller.id, body.org_id)
        return json({ mode: billingMode() })
      case 'create_checkout':
        return await createCheckout(db, caller, body)
      case 'create_portal':
        return await createPortal(db, caller, body)
      case 'refresh':
        return await refresh(db, caller, body)
      default:
        throw new HttpError(400, `Unknown action: ${String(body.action ?? '(none)')}`)
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    // Surface Stripe's own message (e.g. card or config problems).
    const msg = e instanceof Error ? e.message : 'Internal error'
    console.error('stripe-billing error:', msg)
    return json({ error: msg }, 500)
  }
})
