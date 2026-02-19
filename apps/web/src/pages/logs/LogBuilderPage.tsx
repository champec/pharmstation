import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogCategory, LogScheduleType, FieldType } from '@pharmstation/types'

/* ---- Constants ---- */

const FIELD_TYPES: { type: FieldType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: '📝' },
  { type: 'number', label: 'Number', icon: '🔢' },
  { type: 'boolean', label: 'Yes / No', icon: '✅' },
  { type: 'select', label: 'Dropdown', icon: '📋' },
  { type: 'multiselect', label: 'Multi-select', icon: '☑️' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'textarea', label: 'Text Area', icon: '📄' },
  { type: 'signature', label: 'Signature', icon: '✍️' },
  { type: 'canvas', label: 'Canvas', icon: '🎨' },
]

const CATEGORIES: { value: LogCategory; label: string; icon: string }[] = [
  { value: 'fridge', label: 'Fridge', icon: '🌡️' },
  { value: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { value: 'cd', label: 'CD', icon: '💊' },
  { value: 'visitor', label: 'Visitor', icon: '👤' },
  { value: 'date_check', label: 'Date Check', icon: '📅' },
  { value: 'custom', label: 'Custom', icon: '📋' },
]

const DAY_LABELS = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
]

/* ---- Local field type ---- */

interface LocalField {
  _key: string
  label: string
  field_key: string
  field_type: FieldType
  options: string[] | null
  is_required: boolean
  column_width: string
}

let _nextKey = 1
function nextKey(): string {
  return `local_${_nextKey++}`
}

function toFieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/* ---- Component ---- */

