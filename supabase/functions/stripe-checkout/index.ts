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
//   cancel_checkout — patient backed out of Checkout (cancel page)
//       body: { action, payment_id }
//       Expires the Stripe session, cancels the payment and the pending
//       appointment so the slot is released straight away.
//   refund_payment — staff refund from the Payments page (auth required,
//       caller must be a member of the payment's org)
//       body: { action, payment_id, amount_pence?, cancel_appointment? }
//       Omit amount_pence for a full refund. The ledger is updated by the
//       charge.refunded webhook; this returns the Stripe refund status.
//   create_shop_checkout — pay for a shop order placed with payment_method
//       'card' (unauthenticated, like bookings: the order id is an
//       unguessable UUID only the customer's browser has)
//       body: { action, order_id, success_url, cancel_url, payer_email? }
//       Line items and total are read from the order in the database. Needs
//       the pharmacy's Connect account: shop money always goes to the
//       pharmacy. The ps_payments trigger marks the order paid, or cancels
//       it and returns the stock when the session expires or is cancelled.
//   cancel_shop_order — staff cancel, or a pharmacist rejects, a shop order
//       and any card payment is refunded in full (auth required)
//       body: { action, order_id, reject_notes? }
//       With reject_notes it calls ps_shop_review_order as the caller, so
//       only a pharmacist can reject. Without, it cancels as the caller.
//
// Unpaid bookings: Checkout sessions expire after CHECKOUT_EXPIRY_MINUTES
// (default 30, Stripe's minimum). The checkout.session.expired webhook then
// cancels the pending appointment, which frees the slot.
//
// Money flow:
//   Phase 1 (org not onboarded): funds land in the PLATFORM Stripe account.
//   Phase 2 (org has active Connect account): destination charge — funds
//   route to the pharmacy's connected account automatically. Platform fee
//   currently 0 (services are free-tier); PLATFORM_FEE_PERCENT env can
//   introduce a fee later without code changes.
//
// Secrets required: STRIPE_SECRET_KEY (optional: CHECKOUT_EXPIRY_MINUTES)
// ============================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Stripe allows 30 minutes to 24 hours. Short keeps unpaid slots free.
function checkoutExpiresAt(): number {
  const mins = Math.min(Math.max(Number(Deno.env.get('CHECKOUT_EXPIRY_MINUTES') ?? '30') || 30, 30), 1440)
  return Math.floor(Date.now() / 1000) + mins * 60
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
    const { data } = await db.from('ps_appointments').select('id, status, service_id, hold_expires_at')
      .eq('id', appointment_id).eq('org_id', org_id).maybeSingle()
    if (!data) return json({ error: 'Appointment not found' }, 404)
    // Only a booking still waiting for payment can be paid for.
    if (data.status !== 'pending' || data.service_id !== service_id) {
      return json({ error: 'This booking is no longer waiting for payment' }, 409)
    }
    if (data.hold_expires_at && new Date(data.hold_expires_at).getTime() < Date.now()) {
      return json({ error: 'This booking has expired. Please book again.' }, 409)
    }
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
      expires_at: checkoutExpiresAt(),
      success_url: `${success_url}${success_url.includes('?') ? '&' : '?'}payment_id=${payment.id}`,
      cancel_url: `${cancel_url}${cancel_url.includes('?') ? '&' : '?'}payment_id=${payment.id}`,
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
    // Release the slot: the patient never reached a payment page.
    if (appointment_id) await cancelPendingAppointment(db, appointment_id)
    // Surface Stripe's real message — a generic error hides fixable problems
    // (invalid email, Connect capability issues, etc.)
    const msg = (e as { message?: string })?.message ?? 'Stripe checkout could not be created'
    return json({ error: `Stripe: ${msg}` }, 502)
  }
}

