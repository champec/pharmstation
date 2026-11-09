import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { Modal } from '../Modal'
import {
  amendDeliveryRecord,
  fetchDeliveryRecord,
  fmtDateTime,
  formatAnswer,
  isImageAnswer,
  isLayoutField,
  patientName,
  SIMPLE_FIELD_TYPES,
  type DeliveryRecord,
} from './serviceRecord'

const OUTCOME_LABELS: Record<string, string> = {
  prescription: 'Medicine supplied',
  referral: 'Referred',
  advice: 'Advice given',
  no_treatment: 'No treatment',
}

/**
 * The full consultation record for one service delivery: patient, answers
 * (labelled from the form version used), outcome, medicines, who delivered
 * it, and every amendment. Printable on A4 via body[data-print-mode].
 */
export function ServiceRecordView({ deliveryId }: { deliveryId: string }) {
  const { organisation, permissions } = useAuthStore()
  const [record, setRecord] = useState<DeliveryRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [amendOpen, setAmendOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRecord(await fetchDeliveryRecord(deliveryId))
    } catch (e: any) {
      setError(e.message || 'The record could not be loaded.')
    }
  }, [deliveryId])

  useEffect(() => { load() }, [load])

  const handlePrint = () => {
    document.body.dataset.printMode = 'service-record'
    const done = () => {
      delete document.body.dataset.printMode
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
  }

  if (error) return <div className="auth-error">{error}</div>
  if (!record) return <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading record…</div>

  const canAmend = record.status === 'completed' && !!permissions?.services_amend
  const answers = record.form_data ?? {}
  const knownKeys = new Set(record.fields.map((f) => f.field_key))
  const extraKeys = Object.keys(answers).filter((k) => !knownKeys.has(k))
  const addr = organisation?.address
  const amendments = record.events.filter((e) => e.event === 'amended')

  return (
    <div className="service-record">
      <div className="service-record-actions no-print" style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end', marginBottom: 'var(--ps-space-md)' }}>
        {canAmend && (
          <button className="ps-btn ps-btn-secondary" onClick={() => setAmendOpen(true)}>Amend record</button>
        )}
        <button className="ps-btn ps-btn-primary" onClick={handlePrint}>Print / save PDF</button>
      </div>

      <div className="ps-card service-record-document" style={{ padding: 'var(--ps-space-lg)' }}>
        {/* Pharmacy header (shown on screen and paper) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ps-space-md)', borderBottom: '2px solid var(--ps-off-white)', paddingBottom: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--ps-font-lg)', color: 'var(--ps-midnight)' }}>{organisation?.name}</div>
            {addr && (
              <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                {[addr.line_1, addr.line_2, addr.city, addr.postcode].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>Consultation record</div>
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>{record.service?.name ?? 'Service'}</div>
            <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>Ref {record.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </div>

        {/* Summary */}
        <div className="ps-split" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
          <Item label="Patient" value={patientName(record.patient) || 'Walk-in / no patient record'} />
          {record.patient?.nhs_number && <Item label="NHS number" value={record.patient.nhs_number} />}
          {record.patient?.dob && <Item label="Date of birth" value={new Date(record.patient.dob).toLocaleDateString('en-GB')} />}
          <Item label={record.status === 'completed' ? 'Completed' : 'Started'} value={fmtDateTime(record.completed_at || record.created_at)} />
          <Item
            label="Delivered by"
            value={record.deliverer?.full_name
              ? `${record.deliverer.full_name}${record.deliverer.gphc_number ? ` (GPhC ${record.deliverer.gphc_number})` : ''}`
              : 'Former staff member'}
          />
          <Item label="Status" value={record.status === 'completed'
            ? (record.amendment_count ? `Completed, amended ${record.amendment_count}×` : 'Completed')
            : 'Draft (not finished)'} />
          {record.form_snapshot && <Item label="Form" value={`${record.form_snapshot.name} (version ${record.form_snapshot.version})`} />}
        </div>

        {/* Answers */}
        <h3 style={sectionTitle}>Consultation</h3>
        {record.fields.length === 0 && extraKeys.length === 0 ? (
          <p style={{ color: 'var(--ps-slate)' }}>No form answers recorded.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-lg)' }}>
            <tbody>
              {record.fields.map((f) => {
                if (isLayoutField(f.field_type)) {
                  return f.field_type === 'heading' ? (
                    <tr key={f.field_key}><td colSpan={2} style={{ paddingTop: 'var(--ps-space-md)', fontWeight: 700, color: 'var(--ps-midnight)' }}>{f.label}</td></tr>
                  ) : null
                }
                return <AnswerRow key={f.field_key} label={f.label} value={answers[f.field_key]} />
              })}
              {extraKeys.map((k) => (
                <AnswerRow key={k} label={k.replace(/_/g, ' ')} value={answers[k]} />
              ))}
            </tbody>
          </table>
        )}

        {/* Outcome + medicines */}
        {record.outcomes.length > 0 && (
          <>
            <h3 style={sectionTitle}>Outcome</h3>
            {record.outcomes.map((o) => (
              <div key={o.id} style={{ marginBottom: 'var(--ps-space-md)' }}>
                <div style={{ fontWeight: 600 }}>{OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type}</div>
                {o.referral_to && <div style={{ fontSize: 'var(--ps-font-sm)' }}>Referred to {o.referral_to}{o.referral_urgency ? ` (${o.referral_urgency})` : ''}{o.referral_reason ? `: ${o.referral_reason}` : ''}</div>}
                {o.advice_given && <div style={{ fontSize: 'var(--ps-font-sm)' }}>{o.advice_given}</div>}
                {(o.medications?.length ?? 0) > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)', marginTop: 'var(--ps-space-sm)' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--ps-slate)' }}>
                        <th style={cell}>Medicine</th><th style={cell}>Dose</th><th style={cell}>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.medications!.map((m) => (
                        <tr key={m.id}>
                          <td style={cell}>{[m.drug_name, m.drug_strength, m.drug_form].filter(Boolean).join(' ')}{m.is_controlled_drug ? ' (CD)' : ''}</td>
                          <td style={cell}>{m.dose || '—'}</td>
                          <td style={cell}>{m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </>
        )}

        {/* Notes */}
        {record.notes && (
          <>
            <h3 style={sectionTitle}>Notes</h3>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--ps-font-sm)' }}>{record.notes}</p>
          </>
        )}

        {/* Amendment history */}
        {amendments.length > 0 && (
          <>
            <h3 style={sectionTitle}>Amendments</h3>
            {amendments.map((e) => (
              <div key={e.id} style={{ fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-sm)', borderLeft: '3px solid var(--ps-warning)', paddingLeft: 'var(--ps-space-sm)' }}>
                <div><strong>{fmtDateTime(e.created_at)}</strong> by {e.actor_profile?.full_name ?? 'former staff member'}</div>
                <div>Reason: {e.reason}</div>
                <AmendmentDiff before={e.before} after={e.after} labels={Object.fromEntries(record.fields.map((f) => [f.field_key, f.label]))} />
              </div>
            ))}
          </>
        )}

        <div style={{ marginTop: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
          Printed from PharmStation {new Date().toLocaleDateString('en-GB')}. Completed records cannot be edited; changes are recorded as amendments.
        </div>
      </div>

      {amendOpen && (
        <AmendModal
          record={record}
          onClose={() => setAmendOpen(false)}
          onSaved={async () => { setAmendOpen(false); await load() }}
        />
      )}
    </div>
  )
}

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)',
  margin: 'var(--ps-space-md) 0 var(--ps-space-sm)',
}
const cell: React.CSSProperties = { padding: '4px 8px 4px 0', borderBottom: '1px solid var(--ps-off-white)', verticalAlign: 'top' }

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 500, color: 'var(--ps-midnight)' }}>{value}</div>
    </div>
  )
}

