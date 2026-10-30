// ============================================
// PharmStation Edge Function: stripe-checkout
// Creates Stripe Checkout Sessions for patient payments (Phase 1).
//
// Actions:
//   create_checkout_session — start payment for a chargeable service
//       body: { action, org_id, service_id, appointment_id?, patient_id?,
//               payer_email?, success_url, cancel_url }
//       Price is ALWAYS read from ps_services server-side (never trusted
//       from the client). Creates a pending ps_payments row first, then a
//       Checkout Session carrying payment_id in metadata. Returns { url }.
//   get_payment — poll payment status (success page)
//       body: { action, payment_id }
//
// Money flow:
//   Phase 1 (org not onboarded): funds land in the PLATFORM Stripe account.
//   Phase 2 (org has active Connect account): destination charge — funds
//   route to the pharmacy's connected account automatically. Platform fee
//   currently 0 (services are free-tier); PLATFORM_FEE_PERCENT env can
//   introduce a fee later without code changes.
//
// Secrets required: STRIPE_SECRET_KEY
// ============================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY secret)')
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() })
}

// Checkout redirects only to our own app, so a crafted request can't use a
// trusted Stripe page to bounce patients to a phishing site. Override with
// the APP_ORIGINS secret (comma-separated) for new domains.
const DEFAULT_APP_ORIGINS = [
  'https://pharmstation.co.uk',
  'https://www.pharmstation.co.uk',
  'https://pharmstation-web.vercel.app',
  'http://localhost:3000',
]

