import { useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { changeUserEmail, friendlyAuthError } from '@pharmstation/supabase-client'

/** Change the sign-in email. Both addresses must confirm the change. */
export function ChangeEmailCard() {
  const currentEmail = useAuthStore((s) => s.userSession?.user?.email ?? '')
  const pendingEmail = useAuthStore((s) => s.userSession?.user?.new_email ?? '')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const next = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setMsg({ type: 'error', text: 'Enter a valid email address' })
    if (next === currentEmail.toLowerCase()) return setMsg({ type: 'error', text: 'That’s already your email' })
    setSaving(true)
    try {
      await changeUserEmail(next)
      setEmail('')
      setMsg({
        type: 'success',
        text: `Nearly done. We’ve emailed a link to ${currentEmail} and to ${next}. Follow both, then sign in with ${next}.`,
      })
    } catch (err) {
      setMsg({ type: 'error', text: friendlyAuthError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ps-card-header"><h2 className="ps-card-title">Sign-in email</h2></div>
        <div className="ps-card-body">
          <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            You sign in with <strong>{currentEmail}</strong>.
            {pendingEmail && <> A change to <strong>{pendingEmail}</strong> is waiting for confirmation.</>}
          </p>
          {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: '1rem' }}>{msg.text}</div>}
          <div className="form-group" style={{ maxWidth: 420 }}>
            <label className="form-label" htmlFor="new-email">New email</label>
            <input id="new-email" className="form-input" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button type="submit" className="ps-btn ps-btn-primary" disabled={saving || !email.trim()}>
            {saving ? 'Sending…' : 'Change email'}
          </button>
        </div>
      </div>
    </form>
  )
}