function AnswerRow({ label, value }: { label: string; value: unknown }) {
  return (
    <tr>
      <td style={{ ...cell, width: '40%', color: 'var(--ps-slate)' }}>{label}</td>
      <td style={{ ...cell, whiteSpace: 'pre-wrap' }}>
        {isImageAnswer(value) ? <img src={value} alt={label} style={{ maxWidth: 240, maxHeight: 120 }} /> : formatAnswer(value)}
      </td>
    </tr>
  )
}

function AmendmentDiff({ before, after, labels }: {
  before: DeliveryRecord['events'][number]['before']
  after: DeliveryRecord['events'][number]['after']
  labels: Record<string, string>
}) {
  const changes: Array<{ label: string; from: string; to: string }> = []
  const b = before?.form_data ?? {}
  const a = after?.form_data ?? {}
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      changes.push({ label: labels[key] ?? key, from: formatAnswer(b[key]), to: formatAnswer(a[key]) })
    }
  }
  if ((before?.notes ?? '') !== (after?.notes ?? '')) {
    changes.push({ label: 'Notes', from: before?.notes || '—', to: after?.notes || '—' })
  }
  if (changes.length === 0) return null
  return (
    <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
      {changes.map((c, i) => <li key={i}>{c.label}: “{c.from}” → “{c.to}”</li>)}
    </ul>
  )
}

