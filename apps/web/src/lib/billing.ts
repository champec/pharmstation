/**
 * Plan enforcement ships switched off so existing pharmacies are never locked
 * out by surprise. Set VITE_ENFORCE_PLANS=true in Vercel once Stripe is live
 * and every existing organisation has a subscription row (or a comp).
 */
export const PLANS_ENFORCED = import.meta.env.VITE_ENFORCE_PLANS === 'true'

/**
 * Can this person change the plan, buy text credits or set up payouts?
 * Needs a staff sign-in with the billing permission (owners by default, others
 * only by override). The shared pharmacy login never can. The edge functions
 * enforce the same rule (supabase/functions/_shared/org-billing-permission.ts);
 * this only decides what the page shows.
 */
export function canManageBilling(
  membership: unknown,
  permissions: { billing?: boolean } | null | undefined,
): boolean {
  return !!membership && permissions?.billing === true
}
