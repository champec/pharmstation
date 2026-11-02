import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  useSubscriptionStore,
  featureForPath,
  minimumPlanFor,
  PLANS,
  formatPence,
} from '@pharmstation/core'
import { PLANS_ENFORCED } from '../../lib/billing'
import './billing.css'

/**
 * Wraps the dashboard outlet. When plan enforcement is on and the current
 * route belongs to a feature the organisation's plan does not include, shows
 * an upgrade card instead of the page.
 */
export function PlanGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { loaded, hasFeature, plan } = useSubscriptionStore()

  if (!PLANS_ENFORCED) return <>{children}</>
  const feature = featureForPath(pathname)
  if (!feature) return <>{children}</>
  if (!loaded) return <p style={{ color: 'var(--ps-slate)' }}>Loading…</p>
  if (hasFeature(feature)) return <>{children}</>

  const needed = PLANS[minimumPlanFor(feature)]
  return (
    <div className="ps-card plan-gate">
      <div className="plan-gate-icon" aria-hidden="true">🔒</div>
      <h2>This is part of the {needed.name} plan</h2>
      <p>
        Your pharmacy is on the {PLANS[plan].name} plan. Upgrade to {needed.name} for{' '}
        {formatPence(needed.monthlyPence)} a month to unlock it: {needed.tagline.toLowerCase()}.
      </p>
      <ul>
        {needed.highlights.slice(1, 5).map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <Link to="/settings?tab=billing" className="ps-btn ps-btn-primary">
        See plans
      </Link>
    </div>
  )
}
