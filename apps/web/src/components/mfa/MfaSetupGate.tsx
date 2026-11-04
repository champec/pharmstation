import type { ReactNode } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { TotpSetup } from './TotpSetup'

/** Owners and managers add an authenticator app before using the pharmacy. */
export function MfaSetupGate({ children }: { children: ReactNode }) {
  const { mfaSetupRequired, refreshMfaSetup, membership, switchUser } = useAuthStore()
  if (!mfaSetupRequired) return <>{children}</>

  return (
    <div className="ps-card mfa-setup-gate">
      <div className="ps-card-body">
        <h1 style={{ marginBottom: '0.5rem' }}>Protect your account</h1>
        <p style={{ marginBottom: '1rem' }}>
          As {membership?.role === 'owner' ? 'an owner' : 'a manager'}, you can manage staff, settings and
          registers, so PharmStation needs two-step sign-in on your account. It takes about a minute.
        </p>
        <TotpSetup onDone={() => void refreshMfaSetup()} startLabel="Set it up now" />
        <p className="text-muted" style={{ marginTop: '1.25rem', fontSize: '0.8125rem' }}>
          Not you, or not now?{' '}
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => switchUser()}>
            Switch user
          </button>
        </p>
      </div>
    </div>
  )
}
