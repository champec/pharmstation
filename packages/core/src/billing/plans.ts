// ============================================================
// PharmStation platform plans — the single catalogue for what each
// subscription tier costs and unlocks.
//
// Prices shown here are for display. The amount actually charged always
// comes from the Stripe Price with the matching lookup key (created by
// tooling/stripe/setup-billing.mjs), so change both together.
// ============================================================

export type PlanId = 'network' | 'essential' | 'complete'

/** Product areas that can be gated by plan. */
export type Feature =
  | 'network' // Pharm Network hub, linking, public profile
  | 'registers' // CD register, RP log, returns, AI scan
  | 'logs' // custom logs (fridge, cleaning, date checks)
  | 'sops' // SOP library with read-and-sign
  | 'patient_safety'
  | 'genie' // AI assistant (Essential has a monthly cap)
  | 'services' // service library, private services, booking
  | 'appointments'
  | 'payments' // take card payments from patients
  | 'video'
  | 'messaging' // patient SMS inbox, compose, broadcasts
  | 'deliveries'
  | 'shop'
  | 'care_homes'

export interface Plan {
  id: PlanId
  name: string
  /** Monthly price in pence, before VAT. */
  monthlyPence: number
  /** Stripe Price lookup key for the monthly price (null = free, no Stripe price). */
  stripeLookupKey: string | null
  tagline: string
  /** Max active staff accounts; null = unlimited. */
  staffLimit: number | null
  /** Patient SMS included each month. */
  smsIncluded: number
  features: Feature[]
  /** Bullet points for pricing cards. */
  highlights: string[]
}

const NETWORK_FEATURES: Feature[] = ['network']
const ESSENTIAL_FEATURES: Feature[] = [
  ...NETWORK_FEATURES,
  'registers',
  'logs',
  'sops',
  'patient_safety',
  'genie',
]
const COMPLETE_FEATURES: Feature[] = [
  ...ESSENTIAL_FEATURES,
  'services',
  'appointments',
  'payments',
  'video',
  'messaging',
  'deliveries',
  'shop',
  'care_homes',
]

export const PLANS: Record<PlanId, Plan> = {
  network: {
    id: 'network',
    name: 'Network',
    monthlyPence: 0,
    stripeLookupKey: null,
    tagline: 'Join the pharmacy network for free',
    staffLimit: 3,
    smsIncluded: 0,
    features: NETWORK_FEATURES,
    highlights: [
      'Pharmacy-to-pharmacy messaging and stock checks',
      'Public pharmacy profile on the map',
      'Sticky notes and resources',
    ],
  },
  essential: {
    id: 'essential',
    name: 'Essential',
    monthlyPence: 3900,
    stripeLookupKey: 'pharmstation_essential_monthly',
    tagline: 'Paperless compliance',
    staffLimit: 3,
    smsIncluded: 0,
    features: ESSENTIAL_FEATURES,
    highlights: [
      'Everything in Network',
      'Digital CD register, RP log and patient returns',
      'Custom logs: fridge, cleaning, date checks',
      'SOP library with read-and-sign',
      'Patient safety reporting',
      'Genie AI assistant',
      'Up to 3 staff',
    ],
  },
  complete: {
    id: 'complete',
    name: 'Complete',
    monthlyPence: 7900,
    stripeLookupKey: 'pharmstation_complete_monthly',
    tagline: 'Compliance plus services that earn you money',
    staffLimit: null,
    smsIncluded: 200,
    features: COMPLETE_FEATURES,
    highlights: [
      'Everything in Essential',
      'Online booking with card payments to your bank',
      'Appointments calendar and video consultations',
      'Patient text messaging, inbox and broadcasts',
      'Delivery rounds and driver app',
      'Online shop and care homes',
      'Unlimited staff',
      'NHS services included when live',
    ],
  },
}

export const PLAN_ORDER: PlanId[] = ['network', 'essential', 'complete']

export const PAID_PLANS: PlanId[] = ['essential', 'complete']

/** Free trial on a first paid subscription. Must match BILLING_TRIAL_DAYS on the server. */
export const TRIAL_DAYS = 30

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan)
}

export function planHasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature)
}

/** The cheapest plan that includes a feature. */
export function minimumPlanFor(feature: Feature): PlanId {
  return PLAN_ORDER.find((p) => planHasFeature(p, feature)) ?? 'complete'
}

export function formatPence(pence: number): string {
  if (pence === 0) return '£0'
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`
}

/**
 * Which feature a route in the dashboard belongs to. Routes not listed are
 * never gated (dashboard, settings, notes, resources, patients, NHS, PEPS,
 * shifts, outreach…).
 */
const ROUTE_FEATURES: Array<[RegExp, Feature]> = [
  [/^\/registers(\/|$)/, 'registers'],
  [/^\/logs(\/|$)/, 'logs'],
  [/^\/sops(\/|$)/, 'sops'],
  [/^\/patient-safety(\/|$)/, 'patient_safety'],
  [/^\/messaging\/network(\/|$)/, 'network'],
  [/^\/messaging(\/|$)/, 'messaging'],
  [/^\/services(\/|$)/, 'services'],
  [/^\/appointments(\/|$)/, 'appointments'],
  [/^\/payments(\/|$)/, 'payments'],
  [/^\/video(\/|$)/, 'video'],
  [/^\/deliver(y|ies)(-rounds)?(\/|$)/, 'deliveries'],
  [/^\/driver(\/|$)/, 'deliveries'],
  [/^\/shop-admin(\/|$)/, 'shop'],
  [/^\/care-homes(\/|$)/, 'care_homes'],
]

export function featureForPath(pathname: string): Feature | null {
  for (const [re, feature] of ROUTE_FEATURES) {
    if (re.test(pathname)) return feature
  }
  return null
}

/** Row shape of ps_org_subscriptions. */
export interface OrgSubscription {
  org_id: string
  plan: PlanId
  status:
    | 'none'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused'
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  billing_interval: 'month' | 'year' | null
  current_period_end: string | null
  trial_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  override_plan: PlanId | null
  override_until: string | null
  override_reason: string | null
  is_founding_member: boolean
  created_at: string
  updated_at: string
}

/** Mirrors public.ps_org_effective_plan() in the database. Keep the two in step. */
export function effectivePlan(sub: OrgSubscription | null, now: Date = new Date()): PlanId {
  if (!sub) return 'network'
  const paid: PlanId = ['trialing', 'active', 'past_due'].includes(sub.status) ? sub.plan : 'network'
  const compActive =
    sub.override_plan && (!sub.override_until || new Date(sub.override_until) > now)
  const comp: PlanId | null = compActive ? sub.override_plan : null
  if (comp && planRank(comp) > planRank(paid)) return comp
  return paid
}
