import { useState, type FormEvent } from 'react'
import { startTotpEnrollment, verifyTotpCode, type TotpEnrollment } from '@pharmstation/supabase-client'

/** Add an authenticator app: scan the QR code, then confirm a code. */
export function TotpSetup({ onDone, startLabel = 'Set up two-step sign-in' }: { onDone: () => void; startLabel?: string }) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      setEnrollment(await startTotpEnrollment())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start set-up. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!enrollment) return
    setError(null)
    setBusy(true)
    try {
      await verifyTotpCode(enrollment.factorId, code)
      setEnrollment(null)
      setCode('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!enrollment) {
    return (
      <>
        {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        <button type="button" className="ps-btn ps-btn-primary" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : startLabel}
        </button>
      </>
    )
  }

  return (
    <form onSubmit={confirm} className="totp-setup">
      <ol className="totp-steps">
        <li>
          On your phone, open the PharmStation app and go to My Account &gt; Security. Any authenticator app
          works too, such as Google Authenticator, Microsoft Authenticator or 1Password.
        </li>
        <li>
          Tap &ldquo;Scan a QR code&rdquo; (or add an account in your authenticator app) and scan this code.
          <div className="totp-qr">
            <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} />
          </div>
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setShowSecret((v) => !v)}>
            {showSecret ? 'Hide the set-up key' : 'Can’t scan? Type a key instead'}
          </button>
          {showSecret && <code className="totp-secret">{enrollment.secret}</code>}
        </li>
        <li>
          Type the 6-digit code the app shows.
          <div className="form-group" style={{ maxWidth: 220, marginTop: '0.5rem' }}>
            <input
              className="ps-input mfa-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="6-digit code"
              autoFocus
            />
          </div>
        </li>
      </ol>
      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      <button type="submit" className="ps-btn ps-btn-primary" disabled={busy || code.replace(/\s/g, '').length !== 6}>
        {busy ? 'Checking…' : 'Turn on two-step sign-in'}
      </button>
    </form>
  )
}
