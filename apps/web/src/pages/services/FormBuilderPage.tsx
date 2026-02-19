import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useServiceStore } from '@pharmstation/core'
import type { ServiceFormField, FieldType } from '@pharmstation/types'

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
]

function toFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function defaultLabel(type: FieldType): string {
  const found = FIELD_TYPES.find((f) => f.type === type)
  return found ? `New ${found.label.toLowerCase()} field` : 'New field'
}

/* ---- Local field type (pre-save, may lack id) ---- */

interface LocalField {
  _key: string // local unique key for React
  id?: string
  form_id?: string
  label: string
  field_key: string
  field_type: FieldType
  options: Record<string, unknown> | null
  is_required: boolean
  display_order: number
}

let _nextKey = 1
function nextKey(): string {
  return `local_${_nextKey++}`
}

function dbFieldToLocal(f: ServiceFormField): LocalField {
  return { ...f, _key: nextKey() }
}

/* ---- Component ---- */

export function FormBuilderPage() {
  const { serviceId, formId } = useParams<{ serviceId: string; formId: string }>()
  const navigate = useNavigate()
  const {
    activeService,
    activeFields,
    loading,
    error,
    fetchServiceDetail,
    fetchFormFields,
    saveFields,
    clearError,
  } = useServiceStore()

  const [fields, setFields] = useState<LocalField[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)

  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load data
  const load = useCallback(() => {
    if (serviceId) fetchServiceDetail(serviceId)
    if (formId) fetchFormFields(formId)
  }, [serviceId, formId, fetchServiceDetail, fetchFormFields])

  useEffect(() => { load() }, [load])

  // Sync store fields → local state
  useEffect(() => {
    setFields(activeFields.map(dbFieldToLocal))
    setDirty(false)
  }, [activeFields])

  /* ---- Field mutations ---- */

  const addField = (type: FieldType) => {
    const label = defaultLabel(type)
    const newField: LocalField = {
      _key: nextKey(),
      label,
      field_key: toFieldKey(label),
      field_type: type,
      options: type === 'select' || type === 'multiselect' ? { values: ['Option 1', 'Option 2'] } : null,
      is_required: false,
      display_order: fields.length,
    }
    setFields((prev) => [...prev, newField])
    setDirty(true)
  }

  const updateField = (key: string, updates: Partial<LocalField>) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f._key !== key) return f
        const updated = { ...f, ...updates }
        // Auto-update field_key when label changes (if not manually edited)
        if ('label' in updates && updates.label !== undefined) {
          updated.field_key = toFieldKey(updates.label)
        }
        return updated
      })
    )
    setDirty(true)
  }

  const removeField = (key: string) => {
    setFields((prev) => prev.filter((f) => f._key !== key))
    setDirty(true)
  }

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fields.length) return
    setFields((prev) => {
      const copy = [...prev]
      ;[copy[index], copy[newIndex]] = [copy[newIndex], copy[index]]
      return copy
    })
    setDirty(true)
  }

  /* ---- Save ---- */

  const handleSave = async () => {
    if (!formId) return
    setSaving(true)
    try {
      const toSave = fields.map((f, i) => ({
        label: f.label,
        field_key: f.field_key,
        field_type: f.field_type,
        options: f.options,
        is_required: f.is_required,
        display_order: i,
      }))
      await saveFields(formId, toSave)
      setDirty(false)
      setSaved(true)
      if (savedTimeout.current) clearTimeout(savedTimeout.current)
      savedTimeout.current = setTimeout(() => setSaved(false), 2500)
    } catch { /* error from store */ }
    setSaving(false)
  }

  const handleDiscard = () => {
    setFields(activeFields.map(dbFieldToLocal))
    setDirty(false)
  }

  // Find the form name
  const activeForms = useServiceStore((s) => s.activeForms)
  const currentForm = activeForms.find((f) => f.id === formId)

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <a
            href={`/services/${serviceId}`}
            onClick={(e) => { e.preventDefault(); navigate(`/services/${serviceId}`) }}
          >
            {activeService?.name || 'Service'}
          </a>
          <span className="separator">/</span>
          <span>{currentForm?.name || 'Form Builder'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📝 Form Builder{currentForm ? ` — ${currentForm.name}` : ''}</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center' }}>
            {saved && (
              <span style={{ color: 'var(--ps-success)', fontSize: 'var(--ps-font-sm)', fontWeight: 600 }}>
                ✓ Saved
              </span>
            )}
            <button
              className="ps-btn ps-btn-secondary ps-btn-sm"
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? '🔧 Edit' : '👁 Preview'}
            </button>
            {dirty && (
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={handleDiscard}>
                Discard
              </button>
            )}
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save Fields'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {previewMode ? (
        <FormPreview fields={fields} />
      ) : (
        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', alignItems: 'flex-start' }}>
          {/* Left palette */}
          <div
            className="ps-card"
            style={{
              padding: 'var(--ps-space-md)',
              minWidth: 180,
              position: 'sticky',
              top: 'var(--ps-space-lg)',
            }}
          >
            <h3 style={{ fontSize: 'var(--ps-font-sm)', fontWeight: 600, color: 'var(--ps-midnight)', margin: '0 0 var(--ps-space-sm)' }}>
              Field Types
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
              {FIELD_TYPES.map((ft) => (
                <button
                  key={ft.type}
                  className="ps-btn ps-btn-secondary ps-btn-sm"
                  onClick={() => addField(ft.type)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  {ft.icon} {ft.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right - field list */}
          <div style={{ flex: 1 }}>
            {loading && fields.length === 0 && (
              <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
                <div style={{ height: 16, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '50%' }} />
              </div>
            )}

            {!loading && fields.length === 0 && (
              <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 'var(--ps-space-md)' }}>📋</div>
                <p style={{ color: 'var(--ps-slate)' }}>
                  No fields yet. Click a field type on the left to start building your form.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
              {fields.map((field, index) => (
                <FieldCard
                  key={field._key}
                  field={field}
                  index={index}
                  total={fields.length}
                  onUpdate={(updates) => updateField(field._key, updates)}
                  onRemove={() => removeField(field._key)}
                  onMove={(dir) => moveField(index, dir)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- FieldCard ---- */

function FieldCard({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  field: LocalField
  index: number
  total: number
  onUpdate: (updates: Partial<LocalField>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const isOptionsType = field.field_type === 'select' || field.field_type === 'multiselect'
  const optionValues: string[] = isOptionsType
    ? ((field.options as any)?.values || [])
    : []

  const updateOptions = (values: string[]) => {
    onUpdate({ options: { values } })
  }

  return (
    <div
      className="ps-card"
      style={{
        padding: 'var(--ps-space-md)',
        display: 'flex',
        gap: 'var(--ps-space-md)',
        alignItems: 'flex-start',
      }}
    >
      {/* Drag handle / reorder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
        <button
          className="ps-btn ps-btn-ghost ps-btn-sm"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          style={{ padding: '2px 6px', fontSize: 12 }}
          title="Move up"
        >
          ▲
        </button>
        <span style={{ textAlign: 'center', fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)' }}>
          {index + 1}
        </span>
        <button
          className="ps-btn ps-btn-ghost ps-btn-sm"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          style={{ padding: '2px 6px', fontSize: 12 }}
          title="Move down"
        >
          ▼
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginBottom: 'var(--ps-space-sm)' }}>
          <span className="ps-badge ps-badge-blue" style={{ textTransform: 'capitalize' }}>
            {FIELD_TYPES.find((f) => f.type === field.field_type)?.icon}{' '}
            {field.field_type}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--ps-font-xs)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={field.is_required}
              onChange={(e) => onUpdate({ is_required: e.target.checked })}
            />
            Required
          </label>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', display: 'block', marginBottom: 2 }}>Label</label>
            <input
              className="ps-input"
              value={field.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="Field label"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', display: 'block', marginBottom: 2 }}>Key</label>
            <input
              className="ps-input"
              value={field.field_key}
              onChange={(e) => onUpdate({ field_key: e.target.value })}
              placeholder="field_key"
              style={{ fontFamily: 'monospace', fontSize: 'var(--ps-font-xs)' }}
            />
          </div>
        </div>

        {/* Options editor for select/multiselect */}
        {isOptionsType && (
          <div style={{ marginTop: 'var(--ps-space-sm)' }}>
            <label style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', display: 'block', marginBottom: 4 }}>
              Options
            </label>
            {optionValues.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--ps-space-xs)', marginBottom: 4, alignItems: 'center' }}>
                <input
                  className="ps-input"
                  value={opt}
                  onChange={(e) => {
                    const updated = [...optionValues]
                    updated[i] = e.target.value
                    updateOptions(updated)
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  className="ps-btn ps-btn-ghost ps-btn-sm"
                  onClick={() => {
                    const updated = optionValues.filter((_, idx) => idx !== i)
                    updateOptions(updated)
                  }}
                  style={{ color: 'var(--ps-error)', padding: '2px 8px' }}
                  title="Remove option"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="ps-btn ps-btn-ghost ps-btn-sm"
              onClick={() => updateOptions([...optionValues, `Option ${optionValues.length + 1}`])}
            >
              + Add option
            </button>
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        className="ps-btn ps-btn-ghost ps-btn-sm"
        onClick={onRemove}
        style={{ color: 'var(--ps-error)', paddingTop: 4 }}
        title="Delete field"
      >
        🗑
      </button>
    </div>
  )
}

/* ---- Form Preview ---- */

function FormPreview({ fields }: { fields: LocalField[] }) {
  if (fields.length === 0) {
    return (
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
        <p style={{ color: 'var(--ps-slate)' }}>No fields to preview. Add some fields first.</p>
      </div>
    )
  }

  return (
    <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', maxWidth: 600 }}>
      <h3 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
        Form Preview
      </h3>
      {fields.map((field) => (
        <div key={field._key} className="form-group">
          <label>
            {field.label}
            {field.is_required && <span style={{ color: 'var(--ps-error)' }}> *</span>}
          </label>
          {renderPreviewInput(field)}
        </div>
      ))}
      <button className="ps-btn ps-btn-primary" disabled style={{ marginTop: 'var(--ps-space-md)' }}>
        Submit (preview only)
      </button>
    </div>
  )
}

function renderPreviewInput(field: LocalField) {
  const optionValues: string[] = (field.options as any)?.values || []

  switch (field.field_type) {
    case 'text':
      return <input className="ps-input" placeholder={field.label} disabled />
    case 'number':
      return <input className="ps-input" type="number" placeholder="0" disabled />
    case 'boolean':
      return (
        <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" name={field._key} disabled /> Yes
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" name={field._key} disabled /> No
          </label>
        </div>
      )
    case 'select':
      return (
        <select className="ps-input" disabled>
          <option value="">Select…</option>
          {optionValues.map((v, i) => (
            <option key={i} value={v}>{v}</option>
          ))}
        </select>
      )
    case 'multiselect':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {optionValues.map((v, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" disabled /> {v}
            </label>
          ))}
        </div>
      )
    case 'date':
      return <input className="ps-input" type="date" disabled />
    case 'textarea':
      return <textarea className="ps-input" placeholder={field.label} rows={3} disabled />
    case 'signature':
      return (
        <div style={{
          border: '1px dashed var(--ps-cloud-blue)',
          borderRadius: 'var(--ps-radius-md)',
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ps-mist)',
          fontSize: 'var(--ps-font-sm)',
        }}>
          Signature capture area
        </div>
      )
    default:
      return <input className="ps-input" disabled />
  }
}