// Cancel an appointment only while it is still awaiting payment. The
// ps_appointment_slot_decrement trigger frees the slot on 'cancelled'.
async function cancelPendingAppointment(db: ReturnType<typeof getAdminClient>, appointmentId: string) {
  const { error } = await db.from('ps_appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .eq('status', 'pending')
  if (error) console.error('appointment cancel failed', error)
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
// cancel_checkout (patient pressed back on Stripe Checkout)
// ============================================
// Unauthenticated: the payment id is an unguessable UUID that only reaches
// the patient's own browser via the cancel URL, and this can only cancel a
// payment that has not been paid.
async function cancelCheckout(body: Record<string, unknown>): Promise<Response> {
  const payment_id = body.payment_id as string | undefined
  if (!payment_id) return json({ error: 'payment_id is required' }, 400)

  const db = getAdminClient()
  const { data: payment } = await db.from('ps_payments')
    .select('id, status, appointment_id, stripe_checkout_session_id')
    .eq('id', payment_id).maybeSingle()
  if (!payment) return json({ error: 'Payment not found' }, 404)
  if (!['pending', 'processing'].includes(payment.status)) {
    return json({ payment: { id: payment.id, status: payment.status } })
  }

  if (payment.stripe_checkout_session_id) {
    try {
      await getStripe().checkout.sessions.expire(payment.stripe_checkout_session_id)
    } catch (e) {
      // Already completed or expired. If it completed, the webhook wins:
      // re-read Stripe so we never cancel a paid booking.
      const session = await getStripe().checkout.sessions.retrieve(payment.stripe_checkout_session_id)
      if (session.payment_status === 'paid') {
        return json({ payment: { id: payment.id, status: 'processing' } })
      }
      console.warn('session expire failed', (e as Error).message)
    }
  }

  await db.from('ps_payments').update({ status: 'canceled' })
    .eq('id', payment.id).in('status', ['pending', 'processing'])
  if (payment.appointment_id) await cancelPendingAppointment(db, payment.appointment_id)
  return json({ payment: { id: payment.id, status: 'canceled' } })
}

// ============================================
// refund_payment (staff, from the Payments page)
// ============================================
async function getCaller(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data, error } = await anon.auth.getUser()
  if (error || !data?.user) return null
  return data.user.id
}

// The admin client bypasses RLS, so this is the tenant check: the caller
// must be the org's own auth user or an active member of the org.
async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const db = getAdminClient()
  const { data: org } = await db
    .from('ps_organisations').select('auth_user_id').eq('id', orgId).maybeSingle()
  if (!org) return false
  if (org.auth_user_id === userId) return true
  const { data: member } = await db
    .from('ps_organisation_members').select('user_id')
    .eq('organisation_id', orgId).eq('user_id', userId).eq('status', 'active')
    .maybeSingle()
  return !!member
}

async function refundPayment(req: Request, body: Record<string, unknown>): Promise<Response> {
  const callerId = await getCaller(req)
  if (!callerId) return json({ error: 'Not authenticated' }, 401)

  const payment_id = body.payment_id as string | undefined
  if (!payment_id) return json({ error: 'payment_id is required' }, 400)

  const db = getAdminClient()
  const { data: payment } = await db.from('ps_payments')
    .select('id, org_id, status, amount_pence, refunded_pence, stripe_payment_intent_id, appointment_id, metadata')
    .eq('id', payment_id).maybeSingle()
  if (!payment) return json({ error: 'Payment not found' }, 404)

  // Org comes from the stored row, never from the request.
  if (!(await isOrgMember(callerId, payment.org_id))) {
    return json({ error: 'Not authorised for this organisation' }, 403)
  }
  if (!['succeeded', 'partially_refunded'].includes(payment.status) || !payment.stripe_payment_intent_id) {
    return json({ error: 'Only a completed card payment can be refunded' }, 400)
  }

  const remaining = payment.amount_pence - (payment.refunded_pence ?? 0)
  const requested = body.amount_pence == null ? remaining : Number(body.amount_pence)
  if (!Number.isInteger(requested) || requested <= 0 || requested > remaining) {
    return json({ error: `Refund must be between 1p and £${(remaining / 100).toFixed(2)}` }, 400)
  }

  // Destination charges: pull the money back from the pharmacy's connected
  // account, and return any platform fee in proportion.
  const meta = (payment.metadata ?? {}) as Record<string, unknown>
  const isDestination = typeof meta.destination === 'string'

  try {
    const refund = await getStripe().refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: requested,
      reason: 'requested_by_customer',
      metadata: { payment_id: payment.id, refunded_by: callerId },
      ...(isDestination ? { reverse_transfer: true, refund_application_fee: true } : {}),
    }, { idempotencyKey: `refund-${payment.id}-${payment.refunded_pence ?? 0}-${requested}` })

    if (body.cancel_appointment === true && payment.appointment_id) {
      await db.from('ps_appointments').update({ status: 'cancelled' })
        .eq('id', payment.appointment_id).in('status', ['pending', 'confirmed'])
    }

    return json({ refund: { id: refund.id, status: refund.status, amount_pence: refund.amount } })
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? 'Refund failed'
    return json({ error: `Stripe: ${msg}` }, 502)
  }
}

