import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger, RpAbsence } from '@pharmstation/types'
import { Drawer } from '../../components/Drawer'
import { Modal } from '../../components/Modal'
import { RPCertificate } from '../../components/RPCertificate'
import { RpStatusCard } from '../../components/registers/RpStatusCard'
import {
  MAX_ABSENCE_MINUTES,
  buildSessions,
  formatDuration,
  isSignOutRecord,
  loadRpData,
  minutesBetween,
  rpErrorMessage,
  rpLedger,
  rpSignOut,
  rpWriteRecord,
  type RpSession,
} from '../../lib/rpLog'
import {
  downloadCsv,
  fmtDate as fmtExportDate,
  fmtDateTime,
  openPrintReport,
  organisationDetail,
  safeFilename,
  todayIso as todayIsoDate,
  type ExportCell,
} from '../../utils/registerExport'
import { addDays, dateList, formatDateTime, formatDay, formatTime, relativeDay, ukDate } from '../logs/logUtils'
import { History } from 'lucide-react'

type Period = 14 | 30 | 90 | 365

const NOTES_MAX = 200

/* ---- helpers for datetime inputs in UK time ---- */

function toLocalInput(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function absenceLabel(a: RpAbsence): string {
  const mins = minutesBetween(a.absent_from, a.returned_at)
  return `Away ${formatTime(a.absent_from)}–${a.returned_at ? formatTime(a.returned_at) : 'now'} (${formatDuration(mins)})${a.reason ? ` · ${a.reason}` : ''}`
}

function crossesDay(session: RpSession): boolean {
  const s = session.current
  return !!s.rp_signed_out_at && !!s.rp_signed_in_at && ukDate(new Date(s.rp_signed_out_at)) !== ukDate(new Date(s.rp_signed_in_at))
}

/* ---- Form for a late record or a correction ---- */

type FormTarget = { mode: 'late' } | { mode: 'correct'; session: RpSession }

function RpRecordForm({ target, ledger, onDone, onCancel }: { target: FormTarget; ledger: RegisterLedger; onDone: () => void; onCancel: () => void }) {
  const { activeUser } = useAuthStore()
  const cur = target.mode === 'correct' ? target.session.current : null
  const [name, setName] = useState(cur?.pharmacist_name ?? activeUser?.full_name ?? '')
  const [gphc, setGphc] = useState(cur?.gphc_number ?? activeUser?.gphc_number ?? '')
  const [start, setStart] = useState(toLocalInput(cur?.rp_signed_in_at) || `${ukDate()}T09:00`)
  const [end, setEnd] = useState(toLocalInput(cur?.rp_signed_out_at))
  const [notes, setNotes] = useState(cur?.notes ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const inAt = fromLocalInput(start)
    const outAt = fromLocalInput(end)
    if (!name.trim()) return setError('Pharmacist name is required')
    if (!/^\d{7}$/.test(gphc.trim())) return setError('GPhC number must be 7 digits')
    if (!inAt) return setError('When did they become RP?')
    if (new Date(inAt) > new Date()) return setError('The start time cannot be in the future')
    if (outAt && new Date(outAt) <= new Date(inAt)) return setError('The end time must be after the start time')
    if (outAt && new Date(outAt) > new Date()) return setError('The end time cannot be in the future')
    if (target.mode === 'late' && !outAt) return setError('Add when they stopped being RP. To start a session now, use "Sign in as RP".')
    if (reason.trim().length < 3) return setError(target.mode === 'late' ? 'Say why this is being recorded late' : 'Say what was wrong')
    if (notes.length > NOTES_MAX) return setError(`Notes must be ${NOTES_MAX} characters or fewer`)

    setSaving(true)
    setError(null)
    try {
      await rpWriteRecord({
        ledger,
        correctsRootId: target.mode === 'correct' ? target.session.root.id : null,
        reason: target.mode === 'correct' ? reason.trim() : null,
        date: ukDate(new Date(inAt)),
        pharmacistName: name.trim(),
        gphcNumber: gphc.trim(),
        signedInAt: inAt,
        signedOutAt: outAt,
        notes: target.mode === 'late'
          ? `Recorded late: ${reason.trim()}${notes.trim() ? ` · ${notes.trim()}` : ''}`.slice(0, NOTES_MAX + 120)
          : notes.trim() || null,
        authorisedBy: activeUser?.full_name ?? null,
      })
      onDone()
    } catch (err) {
      setError(rpErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const lockedIdentity = target.mode === 'late'

  return (
    <form className="log-form" onSubmit={submit} noValidate>
      {target.mode === 'late' ? (
        <div className="log-alert log-alert-info">
          Use this only if you were RP and the sign-in was missed. It is recorded in your name and marked as a late entry.
        </div>
      ) : (
        <div className="log-alert log-alert-info">
          The original record is never changed. Your correction is added on top and both stay in the history.
        </div>
      )}
      <div className="form-row">
        <div className="log-form-field">
          <label htmlFor="rp-name">Pharmacist</label>
          <input id="rp-name" className="ps-input log-input" value={name} onChange={(e) => setName(e.target.value)} disabled={lockedIdentity} />
        </div>
        <div className="log-form-field">
          <label htmlFor="rp-gphc">GPhC number</label>
          <input id="rp-gphc" className="ps-input log-input" inputMode="numeric" maxLength={7} value={gphc} onChange={(e) => setGphc(e.target.value.replace(/\D/g, ''))} disabled={lockedIdentity} />
        </div>
      </div>
      <div className="form-row">
        <div className="log-form-field">
          <label htmlFor="rp-start">Became RP</label>
          <input id="rp-start" type="datetime-local" className="ps-input log-input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="log-form-field">
          <label htmlFor="rp-end">Stopped being RP</label>
          <input id="rp-end" type="datetime-local" className="ps-input log-input" value={end} onChange={(e) => setEnd(e.target.value)} />
          <div className="log-hint">Can be the next day for overnight cover.</div>
        </div>
      </div>
      <div className="log-form-field">
        <label htmlFor="rp-notes">Notes</label>
        <textarea id="rp-notes" className="ps-input log-input" rows={2} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="log-form-field">
        <label htmlFor="rp-reason">{target.mode === 'late' ? 'Why is this being recorded late?' : 'What was wrong?'} <span className="log-req">*</span></label>
        <input id="rp-reason" className="ps-input log-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target.mode === 'late' ? 'e.g. Forgot to sign in, system was down' : 'e.g. Wrong sign-out time'} />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="log-form-actions">
        <button type="button" className="ps-btn ps-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ps-btn ps-btn-primary log-save-btn" disabled={saving}>
          {saving ? 'Saving…' : target.mode === 'late' ? 'Save late record' : 'Save correction'}
        </button>
      </div>
    </form>
  )
}

/* ---- Sign out an open session (possibly at an earlier time) ---- */

function SignOutModal({ session, onClose, onDone }: { session: RpSession | null; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setAt(toLocalInput(new Date().toISOString())); setReason(''); setError(null) }, [session])

  const iso = fromLocalInput(at)
  const earlier = !!iso && Date.now() - new Date(iso).getTime() > 5 * 60000

  const submit = async () => {
    if (!session) return
    if (earlier && reason.trim().length < 3) { setError('Say why the sign-out is being recorded late'); return }
    setSaving(true)
    setError(null)
    try {
      await rpSignOut(session.root.id, earlier ? iso : null, earlier ? reason.trim() : null)
      onDone()
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={!!session} onClose={onClose} title={`Sign out ${session?.current.pharmacist_name ?? ''}`} width="480px">
      <div className="log-form">
        <div className="log-form-field">
          <label htmlFor="rp-out-at">Stopped being RP at</label>
          <input id="rp-out-at" type="datetime-local" className="ps-input log-input" value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        {earlier && (
          <div className="log-form-field">
            <label htmlFor="rp-out-reason">Why is this being recorded late? <span className="log-req">*</span></label>
            <input id="rp-out-reason" className="ps-input log-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to sign out last night" />
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        <div className="log-form-actions">
          <button className="ps-btn ps-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="ps-btn ps-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Sign out'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ---- Page ---- */

export function RPLogPage() {
  const navigate = useNavigate()
  const { organisation, activeUser, permissions } = useAuthStore()
  const canSign = !!permissions?.rp_log_sign
  const today = ukDate()

  const [period, setPeriod] = useState<Period>(14)
  const [ledger, setLedger] = useState<RegisterLedger | null>(null)
  const [entries, setEntries] = useState<RegisterEntry[]>([])
  const [absences, setAbsences] = useState<RpAbsence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormTarget | null>(null)
  const [historyFor, setHistoryFor] = useState<RpSession | null>(null)
  const [signOutFor, setSignOutFor] = useState<RpSession | null>(null)
  const [certOpen, setCertOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const since = addDays(today, -(period - 1))

  const load = useCallback(async () => {
    if (!organisation) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadRpData(organisation.id, since)
      setLedger(data.ledger)
      setEntries(data.entries)
      setAbsences(data.absences)
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [organisation, since])

  useEffect(() => { load() }, [load])

  const afterChange = () => { load(); setRefreshKey((k) => k + 1) }

  const sessions = useMemo(() => buildSessions(entries, absences), [entries, absences])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => [s.current.pharmacist_name, s.current.gphc_number, s.current.notes].join(' ').toLowerCase().includes(q))
  }, [sessions, search])

  const byDate = useMemo(() => {
    const map = new Map<string, RpSession[]>()
    for (const s of filtered) {
      const list = map.get(s.date) ?? []
      list.push(s)
      map.set(s.date, list)
    }
    for (const list of map.values()) list.sort((a, b) => (a.current.rp_signed_in_at ?? '').localeCompare(b.current.rp_signed_in_at ?? ''))
    return map
  }, [filtered])

  const days = useMemo(() => {
    const all = dateList(since, today)
    return search.trim() ? all.filter((d) => byDate.has(d)) : all
  }, [since, today, byDate, search])

  // Runs of past days with no RP collapse into one line.
  const dayBlocks = useMemo(() => {
    type Block = { kind: 'day'; date: string } | { kind: 'gap'; from: string; to: string; count: number }
    const out: Block[] = []
    for (const d of days) {
      const empty = !byDate.has(d) && d !== today
      const last = out[out.length - 1]
      if (empty && last?.kind === 'gap') { last.from = d; last.count++ }
      else if (empty) out.push({ kind: 'gap', from: d, to: d, count: 1 })
      else out.push({ kind: 'day', date: d })
    }
    return out
  }, [days, byDate, today])

  const openSession = sessions.find((s) => s.isOpen) ?? null

  const ensureLedger = async (): Promise<RegisterLedger | null> => {
    if (ledger) return ledger
    if (!organisation) return null
    try {
      const l = await rpLedger(organisation.id)
      setLedger(l)
      return l
    } catch (e) {
      setError(rpErrorMessage(e))
      return null
    }
  }

  const openLate = async () => { if (await ensureLedger()) setForm({ mode: 'late' }) }

  /* ---- Exports ---- */
  const handlePrint = () => {
    const rows: ExportCell[][] = []
    for (const d of [...days].reverse()) {
      const list = byDate.get(d) ?? []
      if (list.length === 0) {
        rows.push([fmtExportDate(d), 'No RP recorded', '', '', '', '', ''])
        continue
      }
      for (const s of list) {
        const c = s.current
        rows.push([
          fmtExportDate(d),
          c.pharmacist_name ?? '',
          c.gphc_number ?? '',
          fmtDateTime(c.rp_signed_in_at),
          c.rp_signed_out_at ? fmtDateTime(c.rp_signed_out_at) : 'Still on duty',
          s.absences.map(absenceLabel).join('\n'),
          [c.notes ?? '', s.edits.length ? `Corrected ${s.edits.length}× (latest: ${s.edits[s.edits.length - 1].correction_reason ?? ''})` : ''].filter(Boolean).join('\n'),
        ])
      }
    }
    const ok = openPrintReport({
      title: 'Responsible Pharmacist record',
      organisationName: organisation?.name,
      organisationDetail: organisationDetail(organisation),
      periodLabel: `${fmtExportDate(since)} to ${fmtExportDate(today)}`,
      generatedBy: activeUser?.full_name,
      orientation: 'landscape',
      notes: ['Kept under The Medicines (Pharmacies) (Responsible Pharmacist) Regulations 2008. Corrections never overwrite the original record; the full history is in the CSV export.'],
      sections: [{
        heading: 'RP record',
        headers: ['Date', 'Pharmacist', 'GPhC', 'Became RP', 'Stopped being RP', 'Absences', 'Notes'],
        rows,
        emptyMessage: 'No RP records in this period.',
      }],
    })
    if (!ok) setError('Your browser blocked the print window. Allow pop-ups for PharmStation and try again.')
  }

  const handleCsv = () => {
    const numberById = new Map(entries.map((e) => [e.id, e.entry_number]))
    const headers = ['Entry', 'Date', 'Type', 'Pharmacist', 'GPhC number', 'Became RP', 'Stopped being RP', 'Notes', 'Corrects entry', 'Reason', 'Recorded at']
    const rows: ExportCell[][] = [...entries]
      .sort((a, b) => a.entry_number - b.entry_number)
      .map((e) => [
        e.entry_number,
        fmtExportDate(e.date_of_transaction),
        e.entry_type === 'normal' ? 'RP record' : isSignOutRecord(e) ? 'Sign-out' : 'Correction',
        e.pharmacist_name ?? '',
        e.gphc_number ?? '',
        fmtDateTime(e.rp_signed_in_at),
        fmtDateTime(e.rp_signed_out_at),
        e.notes ?? '',
        e.corrects_entry_id ? numberById.get(e.corrects_entry_id) ?? '' : '',
        e.correction_reason ?? '',
        fmtDateTime(e.entered_at),
      ])
    for (const a of absences) {
      const root = entries.find((e) => e.id === a.rp_entry_id)
      rows.push(['', fmtExportDate(ukDate(new Date(a.absent_from))), 'Absence', root?.pharmacist_name ?? '', root?.gphc_number ?? '', fmtDateTime(a.absent_from), fmtDateTime(a.returned_at), a.reason ?? '', root?.entry_number ?? '', '', fmtDateTime(a.created_at)])
    }
    downloadCsv(safeFilename(organisation?.name, 'rp-log', todayIsoDate()), headers, rows)
  }

  const certName = openSession?.current.pharmacist_name ?? activeUser?.full_name ?? ''
  const certGphc = openSession?.current.gphc_number ?? activeUser?.gphc_number ?? ''

  return (
    <div className="logs-page">
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/registers" onClick={(e) => { e.preventDefault(); navigate('/registers') }}>Registers</a>
          <span className="separator">/</span>
          <span>RP Log</span>
        </div>
        <div className="logs-header">
          <div>
            <h1>RP log</h1>
            <p className="log-muted">Who was the Responsible Pharmacist, when, and any time they were away.</p>
          </div>
          <div className="logs-header-actions no-print">
            <button className="ps-btn ps-btn-ghost" onClick={() => setCertOpen(true)}>RP notice</button>
            <button className="ps-btn ps-btn-secondary" onClick={handlePrint} disabled={loading}>Print / PDF</button>
            <button className="ps-btn ps-btn-secondary" onClick={handleCsv} disabled={loading || entries.length === 0} title="Every record, sign-out, correction and absence">⬇ CSV</button>
            {canSign && <button className="ps-btn ps-btn-secondary" onClick={openLate}>+ Record a missed session</button>}
          </div>
        </div>
      </div>

      <RpStatusCard onChange={() => load()} refreshKey={refreshKey} />

      <div className="rp-toolbar no-print">
        <input className="ps-input" placeholder="Search name, GPhC or notes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the RP log" />
        {([14, 30, 90, 365] as Period[]).map((p) => (
          <button key={p} className={`log-chip${period === p ? ' is-on' : ''}`} onClick={() => setPeriod(p)}>
            {p === 365 ? 'Last year' : `Last ${p} days`}
          </button>
        ))}
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}
      {loading && entries.length === 0 && <div className="log-card log-card-skeleton" />}

      {!loading && search.trim() && days.length === 0 && (
        <div className="ps-card logs-empty"><p className="log-muted">No RP records match "{search}" in this period.</p></div>
      )}

      {dayBlocks.map((block) => {
        if (block.kind === 'gap') {
          return (
            <section key={block.from} className="rp-day is-empty">
              <div className="rp-empty-day">
                No RP recorded {block.count === 1 ? `on ${formatDay(block.from)}` : `from ${formatDay(block.from)} to ${formatDay(block.to)} (${block.count} days)`}
              </div>
            </section>
          )
        }
        const d = block.date
        const list = byDate.get(d) ?? []
        const isToday = d === today
        return (
          <section key={d} className={`rp-day${list.length ? '' : ' is-empty'}`}>
            <h2 className="rp-day-head">
              {relativeDay(d, today)}
              {(isToday || d === addDays(today, -1)) && <span className="log-muted">{formatDay(d, { day: 'numeric', month: 'short' })}</span>}
            </h2>
            {list.length === 0 && (
              <div className="rp-empty-day">{isToday ? 'No RP has signed in yet today.' : 'No RP recorded.'}</div>
            )}
            {list.map((s) => {
              const c = s.current
              const mins = c.rp_signed_in_at ? minutesBetween(c.rp_signed_in_at, c.rp_signed_out_at) : 0
              const lateRecord = (s.root.notes ?? '').startsWith('Recorded late:')
              return (
                <div key={s.root.id} className={`rp-session${s.isOpen ? ' is-open' : ''}`}>
                  <div>
                    <div className="rp-session-name">{c.pharmacist_name}</div>
                    <div className="rp-session-gphc">GPhC {c.gphc_number}</div>
                  </div>
                  <div className="rp-session-times">
                    <strong>{formatTime(c.rp_signed_in_at)}</strong> → {c.rp_signed_out_at ? <strong>{crossesDay(s) ? formatDateTime(c.rp_signed_out_at) : formatTime(c.rp_signed_out_at)}</strong> : <span className="log-status ok">On duty</span>}
                  </div>
                  <div>
                    <div className="log-muted">{formatDuration(mins)}{s.isOpen ? ' so far' : ''}</div>
                    {s.absences.length > 0 && (
                      <div className="rp-absences">
                        {s.absences.map((a) => (
                          <span key={a.id} className={`rp-absence${minutesBetween(a.absent_from, a.returned_at) > MAX_ABSENCE_MINUTES ? ' is-long' : ''}`}>{absenceLabel(a)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rp-session-notes">
                    {c.notes}
                    <div className="log-meta">
                      {lateRecord && <span className="ps-badge ps-badge-amber">Late record</span>}
                      {s.edits.length > 0 && <button className="log-link" onClick={() => setHistoryFor(s)}>Corrected {s.edits.length}× · history</button>}
                    </div>
                  </div>
                  <div className="log-row-actions no-print">
                    {s.isOpen && canSign && !isToday && (
                      <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => setSignOutFor(s)}>Sign out</button>
                    )}
                    {canSign && <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setForm({ mode: 'correct', session: s })}>Correct</button>}
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setHistoryFor(s)} aria-label="History"><History size={16} aria-hidden="true" /></button>
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}

      <Drawer isOpen={!!form} onClose={() => setForm(null)} title={form?.mode === 'correct' ? 'Correct an RP record' : 'Record a missed RP session'} width="560px">
        {form && ledger && (
          <RpRecordForm
            key={form.mode === 'correct' ? form.session.root.id : 'late'}
            target={form}
            ledger={ledger}
            onCancel={() => setForm(null)}
            onDone={() => { setForm(null); afterChange() }}
          />
        )}
      </Drawer>

      <SignOutModal session={signOutFor} onClose={() => setSignOutFor(null)} onDone={() => { setSignOutFor(null); afterChange() }} />

      <Modal isOpen={!!historyFor} onClose={() => setHistoryFor(null)} title="RP record history" width="820px">
        {historyFor && (
          <div style={{ overflowX: 'auto' }}>
            <table className="log-table">
              <thead>
                <tr><th>#</th><th>What</th><th>Recorded</th><th>Pharmacist</th><th>GPhC</th><th>Became RP</th><th>Stopped</th><th>Reason / notes</th></tr>
              </thead>
              <tbody>
                {historyFor.versions.map((v, i) => (
                  <tr key={v.id} style={i === historyFor.versions.length - 1 ? { fontWeight: 600 } : undefined}>
                    <td>{v.entry_number}</td>
                    <td>{v.entry_type === 'normal' ? <span className="ps-badge ps-badge-blue">Original</span> : isSignOutRecord(v) ? <span className="ps-badge ps-badge-green">Sign-out</span> : <span className="ps-badge ps-badge-amber">Correction</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v.entered_at)}{v.authorised_by ? <div className="log-muted">{v.authorised_by}</div> : null}</td>
                    <td>{v.pharmacist_name}</td>
                    <td>{v.gphc_number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v.rp_signed_in_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v.rp_signed_out_at) || '—'}</td>
                    <td style={{ minWidth: 160 }}>{v.correction_reason ?? v.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {historyFor.absences.length > 0 && (
              <>
                <h3 style={{ margin: 'var(--ps-space-md) 0 var(--ps-space-sm)', fontSize: 'var(--ps-font-base)' }}>Absences</h3>
                <div className="rp-absences">{historyFor.absences.map((a) => <span key={a.id} className="rp-absence">{absenceLabel(a)}</span>)}</div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={certOpen} onClose={() => setCertOpen(false)} title="Responsible Pharmacist notice" width="700px">
        <RPCertificate
          name={certName}
          gphcNumber={certGphc}
          onPrint={(orientation) => {
            const el = document.getElementById('rp-certificate-print')
            if (!el) return
            const w = window.open('', '_blank')
            if (!w) return
            w.document.write(`<!DOCTYPE html><html><head><title>RP notice</title><style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
              @page { size: A4 ${orientation}; margin: ${orientation === 'landscape' ? '5mm 10mm' : '10mm 15mm'}; }
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .rp-cert-card { max-width: none !important; width: 100% !important; height: 100vh !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; border-radius: 0 !important; border: 3px solid #257BB4 !important; margin: 0 !important; }
              }
            </style></head><body>${el.innerHTML}</body></html>`)
            w.document.close()
            w.focus()
            w.print()
            w.close()
          }}
        />
      </Modal>
    </div>
  )
}
