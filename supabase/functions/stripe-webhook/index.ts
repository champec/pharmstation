// ============================================
// PharmStation Edge Function: stripe-webhook
// Receives Stripe webhook events. JWT verification is DISABLED for this
// function — authenticity is guaranteed by Stripe signature verification
// (constructEventAsync with STRIPE_WEBHOOK_SECRET).
//
// Handled events (Phase 1):
//   checkout.session.completed        → mark ps_payments succeeded and
//                                       confirm the pending appointment
//   checkout.session.expired          → mark canceled and cancel the
//                                       unpaid appointment (frees the slot)
//   payment_intent.payment_failed     → mark failed
//   charge.refunded                   → mark refunded / partially_refunded
// Handled events (Phase 4 — platform subscriptions):
//   checkout.session.completed (mode=subscription) → sync ps_org_subscriptions
//   customer.subscription.created/updated/deleted/paused/resumed
//                                     → sync ps_org_subscriptions
//   invoice.paid                      → ledger row in ps_payments (kind=subscription)
//   checkout.session.completed (metadata.kind=sms_credits)
//                                     → add prepaid text credits
// Handled events (Phase 2 — Connect):
//   account.updated                   → sync ps_org_billing (orgs) or
//                                       ps_locum_profiles (locums, via
//                                       metadata.locum_user_id)
//
// Two webhook endpoints point here (each with its own signing secret):
//   STRIPE_WEBHOOK_SECRET          — platform events endpoint
//   STRIPE_CONNECT_WEBHOOK_SECRET  — connect (account.updated) endpoint
// Signature verification tries both.
//
// Idempotency: every event is recorded in ps_stripe_webhook_events with a
// UNIQUE stripe_event_id — duplicate deliveries are acknowledged and skipped.
//
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                   STRIPE_CONNECT_WEBHOOK_SECRET (optional until Connect live)
// ============================================

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { syncSubscription } from '../_shared/billing-sync.ts'
import { loadBooking, pounds, refundBookingPayment, textPatient } from '../_shared/appointment-helpers.ts'

function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY')
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() })
}

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

type Db = ReturnType<typeof getAdminClient>

// ============================================
// Event handlers
// ============================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Our ps_payments id from Stripe metadata, or null if missing or malformed
 *  (e.g. a session someone created by hand in the Stripe dashboard). */
function paymentIdFrom(metadata: Stripe.Metadata | null | undefined): string | null {
  const id = metadata?.payment_id
  return id && UUID_RE.test(id) ? id : null
}

async function onCheckoutCompleted(db: Db, session: Stripe.Checkout.Session) {
  const paymentId = paymentIdFrom(session.metadata)
  const update = {
    status: 'succeeded',
    stripe_payment_intent_id: (session.payment_intent as string) ?? null,
    payer_email: session.customer_details?.email ?? session.customer_email ?? null,
    paid_at: new Date().toISOString(),
  }
  // Prefer our metadata id; fall back to session id.
  const q = paymentId
    ? db.from('ps_payments').update(update).eq('id', paymentId)
    : db.from('ps_payments').update(update).eq('stripe_checkout_session_id', session.id)
  const { error } = await q
  if (error) throw new Error(`ps_payments update failed: ${error.message}`)

  // Paid booking: the patient has committed, so confirm the slot.
  const appointmentId = await appointmentFor(db, session)
  if (appointmentId) {
    const { data: confirmed, error: apptErr } = await db.from('ps_appointments')
      .update({ status: 'confirmed', hold_expires_at: null })
      .eq('id', appointmentId)
      .eq('status', 'pending')
      .select('id')
    if (apptErr) throw new Error(`appointment confirm failed: ${apptErr.message}`)

    const booking = await loadBooking(db, { id: appointmentId })
    if (confirmed?.length) {
      if (booking) await textPatient(db, booking, 'confirmed', 'Payment received, thank you.')
    } else if (booking?.status === 'cancelled') {
      // Paid after the hold ran out and the slot was released: give the
      // money back rather than keep payment for a booking that doesn't exist.
      try {
        const refunded = await refundBookingPayment(db, appointmentId, 'system:late_payment')
        if (refunded) {
          await textPatient(db, booking, 'cancelled',
            `Your payment arrived after the booking had expired, so ${pounds(refunded)} has been refunded. Please book again.`)
        }
      } catch (e) {
        console.error('late payment refund failed', e)
        await db.rpc('ps_fanout_notification', {
          p_org_id: booking.org_id,
          p_event_type: 'appointment',
          p_title: 'Refund needed: payment for an expired booking',
          p_body: `${booking.patient_first_name ?? 'A patient'} paid for ${booking.service_name} after the booking expired. Refund them from Payments.`,
          p_link: '/payments',
          p_metadata: { appointment_id: appointmentId },
        })
      }
    }
  }
}

