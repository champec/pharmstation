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
  formatSince,
  isStaleSession,
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

type Confirm =
  | { kind: 'sign-in' | 'take-over' }
  | { kind: 'sign-out' }
  | { kind: 'step-out' }
  /** Record when an RP who was left signed in really finished (then optionally take over). */
  | { kind: 'finish'; then: 'take-over' | null }
  | null

/** yyyy-mm-ddThh:mm in the browser's own time, for datetime-local inputs. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function RpStatusCard({ onChange, refreshKey, compact }: Props) {
  const { organisation, activeUser, permissions } = useAuthStore()
  const canSign = !!permissions?.rp_log_sign
  const [session, setSession] = useState<RpSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [absenceReason, setAbsenceReason] = useState('')
  const [finishMode, setFinishMode] = useState<'at' | 'now'>('at')
  const [finishAt, setFinishAt] = useState('')
  const [finishNote, setFinishNote] = useState('')
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
  const stale = !!session && isStaleSession(session.current.rp_signed_in_at)
  const rpFirst = session?.current.pharmacist_name?.split(' ')[0] ?? 'The RP'

  const openFinish = (then: 'take-over' | null) => {
    setFinishMode('at')
    setFinishAt('')
    setFinishNote('')
    setError(null)
    setConfirm({ kind: 'finish', then })
  }

  const finishAtIso = finishAt ? new Date(finishAt).toISOString() : null
  const finishInvalid =
    finishMode === 'at' &&
    (!finishAtIso ||
      !session?.current.rp_signed_in_at ||
      new Date(finishAtIso).getTime() < new Date(session.current.rp_signed_in_at).getTime() ||
      new Date(finishAtIso).getTime() > Date.now())

  const submitFinish = (then: 'take-over' | null) => {
    if (!session) return
    const by = activeUser?.full_name ?? 'a pharmacist'
    const note = finishNote.trim()
    const reason =
      finishMode === 'at'
        ? `${isMe ? 'forgot to sign out' : `forgot to sign out; finish time recorded by ${by}`}${note ? `; ${note}` : ''}`
        : `on duty until ${then === 'take-over' ? 'handover' : 'now'}, confirmed by ${by}${note ? `; ${note}` : ''}`
    return run(async () => {
      await rpSignOut(session.root.id, finishMode === 'at' ? finishAtIso : null, reason)
      if (then === 'take-over') await rpSignIn(organisation.id, false)
    })
  }

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
                  : <>On duty since {session.current.rp_signed_in_at ? formatSince(session.current.rp_signed_in_at) : '—'} · {formatDuration(onDutyMins)}</>}
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
            <button className="ps-btn ps-btn-primary" disabled={busy} onClick={() => (stale ? openFinish(null) : setConfirm({ kind: 'sign-out' }))}>Sign out</button>
          </>
        )}
        {session && canSign && away && (
          <button className="ps-btn ps-btn-primary" disabled={busy} onClick={() => run(() => rpEndAbsence(away.id))}>
            {isMe ? "I'm back" : `${session.current.pharmacist_name?.split(' ')[0] ?? 'RP'} is back`}
          </button>
        )}
        {session && canSign && !isMe && (
          <button className="ps-btn ps-btn-secondary" disabled={busy} onClick={() => (stale ? openFinish('take-over') : setConfirm({ kind: 'take-over' }))}>Take over as RP</button>
        )}
        {session && canSign && isMe && away && (
          <button className="ps-btn ps-btn-ghost" disabled={busy} onClick={() => (stale ? openFinish(null) : setConfirm({ kind: 'sign-out' }))}>Sign out</button>
        )}
      </div>

      {stale && session && (
        <div className="log-alert log-alert-warn rp-status-stale">
          <span>
            {isMe ? 'You have' : `${rpFirst} has`} been signed in since {formatSince(session.current.rp_signed_in_at!)} ({formatDuration(onDutyMins)}).
            {' '}{isMe ? 'If you forgot to sign out, record when you finished.' : 'If they forgot to sign out, record when they finished.'}
          </span>
          {canSign && (
            <button className="ps-btn ps-btn-secondary ps-btn-sm" disabled={busy} onClick={() => openFinish(null)}>
              Record when {isMe ? 'you' : 'they'} finished
            </button>
          )}
        </div>
      )}

      {error && !confirm && <div className="auth-error rp-status-error">{error}</div>}

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

      <Modal
        isOpen={confirm?.kind === 'finish'}
        onClose={() => setConfirm(null)}
        title={isMe ? 'When did you finish as RP?' : `When did ${rpFirst} finish as RP?`}
        width="540px"
      >
        {confirm?.kind === 'finish' && session && (
          <div className="log-form">
            <div className="log-alert log-alert-warn">
              {session.current.pharmacist_name} has been signed in since {formatSince(session.current.rp_signed_in_at!)} ({formatDuration(onDutyMins)}).
              The RP log is a legal record, so record the real time {isMe ? 'you' : 'they'} stopped being RP.
            </div>
            <div className="log-form-field">
              <label className="log-choice">
                <input type="radio" name="rp-finish" checked={finishMode === 'at'} onChange={() => setFinishMode('at')} />
                {isMe ? 'I finished at' : `${rpFirst} finished at`}
              </label>
              {finishMode === 'at' && (
                <input
                  type="datetime-local"
                  className="ps-input log-input"
                  aria-label="Finish time"
                  value={finishAt}
                  min={session.current.rp_signed_in_at ? toLocalInput(new Date(session.current.rp_signed_in_at)) : undefined}
                  max={toLocalInput(new Date())}
                  onChange={(e) => setFinishAt(e.target.value)}
                />
              )}
              <label className="log-choice">
                <input type="radio" name="rp-finish" checked={finishMode === 'now'} onChange={() => setFinishMode('now')} />
                {isMe ? 'I have been RP all this time' : `${rpFirst} really was RP until now`}
              </label>
            </div>
            <div className="log-form-field">
              <label htmlFor="rp-finish-note">Note (optional)</label>
              <input id="rp-finish-note" className="ps-input log-input" placeholder="e.g. Left at closing, confirmed by phone" value={finishNote} onChange={(e) => setFinishNote(e.target.value)} maxLength={200} />
            </div>
            <p className="log-muted">This is saved as a correction. The original sign-in is kept in the history.</p>
            {confirm.then === 'take-over' && (
              <p>
                You will then be signed in as <strong>{activeUser?.full_name}</strong> (GPhC {activeUser?.gphc_number || 'not set'}),
                taking responsibility for the safe and effective running of this pharmacy.
              </p>
            )}
            {error && <div className="auth-error">{error}</div>}
            <div className="log-form-actions">
              <button className="ps-btn ps-btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button
                className="ps-btn ps-btn-primary"
                disabled={busy || finishInvalid || (confirm.then === 'take-over' && !activeUser?.gphc_number)}
                onClick={() => submitFinish(confirm.then)}
              >
                {busy ? 'Saving…' : confirm.then === 'take-over' ? 'Save and take over' : 'Save sign-out time'}
              </button>
            </div>
          </div>
        )}
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
