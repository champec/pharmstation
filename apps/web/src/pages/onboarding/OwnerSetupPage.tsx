import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { orgNeedsOwner } from '@pharmstation/supabase-client'
import { OwnerSetupForm } from './OwnerSetupForm'

/**
 * Resume point for pharmacy sign-up when email confirmation interrupted it.
 * Reached from the staff sign-in screen when the pharmacy has no owner yet.
 */
export function OwnerSetupPage() {
  const { organisation, orgLogout } = useAuthStore()
  const [needsOwner, setNeedsOwner] = useState<boolean | null>(null)

  useEffect(() => {
    orgNeedsOwner().then(setNeedsOwner)
  }, [])

  if (needsOwner === null) {
    return <div className="auth-card"><p>Loading&hellip;</p></div>
  }
  if (!needsOwner) return <Navigate to="/login/user" replace />

  return (
    <div className="auth-card onboarding-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>
      <ol className="onboarding-steps" aria-label="Sign-up progress">
        <li className="done">Your pharmacy</li>
        <li className="active">Your login</li>
      </ol>
      <OwnerSetupForm pharmacyName={organisation?.name} />
      <p className="onboarding-footer">
        Not your pharmacy?{' '}
        <button type="button" className="ps-btn-link" onClick={() => orgLogout()}>Sign out of {organisation?.name ?? 'this pharmacy'}</button>
      </p>
    </div>
  )
}
