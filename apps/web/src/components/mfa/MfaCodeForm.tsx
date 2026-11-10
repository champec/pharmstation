import { useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { sendMfaRecoveryEmail } from '@pharmstation/supabase-client'

/** Second step of sign-in for accounts with an authenticator app. */
export function MfaCodeForm() {
  const { verifyUserMfa, recoverUserMfaByEmail, cancelUserMfa } = useAuthStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Set once a recovery code has been emailed: the code box then takes that code.
  const [emailedTo, setEmailedTo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (emailedTo) await recoverUserMfaByEmail(code)
      else await verifyUserMfa(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work. Try again.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const emailMeACode = async () => {
    setError(null)
    setSending(true)
    try {
      const to = await sendMfaRecoveryEmail()
      setEmailedTo(to ?? 'your email')
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send the email. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <h1>{emailedTo ? 'Check your email' : 'Enter your code'}</h1>
      <p className="subtitle">
        {emailedTo
          ? `We’ve emailed a 6-digit code to ${emailedTo}. It lasts 10 minutes. Entering it turns off two-step sign-in so you can set it up again.`
          : 'Open the PharmStation app (My Account > Security) or Google Authenticator and type the 6-digit code. On a pharmacy computer you only need it once per shift.'}
      </p>
      {error && <div className="auth-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="mfa-code">{emailedTo ? 'Code from the email' : '6-digit code'}</label>
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
      <div style={{ marginTop: '12px', textAlign: 'center', display: 'grid', gap: '4px' }}>
        <button type="button" className="ps-btn ps-btn-ghost" onClick={emailMeACode} disabled={sending} style={{ fontSize: 'var(--ps-font-sm)' }}>
          {sending ? 'Sending…' : emailedTo ? 'Send a new email code' : 'Can’t get your code? Email me one instead'}
        </button>
        {emailedTo && (
          <button
            type="button"
            className="ps-btn ps-btn-ghost"
            onClick={() => { setEmailedTo(null); setCode(''); setError(null) }}
            style={{ fontSize: 'var(--ps-font-sm)' }}
          >
            Use my authenticator code after all
          </button>
        )}
        <button type="button" className="ps-btn ps-btn-ghost" onClick={() => cancelUserMfa()} style={{ fontSize: 'var(--ps-font-sm)' }}>
          ← Use a different account
        </button>
      </div>
    </>
  )
}
