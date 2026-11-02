// ============================================================
// Server-side view of the PharmStation plan catalogue.
// The display catalogue lives in packages/core/src/billing/plans.ts; the
// amount charged lives on the Stripe Price. This file only maps plans to
// Stripe Price lookup keys and back. Keep the lookup keys in step with
// packages/core/src/billing/plans.ts and tooling/stripe/setup-billing.mjs.
// ============================================================

export type PaidPlan = 'essential' | 'complete'
export type PlanId = 'network' | PaidPlan

export const PLAN_LOOKUP_KEYS: Record<PaidPlan, string> = {
  essential: 'pharmstation_essential_monthly',
  complete: 'pharmstation_complete_monthly',
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
  for (const [plan, key] of Object.entries(PLAN_LOOKUP_KEYS)) {
    if (price.lookup_key === key) return plan as PaidPlan
  }
  return null
}

/** Days of free trial on an org's first paid subscription (0 disables). */
export function trialDays(): number {
  const raw = Deno.env.get('BILLING_TRIAL_DAYS')
  const n = raw === undefined ? 30 : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30
}
