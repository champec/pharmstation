import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Service, ServiceForm, ServiceFormField, AppointmentSlot } from '@pharmstation/types'

/* ---- Patient search option ---- */
interface PatientOption {
  id: string
  first_name: string
  last_name: string
  nhs_number: string | null
  phone: string | null
}

export function NewAppointmentPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { services, fetchServices, fetchServiceDetail, activeForms, fetchFormFields, activeFields } = useServiceStore()
  const { slots, fetchSlots, bookAppointment, clearError, error } = useAppointmentStore()

  /* ---- Step control ---- */
  const [step, setStep] = useState<'service' | 'patient' | 'slot' | 'form' | 'confirm'>('service')

  /* ---- Service ---- */
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [noService, setNoService] = useState(false)
  const selectedService = services.find((s) => s.id === selectedServiceId)

  /* ---- Patient ---- */
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)

  /* ---- New patient inline form ---- */
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')

  /* ---- Slot ---- */
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlot | null>(null)

  /* ---- Form ---- */
  const [selectedForm, setSelectedForm] = useState<ServiceForm | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')

  /* ---- Submission ---- */
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchServices(organisation.id)
      fetchSlots(organisation.id)
    }
  }, [organisation?.id, fetchServices, fetchSlots])

  useEffect(() => { load() }, [load])

  // Load service detail + forms when service selected
  useEffect(() => {
    if (selectedServiceId) fetchServiceDetail(selectedServiceId)
  }, [selectedServiceId, fetchServiceDetail])

  // Auto-select default form
  useEffect(() => {
    if (activeForms.length > 0 && !selectedForm) {
      const def = activeForms.find((f) => f.is_default) || activeForms[0]
      setSelectedForm(def)
    }
  }, [activeForms, selectedForm])

  // Load fields when form changes
  useEffect(() => {
    if (selectedForm) fetchFormFields(selectedForm.id)
  }, [selectedForm, fetchFormFields])

  /* ---- Patient search ---- */
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) { setPatientResults([]); return }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('id, first_name, last_name, nhs_number, phone')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10)
      setPatientResults((data as PatientOption[]) || [])
    } catch { setPatientResults([]) }
    setSearching(false)
  }, [organisation?.id])

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(timer)
  }, [patientSearch, searchPatients])

  /* ---- Available slots for selected date ---- */
  const dateSlots = useMemo(() => {
    if (!selectedDate) return []
    return slots.filter((s) => {
      if (selectedServiceId && s.service_id !== selectedServiceId) return false
      if (s.booked_count >= s.max_bookings) return false
      const d = new Date(s.start_time).toISOString().split('T')[0]
      return d === selectedDate
    })
  }, [slots, selectedDate, selectedServiceId])

  /* ---- Create patient inline ---- */
  const handleCreatePatient = async () => {
    if (!organisation?.id || !newFirstName.trim() || !newLastName.trim()) return
    try {
      const { data, error } = await getUserClient()
        .from('ps_patients')
        .insert({
          organisation_id: organisation.id,
          first_name: newFirstName.trim(),
          last_name: newLastName.trim(),
          phone: newPhone.trim() || null,
          email: newEmail.trim() || null,
        })
        .select('id, first_name, last_name, nhs_number, phone')
        .single()
      if (error) throw error
      setSelectedPatient(data as PatientOption)
      setShowNewPatient(false)
    } catch (e: any) {
      alert(e.message)
    }
  }

  /* ---- Form validation ---- */
  const requiredFieldsMissing = useMemo(() => {
    return activeFields
      .filter((f) => f.is_required)
      .filter((f) => {
        const val = formData[f.field_key]
        return val === undefined || val === null || val === ''
      })
  }, [activeFields, formData])

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    if (!organisation?.id || !selectedPatient) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const created = await bookAppointment({
        org_id: organisation.id,
        service_id: selectedServiceId || undefined,
        patient_id: selectedPatient.id,
        slot_id: selectedSlot?.id || undefined,
        form_id: selectedForm?.id || undefined,
        form_data: formData,
        notes: notes || undefined,
        booked_by_user_id: activeUser?.id || undefined,
        status: 'confirmed',
      })
      setCreatedId(created.id)
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
        <div className="page-header"><h1>✅ Appointment Booked</h1></div>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: 'var(--ps-space-md)' }}>📅</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
            Appointment Created
          </h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            {selectedPatient?.first_name} {selectedPatient?.last_name}
            {selectedService ? ` — ${selectedService.name}` : ''}
            {selectedSlot ? ` at ${new Date(selectedSlot.start_time).toLocaleString('en-GB')}` : ''}
          </p>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            {createdId && (
              <button className="ps-btn ps-btn-primary" onClick={() => navigate(`/appointments/${createdId}`)}>
                View Appointment
              </button>
            )}
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>
              Back to Calendar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const steps = ['service', 'patient', 'slot', 'form', 'confirm'] as const

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/appointments" onClick={(e) => { e.preventDefault(); navigate('/appointments') }}>Appointments</a>
          <span className="separator">/</span>
          <span>New</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📅 New Appointment</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>← Cancel</button>
        </div>
      </div>

      {(error || submitError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || submitError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubmitError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Step indicators */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)' }}>
        {steps.map((s, i) => {
          const labels = { service: 'Service', patient: 'Patient', slot: 'Time Slot', form: 'Form', confirm: 'Confirm' }
          const isActive = step === s
          const isPast = steps.indexOf(step) > i
          return (
            <div
              key={s}
              style={{
                flex: 1,
                padding: 'var(--ps-space-xs) var(--ps-space-sm)',
                borderRadius: 'var(--ps-radius-md)',
                background: isActive ? 'var(--ps-deep-blue)' : isPast ? 'var(--ps-success)' : 'var(--ps-off-white)',
                color: isActive || isPast ? 'var(--ps-white)' : 'var(--ps-slate)',
                textAlign: 'center',
                fontSize: 'var(--ps-font-sm)',
                fontWeight: 600,
              }}
            >
              {i + 1}. {labels[s]}
            </div>
          )
        })}
      </div>

      {/* ==== STEP 1: Service ==== */}
      {step === 'service' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            🩺 Select Service (optional)
          </h2>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-md)' }}>
            Choose a service for this appointment, or skip if it's a general consultation.
          </p>

          <div className="dashboard-grid">
            {services.filter((s) => s.is_active).map((service) => (
              <div
                key={service.id}
                className="ps-card"
                onClick={() => { setSelectedServiceId(service.id); setNoService(false) }}
                style={{
                  padding: 'var(--ps-space-md)',
                  cursor: 'pointer',
                  border: selectedServiceId === service.id ? '2px solid var(--ps-electric-cyan)' : undefined,
                  transition: 'all var(--ps-transition-fast)',
                }}
              >
                <h3 style={{ fontSize: 'var(--ps-font-md)', margin: 0 }}>{service.name}</h3>
                <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: 'var(--ps-space-xs) 0 0' }}>
                  ⏱ {service.duration_minutes} min
                </p>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)', marginTop: 'var(--ps-space-md)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              <input
                type="checkbox"
                checked={noService}
                onChange={(e) => { setNoService(e.target.checked); if (e.target.checked) setSelectedServiceId(null) }}
              />
              No service — general appointment
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
            <button
              className="ps-btn ps-btn-primary"
              disabled={!selectedServiceId && !noService}
              onClick={() => setStep('patient')}
            >
              Next: Select Patient →
            </button>
          </div>
        </div>
      )}

      {/* ==== STEP 2: Patient ==== */}
      {step === 'patient' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            👤 Select or Create Patient
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

          {searching && <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Searching…</p>}

          {patientResults.length > 0 && (
            <div style={{ marginBottom: 'var(--ps-space-md)' }}>
              {patientResults.map((p) => (
                <div
                  key={p.id}
                  onClick={() => { setSelectedPatient(p); setPatientSearch(''); setPatientResults([]); setShowNewPatient(false) }}
                  style={{
                    padding: 'var(--ps-space-sm) var(--ps-space-md)',
                    borderBottom: '1px solid var(--ps-off-white)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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

          {selectedPatient && (
            <div style={{
              padding: 'var(--ps-space-md)',
              background: 'rgba(4,176,255,0.06)',
              borderRadius: 'var(--ps-radius-md)',
              border: '1px solid var(--ps-electric-cyan)',
              marginBottom: 'var(--ps-space-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <strong>✓ {selectedPatient.first_name} {selectedPatient.last_name}</strong>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setSelectedPatient(null)}>Change</button>
            </div>
          )}

          {/* Quick create patient */}
          {!selectedPatient && (
            <div style={{ borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)', marginTop: 'var(--ps-space-md)' }}>
              {!showNewPatient ? (
                <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => setShowNewPatient(true)}>
                  + Create New Patient
                </button>
              ) : (
                <div>
                  <h3 style={{ fontSize: 'var(--ps-font-md)', marginBottom: 'var(--ps-space-sm)' }}>Quick Create Patient</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)' }}>
                    <div className="form-group">
                      <label>First Name *</label>
                      <input className="ps-input" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Last Name *</label>
                      <input className="ps-input" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input className="ps-input" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input className="ps-input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)' }}>
                    <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleCreatePatient} disabled={!newFirstName.trim() || !newLastName.trim()}>
                      Create & Select
                    </button>
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setShowNewPatient(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('service')}>← Back</button>
            <button className="ps-btn ps-btn-primary" disabled={!selectedPatient} onClick={() => setStep('slot')}>
              Next: Select Time →
            </button>
          </div>
        </div>
      )}

      {/* ==== STEP 3: Slot ==== */}
      {step === 'slot' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            🕐 Select Time Slot
          </h2>

          <div className="form-group">
            <label>Select Date</label>
            <input
              className="ps-input"
              type="date"
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(null) }}
            />
          </div>

          {selectedDate && dateSlots.length === 0 && (
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
              No available slots for this date{selectedServiceId ? ' and service' : ''}. You can still proceed without a specific slot.
            </p>
          )}

          {dateSlots.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
              {dateSlots.map((slot) => {
                const start = new Date(slot.start_time)
                const end = new Date(slot.end_time)
                const isSelected = selectedSlot?.id === slot.id
                const remaining = slot.max_bookings - slot.booked_count
                return (
                  <div
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot)}
                    className="ps-card"
                    style={{
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      cursor: 'pointer',
                      border: isSelected ? '2px solid var(--ps-electric-cyan)' : undefined,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 'var(--ps-font-md)' }}>
                      {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – {end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)' }}>
                      {remaining} spot{remaining !== 1 ? 's' : ''} left
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('patient')}>← Back</button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep(selectedServiceId && activeForms.length > 0 ? 'form' : 'confirm')}>
              {selectedServiceId && activeForms.length > 0 ? 'Next: Fill Form →' : 'Next: Confirm →'}
            </button>
          </div>
        </div>
      )}

      {/* ==== STEP 4: Form ==== */}
      {step === 'form' && selectedServiceId && (
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
                  if (f) { setSelectedForm(f); setFormData({}) }
                }}
              >
                {activeForms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </div>

          {activeFields.length === 0 ? (
            <p style={{ color: 'var(--ps-slate)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
              No form fields defined for this service.
            </p>
          ) : (
            activeFields.map((field) => (
              <FormField
                key={field.id}
                field={field}
                value={formData[field.field_key]}
                onChange={(val) => setFormData((prev) => ({ ...prev, [field.field_key]: val }))}
              />
            ))
          )}

          <div className="form-group" style={{ marginTop: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
            <label>Notes (optional)</label>
            <textarea className="ps-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes…" rows={3} />
          </div>

          {requiredFieldsMissing.length > 0 && (
            <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-error)', marginBottom: 'var(--ps-space-md)' }}>
              Missing required: {requiredFieldsMissing.map((f) => f.label).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep('slot')}>← Back</button>
            <button className="ps-btn ps-btn-primary" onClick={() => setStep('confirm')}>Next: Confirm →</button>
          </div>
        </div>
      )}

      {/* ==== STEP 5: Confirm ==== */}
      {step === 'confirm' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-lg)' }}>
            ✅ Review & Confirm
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-lg)' }}>
            <strong>Service:</strong>
            <span>{selectedService?.name || 'General (no service)'}</span>

            <strong>Patient:</strong>
            <span>{selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : '—'}</span>

            <strong>Time Slot:</strong>
            <span>{selectedSlot ? `${new Date(selectedSlot.start_time).toLocaleString('en-GB')} – ${new Date(selectedSlot.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'No slot selected'}</span>

            <strong>Staff:</strong>
            <span>{activeUser?.full_name || activeUser?.email || 'Unknown'}</span>
          </div>

          {/* Form data review */}
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
                      <span style={{ color: 'var(--ps-slate)' }}>{formatVal(field, val)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {notes && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <strong>Notes:</strong> <span style={{ color: 'var(--ps-slate)' }}>{notes}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setStep(selectedServiceId && activeForms.length > 0 ? 'form' : 'slot')}>
              ← Back
            </button>
            <button
              className="ps-btn ps-btn-success"
              disabled={submitting || !selectedPatient}
              onClick={handleSubmit}
              style={{ fontSize: 'var(--ps-font-md)', padding: 'var(--ps-space-sm) var(--ps-space-xl)' }}
            >
              {submitting ? 'Booking…' : '✓ Confirm Appointment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ==== Reusable form field renderer ==== */

function FormField({ field, value, onChange }: { field: ServiceFormField; value: unknown; onChange: (val: unknown) => void }) {
  const opts: string[] = Array.isArray((field.options as any)?.values) ? (field.options as any).values : []

  return (
    <div className="form-group">
      <label>{field.label}{field.is_required && <span style={{ color: 'var(--ps-error)', marginLeft: 4 }}>*</span>}</label>
      {field.field_type === 'text' && <input className="ps-input" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />}
      {field.field_type === 'number' && <input className="ps-input" type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} />}
      {field.field_type === 'boolean' && (
        <div style={{ display: 'flex', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name={field.field_key} checked={value === true} onChange={() => onChange(true)} /> Yes</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="radio" name={field.field_key} checked={value === false} onChange={() => onChange(false)} /> No</label>
        </div>
      )}
      {field.field_type === 'select' && (
        <select className="ps-input" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {opts.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {field.field_type === 'multiselect' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {opts.map((v) => {
            const sel = Array.isArray(value) ? value : []
            return (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(v)} onChange={(e) => { if (e.target.checked) onChange([...sel, v]); else onChange(sel.filter((s: string) => s !== v)) }} />
                {v}
              </label>
            )
          })}
        </div>
      )}
      {field.field_type === 'date' && <input className="ps-input" type="date" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />}
      {field.field_type === 'textarea' && <textarea className="ps-input" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} rows={3} />}
      {field.field_type === 'signature' && (
        <div
          style={{ border: '2px dashed var(--ps-cloud-blue)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-mist)', cursor: 'pointer' }}
          onClick={() => { const name = window.prompt('Type name for signature:'); if (name) onChange(name) }}
        >
          {value ? <span style={{ color: 'var(--ps-midnight)', fontStyle: 'italic', fontSize: 'var(--ps-font-lg)' }}>{value as string}</span> : 'Click to sign'}
        </div>
      )}
    </div>
  )
}

function formatVal(field: ServiceFormField, val: unknown): string {
  if (field.field_type === 'boolean') return val ? 'Yes' : 'No'
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
