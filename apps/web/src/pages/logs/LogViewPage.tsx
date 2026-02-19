import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogField, LogEntry, LogCategory, FieldType } from '@pharmstation/types'
import { Drawer } from '../../components/Drawer'
import { CanvasField } from '../../components/forms/CanvasField'

/* ---- Constants ---- */

const CATEGORY_CONFIG: Record<LogCategory, { label: string; emoji: string; color: string }> = {
  fridge: { label: 'Fridge', emoji: '🌡️', color: 'var(--ps-electric-cyan)' },
  cleaning: { label: 'Cleaning', emoji: '🧹', color: '#22c55e' },
  cd: { label: 'CD', emoji: '💊', color: '#a855f7' },
  visitor: { label: 'Visitor', emoji: '👤', color: '#f59e0b' },
  date_check: { label: 'Date Check', emoji: '📅', color: '#f97316' },
  custom: { label: 'Custom', emoji: '📋', color: 'var(--ps-slate)' },
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type DateRange = '7d' | '30d' | 'custom'

function formatDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDateRange(range: DateRange, customStart?: string, customEnd?: string): { start: string; end: string } {
  const today = new Date()
  if (range === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd }
  }
  const days = range === '30d' ? 30 : 7
  const start = new Date(today)
  start.setDate(start.getDate() - days + 1)
  return { start: toISODate(start), end: toISODate(today) }
}

function generateDateList(start: string, end: string): string[] {
  const dates: string[] = []
  const d = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  while (d <= endD) {
    dates.push(toISODate(d))
    d.setDate(d.getDate() + 1)
  }
  return dates.reverse() // most recent first
}