// ============================================
// Shop orders
// ============================================
async function createShopCheckout(body: Record<string, unknown>): Promise<Response> {
  const order_id = body.order_id as string | undefined
  const success_url = body.success_url as string | undefined
  const cancel_url = body.cancel_url as string | undefined
  const rawEmail = ((body.payer_email as string | undefined) ?? '').trim()
  const payer_email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null

  if (!order_id || !success_url || !cancel_url) {
    return json({ error: 'order_id, success_url and cancel_url are required' }, 400)
  }
  if (!isAllowedRedirect(success_url) || !isAllowedRedirect(cancel_url)) {
    return json({ error: 'success_url and cancel_url must be on the PharmStation app' }, 400)
  }

  const db = getAdminClient()
  const { data: order } = await db.from('ps_shop_orders')
    .select('id, org_id, order_number, status, payment_method, payment_status, delivery_fee_pence, total_pence, items:ps_shop_order_items(product_name, unit_price_pence, quantity)')
    .eq('id', order_id).maybeSingle()
  if (!order) return json({ error: 'Order not found' }, 404)
  if (order.payment_method !== 'card' || order.payment_status !== 'awaiting_payment' || order.status === 'cancelled') {
    return json({ error: 'This order is not waiting for a card payment' }, 409)
  }

  const { data: org } = await db.from('ps_organisations').select('id, name').eq('id', order.org_id).single()
  const { data: billing } = await db.from('ps_org_billing')
    .select('stripe_account_id, charges_enabled').eq('org_id', order.org_id).maybeSingle()
  if (!billing?.charges_enabled || !billing.stripe_account_id) {
    return json({ error: 'This pharmacy can\'t take card payments yet' }, 409)
  }
  const destination = billing.stripe_account_id as string

  const stripe = getStripe()

  // Reuse a session that is still open (customer pressed back, then pay again).
  const { data: open } = await db.from('ps_payments')
    .select('id, stripe_checkout_session_id')
    .eq('shop_order_id', order.id).in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (open?.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(open.stripe_checkout_session_id)
      if (existing.status === 'open' && existing.url) return json({ url: existing.url, payment_id: open.id })
    } catch { /* fall through and create a new one */ }
  }

  const items = (order.items ?? []) as { product_name: string; unit_price_pence: number; quantity: number }[]
  const lineItems = items.map((it) => ({
    quantity: it.quantity,
    price_data: { currency: 'gbp', unit_amount: it.unit_price_pence, product_data: { name: it.product_name } },
  }))
  if (order.delivery_fee_pence > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: 'gbp', unit_amount: order.delivery_fee_pence, product_data: { name: 'Delivery' } },
    })
  }
  const lineTotal = lineItems.reduce((n, li) => n + li.quantity * li.price_data.unit_amount, 0)
  if (lineTotal !== order.total_pence || order.total_pence <= 0) {
    return json({ error: 'Order total could not be confirmed. Please contact the pharmacy.' }, 409)
  }

  const feePercent = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '0')
  const feePence = feePercent > 0 ? Math.round(order.total_pence * feePercent / 100) : 0

  const { data: payment, error: payErr } = await db.from('ps_payments').insert({
    org_id: order.org_id,
    shop_order_id: order.id,
    kind: 'shop',
    description: `Shop order ${order.order_number} — ${org?.name ?? 'pharmacy'}`,
    amount_pence: order.total_pence,
    currency: 'gbp',
    status: 'pending',
    payer_email,
    metadata: { destination, platform_fee_pence: feePence, shop_order_id: order.id },
  }).select('id').single()
  if (payErr || !payment) {
    console.error('shop payment insert failed', payErr)
    return json({ error: 'Could not create payment record' }, 500)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: payer_email ?? undefined,
      expires_at: checkoutExpiresAt(),
      success_url: `${success_url}${success_url.includes('?') ? '&' : '?'}payment_id=${payment.id}`,
      cancel_url: `${cancel_url}${cancel_url.includes('?') ? '&' : '?'}payment_id=${payment.id}`,
      metadata: { payment_id: payment.id, org_id: order.org_id, shop_order_id: order.id, kind: 'shop' },
      payment_intent_data: {
        description: `Shop order ${order.order_number}`,
        metadata: { payment_id: payment.id, org_id: order.org_id, shop_order_id: order.id },
        transfer_data: { destination },
        ...(feePence > 0 ? { application_fee_amount: feePence } : {}),
      },
    }, { idempotencyKey: `shop-checkout-${payment.id}` })

    await db.from('ps_payments')
      .update({ stripe_checkout_session_id: session.id, status: 'processing' })
      .eq('id', payment.id)
    await db.from('ps_shop_orders').update({ payment_id: payment.id }).eq('id', order.id)

    return json({ url: session.url, payment_id: payment.id })
  } catch (e) {
    console.error('stripe shop checkout create failed', e)
    // Mark this attempt failed but keep the order: the customer can try again
    // until it times out (pg_cron cancels unpaid card orders after 45 minutes).
    await db.from('ps_payments').update({ status: 'failed' }).eq('id', payment.id)
    const msg = (e as { message?: string })?.message ?? 'Stripe checkout could not be created'
    return json({ error: `Stripe: ${msg}` }, 502)
  }
}

