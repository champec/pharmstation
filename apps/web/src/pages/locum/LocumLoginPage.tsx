import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLocumAuthStore } from '@pharmstation/core'
import { getLocumClient } from '@pharmstation/supabase-client'

export function LocumLoginPage() {
  const navigate = useNavigate()
  const { login } = useLocumAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Forgot password state
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate('/locum/dashboard')
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Login failed. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault()
    setResetError(null)
    setResetLoading(true)
    try {
      const { error } = await getLocumClient().auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/locum/update-password`,
      })
      if (error) throw error
      setResetSent(true)
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset email.')
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '420px', margin: '80px auto', padding: '0 var(--ps-space-lg)' }}>
      <div className="ps-card" style={{ padding: 'var(--ps-space-xl)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <div className="logo" style={{ fontSize: '1.5rem', marginBottom: 'var(--ps-space-sm)' }}>
            Pharm<span>Station</span>
          </div>
          {showReset ? (
            <>
              <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>Reset Password</h1>
              <p style={{ color: 'var(--ps-slate)' }}>We'll email you a link to reset your password</p>
            </>
          ) : (
            <>
              <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>Locum Sign In</h1>
              <p style={{ color: 'var(--ps-slate)' }}>Access your shifts, bookings, and invoices</p>
            </>
          )}
        </div>

        {/* ── Forgot password panel ── */}
        {showReset ? (
          resetSent ? (
            <div className="ps-alert ps-alert-info" style={{ textAlign: 'center' }}>
              <p style={{ marginBottom: 'var(--ps-space-sm)' }}>Check your email for a password reset link.</p>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { setShowReset(false); setResetSent(false) }}>
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword}>
              {resetError && (
                <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{resetError}</div>
              )}
              <div className="form-group">
                <label htmlFor="reset-email">Email</label>
                <input
                  id="reset-email"
                  type="email"
                  className="ps-input"
                  placeholder="you@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <button
                type="submit"
                className="ps-btn ps-btn-primary"
                style={{ width: '100%', marginTop: 'var(--ps-space-md)' }}
                disabled={resetLoading}
              >
                {resetLoading ? 'Sending…' : 'Send Reset Link'}
              </button>
              <p style={{ textAlign: 'center', marginTop: 'var(--ps-space-md)', fontSize: '0.875rem' }}>
                <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setShowReset(false)}>
                  Back to sign in
                </button>
              </p>
            </form>
          )
        ) : (
          /* ── Sign in panel ── */
          <>
            {error && (
              <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="locum-email">Email</label>
                <input
                  id="locum-email"
                  type="email"
                  className="ps-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label htmlFor="locum-password">Password</label>
                  <button
                    type="button"
                    onClick={() => { setShowReset(true); setResetEmail(email) }}
                    style={{ background: 'none', border: 'none', color: 'var(--ps-primary)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="locum-password"
                  type="password"
                  className="ps-input"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="ps-btn ps-btn-primary"
                style={{ width: '100%', marginTop: 'var(--ps-space-md)' }}
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p style={{ textAlign: 'center', marginTop: 'var(--ps-space-lg)', color: 'var(--ps-slate)', fontSize: '0.875rem' }}>
              New to PharmStation?{' '}
              <Link to="/locum/register" style={{ color: 'var(--ps-primary)' }}>Create a locum account</Link>
            </p>

            <p style={{ textAlign: 'center', marginTop: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: '0.875rem' }}>
              Pharmacy staff?{' '}
              <Link to="/login/org" style={{ color: 'var(--ps-primary)' }}>Staff login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