async function appointmentFor(db: Db, session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.metadata?.appointment_id) return session.metadata.appointment_id
  const { data } = await db.from('ps_payments').select('appointment_id')
    .eq('stripe_checkout_session_id', session.id).maybeSingle()
  return (data?.appointment_id as string) ?? null
}

async function onCheckoutExpired(db: Db, session: Stripe.Checkout.Session) {
  const paymentId = paymentIdFrom(session.metadata)
  const q = paymentId
    ? db.from('ps_payments').update({ status: 'canceled' }).eq('id', paymentId).in('status', ['pending', 'processing'])
    : db.from('ps_payments').update({ status: 'canceled' }).eq('stripe_checkout_session_id', session.id).in('status', ['pending', 'processing'])
  const { error } = await q
  if (error) throw new Error(`ps_payments cancel failed: ${error.message}`)

  // Unpaid booking: release the slot. Only a still-pending appointment is
  // touched, so one the pharmacy confirmed by hand is left alone.
  const appointmentId = await appointmentFor(db, session)
  if (appointmentId) {
    const { error: apptErr } = await db.from('ps_appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId)
      .eq('status', 'pending')
    if (apptErr) throw new Error(`appointment cancel failed: ${apptErr.message}`)
  }
}

async function onPaymentFailed(db: Db, pi: Stripe.PaymentIntent) {
  const paymentId = paymentIdFrom(pi.metadata)
  if (!paymentId) return
  const { error } = await db
    .from('ps_payments')
    .update({ status: 'failed' })
    .eq('id', paymentId)
    .in('status', ['pending', 'processing'])
  if (error) throw new Error(`ps_payments fail-update failed: ${error.message}`)
}

async function onChargeRefunded(db: Db, charge: Stripe.Charge) {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!piId) return
  const refunded = charge.amount_refunded ?? 0
  const full = refunded >= charge.amount
  const { error } = await db
    .from('ps_payments')
    .update({
      status: full ? 'refunded' : 'partially_refunded',
      refunded_pence: refunded,
      stripe_charge_id: charge.id,
    })
    .eq('stripe_payment_intent_id', piId)
  if (error) throw new Error(`ps_payments refund-update failed: ${error.message}`)
}

// ============================================
// Platform subscriptions (Phase 4)
// ============================================

async function onSubscriptionCheckoutCompleted(db: Db, stripe: Stripe, session: Stripe.Checkout.Session) {
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (!subId) return
  const sub = await stripe.subscriptions.retrieve(subId)
  await syncSubscription(db, sub)
}

async function orgIdForCustomer(db: Db, customerId: string | null | undefined): Promise<string | null> {
  if (!customerId) return null
  const { data } = await db.from('ps_org_billing').select('org_id').eq('stripe_customer_id', customerId).maybeSingle()
  return (data?.org_id as string | undefined) ?? null
}

// Prepaid text credits: add them once the card payment has gone through.
// Idempotent: the ledger allows one row per Checkout session.
async function onSmsCreditsPaid(db: Db, session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return
  const orgId = session.metadata?.org_id
  const credits = Number(session.metadata?.credits)
  if (!orgId || !Number.isInteger(credits) || credits <= 0) {
    throw new Error(`sms credits session ${session.id} has bad metadata`)
  }
  const { error } = await db.rpc('ps_sms_add_credits', {
    p_org_id: orgId,
    p_credits: credits,
    p_reason: 'purchase',
    p_checkout_session_id: session.id,
    p_payment_id: paymentIdFrom(session.metadata),
    p_note: `${credits} text credits bought`,
  })
  if (error) throw new Error(`ps_sms_add_credits failed: ${error.message}`)
}

