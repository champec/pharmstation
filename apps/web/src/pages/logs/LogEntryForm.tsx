import { useEffect, useMemo, useState } from 'react'
import type { FieldType, LogEntry, LogField } from '@pharmstation/types'
import { CanvasField } from '../../components/forms/CanvasField'
import {
  dataFields,
  fieldRange,
  isActionField,
  isEmptyValue,
  isOutOfRange,
  isPersonField,
  rangeLabel,
  relativeDay,
  validateEntry,
} from './logUtils'

/* ---- One input per field type ---- */

export function FieldInput({
  field,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  field: LogField
  value: unknown
  onChange: (val: unknown) => void
  invalid?: boolean
  autoFocus?: boolean
}) {
  const strVal = (value ?? '') as string
  const cls = `ps-input log-input${invalid ? ' log-input-invalid' : ''}`
  const id = `log-field-${field.field_key}`

  switch (field.field_type as FieldType) {
    case 'number': {
      const range = fieldRange(field)
      const out = isOutOfRange(field, value)
      const has = !isEmptyValue(value)
      const step = range?.unit === '°C' ? 0.1 : 1
      const bump = (delta: number) => {
        const base = has ? Number(value) : range?.min !== undefined && range?.max !== undefined ? (range.min + range.max) / 2 : 0
        onChange(Math.round((base + delta) * 10) / 10)
      }
      return (
        <div className="log-number">
          <button type="button" className="log-step" onClick={() => bump(-step)} aria-label={`Lower ${field.label}`}>−</button>
          <input
            id={id}
            className={`${cls} log-number-input${has ? (out ? ' is-out' : range ? ' is-ok' : '') : ''}`}
            type="number"
            inputMode="decimal"
            step={step}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            autoFocus={autoFocus}
          />
          <button type="button" className="log-step" onClick={() => bump(step)} aria-label={`Raise ${field.label}`}>+</button>
          {range && (
            <span className={`log-range-pill${has ? (out ? ' is-out' : ' is-ok') : ''}`}>
              {has ? (out ? '⚠ Out of range' : '✓ In range') : `Safe: ${rangeLabel(range)}`}
            </span>
          )}
        </div>
      )
    }
    case 'boolean':
      return (
        <div className="log-toggle" role="group" aria-label={field.label}>
          <button type="button" className={value === true ? 'is-on' : ''} onClick={() => onChange(true)}>Yes</button>
          <button type="button" className={value === false ? 'is-on' : ''} onClick={() => onChange(false)}>No</button>
        </div>
      )
    case 'select': {
      const options = Array.isArray(field.options) ? (field.options as string[]) : []
      if (options.length <= 8) {
        return (
          <div className="log-chips" role="radiogroup" aria-label={field.label}>
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={strVal === opt}
                className={`log-chip${strVal === opt ? ' is-on' : ''}`}
                onClick={() => onChange(strVal === opt ? '' : opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )
      }
      return (
        <select id={id} className={cls} value={strVal} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }
    case 'multiselect': {
      const options = Array.isArray(field.options) ? (field.options as string[]) : []
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="log-chips" role="group" aria-label={field.label}>
          {options.map((opt) => {
            const on = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                className={`log-chip${on ? ' is-on' : ''}`}
                onClick={() => onChange(on ? selected.filter((s) => s !== opt) : [...selected, opt])}
              >
                {on ? '✓ ' : ''}{opt}
              </button>
            )
          })}
        </div>
      )
    }
    case 'date':
      return (
        <div className="log-inline">
          <input id={id} className={cls} type="datetime-local" value={strVal} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => onChange(nowLocalInput())}>Now</button>
        </div>
      )
    case 'textarea':
      return (
        <textarea id={id} className={cls} value={strVal} onChange={(e) => onChange(e.target.value)} rows={3} autoFocus={autoFocus} />
      )
    case 'signature':
    case 'canvas':
      return <CanvasField value={strVal || undefined} onChange={(b64) => onChange(b64)} width={320} height={120} />
    default:
      return <input id={id} className={cls} value={strVal} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
  }
}

