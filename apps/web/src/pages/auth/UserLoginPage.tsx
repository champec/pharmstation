import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { logAuthEvent, orgNeedsOwner } from '@pharmstation/supabase-client'
import { IDLE_SIGNOUT_FLAG } from '../../components/IdleLock'
import { MfaCodeForm } from '../../components/mfa/MfaCodeForm'
import { PasswordInput } from '../../components/PasswordInput'

export function UserLoginPage() {
  const { organisation, userLogin, orgLogout, mfaPendingFactorId } = useAuthStore()
  // Test credentials are prefilled in local dev only
  const [email, setEmail] = useState(import.meta.env.DEV ? 'testuser@pharmstation.dev' : '')
  const [password, setPassword] = useState(import.meta.env.DEV ? 'TestUser123!' : '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsOwner, setNeedsOwner] = useState(false)
  // Set by IdleLock when it signed the last person out for inactivity.
  const [idleMinutes] = useState(() => {
    try {
      return sessionStorage.getItem(IDLE_SIGNOUT_FLAG)
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      sessionStorage.removeItem(IDLE_SIGNOUT_FLAG)
    } catch {
      // ignore
    }
  }, [])

  // A pharmacy that signed up but hasn't linked its owner yet (e.g. the
  // sign-up paused for email confirmation) has nobody who can sign in here.
  useEffect(() => {
    orgNeedsOwner().then(setNeedsOwner)
  }, [])

  // Load saved staff emails from localStorage
  // Recent staff for THIS pharmacy only (the old device-wide list showed people from other pharmacies)
  const savedStaff = (() => {
    try {
      return JSON.parse(localStorage.getItem(`ps-saved-staff:${organisation?.id ?? ''}`) || '[]') as string[]
    } catch {
      return []
    }
  })()

  const handleStaffSelect = (staffEmail: string) => {
    // If already selected, clicking again just keeps the selection (cancel = don't submit)
    setEmail(staffEmail)
    setPassword('') // Clear password so they need to re-enter it
    setError(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await userLogin(email, password)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Login failed. Please try again.'
      void logAuthEvent(organisation?.id, 'failed_sign_in', email)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (mfaPendingFactorId) {
    return (
      <div className="auth-card">
        <div className="logo">
          Pharm<span>Station</span>
        </div>
        <MfaCodeForm />
      </div>
    )
  }

  return (
    <div className="auth-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <h1>Staff Sign In</h1>
      <p className="subtitle">
        Signed in to <strong>{organisation?.name ?? 'Unknown Pharmacy'}</strong>
      </p>

      {needsOwner && (
        <div className="ps-alert ps-alert-info onboarding-notice">
          <span>
            Almost there: this pharmacy doesn&rsquo;t have an owner yet.{' '}
            <Link to="/setup/owner"><strong>Finish setting up</strong></Link>
          </span>
        </div>
      )}
      {idleMinutes && !error && (
        <div className="ps-alert ps-alert-info onboarding-notice">
          You were signed out after {idleMinutes} minutes without activity. Sign in again to carry on.
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}

      {/* Saved staff quick-select */}
      {savedStaff.length > 0 && (
        <>
          <div className="saved-staff-list">
            {savedStaff.map((staffEmail) => (
              <button
                key={staffEmail}
                type="button"
                className={`saved-staff-item ${email === staffEmail ? 'selected' : ''}`}
                onClick={() => handleStaffSelect(staffEmail)}
              >
                👤 {staffEmail}
              </button>
            ))}
          </div>
          <div className="divider-text">or enter email manually</div>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="user-email">Email</label>
          <input
            id="user-email"
            type="email"
            className="ps-input"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="user-password">Password</label>
          <PasswordInput
            id="user-password"
            className="ps-input"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus={savedStaff.length > 0}
          />
        </div>
        <div className="auth-forgot-link">
          <Link to="/forgot-password/staff">Forgot password?</Link>
        </div>

        <button
          type="submit"
          className="ps-btn ps-btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: '8px' }}
          disabled={loading || !email}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button
          className="ps-btn ps-btn-ghost"
          onClick={orgLogout}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        >
          ← Switch Pharmacy
        </button>
      </div>
    </div>
  )
}
