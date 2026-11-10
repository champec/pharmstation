import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import {
  useAuthStore,
  useSubscriptionStore,
  PLANS,
  PLAN_ORDER,
  TRIAL_DAYS,
  planRank,
  formatPence,
  type BillingMode,
  type PlanId,
  type BillingInterval,
} from '@pharmstation/core'
import { canManageBilling } from '../../lib/billing'
import { SmsCreditsCard } from './SmsCreditsCard'
import '../../components/billing/billing.css'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export function BillingSettingsTab() {
  const { organisation, membership, permissions } = useAuthStore()
  const orgId = organisation?.id
  const { subscription, plan, loaded, fetchSubscription, startCheckout, openPortal, getBillingMode } =
    useSubscriptionStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const checkoutResult = searchParams.get('checkout')

  const [mode, setMode] = useState<BillingMode | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [interval, setBillingInterval] = useState<BillingInterval>('month')

  const canManage = canManageBilling(membership, permissions)
  const hasStripeSub =
    !!subscription?.stripe_subscription_id &&
    ['trialing', 'active', 'past_due', 'unpaid', 'incomplete'].includes(subscription.status)
  const everSubscribed = !!subscription?.stripe_subscription_id
  const comped =
    subscription?.override_plan &&
    (!subscription.override_until || new Date(subscription.override_until) > new Date())

  useEffect(() => {
    if (!orgId) return
    fetchSubscription(orgId)
    getBillingMode(orgId).then(setMode)
  }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Back from Stripe Checkout: the webhook normally lands within seconds, but
  // ask the server to re-read Stripe too so the page never shows stale data.
  useEffect(() => {
    if (!orgId || checkoutResult !== 'success') return
    let cancelled = false
    setNotice('Payment details received. Setting up your plan…')
    ;(async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        await getUserClient()
          .functions.invoke('stripe-billing', { body: { action: 'refresh', org_id: orgId } })
          .catch(() => undefined)
        await fetchSubscription(orgId)
        const s = useSubscriptionStore.getState().subscription
        if (s?.stripe_subscription_id && ['trialing', 'active'].includes(s.status)) break
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (cancelled) return
      const s = useSubscriptionStore.getState().subscription
      setNotice(
        s?.stripe_subscription_id
          ? `You're on ${PLANS[s.plan].name}. Thank you!`
          : 'Stripe is still confirming your payment. This page will update shortly; refresh in a minute.',
      )
      const next = new URLSearchParams(searchParams)
      next.delete('checkout')
      next.delete('session_id')
      setSearchParams(next, { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, checkoutResult]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (target: Exclude<PlanId, 'network'>) => {
    if (!orgId) return
    setBusy(target)
    setError('')
    try {
      window.location.href = await startCheckout(orgId, target, interval)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  const manage = async () => {
    if (!orgId) return
    setBusy('portal')
    setError('')
    try {
      window.location.href = await openPortal(orgId)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  const statusLine = () => {
    if (!subscription || !hasStripeSub) return null
    switch (subscription.status) {
      case 'trialing':
        return `Free trial until ${fmtDate(subscription.trial_end)}. Your card is charged after that unless you cancel.`
      case 'past_due':
      case 'unpaid':
        return 'Your last payment failed. Update your card in "Manage billing" to keep your plan.'
      case 'incomplete':
        return 'Your first payment needs confirming. Open "Manage billing" to finish.'
      default:
        return subscription.cancel_at_period_end
          ? `Cancelled. You keep ${PLANS[subscription.plan].name} until ${fmtDate(subscription.current_period_end)}.`
          : `Renews on ${fmtDate(subscription.current_period_end)}.`
    }
  }

  if (!orgId) return null

  return (
    <div className="billing-tab">
      {mode === 'test' && (
        <div className="billing-banner billing-banner-test">
          <strong>Test mode.</strong> Stripe is using test keys, so no real money moves. Pay with card
          4242 4242 4242 4242, any future date and any CVC.
        </div>
      )}
      {mode === 'unconfigured' && (
        <div className="billing-banner billing-banner-warn">
          Online billing isn't switched on yet. Contact PharmStation to change your plan.
        </div>
      )}
      {checkoutResult === 'cancel' && (
        <div className="billing-banner">Checkout cancelled. Nothing was charged.</div>
      )}
      {notice && <div className="billing-banner billing-banner-ok">{notice}</div>}
      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card billing-current">
        <div>
          <div className="billing-eyebrow">Current plan</div>
          <h3>
            {!loaded ? '…' : hasStripeSub ? PLANS[subscription!.plan].name : PLANS[plan].name}
            {subscription?.is_founding_member && <span className="ps-badge ps-badge-blue">Founding member</span>}
            {subscription?.status === 'trialing' && <span className="ps-badge ps-badge-green">Free trial</span>}
            {(subscription?.status === 'past_due' || subscription?.status === 'unpaid') && (
              <span className="ps-badge ps-badge-amber">Payment failed</span>
            )}
          </h3>
          {statusLine() && <p>{statusLine()}</p>}
          {comped && hasStripeSub && planRank(subscription!.override_plan!) > planRank(subscription!.plan) && (
            <p>
              You also have complimentary {PLANS[subscription!.override_plan!].name} access
              {subscription!.override_until ? ` until ${fmtDate(subscription!.override_until)}` : ''}, so you can use
              everything in {PLANS[subscription!.override_plan!].name} until then.
            </p>
          )}
          {comped && !hasStripeSub && (
            <p>
              Complimentary {PLANS[subscription!.override_plan!].name} access
              {subscription!.override_until ? ` until ${fmtDate(subscription!.override_until)}` : ''}. Choose a plan
              below any time to keep it after that.
            </p>
          )}
        </div>
        {hasStripeSub && canManage && (
          <button className="ps-btn ps-btn-secondary" onClick={manage} disabled={busy !== null}>
            {busy === 'portal' ? 'Opening Stripe…' : 'Manage billing'}
          </button>
        )}
      </div>

      {!canManage && (
        <p className="billing-note">
          Only the pharmacy owner, or staff they give billing access, can change the plan.
          {!membership && ' Sign in with your own staff account to do it.'}
        </p>
      )}

      {!hasStripeSub && (
        <div className="billing-interval" role="group" aria-label="Billing period">
          <button
            className={`ps-btn ${interval === 'month' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setBillingInterval('month')}
          >
            Monthly
          </button>
          <button
            className={`ps-btn ${interval === 'year' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setBillingInterval('year')}
          >
            Yearly: 2 months free
          </button>
        </div>
      )}

      <div className="billing-plans">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id]
          const isCurrent = loaded && plan === id && (hasStripeSub || id === 'network' || !!comped)
          const isPaidCurrent = hasStripeSub && subscription?.plan === id
          let action: ReactNode = null

          if (id === 'network') {
            action = isCurrent && !hasStripeSub ? <span className="billing-current-tag">Your plan</span> : null
          } else if (isPaidCurrent) {
            action = <span className="billing-current-tag">Your plan</span>
          } else if (hasStripeSub) {
            action = (
              <button className="ps-btn ps-btn-secondary" onClick={manage} disabled={!canManage || busy !== null}>
                {planRank(id) > planRank(subscription!.plan) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
              </button>
            )
          } else {
            action = (
              <button
                className="ps-btn ps-btn-primary"
                onClick={() => choose(id)}
                disabled={!canManage || busy !== null || mode === 'unconfigured'}
              >
                {busy === id ? 'Opening Stripe…' : everSubscribed || TRIAL_DAYS === 0 ? `Choose ${p.name}` : `Start ${TRIAL_DAYS}-day free trial`}
              </button>
            )
          }

          return (
            <div key={id} className={`ps-card billing-plan ${id === 'complete' ? 'billing-plan-featured' : ''}`}>
              {id === 'complete' && <div className="billing-plan-flag">Most popular</div>}
              <h4>{p.name}</h4>
              <div className="billing-price">
                {formatPence(interval === 'year' && !hasStripeSub ? p.annualPence : p.monthlyPence)}
                <span>{!p.monthlyPence ? ' forever' : interval === 'year' && !hasStripeSub ? ' / year' : ' / month'}</span>
              </div>
              <p className="billing-tagline">{p.tagline}</p>
              <ul>
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <div className="billing-plan-action">{action}</div>
            </div>
          )
        })}
      </div>

      <SmsCreditsCard orgId={orgId} canManage={canManage} />

      <p className="billing-note">
        Payments are handled by Stripe; PharmStation never sees your card details. Cancel any time from
        "Manage billing": you keep your plan until the end of the period you've paid for.
      </p>
    </div>
  )
}
