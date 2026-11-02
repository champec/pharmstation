import { create } from 'zustand'
import { getUserClient } from '@pharmstation/supabase-client'
import {
  effectivePlan,
  planHasFeature,
  type Feature,
  type OrgSubscription,
  type PlanId,
  type BillingInterval,
} from '../billing/plans'

export type BillingMode = 'test' | 'live' | 'unconfigured'

export interface SubscriptionState {
  orgId: string | null
  subscription: OrgSubscription | null
  plan: PlanId
  loaded: boolean
  loading: boolean
  error: string | null
  /** Prepaid text credits left; null until loaded or if not available. */
  smsBalance: number | null

  fetchSubscription: (orgId: string) => Promise<void>
  hasFeature: (feature: Feature) => boolean
  /** Start Stripe Checkout for a paid plan; resolves to the hosted Checkout URL. */
  startCheckout: (
    orgId: string,
    plan: Exclude<PlanId, 'network'>,
    interval?: BillingInterval,
  ) => Promise<string>
  /** Open the Stripe customer portal (change card, switch plan, cancel, invoices). */
  openPortal: (orgId: string) => Promise<string>
  /** Ask the server whether Stripe is in test or live mode. */
  getBillingMode: (orgId: string) => Promise<BillingMode>
  fetchSmsBalance: (orgId: string) => Promise<number | null>
  /** Start Stripe Checkout for a text credit pack; resolves to the Checkout URL. */
  buySmsCredits: (orgId: string, packId: string) => Promise<string>
  reset: () => void
}

/** Pull the real error message out of a FunctionsHttpError response body. */
async function fnError(e: unknown): Promise<string> {
  const err = e as { context?: { json?: () => Promise<{ error?: string }> }; message?: string }
  try {
    if (err?.context && typeof err.context.json === 'function') {
      const body = await err.context.json()
      if (body?.error) return body.error
    }
  } catch {
    /* fall through */
  }
  return err?.message || 'Something went wrong.'
}

async function invokeBilling<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getUserClient().functions.invoke('stripe-billing', { body })
  if (error) throw new Error(await fnError(error))
  if (data?.error) throw new Error(data.error as string)
  return data as T
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  orgId: null,
  subscription: null,
  plan: 'network',
  loaded: false,
  loading: false,
  error: null,
  smsBalance: null,

  fetchSubscription: async (orgId) => {
    set({ loading: true, error: null, orgId })
    const { data, error } = await getUserClient()
      .from('ps_org_subscriptions')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle()
    if (error) {
      // Table not deployed yet, or no access: behave as the free plan.
      set({ loading: false, loaded: true, error: error.message, subscription: null, plan: 'network' })
      return
    }
    const sub = (data as OrgSubscription | null) ?? null
    set({ loading: false, loaded: true, subscription: sub, plan: effectivePlan(sub) })
  },

  hasFeature: (feature) => planHasFeature(get().plan, feature),

  startCheckout: async (orgId, plan, interval = 'month') => {
    const origin = window.location.origin
    const data = await invokeBilling<{ url: string }>({
      action: 'create_checkout',
      org_id: orgId,
      plan,
      interval,
      success_url: `${origin}/settings?tab=billing&checkout=success`,
      cancel_url: `${origin}/settings?tab=billing&checkout=cancel`,
    })
    return data.url
  },

  openPortal: async (orgId) => {
    const data = await invokeBilling<{ url: string }>({
      action: 'create_portal',
      org_id: orgId,
      return_url: `${window.location.origin}/settings?tab=billing`,
    })
    return data.url
  },

  getBillingMode: async (orgId) => {
    try {
      const data = await invokeBilling<{ mode: BillingMode }>({ action: 'get_mode', org_id: orgId })
      return data.mode
    } catch {
      return 'unconfigured'
    }
  },

  fetchSmsBalance: async (orgId) => {
    const { data, error } = await getUserClient().rpc('ps_sms_credit_balance', { p_org_id: orgId })
    const balance = error ? null : ((data as number | null) ?? 0)
    set({ smsBalance: balance })
    return balance
  },

  buySmsCredits: async (orgId, packId) => {
    const origin = window.location.origin
    const data = await invokeBilling<{ url: string }>({
      action: 'buy_sms_credits',
      org_id: orgId,
      pack: packId,
      success_url: `${origin}/settings?tab=billing&credits=success`,
      cancel_url: `${origin}/settings?tab=billing&credits=cancel`,
    })
    return data.url
  },

  reset: () => set({ smsBalance: null, orgId: null, subscription: null, plan: 'network', loaded: false, error: null }),
}))
