import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { getAuthRedirectType } from '@pharmstation/supabase-client'
import { PasswordInput } from '../../components/PasswordInput'
import { Building2, User } from 'lucide-react'

export function OrgLoginPage() {
  const { orgLogin } = useAuthStore()
  // Test credentials are prefilled in local dev only
  const [email, setEmail] = useState(import.meta.env.DEV ? 'testpharmacy@pharmstation.dev' : '')
  const [password, setPassword] = useState(import.meta.env.DEV ? 'TestPharmacy123!' : '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await orgLogin(email, password)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Login failed. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <div className="login-portal-switcher">
        <span className="login-portal-tab active">
          <span className="login-portal-tab-icon"><Building2 size={18} aria-hidden="true" /></span>
          Pharmacy
        </span>
        <Link to="/patient/login" className="login-portal-tab">
          <span className="login-portal-tab-icon">🧑‍⚕️</span>
          Patient
        </Link>
        <Link to="/me/login" className="login-portal-tab">
          <span className="login-portal-tab-icon"><User size={18} aria-hidden="true" /></span>
          Staff
        </Link>
      </div>

      <h1>Pharmacy Login</h1>
      <p className="subtitle">Sign in to your pharmacy workstation</p>

      {getAuthRedirectType() === 'signup' && !error && (
        <div className="ps-alert ps-alert-success onboarding-notice">
          Email confirmed. Sign in to the pharmacy to carry on.
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="org-email">Pharmacy Email</label>
          <input
            id="org-email"
            type="email"
            className="ps-input"
            placeholder="pharmacy@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="org-password">Password</label>
          <PasswordInput
            id="org-password"
            className="ps-input"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="auth-forgot-link">
          <Link to="/forgot-password/org">Forgot password?</Link>
        </div>

        <button
          type="submit"
          className="ps-btn ps-btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: '8px' }}
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign In to Pharmacy'}
        </button>
      </form>

      <p className="onboarding-footer">
        New pharmacy? <Link to="/signup">Create a pharmacy account</Link>
      </p>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <Link to="/me/login" style={{ fontSize: 'var(--ps-font-sm)' }}>
          Personal account sign in instead
        </Link>
      </div>
    </div>
  )
}
