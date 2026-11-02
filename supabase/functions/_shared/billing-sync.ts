// ============================================================
// Copy a Stripe Subscription onto ps_org_subscriptions.
// Used by stripe-webhook (customer.subscription.*) and by stripe-billing's
// `refresh` action, so both paths write exactly the same thing.
// ============================================================

import type Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'
import { planFromPrice } from './billing-plans.ts'

const KNOWN_STATUSES = new Set([
  'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused',
])

const ts = (secs: number | null | undefined) => (secs ? new Date(secs * 1000).toISOString() : null)

/** Resolve the org a subscription belongs to: metadata first, then the customer id. */
export async function orgIdForSubscription(db: SupabaseClient, sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.org_id
  if (fromMeta) return fromMeta
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customerId) return null
  const { data } = await db
    .from('ps_org_billing')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return (data?.org_id as string | undefined) ?? null
}

/**
 * Returns false (and writes nothing) for subscriptions that are not
 * PharmStation plans: the Stripe account also bills other products, and
 * those events must be acknowledged, not retried forever.
 */
export async function syncSubscription(db: SupabaseClient, sub: Stripe.Subscription): Promise<boolean> {
  const item = sub.items?.data?.[0]
  const price = item?.price
  const plan = planFromPrice(price) ?? (sub.metadata?.plan as string | undefined)
  if (plan !== 'essential' && plan !== 'complete') return false

  const orgId = await orgIdForSubscription(db, sub)
  if (!orgId) throw new Error(`No organisation found for PharmStation subscription ${sub.id}`)

  // An org has one PharmStation subscription. If an older one is ending while
  // a newer one is live, ignore events for the old one so it can't overwrite.
  const { data: existing } = await db
    .from('ps_org_subscriptions')
    .select('stripe_subscription_id, status')
    .eq('org_id', orgId)
    .maybeSingle()
  const live = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete']
  if (
    existing?.stripe_subscription_id &&
    existing.stripe_subscription_id !== sub.id &&
    live.includes(existing.status as string) &&
    !live.includes(sub.status)
  ) {
    return true
  }

  // current_period_end moved to the item in newer API versions; read both.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end

  const row = {
    org_id: orgId,
    plan,
    status: KNOWN_STATUSES.has(sub.status) ? sub.status : 'incomplete',
    stripe_subscription_id: sub.id,
    stripe_price_id: price?.id ?? null,
    billing_interval: price?.recurring?.interval === 'year' ? 'year' : 'month',
    current_period_end: ts(periodEnd),
    trial_end: ts(sub.trial_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: ts(sub.canceled_at),
    is_founding_member: sub.metadata?.founding === 'true' ? true : undefined,
  }
  // Don't clear a founding flag that was set by hand.
  if (row.is_founding_member === undefined) delete (row as Record<string, unknown>).is_founding_member

  const { error } = await db.from('ps_org_subscriptions').upsert(row, { onConflict: 'org_id' })
  if (error) throw new Error(`ps_org_subscriptions upsert failed: ${error.message}`)
  return true
}
