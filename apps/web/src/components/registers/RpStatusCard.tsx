// ============================================
// RpStatusCard: who is the Responsible Pharmacist right now, with one-tap
// sign in, step out, back, sign out and take over. Used on the dashboard and
// the RP log.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { Modal } from '../Modal'
import {
  MAX_ABSENCE_MINUTES,
  buildSessions,
  formatDuration,
  loadRpData,
  minutesBetween,
  openAbsence,
  rpEndAbsence,
  rpErrorMessage,
  rpSignIn,
  rpSignOut,
  rpStartAbsence,
  type RpSession,
} from '../../lib/rpLog'
import { addDays, formatTime, ukDate } from '../../pages/logs/logUtils'

interface Props {
  /** Called after any change so the parent can refresh */
  onChange?: () => void
  /** Bump to make the card reload (e.g. after the parent changed the log) */
  refreshKey?: number
  compact?: boolean
}

type Confirm = { kind: 'sign-in' | 'take-over' } | { kind: 'sign-out' } | { kind: 'step-out' } | null

export function RpStatusCard({ onChange, refreshKey, compact }: Props) {
  const { organisation, activeUser, permissions } = useAuthStore()
  const canSign = !!permissions?.rp_log_sign
  const [session, setSession] = useState<RpSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [absenceReason, setAbsenceReason] = useState('')
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!organisation) return
    setLoading(true)
    try {
      const data = await loadRpData(organisation.id, addDays(ukDate(), -2))
      const open = buildSessions(data.entries, data.absences).find((s) => s.isOpen) ?? null
      setSession(open)
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [organisation])

  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30000)
    return () => window.clearInterval(t)
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setConfirm(null)
      setAbsenceReason('')
      await load()
      onChange?.()
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!organisation) return null

  const isMe = !!session && !!activeUser?.gphc_number && session.current.gphc_number === activeUser.gphc_number
  const away = openAbsence(session)
  const awayMins = away ? minutesBetween(away.absent_from, null) : 0
  const onDutyMins = session?.current.rp_signed_in_at ? minutesBetween(session.current.rp_signed_in_at, null) : 0
  const state = loading && !session ? 'loading' : !session ? 'none' : away ? 'away' : 'on'

  return (
    <section className={`rp-status is-${state}${compact ? ' is-compact' : ''}`} aria-live="polite">
      <div className="rp-status-main">
        <span className="rp-status-dot" aria-hidden />
        <div>
          <div className="rp-status-label">Responsible Pharmacist</div>
          {state === 'loading' && <div className="rp-status-sub">Checking…</div>}
          {state === 'none' && (
            <>
              <div className="rp-status-name">No RP signed in</div>
              <div className="rp-status-sub">
                {canSign ? 'The pharmacy cannot sell P medicines or hand out prescriptions until a pharmacist signs in.' : 'Ask a pharmacist to sign in as RP.'}
              </div>
            </>
          )}
          {session && (
            <>
              <div className="rp-status-name">
                {session.current.pharmacist_name}{isMe ? ' (you)' : ''}
                <span className="rp-session-gphc"> · GPhC {session.current.gphc_number}</span>
              </div>
              <div className="rp-status-sub">
                {away
                  ? <>Away since {formatTime(away.absent_from)} ({formatDuration(awayMins)}){away.reason ? ` · ${away.reason}` : ''}{awayMins > MAX_ABSENCE_MINUTES ? ' · over the 2 hour limit' : ''}</>
                  : <>On duty since {formatTime(session.current.rp_signed_in_at)} · {formatDuration(onDutyMins)}</>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rp-status-actions">
        {state === 'none' && canSign && (
          <button className="ps-btn ps-btn-primary" disabled={busy} onClick={() => setConfirm({ kind: 'sign-in' })}>Sign in as RP</button>
        )}
        {session && canSign && isMe && !away && (
          <>
            <button className="ps-btn ps-btn-secondary" disabled={busy} onClick={() => setConfirm({ kind: 'step-out' })}>Step out</button>
            <button className="ps-btn ps-btn-primary" disabled={busy} onClick={() => setConfirm({ kind: 'sign-out' })}>Sign out</button>
          </>
        )}
        {session && canSign && away && (
          <button className="ps-btn ps-btn-primary" disabled={busy} onClick={() => run(() => rpEndAbsence(away.id))}>
            {isMe ? "I'm back" : `${session.current.pharmacist_name?.split(' ')[0] ?? 'RP'} is back`}
          </button>
        )}
        {session && canSign && !isMe && (
          <button className="ps-btn ps-btn-secondary" disabled={busy} onClick={() => setConfirm({ kind: 'take-over' })}>Take over as RP</button>
        )}
        {session && canSign && isMe && away && (
          <button className="ps-btn ps-btn-ghost" disabled={busy} onClick={() => setConfirm({ kind: 'sign-out' })}>Sign out</button>
        )}
      </div>

      {error && <div className="auth-error rp-status-error">{error}</div>}

      <Modal
        isOpen={confirm?.kind === 'sign-in' || confirm?.kind === 'take-over'}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'take-over' ? 'Take over as Responsible Pharmacist' : 'Sign in as Responsible Pharmacist'}
        width="520px"
      >
        <div className="log-form">
          {confirm?.kind === 'take-over' && session && (
            <div className="log-alert log-alert-info">
              {session.current.pharmacist_name} will be signed out at the same moment you sign in.
            </div>
          )}
          <p>
            You are signing in as <strong>{activeUser?.full_name}</strong> (GPhC {activeUser?.gphc_number || 'not set'}).
            This is a legal record: you are taking responsibility for the safe and effective running of this pharmacy,
            and your notice will be on display.
          </p>
          {!activeUser?.gphc_number && (
            <div className="auth-error">Add your GPhC number to your profile first.</div>
          )}
          {error && <div className="auth-error">{error}</div>}
          <div className="log-form-actions">
            <button className="ps-btn ps-btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button
              className="ps-btn ps-btn-primary"
              disabled={busy || !activeUser?.gphc_number}
              onClick={() => run(() => rpSignIn(organisation.id, confirm?.kind === 'take-over'))}
            >
              {busy ? 'Signing in…' : 'I accept, sign me in'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={confirm?.kind === 'sign-out'} onClose={() => setConfirm(null)} title="Sign out as RP?" width="460px">
        <div className="log-form">
          <p>Your sign-out time will be recorded as now ({formatTime(new Date().toISOString())}).</p>
          <p className="log-muted">Once you sign out, the pharmacy has no RP until another pharmacist signs in.</p>
          {error && <div className="auth-error">{error}</div>}
          <div className="log-form-actions">
            <button className="ps-btn ps-btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={busy || !session} onClick={() => session && run(() => rpSignOut(session.root.id))}>
              {busy ? 'Signing out…' : 'Sign out now'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={confirm?.kind === 'step-out'} onClose={() => setConfirm(null)} title="Step out of the pharmacy" width="460px">
        <div className="log-form">
          <p className="log-muted">
            You stay the RP while you're away, for up to 2 hours in a working day. Stay contactable and able to return quickly.
          </p>
          <div className="log-form-field">
            <label htmlFor="rp-absence-reason">Reason (optional)</label>
            <input id="rp-absence-reason" className="ps-input log-input" placeholder="e.g. Lunch, care home visit" value={absenceReason} onChange={(e) => setAbsenceReason(e.target.value)} maxLength={300} />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <div className="log-form-actions">
            <button className="ps-btn ps-btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button className="ps-btn ps-btn-primary" disabled={busy || !session} onClick={() => session && run(() => rpStartAbsence(session.root.id, absenceReason.trim() || null))}>
              {busy ? 'Saving…' : 'Record absence'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
