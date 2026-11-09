import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogField, LogEntry } from '@pharmstation/types'
import { Drawer } from '../../components/Drawer'
import {
  downloadCsv,
  fmtDate as fmtExportDate,
  fmtDateTime,
  openPrintReport,
  organisationDetail,
  safeFilename,
  signatureImg,
  type ExportCell,
} from '../../utils/registerExport'
import { LogEntryForm } from './LogEntryForm'
import { Download, Inbox, PencilLine, Settings, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { Celebration, CategoryIcon, EntryHistoryModal, StreakBadge, VoidEntryModal, useCelebration } from './LogBits'
import {
  addDays,
  categoryOf,
  cheer,
  computeStreak,
  dataFields,
  dateList,
  displayValue,
  entryHasWarning,
  formatDay,
  formatTime,
  isOutOfRange,
  isRequiredOn,
  isScheduled,
  relativeDay,
  scheduleLabel,
  ukDate,
} from './logUtils'

type DateRange = '7d' | '30d' | 'custom'

function rangeFor(range: DateRange, today: string, customStart?: string, customEnd?: string) {
  if (range === 'custom' && customStart && customEnd) {
    return customStart <= customEnd ? { start: customStart, end: customEnd } : { start: customEnd, end: customStart }
  }
  return { start: addDays(today, range === '30d' ? -29 : -6), end: today }
}

type EditorState =
  | { mode: 'new'; date: string }
  | { mode: 'edit'; entry: LogEntry }
  | null

export function LogViewPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    subscriptions, activeTemplate, activeFields, entries, loading, error,
    fetchSubscriptions, fetchTemplateDetail, fetchEntries, saveEntry, clearError,
  } = useLogStore()
  const { celebration, celebrate, dismiss } = useCelebration()

  const today = ukDate()
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [editor, setEditor] = useState<EditorState>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [historyEntry, setHistoryEntry] = useState<LogEntry | null>(null)
  const [voidTarget, setVoidTarget] = useState<LogEntry | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const subscription = subscriptions.find((s) => s.id === subscriptionId)

  useEffect(() => {
    if (organisation?.id) fetchSubscriptions(organisation.id)
  }, [organisation?.id, fetchSubscriptions])

  useEffect(() => {
    if (subscription?.template_id) fetchTemplateDetail(subscription.template_id)
  }, [subscription?.template_id, fetchTemplateDetail])

  const range = useMemo(() => rangeFor(dateRange, today, customStart, customEnd), [dateRange, today, customStart, customEnd])

  // Load a wider window than shown so the streak is right.
  const loadStart = useMemo(() => (range.start < addDays(today, -60) ? range.start : addDays(today, -60)), [range.start, today])
  useEffect(() => {
    if (subscriptionId) fetchEntries(subscriptionId, { start: loadStart, end: range.end > today ? range.end : today })
  }, [subscriptionId, loadStart, range.end, today, fetchEntries])

  const template = activeTemplate && subscription && activeTemplate.id === subscription.template_id ? activeTemplate : null
  const fields = useMemo(() => (template ? dataFields(activeFields) : []), [template, activeFields])
  const scheduled = isScheduled(template)
  const cat = categoryOf(template)
  const logTitle = subscription?.custom_title || template?.title || 'Log'

  const liveEntries = useMemo(() => entries.filter((e) => !e.voided_at), [entries])
  const entryByDate = useMemo(() => {
    const map: Record<string, LogEntry> = {}
    for (const e of [...liveEntries].sort((a, b) => a.created_at.localeCompare(b.created_at))) map[e.entry_date] = e
    return map
  }, [liveEntries])
  const loggedDates = useMemo(() => new Set(liveEntries.map((e) => e.entry_date)), [liveEntries])

  const dates = useMemo(() => dateList(range.start, range.end > today ? today : range.end), [range, today])
  const inRange = (e: LogEntry) => e.entry_date >= range.start && e.entry_date <= range.end

  const stats = useMemo(() => {
    const requiredDates = dates.filter((d) => isRequiredOn(template, d) && d !== today)
    const logged = requiredDates.filter((d) => loggedDates.has(d)).length
    const warnings = liveEntries.filter((e) => inRange(e) && entryHasWarning(fields, e)).length
    return {
      streak: computeStreak(template, loggedDates, today, 60),
      required: requiredDates.length,
      logged,
      missed: requiredDates.length - logged,
      warnings,
      count: liveEntries.filter(inRange).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, template, loggedDates, liveEntries, fields, today, range])

  const todayDue = scheduled && isRequiredOn(template, today) && !entryByDate[today]

  /* ---- Save ---- */
  const handleSubmit = async (data: Record<string, unknown>, reason: string | null) => {
    if (!subscriptionId || !editor) return
    setSaving(true)
    setSaveError(null)
    try {
      if (editor.mode === 'edit') {
        await saveEntry({ subscriptionId, data, replacesId: editor.entry.id, editReason: reason })
        celebrate('Change saved', 'The original is kept in the history.', PencilLine)
      } else {
        await saveEntry({ subscriptionId, entryDate: editor.date, data })
        const late = editor.date !== today
        celebrate(cheer(), late ? `Logged for ${formatDay(editor.date)} (marked as a late entry).` : `${logTitle} saved.`, cat.icon)
      }
      setEditor(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const openNew = (date: string) => { setSaveError(null); setEditor({ mode: 'new', date }) }
  const openEdit = (entry: LogEntry) => { setSaveError(null); setEditor({ mode: 'edit', entry }) }

  /* ---- Export (print / PDF and CSV) for the selected dates ---- */
  const exportRows = useMemo(() => {
    const sorted = liveEntries.filter(inRange).sort((a, b) =>
      a.entry_date === b.entry_date ? a.created_at.localeCompare(b.created_at) : a.entry_date.localeCompare(b.entry_date),
    )
    if (!scheduled) return sorted.map((entry) => ({ date: entry.entry_date, entry }))
    const out: { date: string; entry: LogEntry | null }[] = []
    for (const date of [...dates].reverse()) {
      const e = entryByDate[date]
      if (e) out.push({ date, entry: e })
      else if (isRequiredOn(template, date) && date < today) out.push({ date, entry: null })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEntries, scheduled, dates, entryByDate, template, today, range])

  const exportValue = (field: LogField, value: unknown): string => {
    if (value === null || value === undefined || value === '') return ''
    if (field.field_type === 'signature' || field.field_type === 'canvas') return 'Signed'
    if (field.field_type === 'date') return fmtExportDate(String(value))
    const v = displayValue(field, value)
    return isOutOfRange(field, value) ? `${v} (OUT OF RANGE)` : v
  }

  const recordedBy = (entry: LogEntry) => {
    const late = entry.entry_date !== ukDate(new Date(entry.created_at)) ? ' (late entry)' : ''
    const changed = entry.supersedes_id ? `\nChanged: ${entry.edit_reason ?? ''}` : ''
    return `${entry.entered_by_profile?.full_name ?? ''}\n${fmtDateTime(entry.created_at)}${late}${changed}`.trim()
  }

  const handleLogPrint = () => {
    setExportError(null)
    const htmlCells: Record<string, string> = {}
    const rows: ExportCell[][] = exportRows.map(({ date, entry }, i) => {
      if (!entry) return [fmtExportDate(date), ...fields.map((_, c) => (c === 0 ? 'Not recorded' : '')), '']
      return [
        fmtExportDate(date),
        ...fields.map((f, c) => {
          const v = entry.data?.[f.field_key]
          if (f.field_type === 'signature' || f.field_type === 'canvas') {
            const img = signatureImg(typeof v === 'string' ? v : null)
            if (img) { htmlCells[`${i}:${c + 1}`] = img; return '' }
          }
          return exportValue(f, v)
        }),
        recordedBy(entry),
      ]
    })
    const opened = openPrintReport({
      title: logTitle,
      organisationName: organisation?.name,
      organisationDetail: organisationDetail(organisation),
      periodLabel: `${fmtExportDate(range.start)} to ${fmtExportDate(range.end)}`,
      generatedBy: activeUser?.full_name,
      orientation: fields.length > 5 ? 'landscape' : 'portrait',
      notes: scheduled ? [`${stats.logged} of ${stats.required} required days logged in this period.`] : undefined,
      sections: [{
        heading: `${cat.label} log`,
        subheading: template?.description || undefined,
        headers: ['Date', ...fields.map((f) => f.label), 'Recorded by'],
        rows,
        htmlCells,
        emptyMessage: 'No entries in this period.',
      }],
    })
    if (!opened) setExportError('Your browser blocked the print window. Allow pop-ups for PharmStation and try again.')
  }

  const handleLogCsv = () => {
    const headers = ['Date', ...fields.map((f) => f.label), 'Recorded by', 'Recorded at', 'Change reason']
    const rows: ExportCell[][] = exportRows.map(({ date, entry }) =>
      entry
        ? [fmtExportDate(date), ...fields.map((f) => exportValue(f, entry.data?.[f.field_key])), entry.entered_by_profile?.full_name ?? '', fmtDateTime(entry.created_at), entry.edit_reason ?? '']
        : [fmtExportDate(date), ...fields.map((_, c) => (c === 0 ? 'Not recorded' : '')), '', '', ''],
    )
    downloadCsv(safeFilename(organisation?.name, logTitle, range.start, 'to', range.end), headers, rows)
  }

  const entryMeta = (entry: LogEntry) => (
    <div className="log-meta">
      <span>{entry.entered_by_profile?.full_name ?? 'Not recorded'} · {formatTime(entry.created_at)}</span>
      {entry.entry_date !== ukDate(new Date(entry.created_at)) && <span className="ps-badge ps-badge-amber" title={`Entered ${formatDay(ukDate(new Date(entry.created_at)))}`}>Late entry</span>}
      {entry.supersedes_id && (
        <button className="log-link" onClick={() => setHistoryEntry(entry)} title={entry.edit_reason ?? ''}>Edited · history</button>
      )}
    </div>
  )

  const sporadicEntries = entries.filter((e) => inRange(e) && (showRemoved || !e.voided_at))
  const removedCount = entries.filter((e) => inRange(e) && e.voided_at).length

  return (
    <div className="logs-page" style={{ ['--cat' as string]: cat.color, ['--cat-tint' as string]: cat.tint }}>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Logs', to: '/logs' }, { label: logTitle }]}
        title={<span className="log-view-title"><CategoryIcon icon={cat.icon} />{logTitle}</span>}
        subtitle={`${scheduleLabel(template?.schedule_type, template?.required_days)}${template?.description ? ` · ${template.description}` : ''}`}
        actions={<>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate(`/logs/${subscriptionId}/settings`)} aria-label="Log settings" title="Log settings">
            <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button className="ps-btn ps-btn-secondary" onClick={handleLogPrint} disabled={!template}>Print / PDF</button>
          <button className="ps-btn ps-btn-secondary" onClick={handleLogCsv} disabled={!template}>
            <Download size={16} strokeWidth={1.75} aria-hidden="true" /> CSV
          </button>
          {!scheduled && template && (
            <button className="ps-btn ps-btn-primary" onClick={() => openNew(today)}>+ {cat.cta}</button>
          )}
        </>}
      />

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}
      {exportError && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{exportError}</div>}

      {/* Today call to action */}
      {todayDue && (
        <section className="log-today-banner">
          <div>
            <strong>Today's entry isn't in yet.</strong>
            <span className="log-muted"> It takes about 20 seconds.</span>
          </div>
          <button className="ps-btn ps-btn-primary log-cta" onClick={() => openNew(today)}>{cat.cta}</button>
        </section>
      )}
      {scheduled && !todayDue && entryByDate[today] && (
        <section className="log-today-banner is-done">
          <div><strong>✓ Today is logged.</strong> <span className="log-muted">Thanks, {entryByDate[today].entered_by_profile?.full_name?.split(' ')[0] ?? 'team'}.</span></div>
          <StreakBadge streak={stats.streak} />
        </section>
      )}

      {/* Stats */}
      {template && (
        <div className="log-stats">
          {scheduled ? (
            <>
              <div className="log-stat"><span className="log-stat-num">{stats.required ? Math.round((stats.logged / stats.required) * 100) : 100}%</span><span>days logged</span></div>
              <div className="log-stat"><span className="log-stat-num">{stats.streak}</span><span>day streak</span></div>
              <div className={`log-stat${stats.missed ? ' is-warn' : ''}`}><span className="log-stat-num">{stats.missed}</span><span>missed days</span></div>
            </>
          ) : (
            <div className="log-stat"><span className="log-stat-num">{stats.count}</span><span>entries</span></div>
          )}
          <div className={`log-stat${stats.warnings ? ' is-bad' : ''}`}><span className="log-stat-num">{stats.warnings}</span><span>out of range</span></div>
        </div>
      )}

      {/* Date range */}
      {template && (
        <div className="log-range-bar">
          {(['7d', '30d', 'custom'] as DateRange[]).map((r) => (
            <button key={r} className={`log-chip${dateRange === r ? ' is-on' : ''}`} onClick={() => setDateRange(r)}>
              {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Pick dates'}
            </button>
          ))}
          {dateRange === 'custom' && (
            <>
              <input className="ps-input" type="date" value={customStart} max={today} onChange={(e) => setCustomStart(e.target.value)} aria-label="From" />
              <span className="log-muted">to</span>
              <input className="ps-input" type="date" value={customEnd} max={today} onChange={(e) => setCustomEnd(e.target.value)} aria-label="To" />
            </>
          )}
        </div>
      )}

      {loading && !template && <div className="log-card log-card-skeleton" />}

      {/* Scheduled logs: one row per day */}
      {scheduled && fields.length > 0 && (
        <div className="ps-card log-table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>Day</th>
                {fields.map((f) => <th key={f.id}>{f.label}</th>)}
                <th>Recorded</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const required = isRequiredOn(template, date)
                const entry = entryByDate[date]
                const isToday = date === today
                const missing = required && !entry && !isToday
                return (
                  <tr key={date} className={`${isToday ? 'is-today' : ''}${!required ? ' is-off' : ''}${missing ? ' is-missing' : ''}`}>
                    <td className="log-day">
                      {relativeDay(date, today)}
                      {!required && <span className="log-muted"> · closed</span>}
                    </td>
                    {fields.map((f) => {
                      const v = entry?.data?.[f.field_key]
                      const out = isOutOfRange(f, v)
                      return (
                        <td key={f.id} className={out ? 'log-out' : ''}>
                          {entry ? (f.field_type === 'canvas' || f.field_type === 'signature' ? (v ? '✍️ Signed' : '—') : displayValue(f, v)) : ''}
                          {out && <span className="log-out-flag" title="Out of range"> ⚠</span>}
                        </td>
                      )
                    })}
                    <td>
                      {entry ? entryMeta(entry) : missing ? <span className="log-missed">Missed</span> : isToday && required ? <span className="log-status due">Due</span> : ''}
                    </td>
                    <td className="log-row-actions">
                      {entry ? (
                        <>
                          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => openEdit(entry)}>Edit</button>
                          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setHistoryEntry(entry)} aria-label="History">🕘</button>
                        </>
                      ) : required ? (
                        <button className={`ps-btn ps-btn-sm ${isToday ? 'ps-btn-primary' : 'ps-btn-secondary'}`} onClick={() => openNew(date)}>
                          {isToday ? 'Log now' : 'Add late entry'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* As-needed logs: a feed of entries */}
      {!scheduled && template && (
        <>
          {sporadicEntries.length === 0 && !loading && (
            <EmptyState
              icon={Inbox}
              title="No entries in these dates"
              actions={<button className="ps-btn ps-btn-primary" onClick={() => openNew(today)}>+ {cat.cta}</button>}
            >
              Add one now, or pick a wider date range.
            </EmptyState>
          )}
          <div className="log-feed">
            {sporadicEntries.map((entry) => (
              <article key={entry.id} className={`ps-card log-feed-item${entry.voided_at ? ' is-void' : ''}${entryHasWarning(fields, entry) ? ' is-warn' : ''}`}>
                <header>
                  <strong>{relativeDay(entry.entry_date, today)}</strong>
                  {entryMeta(entry)}
                  {!entry.voided_at && (
                    <div className="log-row-actions">
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => openEdit(entry)}>Edit</button>
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setHistoryEntry(entry)} aria-label="History">🕘</button>
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setVoidTarget(entry)} aria-label="Remove">🗑</button>
                    </div>
                  )}
                </header>
                {entry.voided_at && <div className="log-void-note">Removed: {entry.void_reason}</div>}
                <dl className="log-feed-values">
                  {fields.map((f) => {
                    const val = entry.data?.[f.field_key]
                    return (
                      <div key={f.id}>
                        <dt>{f.label}</dt>
                        <dd className={isOutOfRange(f, val) ? 'log-out' : ''}>
                          {f.field_type === 'canvas' || f.field_type === 'signature'
                            ? (val ? <img src={val as string} alt={`${f.label}`} className="log-sig" /> : '—')
                            : displayValue(f, val)}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </article>
            ))}
          </div>
          {removedCount > 0 && (
            <button className="log-link" style={{ marginTop: 'var(--ps-space-md)' }} onClick={() => setShowRemoved((v) => !v)}>
              {showRemoved ? 'Hide removed entries' : `Show ${removedCount} removed ${removedCount === 1 ? 'entry' : 'entries'}`}
            </button>
          )}
        </>
      )}

      <Drawer
        isOpen={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.mode === 'edit' ? 'Edit entry' : logTitle}
        width="520px"
      >
        {editor && (
          <LogEntryForm
            key={editor.mode === 'edit' ? editor.entry.id : editor.date}
            fields={fields}
            entry={editor.mode === 'edit' ? editor.entry : null}
            date={scheduled ? (editor.mode === 'edit' ? editor.entry.entry_date : editor.date) : undefined}
            userName={activeUser?.full_name}
            saving={saving}
            error={saveError}
            submitLabel={editor.mode === 'new' && editor.date !== today ? 'Save late entry' : undefined}
            onSubmit={handleSubmit}
            onCancel={() => setEditor(null)}
          />
        )}
      </Drawer>

      <EntryHistoryModal entry={historyEntry} fields={fields} onClose={() => setHistoryEntry(null)} />
      <VoidEntryModal entry={voidTarget} onClose={() => setVoidTarget(null)} onDone={() => { setVoidTarget(null); celebrate('Entry removed', 'It stays in the history with your reason.', Trash2) }} />
      <Celebration state={celebration} onDismiss={dismiss} />
    </div>
  )
}