/* ---- Dynamic Field Renderer ---- */

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: LogField
  value: unknown
  onChange: (val: unknown) => void
  disabled?: boolean
}) {
  const strVal = (value ?? '') as string
  const numVal = value as number | undefined

  switch (field.field_type as FieldType) {
    case 'text':
      return (
        <input
          className="ps-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.label}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        />
      )
    case 'number':
      return (
        <input
          className="ps-input"
          type="number"
          value={numVal ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={disabled}
          placeholder={field.label}
          style={{ fontSize: 'var(--ps-font-sm)', width: field.column_width || '100px' }}
        />
      )
    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <span style={{ fontSize: 'var(--ps-font-sm)' }}>{value ? 'Yes' : 'No'}</span>
        </label>
      )
    case 'select': {
      const options = Array.isArray(field.options) ? field.options : []
      return (
        <select
          className="ps-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        >
          <option value="">— Select —</option>
          {options.map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }
    case 'multiselect': {
      const options = Array.isArray(field.options) ? field.options : []
      const selected = Array.isArray(value) ? value : []
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {options.map((opt: string) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--ps-font-xs)', cursor: disabled ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, opt])
                  else onChange(selected.filter((s: string) => s !== opt))
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      )
    }
    case 'date':
      return (
        <input
          className="ps-input"
          type="datetime-local"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        />
      )
    case 'textarea':
      return (
        <textarea
          className="ps-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder={field.label}
          style={{ fontSize: 'var(--ps-font-sm)', resize: 'vertical' }}
        />
      )
    case 'signature':
    case 'canvas':
      return (
        <CanvasField
          value={strVal || undefined}
          onChange={(b64) => onChange(b64)}
          disabled={disabled}
          width={300}
          height={120}
        />
      )
    default:
      return (
        <input
          className="ps-input"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        />
      )
  }
}

/* ---- Main Component ---- */

export function LogViewPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    subscriptions,
    activeTemplate,
    activeFields,
    entries,
    loading,
    error,
    fetchSubscriptions,
    fetchTemplateDetail,
    fetchEntries,
    createEntry,
    updateEntry,
    clearError,
  } = useLogStore()

  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showAddDrawer, setShowAddDrawer] = useState(false)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null)
  const [editingEntryData, setEditingEntryData] = useState<Record<string, Record<string, unknown>>>({})
  const [inlineEditingDate, setInlineEditingDate] = useState<string | null>(null)
  const [inlineData, setInlineData] = useState<Record<string, unknown>>({})
  const [savingInline, setSavingInline] = useState(false)

  const subscription = subscriptions.find((s) => s.id === subscriptionId)

  const load = useCallback(() => {
    if (organisation?.id) fetchSubscriptions(organisation.id)
  }, [organisation?.id, fetchSubscriptions])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (subscription?.template_id) {
      fetchTemplateDetail(subscription.template_id)
    }
  }, [subscription?.template_id, fetchTemplateDetail])

  const range = useMemo(() => getDateRange(dateRange, customStart, customEnd), [dateRange, customStart, customEnd])

  useEffect(() => {
    if (subscriptionId) {
      fetchEntries(subscriptionId, range)
    }
  }, [subscriptionId, range, fetchEntries])

  const isSporadic = activeTemplate?.schedule_type === 'sporadic'
  const isDaily = activeTemplate?.schedule_type === 'daily' || activeTemplate?.schedule_type === 'custom_days'
  const requiredDays = activeTemplate?.required_days || []
  const todayStr = toISODate(new Date())

  // Build entry map by date for daily view
  const entryByDate = useMemo(() => {
    const map: Record<string, LogEntry> = {}
    for (const e of entries) {
      map[e.entry_date] = e
    }
    return map
  }, [entries])

  const dates = useMemo(() => generateDateList(range.start, range.end), [range])

  const cat = activeTemplate?.category || 'custom'
  const catConfig = CATEGORY_CONFIG[cat as LogCategory] || CATEGORY_CONFIG.custom

  /* ---- Sporadic: Add Entry ---- */
  const handleAddEntry = async () => {
    if (!subscriptionId || !organisation?.id || !activeUser?.id) return
    setSavingEntryId('new')
    try {
      await createEntry({
        subscription_id: subscriptionId,
        org_id: organisation.id,
        entry_date: todayStr,
        data: formData,
        entered_by_user_id: activeUser.id,
      })
      setShowAddDrawer(false)
      setFormData({})
    } catch {
      // error in store
    } finally {
      setSavingEntryId(null)
    }
  }

  /* ---- Daily: Inline create/update ---- */
  const handleInlineSave = async (date: string) => {
    if (!subscriptionId || !organisation?.id || !activeUser?.id) return
    setSavingInline(true)
    try {
      const existing = entryByDate[date]
      if (existing) {
        await updateEntry(existing.id, inlineData)
      } else {
        await createEntry({
          subscription_id: subscriptionId,
          org_id: organisation.id,
          entry_date: date,
          data: inlineData,
          entered_by_user_id: activeUser.id,
        })
      }
      setInlineEditingDate(null)
      setInlineData({})
      // Refresh entries
      fetchEntries(subscriptionId, range)
    } catch {
      // error in store
    } finally {
      setSavingInline(false)
    }
  }

  const startInlineEdit = (date: string) => {
    const existing = entryByDate[date]
    setInlineEditingDate(date)
    setInlineData(existing?.data ? { ...existing.data } : {})
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/logs" onClick={(e) => { e.preventDefault(); navigate('/logs') }}>Logs</a>
          <span className="separator">/</span>
          <span>{subscription?.custom_title || activeTemplate?.title || 'Log'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            <h1 style={{ margin: 0 }}>
              {catConfig.emoji} {subscription?.custom_title || activeTemplate?.title || 'Log'}
            </h1>
            <span
              className="ps-badge"
              style={{ background: catConfig.color, color: '#fff', fontSize: 'var(--ps-font-xs)' }}
            >
              {catConfig.label}
            </span>
            <span className="ps-badge ps-badge-blue" style={{ fontSize: 'var(--ps-font-xs)' }}>
              {activeTemplate?.schedule_type || ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            {isSporadic && (
              <button className="ps-btn ps-btn-primary" onClick={() => { setFormData({}); setShowAddDrawer(true) }}>
                + Add Entry
              </button>
            )}
            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => navigate(`/logs/${subscriptionId}/settings`)}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Date range selector (for daily) */}
      {isDaily && (
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginBottom: 'var(--ps-space-lg)' }}>
          {(['7d', '30d', 'custom'] as DateRange[]).map((r) => (
            <button
              key={r}
              className={`ps-btn ps-btn-sm ${dateRange === r ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
              onClick={() => setDateRange(r)}
            >
              {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Custom'}
            </button>
          ))}
          {dateRange === 'custom' && (
            <>
              <input
                className="ps-input"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ width: 160 }}
              />
              <span style={{ color: 'var(--ps-slate)' }}>to</span>
              <input
                className="ps-input"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ width: 160 }}
              />
            </>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && entries.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
          <div style={{ height: 20, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '40%' }} />
        </div>
      )}

      {/* ===== DAILY / CUSTOM_DAYS: Spreadsheet Grid ===== */}
      {isDaily && activeFields.length > 0 && (
        <div className="ps-card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
            <thead>
              <tr style={{ background: 'var(--ps-off-white)' }}>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid var(--ps-border)', whiteSpace: 'nowrap' }}>
                  Date
                </th>
                {activeFields.map((f) => (
                  <th
                    key={f.id}
                    style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      textAlign: 'left',
                      fontWeight: 600,
                      borderBottom: '2px solid var(--ps-border)',
                      width: f.column_width || 'auto',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.label}
                    {f.is_required && <span style={{ color: '#ef4444' }}> *</span>}
                  </th>
                ))}
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid var(--ps-border)', whiteSpace: 'nowrap' }}>
                  Entered By
                </th>
                <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', borderBottom: '2px solid var(--ps-border)', width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const dayOfWeek = new Date(date + 'T00:00:00').getDay()
                const isRequired = activeTemplate?.schedule_type === 'daily' || requiredDays.includes(dayOfWeek)
                const entry = entryByDate[date]
                const isToday = date === todayStr
                const isEditing = inlineEditingDate === date
                const isMissing = isRequired && !entry && !isEditing

                let rowBg = 'transparent'
                if (isToday) rowBg = '#f0f9ff'
                else if (!isRequired) rowBg = '#f8f8f8'
                else if (isMissing) rowBg = '#fff7ed'

                return (
                  <tr key={date} style={{ background: rowBg, borderBottom: '1px solid var(--ps-border)' }}>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', whiteSpace: 'nowrap', fontWeight: isToday ? 600 : 400, color: !isRequired ? 'var(--ps-slate)' : 'var(--ps-midnight)' }}>
                      {formatDate(date)}
                      {isToday && <span className="ps-badge ps-badge-blue" style={{ marginLeft: 4, fontSize: '10px' }}>Today</span>}
                      {!isRequired && <span style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginLeft: 4 }}>(off)</span>}
                    </td>
                    {activeFields.map((f) => (
                      <td key={f.id} style={{ padding: 'var(--ps-space-xs) var(--ps-space-md)' }}>
                        {isEditing ? (
                          <FieldInput
                            field={f}
                            value={inlineData[f.field_key]}
                            onChange={(val) => setInlineData((prev) => ({ ...prev, [f.field_key]: val }))}
                          />
                        ) : (
                          <span style={{ color: !isRequired ? 'var(--ps-slate)' : 'var(--ps-midnight)', fontSize: 'var(--ps-font-sm)' }}>
                            {renderValue(entry?.data?.[f.field_key], f.field_type)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                      {entry?.entered_by_profile?.full_name || '—'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-xs) var(--ps-space-md)', textAlign: 'right' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button
                            className="ps-btn ps-btn-success ps-btn-sm"
                            onClick={() => handleInlineSave(date)}
                            disabled={savingInline}
                            style={{ fontSize: 'var(--ps-font-xs)' }}
                          >
                            {savingInline ? '…' : '✓'}
                          </button>
                          <button
                            className="ps-btn ps-btn-ghost ps-btn-sm"
                            onClick={() => { setInlineEditingDate(null); setInlineData({}) }}
                            style={{ fontSize: 'var(--ps-font-xs)' }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        isRequired && (
                          <button
                            className="ps-btn ps-btn-ghost ps-btn-sm"
                            onClick={() => startInlineEdit(date)}
                            style={{ fontSize: 'var(--ps-font-xs)' }}
                          >
                            {entry ? '✏️' : '+ Add'}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== SPORADIC: Entry List ===== */}
      {isSporadic && (
        <>
          {entries.length === 0 && !loading && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>📝</div>
              <h3 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No entries yet</h3>
              <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
                Add your first entry to get started.
              </p>
              <button className="ps-btn ps-btn-primary" onClick={() => { setFormData({}); setShowAddDrawer(true) }}>
                + Add Entry
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
            {entries.map((entry) => (
              <div key={entry.id} className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--ps-midnight)', fontSize: 'var(--ps-font-sm)' }}>
                    {formatDate(entry.entry_date)}
                  </span>
                  <span style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                    by {entry.entered_by_profile?.full_name || 'Unknown'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--ps-space-sm)' }}>
                  {activeFields.map((f) => {
                    const val = entry.data?.[f.field_key]
                    return (
                      <div key={f.id}>
                        <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>{f.label}</div>
                        <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-midnight)' }}>
                          {f.field_type === 'canvas' || f.field_type === 'signature' ? (
                            val ? <img src={val as string} alt={f.label} style={{ maxWidth: 200, height: 60, objectFit: 'contain', border: '1px solid var(--ps-border)', borderRadius: 'var(--ps-radius-md)' }} /> : '—'
                          ) : (
                            renderValue(val, f.field_type) || '—'
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== Sporadic Add Entry Drawer ===== */}
      <Drawer
        isOpen={showAddDrawer}
        onClose={() => setShowAddDrawer(false)}
        title="Add Entry"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          {activeFields.map((f) => (
            <div key={f.id} className="form-group">
              <label style={{ fontWeight: 500 }}>
                {f.label}
                {f.is_required && <span style={{ color: '#ef4444' }}> *</span>}
              </label>
              <FieldInput
                field={f}
                value={formData[f.field_key]}
                onChange={(val) => setFormData((prev) => ({ ...prev, [f.field_key]: val }))}
              />
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => setShowAddDrawer(false)}
              disabled={savingEntryId === 'new'}
            >
              Cancel
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleAddEntry}
              disabled={savingEntryId === 'new'}
            >
              {savingEntryId === 'new' ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  )
}

/* ---- Helpers ---- */

function renderValue(val: unknown, fieldType: string): string {
  if (val === null || val === undefined || val === '') return '—'
  if (fieldType === 'boolean') return val ? 'Yes' : 'No'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