function AmendModal({ record, onClose, onSaved }: { record: DeliveryRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const editable = record.fields.filter((f) => SIMPLE_FIELD_TYPES.has(f.field_type))
  const [values, setValues] = useState<Record<string, unknown>>({ ...(record.form_data ?? {}) })
  const [notes, setNotes] = useState(record.notes ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formChanged = JSON.stringify(values) !== JSON.stringify(record.form_data ?? {})
  const notesChanged = notes !== (record.notes ?? '')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await amendDeliveryRecord({
        deliveryId: record.id,
        reason: reason.trim(),
        formData: formChanged ? values : null,
        notes: notesChanged ? notes : null,
      })
      await onSaved()
    } catch (e: any) {
      setError(e.message || 'The amendment could not be saved.')
    }
    setSaving(false)
  }

  const setValue = (key: string, v: unknown) => setValues((cur) => ({ ...cur, [key]: v }))

  return (
    <Modal isOpen onClose={onClose} title="Amend record" width="720px">
      <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 0 }}>
        The original answers are kept. Your change, the reason and your name are added to the record's amendment history.
      </p>
      {editable.map((f) => {
        const v = values[f.field_key]
        const opts = f.options && !Array.isArray(f.options) ? (f.options as { values?: string[] }).values : Array.isArray(f.options) ? (f.options as string[]) : undefined
        return (
          <div className="form-group" key={f.field_key}>
            <label>{f.label}</label>
            {f.field_type === 'boolean' ? (
              <select className="ps-input" value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => setValue(f.field_key, e.target.value === '' ? null : e.target.value === 'yes')}>
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            ) : f.field_type === 'select' && opts ? (
              <select className="ps-input" value={(v as string) ?? ''} onChange={(e) => setValue(f.field_key, e.target.value)}>
                <option value="">—</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.field_type === 'textarea' ? (
              <textarea className="ps-input" rows={3} value={(v as string) ?? ''} onChange={(e) => setValue(f.field_key, e.target.value)} />
            ) : (
              <input
                className="ps-input"
                type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                value={v === undefined || v === null ? '' : String(v)}
                onChange={(e) => setValue(f.field_key, f.field_type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
              />
            )}
          </div>
        )
      })}
      {record.fields.length > editable.length && (
        <p style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
          Signatures, tables and prescribing answers can't be changed here. Add a note to explain a correction to those.
        </p>
      )}
      <div className="form-group">
        <label>Notes</label>
        <textarea className="ps-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Reason for amendment (required)</label>
        <input className="ps-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Corrected blood pressure reading entered in error" />
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
        <button className="ps-btn ps-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button
          className="ps-btn ps-btn-primary"
          onClick={save}
          disabled={saving || reason.trim().length < 5 || (!formChanged && !notesChanged)}
        >
          {saving ? 'Saving…' : 'Save amendment'}
        </button>
      </div>
    </Modal>
  )
}
