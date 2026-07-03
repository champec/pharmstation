import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service, AppointmentSlot, ServiceForm, ServiceFormField } from '@pharmstation/types'
import { orgSlugOrIdFilter } from '../../lib/orgSlugFilter'

export function PublicBookingConfirmPage() {
  const { orgSlug, serviceId } = useParams<{ orgSlug: string; serviceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const slotId = (location.state as any)?.slotId as string | undefined

  const [org, setOrg] = useState<Organisation | null>(null)
  const [service, setService] = useState<Service | null>(null)
  const [slot, setSlot] = useState<AppointmentSlot | null>(null)
  const [form, setForm] = useState<ServiceForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  // Guest patient info
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [nhsNumber, setNhsNumber] = useState('')

  // Service form answers
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!orgSlug || !serviceId || !slotId) {
      setError('Missing booking details. Please go back and select a time slot.')
      setLoading(false)
      return
    }
    const client = getUserClient()
    Promise.all([
      client.from('ps_organisations').select('*').eq('is_public', true).or(orgSlugOrIdFilter(orgSlug)).limit(1).single(),
      client.from('ps_services').select('*').eq('id', serviceId).single(),
      client.from('ps_appointment_slots').select('*').eq('id', slotId).single(),
      client.from('ps_service_forms').select('*, fields:ps_service_form_fields(*)').eq('service_id', serviceId).eq('is_default', true).limit(1).maybeSingle(),
    ]).then(([orgRes, svcRes, slotRes, formRes]) => {
      if (orgRes.data) setOrg(orgRes.data as Organisation)
      if (svcRes.data) setService(svcRes.data as Service)
      if (slotRes.data) setSlot(slotRes.data as AppointmentSlot)
      if (formRes.data) {
        const f = formRes.data as ServiceForm
        if (f.fields) f.fields.sort((a: ServiceFormField, b: ServiceFormField) => a.display_order - b.display_order)
        setForm(f)
      }
      setLoading(false)
    })
  }, [orgSlug, serviceId, slotId])

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError('Name is required.'); return }
    if (!org || !serviceId || !slotId) { setError('Something went wrong.'); return }
    setSubmitting(true)
    setError('')
    try {
      const client = getUserClient()
      // 1. Find or create patient via SECURITY DEFINER RPC — works for
      //    anonymous patients (no INSERT policy on ps_patients for anon) and
      //    reuses the existing record when the NHS number is already known.
      const { data: patientId, error: patientErr } = await client.rpc('ps_public_find_or_create_patient', {
        p_org_id: org.id,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_dob: dob || null,
        p_nhs_number: nhsNumber.trim() || null,
      })
      if (patientErr || !patientId) throw new Error(patientErr?.message || 'Could not save your details.')

      // 2. Create appointment (id generated client-side — anon role has no
      //    SELECT policy on ps_appointments, so INSERT..RETURNING would fail)
      const appointmentId = crypto.randomUUID()
      const { error: apptErr } = await client
        .from('ps_appointments')
        .insert({
          id: appointmentId,
          org_id: org.id,
          patient_id: patientId,
          service_id: serviceId,
          slot_id: slotId,
          form_id: form?.id || null,
          form_data: Object.keys(formData).length > 0 ? formData : null,
          status: 'pending',
          notes: notes.trim() || null,
        })
      if (apptErr) throw apptErr

      // 3. Chargeable service → redirect to Stripe Checkout
      const chargeable = service?.is_chargeable && service.price_pence != null && service.price_pence > 0
      if (chargeable) {
        const base = window.location.origin
        const { data: checkout, error: checkoutErr } = await client.functions.invoke('stripe-checkout', {
          body: {
            action: 'create_checkout_session',
            org_id: org.id,
            service_id: serviceId,
            appointment_id: appointmentId,
            patient_id: patientId,
            payer_email: email.trim() || null,
            success_url: `${base}/book/${orgSlug}/payment-result`,
            cancel_url: `${base}/book/${orgSlug}/payment-result?canceled=1`,
          },
        })
        if (checkoutErr || !checkout?.url) {
          // Dig the real error out of the function's response body
          let detail = checkout?.error as string | undefined
          if (!detail && checkoutErr && typeof (checkoutErr as any).context?.json === 'function') {
            try { detail = (await (checkoutErr as any).context.json())?.error } catch { /* ignore */ }
          }
          throw new Error(detail || 'Payment could not be started. Please try again.')
        }
        window.location.href = checkout.url as string
        return
      }

      setSubmitted(true)
    } catch (e: any) {
      setError(e.message || 'Failed to create booking.')
    }
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center', padding: '0 var(--ps-space-lg)' }}>
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--ps-space-md)' }}>✅</div>
          <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>Booking Confirmed!</h1>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            Your appointment for <strong>{service?.name}</strong> at <strong>{org?.name}</strong> has been booked.
          </p>
          {slot && (
            <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
              📅 {new Date(slot.start_time).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>The pharmacy will confirm your appointment shortly.</p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/book')} style={{ marginTop: 'var(--ps-space-lg)' }}>Back to Home</button>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading booking details…</div>
  }

  return (
    <div style={{ maxWidth: '700px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <button className="ps-btn ps-btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 'var(--ps-space-md)' }}>← Back</button>

      <h1 style={{ marginBottom: 'var(--ps-space-sm)' }}>Confirm Your Booking</h1>

      {/* Booking summary */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-xl)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>{service?.name}</h3>
        <p style={{ color: 'var(--ps-slate)', margin: 0 }}>{org?.name}</p>
        {slot && (
          <p style={{ color: 'var(--ps-slate)', margin: '4px 0 0' }}>
            📅 {new Date(slot.start_time).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' – '}
            {new Date(slot.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Patient info */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Your Details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>First Name *</label>
            <input className="ps-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Last Name *</label>
            <input className="ps-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="ps-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="ps-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Date of Birth</label>
            <input className="ps-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="form-group">
            <label>NHS Number</label>
            <input className="ps-input" value={nhsNumber} onChange={(e) => setNhsNumber(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Service form */}
      {form && form.fields && form.fields.length > 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>{form.name}</h3>
          {form.fields.map((field) => (
            <div className="form-group" key={field.id}>
              <label>{field.label}{field.is_required ? ' *' : ''}</label>
              <FormField field={field} value={formData[field.field_key]} onChange={(v) => setFormData((p) => ({ ...p, [field.field_key]: v }))} />
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-xl)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Additional Notes</h3>
        <textarea className="ps-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} placeholder="Any additional information…" />
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate(-1)} disabled={submitting}>Cancel</button>
        <button className="ps-btn ps-btn-primary" onClick={handleSubmit} disabled={submitting || !firstName.trim() || !lastName.trim()}>
          {submitting ? 'Booking…' : 'Confirm Booking'}
        </button>
      </div>
    </div>
  )
}

function FormField({ field, value, onChange }: { field: ServiceFormField; value: any; onChange: (v: any) => void }) {
  switch (field.field_type) {
    case 'text':
      return <input className="ps-input" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <input className="ps-input" type="number" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />
    case 'date':
      return <input className="ps-input" type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'textarea':
      return <textarea className="ps-input" value={value || ''} onChange={(e) => onChange(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} />
    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      )
    case 'select': {
      const opts = ((field.options as any)?.choices || []) as string[]
      return (
        <select className="ps-input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    case 'multiselect': {
      const opts = ((field.options as any)?.choices || []) as string[]
      const selected: string[] = value || []
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-sm)' }}>
          {opts.map((o) => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, o])
                  else onChange(selected.filter((s) => s !== o))
                }}
              />
              {o}
            </label>
          ))}
        </div>
      )
    }
    default:
      return <input className="ps-input" value={value || ''} onChange={(e) => onChange(e.target.value)} />
  }
}
