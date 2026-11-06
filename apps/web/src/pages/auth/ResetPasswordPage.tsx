import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { completePasswordReset, friendlyAuthError, passwordProblem } from '@pharmstation/supabase-client'
import { RESET_RETURN, resetReturn } from './passwordReturn'
import { PasswordInput } from '../../components/PasswordInput'

export function ResetPasswordPage() {
  const { kind } = useParams<{ kind: string }>()
  const from = resetReturn(kind)
  const back = RESET_RETURN[from]

  // Read the one-time token once, then drop it from the address bar so it
  // doesn't sit in browser history.
  const tokenHash = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token_hash')
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname)
    return token
  }, [])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError('The two passwords don’t match')
    if (!tokenHash) return
    setLoading(true)
    try {
      await completePasswordReset(tokenHash, password)
      setDone(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      setError(
        /expired|invalid|not found|otp/i.test(message)
          ? 'This reset link has expired or was already used. Request a new one.'
          : friendlyAuthError(err),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <h1>Choose a new password</h1>

      {done ? (
        <>
          <div className="ps-alert ps-alert-success onboarding-notice">
            Your password has been changed and you&rsquo;ve been signed out everywhere else. Sign in with your new
            password.
          </div>
          <Link to={back.to} className="ps-btn ps-btn-primary" style={{ width: '100%', padding: '12px' }}>
            Go to {back.label}
          </Link>
        </>
      ) : !tokenHash ? (
        <>
          <div className="auth-error">This page needs the link from your reset email.</div>
          <p className="onboarding-footer">
            <Link to={`/forgot-password/${from}`}>Request a new reset link</Link>
          </p>
        </>
      ) : (
        <>
          <p className="subtitle">At least 10 characters, with letters and numbers.</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="reset-password">New password</label>
              <PasswordInput
                id="reset-password"
                className="ps-input"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="reset-confirm">Type it again</label>
              <PasswordInput
                id="reset-confirm"
                className="ps-input"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="ps-btn ps-btn-primary"
              style={{ width: '100%', padding: '12px', marginTop: '8px' }}
              disabled={loading || !password || !confirm}
            >
              {loading ? 'Saving…' : 'Save new password'}
            </button>
          </form>
          {error && /expired/.test(error) && (
            <p className="onboarding-footer">
              <Link to={`/forgot-password/${from}`}>Request a new reset link</Link>
            </p>
          )}
        </>
      )}
    </div>
  )
}
