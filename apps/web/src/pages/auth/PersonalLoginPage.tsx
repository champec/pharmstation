import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'

/**
 * Personal account sign-in — bypasses the organisation login entirely.
 * Signing in is a user-layer operation; roles (staff/locum/driver…)
 * decide what the account can see afterwards.
 */
export function PersonalLoginPage() {
  const { userLogin } = useAuthStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Personal login never requires org membership — even on a browser
      // that has an org session (e.g. a pharmacy terminal).
      await userLogin(email, password, { requireOrgMembership: false })
      navigate('/me', { replace: true })
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

      <h1>Personal Sign In</h1>
      <p className="subtitle">
        Access your personal account — no pharmacy sign-in needed
      </p>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="me-email">Email</label>
          <input
            id="me-email"
            type="email"
            className="ps-input"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="me-password">Password</label>
          <input
            id="me-password"
            type="password"
            className="ps-input"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
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

      <div style={{ marginTop: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Link to="/login/org" style={{ fontSize: 'var(--ps-font-sm)' }}>
          🏥 Pharmacy sign in instead
        </Link>
        <Link to="/locum/login" style={{ fontSize: 'var(--ps-font-sm)' }}>
          💼 Locum portal
        </Link>
      </div>
    </div>
  )
}