// Record what the pharmacy paid us, so ps_payments stays the whole money story.
async function onInvoicePaid(db: Db, invoice: Stripe.Invoice) {
  if (!invoice.subscription || (invoice.amount_paid ?? 0) <= 0) return
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  const orgId =
    invoice.subscription_details?.metadata?.org_id ?? (await orgIdForCustomer(db, customerId))
  // Not a PharmStation customer (the Stripe account bills other products too).
  if (!orgId) return

  const { data: existing } = await db
    .from('ps_payments')
    .select('id')
    .eq('kind', 'subscription')
    .contains('metadata', { stripe_invoice_id: invoice.id })
    .maybeSingle()
  if (existing) return

  const pi = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id
  const charge = typeof invoice.charge === 'string' ? invoice.charge : invoice.charge?.id
  const line = invoice.lines?.data?.[0]
  const { error } = await db.from('ps_payments').insert({
    org_id: orgId,
    kind: 'subscription',
    description: line?.description ?? 'PharmStation subscription',
    amount_pence: invoice.amount_paid,
    currency: invoice.currency ?? 'gbp',
    status: 'succeeded',
    stripe_payment_intent_id: pi ?? null,
    stripe_charge_id: charge ?? null,
    payer_email: invoice.customer_email ?? null,
    paid_at: new Date((invoice.status_transitions?.paid_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    metadata: {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf: invoice.invoice_pdf ?? null,
    },
  })
  if (error) throw new Error(`ps_payments subscription insert failed: ${error.message}`)
}

// Connect: keep billing records in sync as the entity completes KYC.
// Routes by account metadata:
//   metadata.locum_user_id → ps_locum_profiles
//   metadata.org_id (or account-id fallback) → ps_org_billing
async function onAccountUpdated(db: Db, acct: Stripe.Account) {
  const locumUserId = acct.metadata?.locum_user_id
  const active = !!acct.charges_enabled && !!acct.payouts_enabled

  if (locumUserId) {
    const { error } = await db
      .from('ps_locum_profiles')
      .update({ stripe_account_id: acct.id, stripe_onboarded: active })
      .eq('user_id', locumUserId)
    if (error) throw new Error(`ps_locum_profiles update failed: ${error.message}`)
    return
  }

  const orgId = acct.metadata?.org_id
  const status = active
    ? 'active'
    : acct.requirements?.disabled_reason ? 'restricted' : 'pending'
  const update = {
    stripe_account_status: status,
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
  }
  // Prefer org_id from metadata; fall back to account id lookup.
  const q = orgId
    ? db.from('ps_org_billing').update(update).eq('org_id', orgId)
    : db.from('ps_org_billing').update(update).eq('stripe_account_id', acct.id)
  const { error } = await q
  if (error) throw new Error(`ps_org_billing update failed: ${error.message}`)
}

// ============================================
// Entry
// ============================================
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const sig = req.headers.get('stripe-signature')
  const platformSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const connectSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')
  if (!sig || (!platformSecret && !connectSecret)) return new Response('Webhook not configured', { status: 500 })

  const rawBody = await req.text()
  const stripe = getStripe()

  // Two endpoints (platform + connect) deliver here — try each secret.
  let event: Stripe.Event | null = null
  for (const secret of [platformSecret, connectSecret]) {
    if (!secret) continue
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, secret)
      break
    } catch { /* try next secret */ }
  }
  if (!event) {
    console.error('signature verification failed for all secrets')
    return new Response('Invalid signature', { status: 400 })
  }

  const db = getAdminClient()

  // Idempotency: insert event id; if it already exists we've seen it.
  const { error: insertErr } = await db
    .from('ps_stripe_webhook_events')
    .insert({ stripe_event_id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
  if (insertErr) {
    if (insertErr.code !== '23505') {
      console.error('event log insert failed', insertErr)
      return new Response('Event log failure', { status: 500 })
    }
    // Seen before. Skip only if it was handled; a Stripe retry of an event
    // whose handler failed must run again, or that update is lost for good.
    const { data: prior } = await db
      .from('ps_stripe_webhook_events')
      .select('*')
      .eq('stripe_event_id', event.id)
      .maybeSingle()
    if (prior?.processed) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 })
    await db
      .from('ps_stripe_webhook_events')
      .update({ attempts: ((prior?.attempts as number | undefined) ?? 1) + 1 })
      .eq('stripe_event_id', event.id)
  }

  let handlerError: string | null = null
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription') await onSubscriptionCheckoutCompleted(db, stripe, session)
        else {
          await onCheckoutCompleted(db, session)
          if (session.metadata?.kind === 'sms_credits') await onSmsCreditsPaid(db, session)
        }
        break
      }
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') await onCheckoutExpired(db, session)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        // Events can arrive out of order, so store Stripe's current state
        // rather than the snapshot inside this event.
        await syncSubscription(db, await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id))
        break
      case 'invoice.paid':
        await onInvoicePaid(db, event.data.object as Stripe.Invoice)
        break
      case 'payment_intent.payment_failed':
        await onPaymentFailed(db, event.data.object as Stripe.PaymentIntent)
        break
      case 'charge.refunded':
        await onChargeRefunded(db, event.data.object as Stripe.Charge)
        break
      case 'account.updated':
        await onAccountUpdated(db, event.data.object as Stripe.Account)
        break
      default:
        // Unhandled event types are logged and acknowledged.
        break
    }
  } catch (e) {
    handlerError = (e as Error).message
    console.error(`handler failed for ${event.type}`, e)
  }

  await db
    .from('ps_stripe_webhook_events')
    .update({ processed: handlerError === null, error: handlerError, processed_at: new Date().toISOString() })
    .eq('stripe_event_id', event.id)

  // Return 500 on handler failure so Stripe retries.
  if (handlerError) return new Response('Handler error', { status: 500 })
  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