function nowLocalInput(): string {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/* ---- The entry form used for new entries and edits ---- */

export interface LogEntryFormProps {
  fields: LogField[]
  /** Existing entry when editing */
  entry?: LogEntry | null
  /** Day being logged (daily logs) */
  date?: string
  userName?: string
  saving?: boolean
  error?: string | null
  submitLabel?: string
  onSubmit: (data: Record<string, unknown>, editReason: string | null) => void
  onCancel: () => void
}

export function LogEntryForm({ fields, entry, date, userName, saving, error, submitLabel, onSubmit, onCancel }: LogEntryFormProps) {
  const fs = useMemo(() => dataFields(fields), [fields])
  const isEdit = !!entry
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (entry?.data) return { ...entry.data }
    const initial: Record<string, unknown> = {}
    for (const f of fs) if (isPersonField(f) && userName) initial[f.field_key] = userName
    return initial
  })
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  // Fill "Checked by" style fields with the signed-in person's name once the
  // fields and the name have loaded (they can arrive after the form opens).
  useEffect(() => {
    if (isEdit || !userName) return
    setData((d) => {
      let changed = false
      const next = { ...d }
      for (const f of fs) {
        if (isPersonField(f) && (next[f.field_key] === undefined || next[f.field_key] === '')) {
          next[f.field_key] = userName
          changed = true
        }
      }
      return changed ? next : d
    })
  }, [fs, userName, isEdit])

  const errors = validateEntry(fs, data)
  const reasonError = isEdit && reason.trim().length < 3 ? 'Say why you are changing this entry' : null
  const anyOut = fs.some((f) => isOutOfRange(f, data[f.field_key]))
  const canSave = Object.keys(errors).length === 0 && !reasonError

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSave) return
    onSubmit(data, isEdit ? reason.trim() : null)
  }

  return (
    <form className="log-form" onSubmit={submit} noValidate>
      {date && (
        <div className="log-form-day">
          <span>{isEdit ? 'Editing' : 'Logging'}</span>
          <strong>{relativeDay(date)}</strong>
        </div>
      )}

      {anyOut && (
        <div className="log-alert log-alert-warn" role="alert">
          <strong>Reading out of range.</strong> Check the thermometer, move stock if needed, and write what you did below.
          If the fridge has been out of range, speak to the pharmacist before using the stock.
        </div>
      )}

      {fs.map((f, i) => {
        const err = touched ? errors[f.field_key] : undefined
        const highlight = anyOut && isActionField(f)
        return (
          <div key={f.id} className={`log-form-field${highlight ? ' is-highlight' : ''}`}>
            <label htmlFor={`log-field-${f.field_key}`}>
              {f.label}
              {f.is_required && <span className="log-req" aria-hidden> *</span>}
            </label>
            <FieldInput
              field={f}
              value={data[f.field_key]}
              onChange={(val) => setData((prev) => ({ ...prev, [f.field_key]: val }))}
              invalid={!!err}
              autoFocus={i === 0}
            />
            {err && <div className="log-field-error">{err}</div>}
          </div>
        )
      })}

      {isEdit && (
        <div className="log-form-field">
          <label htmlFor="log-edit-reason">Why are you changing it? <span className="log-req">*</span></label>
          <input
            id="log-edit-reason"
            className={`ps-input log-input${touched && reasonError ? ' log-input-invalid' : ''}`}
            placeholder="e.g. Typed the wrong reading"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {touched && reasonError && <div className="log-field-error">{reasonError}</div>}
          <div className="log-hint">The original stays in the history. Inspectors can see every change.</div>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      <div className="log-form-actions">
        <button type="button" className="ps-btn ps-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ps-btn ps-btn-primary log-save-btn" disabled={saving}>
          {saving ? 'Saving…' : submitLabel ?? (isEdit ? 'Save change' : 'Save entry')}
        </button>
      </div>
    </form>
  )
}
