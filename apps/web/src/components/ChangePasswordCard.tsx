import { useState, type FormEvent } from 'react'
import { changeUserPassword, friendlyAuthError, logAuthEvent, passwordProblem } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

/** Change the signed-in person's password. Asks for the current one first. */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const problem = passwordProblem(next)
    if (problem) return setMsg({ type: 'error', text: `${problem} in your new password` })
    if (next !== confirm) return setMsg({ type: 'error', text: 'The two new passwords don’t match' })
    if (next === current) return setMsg({ type: 'error', text: 'Choose a password you haven’t used here before' })
    setSaving(true)
    try {
      await changeUserPassword(current, next)
      void logAuthEvent(useAuthStore.getState().membership?.organisation_id, 'password_changed')
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ type: 'success', text: 'Password changed. Use it next time you sign in.' })
    } catch (err) {
      setMsg({ type: 'error', text: friendlyAuthError(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ps-card-header"><h2 className="ps-card-title">🔑 Password</h2></div>
        <div className="ps-card-body">
          {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: '1rem' }}>{msg.text}</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="pw-current">Current password</label>
            <input id="pw-current" className="form-input" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="pw-new">New password</label>
              <input id="pw-new" className="form-input" type="password" autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pw-confirm">Type it again</label>
              <input id="pw-confirm" className="form-input" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
            At least 10 characters, with letters and numbers.
          </p>
          <button type="submit" className="ps-btn ps-btn-primary" disabled={saving || !current || !next || !confirm}>
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </div>
    </form>
  )
}