function isAllowedRedirect(url: string): boolean {
  const allowed = (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',').map((o) => o.trim()).filter(Boolean)
  const origins = allowed.length ? allowed : DEFAULT_APP_ORIGINS
  try {
    return origins.includes(new URL(url).origin)
  } catch {
    return false
  }
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ============================================
// create_checkout_session
// ============================================
async function createCheckoutSession(body: Record<string, unknown>): Promise<Response> {
  const org_id = body.org_id as string | undefined
  const service_id = body.service_id as string | undefined
  const appointment_id = (body.appointment_id as string | undefined) ?? null
  const patient_id = (body.patient_id as string | undefined) ?? null
  // Only forward a syntactically valid email — Stripe hard-rejects the whole
  // session otherwise. If invalid/missing, Checkout collects it on the page.
  const rawEmail = ((body.payer_email as string | undefined) ?? '').trim()
  const payer_email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null
  const success_url = body.success_url as string | undefined
  const cancel_url = body.cancel_url as string | undefined

  if (!org_id || !service_id || !success_url || !cancel_url) {
    return json({ error: 'org_id, service_id, success_url and cancel_url are required' }, 400)
  }

  if (!isAllowedRedirect(success_url) || !isAllowedRedirect(cancel_url)) {
    return json({ error: 'success_url and cancel_url must be on the PharmStation app' }, 400)
  }

  const db = getAdminClient()

  // The caller is unauthenticated, so any linked appointment or patient
  // must already belong to this org.
  if (appointment_id) {
    const { data } = await db.from('ps_appointments').select('id')
      .eq('id', appointment_id).eq('org_id', org_id).maybeSingle()
    if (!data) return json({ error: 'Appointment not found' }, 404)
  }
  if (patient_id) {
    const { data } = await db.from('ps_patients').select('id')
      .eq('id', patient_id).eq('organisation_id', org_id).maybeSingle()
    if (!data) return json({ error: 'Patient not found' }, 404)
  }

  // Server-side price lookup — the client never sets the amount.
  const { data: service, error: svcErr } = await db
    .from('ps_services')
    .select('id, org_id, name, is_active, is_chargeable, price_pence, currency')
    .eq('id', service_id)
    .eq('org_id', org_id)
    .single()

  if (svcErr || !service) return json({ error: 'Service not found' }, 404)
  if (!service.is_active) return json({ error: 'Service is not active' }, 400)
  if (!service.is_chargeable || !service.price_pence || service.price_pence <= 0) {
    return json({ error: 'Service is not chargeable' }, 400)
  }

  const { data: org, error: orgErr } = await db
    .from('ps_organisations')
    .select('id, name')
    .eq('id', org_id)
    .single()
  if (orgErr || !org) return json({ error: 'Organisation not found' }, 404)

  // Connect routing: if the org has an active connected account, route the
  // funds there (destination charge). Otherwise funds stay on the platform.
  const { data: billing } = await db
    .from('ps_org_billing')
    .select('stripe_account_id, charges_enabled')
    .eq('org_id', org_id)
    .maybeSingle()
  const destination = billing?.charges_enabled && billing.stripe_account_id
    ? billing.stripe_account_id as string
    : null

  // Optional platform fee (percent of amount, default 0 = free tier)
  const feePercent = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '0')
  const feePence = destination && feePercent > 0
    ? Math.round(service.price_pence * feePercent / 100)
    : 0

  // 1) Pending ledger row first (single source of truth)
  const { data: payment, error: payErr } = await db
    .from('ps_payments')
    .insert({
      org_id,
      patient_id,
      service_id,
      appointment_id,
      kind: 'service',
      description: `${service.name} — ${org.name}`,
      amount_pence: service.price_pence,
      currency: service.currency ?? 'gbp',
      status: 'pending',
      payer_email,
      metadata: destination ? { destination, platform_fee_pence: feePence } : {},
    })
    .select('id')
    .single()
  if (payErr || !payment) {
    console.error('payment insert failed', payErr)
    return json({ error: 'Could not create payment record' }, 500)
  }

  // 2) Stripe Checkout Session
  const stripe = getStripe()
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: service.currency ?? 'gbp',
            unit_amount: service.price_pence,
            product_data: {
              name: service.name,
              description: `Provided by ${org.name}`,
            },
          },
        },
      ],
      customer_email: payer_email ?? undefined,
      success_url: `${success_url}${success_url.includes('?') ? '&' : '?'}payment_id=${payment.id}`,
      cancel_url,
      metadata: {
        payment_id: payment.id,
        org_id,
        service_id,
        appointment_id: appointment_id ?? '',
        patient_id: patient_id ?? '',
      },
      payment_intent_data: {
        metadata: { payment_id: payment.id, org_id },
        ...(destination
          ? {
              transfer_data: { destination },
              ...(feePence > 0 ? { application_fee_amount: feePence } : {}),
            }
          : {}),
      },
    })

    await db
      .from('ps_payments')
      .update({ stripe_checkout_session_id: session.id, status: 'processing' })
      .eq('id', payment.id)

    return json({ url: session.url, payment_id: payment.id })
  } catch (e) {
    console.error('stripe checkout create failed', e)
    await db.from('ps_payments').update({ status: 'failed' }).eq('id', payment.id)
    // Surface Stripe's real message — a generic error hides fixable problems
    // (invalid email, Connect capability issues, etc.)
    const msg = (e as { message?: string })?.message ?? 'Stripe checkout could not be created'
    return json({ error: `Stripe: ${msg}` }, 502)
  }
}

// ============================================
// get_payment (status polling for success page)
// ============================================
async function getPayment(body: Record<string, unknown>): Promise<Response> {
  const payment_id = body.payment_id as string | undefined
  if (!payment_id) return json({ error: 'payment_id is required' }, 400)

  const db = getAdminClient()
  const { data, error } = await db
    .from('ps_payments')
    .select('id, status, amount_pence, currency, description, paid_at, created_at')
    .eq('id', payment_id)
    .single()
  if (error || !data) return json({ error: 'Payment not found' }, 404)
  return json({ payment: data })
}

// ============================================
// Router
// ============================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    switch (body.action) {
      case 'create_checkout_session':
        return await createCheckoutSession(body)
      case 'get_payment':
        return await getPayment(body)
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (e) {
    console.error('stripe-checkout error', e)
    return json({ error: (e as Error).message ?? 'Internal error' }, 500)
  }
})
