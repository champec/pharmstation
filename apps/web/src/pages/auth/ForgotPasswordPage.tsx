import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { requestPasswordReset } from '@pharmstation/supabase-client'
import { RESET_RETURN, resetReturn } from './passwordReturn'

export function ForgotPasswordPage() {
  const { kind } = useParams<{ kind: string }>()
  const from = resetReturn(kind)
  const back = RESET_RETURN[from]
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await requestPasswordReset(email, `${window.location.origin}/reset-password/${from}`)
      setSent(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setError(/rate limit|too many/i.test(message) ? 'Too many requests. Wait a few minutes, then try again.' : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <h1>Forgot password</h1>
      <p className="subtitle">We&rsquo;ll email you a link to choose a new password for your {back.account}.</p>

      {sent ? (
        <div className="ps-alert ps-alert-success onboarding-notice">
          If an account uses <strong>{email.trim()}</strong>, a reset link is on its way. It works once and expires
          in an hour. Check your spam folder if it hasn&rsquo;t arrived in a few minutes.
        </div>
      ) : (
        <>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                className="ps-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="ps-btn ps-btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: '8px' }}
              disabled={loading || !email.trim()}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        </>
      )}

      <p className="onboarding-footer">
        <Link to={back.to}>← Back to {back.label}</Link>
      </p>
    </div>
  )
}