async function cancelShopOrder(req: Request, body: Record<string, unknown>): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  const callerId = await getCaller(req)
  if (!callerId || !authHeader) return json({ error: 'Not authenticated' }, 401)

  const order_id = body.order_id as string | undefined
  if (!order_id) return json({ error: 'order_id is required' }, 400)
  const rejectNotes = typeof body.reject_notes === 'string' ? body.reject_notes.trim() : null

  const db = getAdminClient()
  const { data: order } = await db.from('ps_shop_orders')
    .select('id, org_id, status, payment_status, payment_id').eq('id', order_id).maybeSingle()
  if (!order) return json({ error: 'Order not found' }, 404)
  if (!(await isOrgMember(callerId, order.org_id))) {
    return json({ error: 'Not authorised for this organisation' }, 403)
  }

  // Do the cancel / reject as the caller, so the database's own rules apply
  // (only a pharmacist can reject; staff column grants and RLS).
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  if (rejectNotes !== null) {
    const { error } = await asCaller.rpc('ps_shop_review_order', {
      p_order_id: order.id, p_approve: false, p_notes: rejectNotes,
    })
    if (error) return json({ error: error.message }, 400)
  } else if (order.status !== 'cancelled') {
    const { error } = await asCaller.from('ps_shop_orders').update({ status: 'cancelled' }).eq('id', order.id)
    if (error) return json({ error: error.message }, 400)
  }

  if (order.payment_status !== 'paid' || !order.payment_id) {
    return json({ cancelled: true, refund: null })
  }

  const { data: payment } = await db.from('ps_payments')
    .select('id, status, amount_pence, refunded_pence, stripe_payment_intent_id')
    .eq('id', order.payment_id).maybeSingle()
  const remaining = payment ? payment.amount_pence - (payment.refunded_pence ?? 0) : 0
  if (!payment?.stripe_payment_intent_id || remaining <= 0
      || !['succeeded', 'partially_refunded'].includes(payment.status)) {
    return json({ cancelled: true, refund: null })
  }

  try {
    const refund = await getStripe().refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: remaining,
      reason: 'requested_by_customer',
      metadata: { payment_id: payment.id, shop_order_id: order.id, refunded_by: callerId },
      reverse_transfer: true,
      refund_application_fee: true,
    }, { idempotencyKey: `shop-refund-${payment.id}-${payment.refunded_pence ?? 0}` })
    return json({ cancelled: true, refund: { id: refund.id, status: refund.status, amount_pence: refund.amount } })
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? 'Refund failed'
    console.error('shop refund failed', e)
    return json({
      cancelled: true,
      refund_error: `The order is cancelled but the refund failed (${msg}). Refund it from Payments.`,
    })
  }
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
      case 'cancel_checkout':
        return await cancelCheckout(body)
      case 'refund_payment':
        return await refundPayment(req, body)
      case 'create_shop_checkout':
        return await createShopCheckout(body)
      case 'cancel_shop_order':
        return await cancelShopOrder(req, body)
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (e) {
    console.error('stripe-checkout error', e)
    return json({ error: (e as Error).message ?? 'Internal error' }, 500)
  }
})
