import { useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'

/** Second step of sign-in for accounts with an authenticator app. */
export function MfaCodeForm() {
  const { verifyUserMfa, cancelUserMfa } = useAuthStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifyUserMfa(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work. Try again.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1>Enter your code</h1>
      <p className="subtitle">Open your authenticator app and type the 6-digit code for PharmStation.</p>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="mfa-code">6-digit code</label>
          <input
            id="mfa-code"
            className="ps-input mfa-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        </div>
        <button
          type="submit"
          className="ps-btn ps-btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: '8px' }}
          disabled={loading || code.replace(/\s/g, '').length !== 6}
        >
          {loading ? 'Checking…' : 'Verify'}
        </button>
      </form>
      <p className="onboarding-footer">
        Lost your phone? Ask the pharmacy owner to reset your two-step sign-in.
      </p>
      <div style={{ marginTop: '8px', textAlign: 'center' }}>
        <button type="button" className="ps-btn ps-btn-ghost" onClick={() => cancelUserMfa()} style={{ fontSize: 'var(--ps-font-sm)' }}>
          ← Use a different account
        </button>
      </div>
    </>
  )
}
