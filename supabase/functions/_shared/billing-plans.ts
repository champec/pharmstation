// ============================================================
// Server-side view of the PharmStation plan catalogue.
// The display catalogue lives in packages/core/src/billing/plans.ts; the
// amount charged lives on the Stripe Price. This file only maps plans to
// Stripe Price lookup keys and back. Keep the lookup keys in step with
// packages/core/src/billing/plans.ts and tooling/stripe/setup-billing.mjs.
// ============================================================

export type PaidPlan = 'essential' | 'complete'
export type PlanId = 'network' | PaidPlan

export type BillingInterval = 'month' | 'year'

export const PLAN_LOOKUP_KEYS: Record<PaidPlan, Record<BillingInterval, string>> = {
  essential: { month: 'pharmstation_essential_monthly', year: 'pharmstation_essential_annual' },
  complete: { month: 'pharmstation_complete_monthly', year: 'pharmstation_complete_annual' },
}

export function isInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year'
}

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === 'essential' || v === 'complete'
}

/** Work out which plan a Stripe Price belongs to. */
export function planFromPrice(price: {
  lookup_key?: string | null
  metadata?: Record<string, string> | null
} | null | undefined): PaidPlan | null {
  if (!price) return null
  const fromMeta = price.metadata?.ps_plan
  if (isPaidPlan(fromMeta)) return fromMeta
  for (const [plan, keys] of Object.entries(PLAN_LOOKUP_KEYS)) {
    if (price.lookup_key && Object.values(keys).includes(price.lookup_key)) return plan as PaidPlan
  }
  return null
}

/** Days of free trial on an org's first paid subscription. Default 0: no trial. */
export function trialDays(): number {
  const n = Number(Deno.env.get('BILLING_TRIAL_DAYS') ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