export function LogBuilderPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editTemplateId = searchParams.get('edit')

  const { organisation } = useAuthStore()
  const {
    activeTemplate,
    activeFields: templateFields,
    loading,
    error,
    fetchTemplateDetail,
    buildTemplate,
    subscribeToLibrary,
    clearError,
  } = useLogStore()

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LogCategory>('custom')
  const [scheduleType, setScheduleType] = useState<LogScheduleType>('sporadic')
  const [requiredDays, setRequiredDays] = useState<number[]>([])
  const [fields, setFields] = useState<LocalField[]>([])
  const [saving, setSaving] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)

  // Load existing template for edit
  useEffect(() => {
    if (editTemplateId) {
      fetchTemplateDetail(editTemplateId)
    }
  }, [editTemplateId, fetchTemplateDetail])

  // Populate from existing template
  useEffect(() => {
    if (editTemplateId && activeTemplate && activeTemplate.id === editTemplateId) {
      setTitle(activeTemplate.title)
      setDescription(activeTemplate.description)
      setCategory(activeTemplate.category)
      setScheduleType(activeTemplate.schedule_type)
      setRequiredDays(activeTemplate.required_days || [])
      setFields(
        templateFields.map((f) => ({
          _key: nextKey(),
          label: f.label,
          field_key: f.field_key,
          field_type: f.field_type,
          options: Array.isArray(f.options) ? f.options as string[] : null,
          is_required: f.is_required,
          column_width: f.column_width || '',
        }))
      )
    }
  }, [editTemplateId, activeTemplate, templateFields])

  // When schedule type changes to 'daily', select all days
  useEffect(() => {
    if (scheduleType === 'daily') {
      setRequiredDays([0, 1, 2, 3, 4, 5, 6])
    }
  }, [scheduleType])

  /* ---- Field mutations ---- */

  const addField = (type: FieldType) => {
    const label = FIELD_TYPES.find((f) => f.type === type)?.label || 'New field'
    setFields((prev) => [
      ...prev,
      {
        _key: nextKey(),
        label: `New ${label.toLowerCase()} field`,
        field_key: toFieldKey(`New ${label.toLowerCase()} field`),
        field_type: type,
        options: type === 'select' || type === 'multiselect' ? ['Option 1', 'Option 2'] : null,
        is_required: false,
        column_width: '',
      },
    ])
  }

  const updateField = (key: string, updates: Partial<LocalField>) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f._key !== key) return f
        const updated = { ...f, ...updates }
        if (updates.label !== undefined) {
          updated.field_key = toFieldKey(updates.label)
        }
        return updated
      })
    )
  }

  const removeField = (key: string) => {
    setFields((prev) => prev.filter((f) => f._key !== key))
  }

  const moveField = (key: string, direction: -1 | 1) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f._key === key)
      if (idx < 0) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
      return copy
    })
  }

  const toggleDay = (day: number) => {
    setRequiredDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    )
  }

  /* ---- Save ---- */

  const handleSave = async () => {
    if (!organisation?.id || !title.trim()) return
    setSaving(true)
    try {
      const template = await buildTemplate(
        {
          org_id: organisation.id,
          title: title.trim(),
          description: description.trim(),
          category,
          schedule_type: scheduleType,
          required_days: scheduleType !== 'sporadic' ? requiredDays : [],
        },
        fields.map((f, i) => ({
          label: f.label,
          field_key: f.field_key,
          field_type: f.field_type,
          options: f.options as any,
          is_required: f.is_required,
          column_width: f.column_width || null,
          display_order: i,
        }))
      )

      // Auto-subscribe the org
      const sub = await subscribeToLibrary(organisation.id, template.id)
      navigate(`/logs/${sub.id}`)
    } catch {
      // error in store
    } finally {
      setSaving(false)
    }
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
          <span>{editTemplateId ? 'Edit Log' : 'New Log'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🛠️ {editTemplateId ? 'Edit Custom Log' : 'Create Custom Log'}</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className={`ps-btn ps-btn-sm ${previewMode ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? '✏️ Edit' : '👁 Preview'}
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs')}>
              ← Cancel
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Preview mode */}
      {previewMode ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ marginBottom: 'var(--ps-space-md)' }}>{title || 'Untitled Log'}</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>{description || 'No description'}</p>
          {fields.length === 0 ? (
            <p style={{ color: 'var(--ps-slate)' }}>No fields added yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
              {fields.map((f) => (
                <div key={f._key} className="form-group">
                  <label style={{ fontWeight: 500 }}>
                    {f.label}
                    {f.is_required && <span style={{ color: '#ef4444' }}> *</span>}
                  </label>
                  {f.field_type === 'textarea' ? (
                    <textarea className="ps-input" rows={2} placeholder={f.label} disabled />
                  ) : f.field_type === 'boolean' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="checkbox" disabled /> Yes
                    </label>
                  ) : f.field_type === 'select' ? (
                    <select className="ps-input" disabled>
                      <option>— Select —</option>
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="ps-input" type={f.field_type === 'number' ? 'number' : 'text'} placeholder={f.label} disabled />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', alignItems: 'flex-start' }}>
          {/* Left: Field palette */}
          <div style={{ width: 200, flexShrink: 0 }}>
            <div className="ps-card" style={{ padding: 'var(--ps-space-md)', position: 'sticky', top: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-sm)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
                Add Field
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
                {FIELD_TYPES.map((ft) => (
                  <button
                    key={ft.type}
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    onClick={() => addField(ft.type)}
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    {ft.icon} {ft.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Log settings + fields */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-lg)' }}>
            {/* Log settings */}
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
                Log Settings
              </h3>

              <div className="form-group">
                <label>Title *</label>
                <input
                  className="ps-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Equipment Maintenance Log"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="ps-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this log for?"
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-xs)' }}>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`ps-btn ps-btn-sm ${category === c.value ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                      onClick={() => setCategory(c.value)}
                    >
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Schedule</label>
                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
                  {(['daily', 'custom_days', 'sporadic'] as LogScheduleType[]).map((s) => (
                    <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="schedule"
                        checked={scheduleType === s}
                        onChange={() => setScheduleType(s)}
                      />
                      <span style={{ fontSize: 'var(--ps-font-sm)' }}>
                        {s === 'daily' ? 'Daily' : s === 'custom_days' ? 'Custom Days' : 'Sporadic'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Day picker */}
              {(scheduleType === 'daily' || scheduleType === 'custom_days') && (
                <div className="form-group">
                  <label>Required Days</label>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-xs)' }}>
                    {DAY_LABELS.map((d) => (
                      <button
                        key={d.day}
                        type="button"
                        className={`ps-btn ps-btn-sm ${requiredDays.includes(d.day) ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                        onClick={() => toggleDay(d.day)}
                        disabled={scheduleType === 'daily'}
                        style={{ minWidth: 44 }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {scheduleType === 'daily' && (
                    <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>
                      All days are selected for "Daily" schedule. Switch to "Custom Days" to pick specific days.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Fields list */}
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
                Fields ({fields.length})
              </h3>

              {fields.length === 0 && (
                <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
                  No fields yet. Click a field type on the left to add one.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
                {fields.map((f, idx) => (
                  <div
                    key={f._key}
                    style={{
                      border: '1px solid var(--ps-border)',
                      borderRadius: 'var(--ps-radius-md)',
                      padding: 'var(--ps-space-md)',
                      background: 'var(--ps-off-white)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                        <span className="ps-badge" style={{ fontSize: 'var(--ps-font-xs)' }}>{f.field_type}</span>
                        <span style={{ fontWeight: 500, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-midnight)' }}>
                          {f.label || 'Untitled'}
                        </span>
                        <span style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>({f.field_key})</span>
                      </div>
                      <div style={{ display: 'flex', gap: '2px' }}>
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => moveField(f._key, -1)} disabled={idx === 0} style={{ fontSize: '10px' }}>▲</button>
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => moveField(f._key, 1)} disabled={idx === fields.length - 1} style={{ fontSize: '10px' }}>▼</button>
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => removeField(f._key)} style={{ color: '#ef4444', fontSize: '10px' }}>✕</button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)' }}>
                      <div>
                        <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Label</label>
                        <input
                          className="ps-input"
                          value={f.label}
                          onChange={(e) => updateField(f._key, { label: e.target.value })}
                          style={{ fontSize: 'var(--ps-font-sm)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Column Width</label>
                        <input
                          className="ps-input"
                          value={f.column_width}
                          onChange={(e) => updateField(f._key, { column_width: e.target.value })}
                          placeholder="e.g. 120px, 1fr"
                          style={{ fontSize: 'var(--ps-font-sm)' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', marginTop: 'var(--ps-space-sm)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
                        <input
                          type="checkbox"
                          checked={f.is_required}
                          onChange={(e) => updateField(f._key, { is_required: e.target.checked })}
                        />
                        Required
                      </label>
                    </div>

                    {/* Options editor for select/multiselect */}
                    {(f.field_type === 'select' || f.field_type === 'multiselect') && (
                      <div style={{ marginTop: 'var(--ps-space-sm)' }}>
                        <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Options (one per line)</label>
                        <textarea
                          className="ps-input"
                          value={(f.options || []).join('\n')}
                          onChange={(e) =>
                            updateField(f._key, { options: e.target.value.split('\n').filter((l) => l.trim()) })
                          }
                          rows={3}
                          style={{ fontSize: 'var(--ps-font-sm)' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Save button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
              <button
                className="ps-btn ps-btn-secondary"
                onClick={() => navigate('/logs')}
              >
                Cancel
              </button>
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleSave}
                disabled={saving || !title.trim()}
              >
                {saving ? 'Saving…' : editTemplateId ? 'Update Log' : 'Create Log'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
