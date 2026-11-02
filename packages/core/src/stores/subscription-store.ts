import { create } from 'zustand'
import { getUserClient } from '@pharmstation/supabase-client'
import {
  effectivePlan,
  planHasFeature,
  type Feature,
  type OrgSubscription,
  type PlanId,
} from '../billing/plans'

export type BillingMode = 'test' | 'live' | 'unconfigured'

export interface SubscriptionState {
  orgId: string | null
  subscription: OrgSubscription | null
  plan: PlanId
  loaded: boolean
  loading: boolean
  error: string | null

  fetchSubscription: (orgId: string) => Promise<void>
  hasFeature: (feature: Feature) => boolean
  /** Start Stripe Checkout for a paid plan; resolves to the hosted Checkout URL. */
  startCheckout: (orgId: string, plan: Exclude<PlanId, 'network'>) => Promise<string>
  /** Open the Stripe customer portal (change card, switch plan, cancel, invoices). */
  openPortal: (orgId: string) => Promise<string>
  /** Ask the server whether Stripe is in test or live mode. */
  getBillingMode: (orgId: string) => Promise<BillingMode>
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

  startCheckout: async (orgId, plan) => {
    const origin = window.location.origin
    const data = await invokeBilling<{ url: string }>({
      action: 'create_checkout',
      org_id: orgId,
      plan,
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

  reset: () => set({ orgId: null, subscription: null, plan: 'network', loaded: false, error: null }),
}))
