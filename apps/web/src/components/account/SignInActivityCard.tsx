import { useEffect, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { listAuthEvents, type AuthEventRow } from '@pharmstation/supabase-client'

const EVENT_LABELS: Record<string, string> = {
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  idle_sign_out: 'Signed out automatically (inactive)',
  failed_sign_in: 'Failed sign-in',
  password_changed: 'Changed password',
  two_step_on: 'Turned on two-step sign-in',
  two_step_off: 'Turned off two-step sign-in',
  two_step_reset: 'Two-step sign-in reset by a manager',
  two_step_reset_by_email: 'Reset two-step sign-in by email',
  member_added: 'Added to the pharmacy',
  member_changed: 'Role or access changed',
}

function describe(e: AuthEventRow): string {
  if (e.event === 'member_added') {
    const d = e.detail as { role?: string; temporary_until?: string | null }
    return d.temporary_until
      ? `Shift access as ${d.role} until ${new Date(d.temporary_until).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`
      : `Added as ${d.role ?? 'staff'}`
  }
  if (e.event === 'member_changed') {
    const d = e.detail as { role?: [string, string]; status?: [string, string]; permissions_changed?: boolean }
    const parts: string[] = []
    if (d.role && d.role[0] !== d.role[1]) parts.push(`role ${d.role[0]} → ${d.role[1]}`)
    if (d.status && d.status[0] !== d.status[1]) parts.push(`${d.status[0]} → ${d.status[1]}`)
    if (d.permissions_changed) parts.push('permissions changed')
    return parts.length ? parts.join(', ') : EVENT_LABELS.member_changed
  }
  return EVENT_LABELS[e.event] ?? e.event
}

/** Settings > Team: recent sign-ins, failures and access changes. */
export function SignInActivityCard() {
  const { organisation, permissions } = useAuthStore()
  const [rows, setRows] = useState<AuthEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)

  useEffect(() => {
    if (!organisation?.id || !permissions?.view_audit) return
    listAuthEvents(organisation.id).then(setRows).catch((err) => setError(err.message))
  }, [organisation?.id, permissions?.view_audit])

  if (!permissions?.view_audit) return null

  const shown = (rows ?? []).filter((r) => !onlyProblems || ['failed_sign_in', 'two_step_off', 'two_step_reset', 'two_step_reset_by_email', 'member_changed'].includes(r.event))

  return (
    <div className="ps-card team-card">
      <div className="ps-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 className="ps-card-title">Sign-in activity</h2>
        <label style={{ fontSize: 'var(--ps-font-sm)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Only failures and access changes
        </label>
      </div>
      <div className="ps-card-body">
        {error && <div className="ps-alert ps-alert-error">{error}</div>}
        {!error && rows === null && <p className="text-muted">Loading…</p>}
        {rows && shown.length === 0 && <p className="text-muted">Nothing to show yet.</p>}
        {shown.length > 0 && (
          <div className="signin-activity">
            {shown.map((r) => (
              <div key={r.id} className={`signin-activity-row ${r.event === 'failed_sign_in' ? 'is-problem' : ''}`}>
                <span className="signin-activity-time">
                  {new Date(r.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span className="signin-activity-who">{r.full_name ?? r.email ?? 'Unknown'}</span>
                <span className="signin-activity-what">
                  {describe(r)}
                  {r.by_name && ['member_changed', 'two_step_reset'].includes(r.event) && ` (by ${r.by_name})`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
