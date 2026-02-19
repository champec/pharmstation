import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Patient, ServiceForm, ServiceFormField } from '@pharmstation/types'

/* ---- Patient search helpers ---- */

interface PatientOption {
  id: string
  first_name: string
  last_name: string
  nhs_number: string | null
  dob: string | null
  phone: string | null
}

export function ServiceDeliveryPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const {
    activeService,
    activeForms,
    error,
    fetchServiceDetail,
    fetchFormFields,
    activeFields,
    createDelivery,
    clearError,
  } = useServiceStore()

  /* ---- Steps: patient → form → review ---- */
  const [step, setStep] = useState<'patient' | 'form' | 'review'>('patient')

  /* ---- Patient state ---- */
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)
  const [skipPatient, setSkipPatient] = useState(false)

  /* ---- Form state ---- */
  const [selectedForm, setSelectedForm] = useState<ServiceForm | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')

  /* ---- Submission ---- */
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  // Load service detail
  const load = useCallback(() => {
    if (serviceId) fetchServiceDetail(serviceId)
  }, [serviceId, fetchServiceDetail])

  useEffect(() => { load() }, [load])

  // Auto-select default form when forms load
  useEffect(() => {
    if (activeForms.length > 0 && !selectedForm) {
      const defaultForm = activeForms.find((f) => f.is_default) || activeForms[0]
      setSelectedForm(defaultForm)
    }
  }, [activeForms, selectedForm])

  // Load fields when form is selected
  useEffect(() => {
    if (selectedForm) {
      fetchFormFields(selectedForm.id)
    }
  }, [selectedForm, fetchFormFields])

  /* ---- Patient search ---- */
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) {
      setPatientResults([])
      return
    }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('id, first_name, last_name, nhs_number, dob, phone')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10)
      setPatientResults((data as PatientOption[]) || [])
    } catch {
      setPatientResults([])
    }
    setSearching(false)
  }, [organisation?.id])

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(timer)
  }, [patientSearch, searchPatients])

  /* ---- Form data handling ---- */
  const setFieldValue = (fieldKey: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldKey]: value }))
  }

  /* ---- Validation ---- */
  const requiredFieldsMissing = useMemo(() => {
    return activeFields
      .filter((f) => f.is_required)
      .filter((f) => {
        const val = formData[f.field_key]
        return val === undefined || val === null || val === ''
      })
  }, [activeFields, formData])

  const canSubmit = (selectedPatient || skipPatient) && requiredFieldsMissing.length === 0

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    if (!organisation?.id || !serviceId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createDelivery({
        org_id: organisation.id,
        service_id: serviceId,
        patient_id: selectedPatient?.id || undefined,
        form_id: selectedForm?.id || undefined,
        form_data: formData,
        delivered_by: activeUser?.id || undefined,
        notes,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      setCompleted(true)
    } catch (e: any) {
      setSubmitError(e.message)
    }
    setSubmitting(false)
  }

  /* ---- Completion screen ---- */
  if (completed) {
    return (
      <div>
        <div className="page-header">
          <h1>✅ Service Delivered</h1>
        </div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: 'var(--ps-space-md)' }}>🎉</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            {activeService?.name} — Complete
          </h2>
          {selectedPatient && (
            <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
              Patient: {selectedPatient.first_name} {selectedPatient.last_name}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            <button className="ps-btn ps-btn-primary" onClick={() => {
              // Reset for another delivery of the same service
              setStep('patient')
              setSelectedPatient(null)
              setSkipPatient(false)
              setFormData({})
              setNotes('')
              setCompleted(false)
              setPatientSearch('')
            }}>
              Deliver Again
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
              Back to Services
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <a href={`/services/${serviceId}`} onClick={(e) => { e.preventDefault(); navigate(`/services/${serviceId}`) }}>{activeService?.name || 'Service'}</a>
          <span className="separator">/</span>
          <span>Deliver</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🩺 Deliver: {activeService?.name || 'Loading…'}</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(-1 as any)}>
            ← Cancel
          </button>
        </div>
      </div>

      {(error || submitError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || submitError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubmitError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Step indicators */}
      <div style={{
        display: 'flex',
        gap: 'var(--ps-space-md)',
        marginBottom: 'var(--ps-space-lg)',
      }}>
        {(['patient', 'form', 'review'] as const).map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              padding: 'var(--ps-space-sm) var(--ps-space-md)',
              borderRadius: 'var(--ps-radius-md)',
              background: step === s ? 'var(--ps-deep-blue)' : s === 'patient' && (selectedPatient || skipPatient) ? 'var(--ps-success)' : s === 'form' && step === 'review' ? 'var(--ps-success)' : 'var(--ps-off-white)',
              color: step === s || (s === 'patient' && (selectedPatient || skipPatient)) || (s === 'form' && step === 'review') ? 'var(--ps-white)' : 'var(--ps-slate)',
              textAlign: 'center',
              fontSize: 'var(--ps-font-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all var(--ps-transition-fast)',
            }}
            onClick={() => {
              if (s === 'patient') setStep('patient')
              if (s === 'form' && (selectedPatient || skipPatient)) setStep('form')
              if (s === 'review' && (selectedPatient || skipPatient)) setStep('review')
            }}
          >
            {i + 1}. {s === 'patient' ? 'Patient' : s === 'form' ? 'Fill Form' : 'Review & Complete'}
          </div>
        ))}
      </div>

      {/* ===== STEP 1: Patient ===== */}
      {step === 'patient' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            👤 Select Patient
          </h2>

          <div className="form-group">
            <label>Search by name, NHS number, or phone</label>
            <input
              className="ps-input"
              placeholder="Start typing…"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Search results */}
          {searching && <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Searching…</p>}

          {patientResults.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {patientResults.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedPatient(p)
                    setSkipPatient(false)
                    setPatientSearch('')
                    setPatientResults([])
                  }}
                  style={{
                    padding: 'var(--ps-space-sm) var(--ps-space-md)',
                    borderBottom: '1px solid var(--ps-off-white)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'background var(--ps-transition-fast)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <div>
                    <strong>{p.first_name} {p.last_name}</strong>
                    {p.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>NHS: {p.nhs_number}</span>}
                  </div>
                  {p.phone && <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{p.phone}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Selected patient */}
          {selectedPatient && (
            <div style={{
              padding: 'var(--ps-space-md)',
              background: 'rgba(4,176,255,0.06)',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-electric-cyan)',
              marginBottom: 'var(--ps-space-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <strong>✓ {selectedPatient.first_name} {selectedPatient.last_name}</strong>
                {selectedPatient.nhs_number && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>NHS: {selectedPatient.nhs_number}</span>}
                {selectedPatient.dob && <span style={{ marginLeft: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>DOB: {selectedPatient.dob}</span>}
              </div>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setSelectedPatient(null)}>Change</button>
            </div>
          )}

          {/* Skip patient option */}
          <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)', marginTop: 'var(--ps-space-md)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              <input
                type="checkbox"
                checked={skipPatient}
                onChange={(e) => {
                  setSkipPatient(e.target.checked)
                  if (e.target.checked) setSelectedPatient(null)
                }}
              />
              Continue without a patient record (walk-in / anonymous)
            </label>
          </div>

          {/* Next button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
            <button
              className="ps-btn ps-btn-primary"
              disabled={!selectedPatient && !skipPatient}
              onClick={() => setStep('form')}
            >
              Next: Fill Form →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 2: Fill Form ===== */}
      {step === 'form' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-lg)' }}>
            <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
              📝 {selectedForm?.name || 'Service Form'}
            </h2>
            {activeForms.length > 1 && (
              <select
                className="ps-input"
                style={{ width: 'auto' }}
                value={selectedForm?.id || ''}
                onChange={(e) => {
                  const f = activeForms.find((fm) => fm.id === e.target.value)
                  if (f) {
                    setSelectedForm(f)
                    setFormData({})
                  }
                }}
              >
                {activeForms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>

          {activeFields.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)', color: 'var(--ps-slate)' }}>
              <p>No form fields defined for this service. You can continue without filling in fields, or go to the Form Builder to add them.</p>
            </div>
          ) : (
            <div>
              {activeFields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  value={formData[field.field_key]}
                  onChange={(val) => setFieldValue(field.field_key, val)}
                />
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="form-group" style={{ marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
            <label>Notes (optional)</label>
            <textarea
              className="ps-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this service delivery…"
              rows={3}
            />
          </div>

          {/* Required fields warning */}
          {requiredFieldsMissing.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)' }}>
              Missing required fields: {requiredFieldsMissing.map((f) => f.label).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('patient')}>
              ← Back
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep('review')}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Review & Complete ===== */}
      {step === 'review' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
            ✅ Review & Complete
          </h2>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-lg)' }}>
            <strong>Service:</strong>
            <span>{activeService?.name}</span>

            <strong>Patient:</strong>
            <span>{selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Walk-in (no record)'}</span>

            <strong>Form:</strong>
            <span>{selectedForm?.name || 'None'}</span>

            <strong>Staff:</strong>
            <span>{activeUser?.full_name || activeUser?.email || 'Unknown'}</span>
          </div>

          {/* Form data summary */}
          {activeFields.length > 0 && Object.keys(formData).length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Form Responses</h3>
              <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
                {activeFields.map((field) => {
                  const val = formData[field.field_key]
                  if (val === undefined || val === null || val === '') return null
                  return (
                    <div key={field.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--ps-space-xs) 0', borderBottom: '1px solid var(--ps-white)' }}>
                      <span style={{ fontWeight: 500 }}>{field.label}</span>
                      <span style={{ color: 'var(--ps-slate)' }}>{formatValue(field, val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {notes && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Notes</h3>
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{notes}</p>
            </div>
          )}

          {requiredFieldsMissing.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)', padding: 'var(--ps-space-sm) var(--ps-space-md)', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--ps-radius-md)' }}>
              ⚠️ Missing required fields: {requiredFieldsMissing.map((f) => f.label).join(', ')} — go back to fill them in.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('form')}>
              ← Back to Form
            </button>
            <button
              className="ps-btn ps-btn-success"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              style={{ fontSize: 'var(--ps-font-md)', padding: 'var(--ps-space-sm) var(--ps-space-xl)' }}
            >
              {submitting ? 'Saving…' : '✓ Complete Service Delivery'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ==== Dynamic Form Field Renderer ==== */

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: ServiceFormField
  value: unknown
  onChange: (val: unknown) => void
}) {
  const optionValues: string[] = Array.isArray((field.options as any)?.values)
    ? (field.options as any).values
    : []

  return (
    <div className="form-group">
      <label>
        {field.label}
        {field.is_required && <span style={{ color: 'var(--ps-error)', marginLeft: 4 }}>*</span>}
      </label>

      {field.field_type === 'text' && (
        <input
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
        />
      )}

      {field.field_type === 'number' && (
        <input
          className="ps-input"
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          placeholder={field.label}
        />
      )}

      {field.field_type === 'boolean' && (
        <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={field.field_key}
              checked={value === true}
              onChange={() => onChange(true)}
            />
            Yes
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name={field.field_key}
              checked={value === false}
              onChange={() => onChange(false)}
            />
            No
          </label>
        </div>
      )}

      {field.field_type === 'select' && (
        <select
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {optionValues.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      )}

      {field.field_type === 'multiselect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {optionValues.map((v) => {
            const selected = Array.isArray(value) ? value : []
            return (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(v)}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, v])
                    else onChange(selected.filter((s: string) => s !== v))
                  }}
                />
                {v}
              </label>
            )
          })}
        </div>
      )}

      {field.field_type === 'date' && (
        <input
          className="ps-input"
          type="date"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.field_type === 'textarea' && (
        <textarea
          className="ps-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
          rows={3}
        />
      )}

      {field.field_type === 'signature' && (
        <div style={{
          border: '2px dashed var(--ps-cloud-blue)',
          borderRadius: 'var(--ps-radius-md)',
          padding: 'var(--ps-space-lg)',
          textAlign: 'center',
          color: 'var(--ps-mist)',
          fontSize: 'var(--ps-font-sm)',
          cursor: 'pointer',
        }}
          onClick={() => {
            const name = window.prompt('Type name for signature:')
            if (name) onChange(name)
          }}
        >
          {value ? (
            <span style={{ color: 'var(--ps-midnight)', fontStyle: 'italic', fontSize: 'var(--ps-font-lg)' }}>
              {value as string}
            </span>
          ) : (
            'Click to sign'
          )}
        </div>
      )}
    </div>
  )
}

/* ==== Value formatter for review ==== */

function formatValue(field: ServiceFormField, val: unknown): string {
  if (field.field_type === 'boolean') return val ? 'Yes' : 'No'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
