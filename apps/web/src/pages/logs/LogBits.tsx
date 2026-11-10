import { useEffect, useState } from 'react'
import { CircleCheck, type LucideIcon } from 'lucide-react'
import { useLogStore } from '@pharmstation/core'
import type { LogEntry, LogField } from '@pharmstation/types'
import { Modal } from '../../components/Modal'
import { dataFields, displayValue, formatDateTime, isOutOfRange } from './logUtils'

/* ---- Toast shown after a save ---- */

export interface CelebrationState { id: number; title: string; detail?: string; icon?: LucideIcon }

export function useCelebration() {
  const [state, setState] = useState<CelebrationState | null>(null)
  useEffect(() => {
    if (!state) return
    const t = window.setTimeout(() => setState(null), 3200)
    return () => window.clearTimeout(t)
  }, [state])
  return {
    celebration: state,
    celebrate: (title: string, detail?: string, icon: LucideIcon = CircleCheck) => setState({ id: Date.now(), title, detail, icon }),
    dismiss: () => setState(null),
  }
}

export function Celebration({ state, onDismiss }: { state: CelebrationState | null; onDismiss: () => void }) {
  if (!state) return null
  return (
    <div className="log-toast" role="status" key={state.id} onClick={onDismiss}>
      <span className="log-toast-emoji" aria-hidden="true">{state.icon ? <state.icon size={26} strokeWidth={1.75} /> : <CircleCheck size={26} strokeWidth={1.75} />}</span>
      <div>
        <strong>{state.title}</strong>
        {state.detail && <div className="log-toast-detail">{state.detail}</div>}
      </div>
    </div>
  )
}

/* ---- Progress ring ---- */

export function ProgressRing({ done, total, size = 76 }: { done: number; total: number; size?: number }) {
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total === 0 ? 1 : Math.min(1, done / total)
  const complete = total > 0 && done >= total
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`log-ring${complete ? ' is-complete' : ''}`} role="img" aria-label={`${done} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="log-ring-track" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="log-ring-value"
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="log-ring-text">
        {complete ? '✓' : `${done}/${total}`}
      </text>
    </svg>
  )
}

export function StreakBadge({ streak }: { streak: number }) {
  if (streak < 2) return null
  return (
    <span className="log-streak" title={`${streak} required days in a row logged`}>
      {streak} day streak
    </span>
  )
}

/* ---- Version history of one entry ---- */

export function EntryHistoryModal({ entry, fields, onClose }: { entry: LogEntry | null; fields: LogField[]; onClose: () => void }) {
  const { fetchEntryHistory } = useLogStore()
  const [versions, setVersions] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entry) return
    setVersions(null)
    setError(null)
    fetchEntryHistory(entry.root_id ?? entry.id)
      .then(setVersions)
      .catch((e: Error) => setError(e.message))
  }, [entry, fetchEntryHistory])

  const fs = dataFields(fields)

  return (
    <Modal isOpen={!!entry} onClose={onClose} title="Entry history" width="760px">
      {error && <div className="auth-error">{error}</div>}
      {!versions && !error && <p className="log-muted">Loading history…</p>}
      {versions && (
        <ol className="log-history">
          {versions.map((v, i) => (
            <li key={v.id} className={v.superseded_at ? '' : 'is-current'}>
              <div className="log-history-head">
                <span className={`ps-badge ${i === 0 ? 'ps-badge-blue' : 'ps-badge-amber'}`}>{i === 0 ? 'Original' : `Change ${i}`}</span>
                <span>{v.entered_by_profile?.full_name ?? 'Unknown'}</span>
                <span className="log-muted">{formatDateTime(v.created_at)}</span>
                {!v.superseded_at && !v.voided_at && <span className="ps-badge ps-badge-green">Current</span>}
                {v.voided_at && <span className="ps-badge ps-badge-red">Removed</span>}
              </div>
              {v.edit_reason && <div className="log-history-reason">Reason: {v.edit_reason}</div>}
              <dl className="log-history-values">
                {fs.map((f) => {
                  const val = v.data?.[f.field_key]
                  const prev = i > 0 ? versions[i - 1].data?.[f.field_key] : undefined
                  const changed = i > 0 && JSON.stringify(val ?? null) !== JSON.stringify(prev ?? null)
                  return (
                    <div key={f.id} className={changed ? 'is-changed' : ''}>
                      <dt>{f.label}</dt>
                      <dd className={isOutOfRange(f, val) ? 'log-out' : ''}>
                        {f.field_type === 'canvas' || f.field_type === 'signature'
                          ? (val ? 'Signed' : '—')
                          : displayValue(f, val)}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              {v.voided_at && (
                <div className="log-history-reason">Removed {formatDateTime(v.voided_at)}: {v.void_reason}</div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}

/* ---- Remove (void) an entry ---- */

export function VoidEntryModal({ entry, onClose, onDone }: { entry: LogEntry | null; onClose: () => void; onDone: () => void }) {
  const { voidEntry } = useLogStore()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setReason(''); setError(null) }, [entry])

  const submit = async () => {
    if (!entry) return
    if (reason.trim().length < 3) { setError('Say why this entry is being removed'); return }
    setSaving(true)
    setError(null)
    try {
      await voidEntry(entry.id, reason.trim())
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={!!entry} onClose={onClose} title="Remove this entry?" width="480px">
      <p className="log-muted" style={{ marginBottom: 'var(--ps-space-md)' }}>
        It will be crossed out, not deleted. The entry and your reason stay in the history.
      </p>
      <label htmlFor="void-reason" style={{ fontWeight: 500, display: 'block', marginBottom: 4 }}>Reason</label>
      <input id="void-reason" className="ps-input log-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Logged on the wrong log" autoFocus />
      {error && <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)' }}>{error}</div>}
      <div className="log-form-actions">
        <button className="ps-btn ps-btn-secondary" onClick={onClose} disabled={saving}>Keep it</button>
        <button className="ps-btn ps-btn-danger" onClick={submit} disabled={saving}>{saving ? 'Removing…' : 'Remove entry'}</button>
      </div>
    </Modal>
  )
}

/* ---- Category icon tile ---- */

export function CategoryIcon({ icon: Icon, size = 20 }: { icon: LucideIcon; size?: number }) {
  return (
    <span className="log-card-emoji" aria-hidden="true">
      <Icon size={size} strokeWidth={1.75} />
    </span>
  )
}
