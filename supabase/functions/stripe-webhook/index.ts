// ============================================
// PharmStation Edge Function: stripe-webhook
// Receives Stripe webhook events. JWT verification is DISABLED for this
// function — authenticity is guaranteed by Stripe signature verification
// (constructEventAsync with STRIPE_WEBHOOK_SECRET).
//
// Handled events (Phase 1):
//   checkout.session.completed        → mark ps_payments succeeded
//   checkout.session.expired          → mark canceled
//   payment_intent.payment_failed     → mark failed
//   charge.refunded                   → mark refunded / partially_refunded
// Handled events (Phase 2 — Connect):
//   account.updated                   → sync ps_org_billing status
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

async function onCheckoutCompleted(db: Db, session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.payment_id
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
}

async function onCheckoutExpired(db: Db, session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.payment_id
  const q = paymentId
    ? db.from('ps_payments').update({ status: 'canceled' }).eq('id', paymentId).in('status', ['pending', 'processing'])
    : db.from('ps_payments').update({ status: 'canceled' }).eq('stripe_checkout_session_id', session.id).in('status', ['pending', 'processing'])
  const { error } = await q
  if (error) throw new Error(`ps_payments cancel failed: ${error.message}`)
}

async function onPaymentFailed(db: Db, pi: Stripe.PaymentIntent) {
  const paymentId = pi.metadata?.payment_id
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

// Connect: keep ps_org_billing in sync as the pharmacy completes KYC
async function onAccountUpdated(db: Db, acct: Stripe.Account) {
  const orgId = acct.metadata?.org_id
  const status = acct.charges_enabled && acct.payouts_enabled
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
    if (insertErr.code === '23505') return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 })
    console.error('event log insert failed', insertErr)
    return new Response('Event log failure', { status: 500 })
  }

  let handlerError: string | null = null
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(db, event.data.object as Stripe.Checkout.Session)
        break
      case 'checkout.session.expired':
        await onCheckoutExpired(db, event.data.object as Stripe.Checkout.Session)
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
