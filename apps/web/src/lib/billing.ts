/**
 * Plan enforcement ships switched off so existing pharmacies are never locked
 * out by surprise. Set VITE_ENFORCE_PLANS=true in Vercel once Stripe is live
 * and every existing organisation has a subscription row (or a comp).
 */
export const PLANS_ENFORCED = import.meta.env.VITE_ENFORCE_PLANS === 'true'

/** Roles that can start, change or cancel the pharmacy's subscription. */
export const BILLING_ROLES = new Set(['owner', 'manager'])
