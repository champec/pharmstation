import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface ServiceOption {
  id: string
  name: string
  category: string
}

const BOOKING_MODES = [
  { value: 'auto', label: 'Auto-accept — first eligible locum to apply is confirmed automatically' },
  { value: 'manual', label: 'Manual review — you choose from applicants' },
]

export function NewShiftPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { organisation, activeUser } = useAuthStore()

  /* Form state */
  const [date, setDate] = useState(searchParams.get('date') ?? '')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [rate, setRate] = useState('')
  const [bookingMode, setBookingMode] = useState<'auto' | 'manual'>('manual')
  const [notes, setNotes] = useState('')

  /* Criteria */
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [requiredServiceIds, setRequiredServiceIds] = useState<string[]>([])
  const [referencesRequired, setReferencesRequired] = useState(false)
  const [sopRequired, setSopRequired] = useState(false)
  const [criteriaEnabled, setCriteriaEnabled] = useState(false)

  /* UI state */
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Load service library */
  useEffect(() => {
    getUserClient()
      .from('ps_service_library')
      .select('id, name, category')
      .order('category')
      .order('name')
      .then(({ data }) => setServiceOptions((data as ServiceOption[]) ?? []))
  }, [])

  function toggleService(id: string) {
    setRequiredServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  function calcHours() {
    if (!startTime || !endTime) return null
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    const diff = (eh * 60 + em) - (sh * 60 + sm)
    return diff > 0 ? (diff / 60).toFixed(1) : null
  }

  function calcTotal() {
    const h = calcHours()
    const r = parseFloat(rate)
    if (h && !isNaN(r)) return (parseFloat(h) * r).toFixed(2)
    return null
  }

  const isValid =
    date !== '' &&
    startTime !== '' &&
    endTime !== '' &&
    parseFloat(rate) > 0 &&
    startTime < endTime

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!organisation?.id || !activeUser?.id || !isValid) return
    setError(null)
    setSubmitting(true)

    try {
      const client = getUserClient()

      // Insert shift
      const { data: shift, error: shiftErr } = await client
        .from('ps_locum_shifts')
        .insert({
          org_id: organisation.id,
          created_by: activeUser.id,
          date,
          start_time: startTime + ':00',
          end_time: endTime + ':00',
          rate_per_hour: parseFloat(rate),
          booking_mode: bookingMode,
          payment_mode: 'platform',
          status: 'open',
          notes: notes.trim() || null,
        })
        .select('id')
        .single()

      if (shiftErr) throw shiftErr

      // Insert criteria if enabled
      if (criteriaEnabled) {
        const { error: critErr } = await client.from('ps_locum_shift_criteria').insert({
          shift_id: shift.id,
          required_service_ids: requiredServiceIds.length > 0 ? requiredServiceIds : null,
          references_required: referencesRequired,
          sop_required: sopRequired,
          notes: null,
        })
        if (critErr) throw critErr
      }

      navigate(`/shifts/${shift.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create shift. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const hours = calcHours()
  const total = calcTotal()

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="breadcrumbs">
          <Link to="/shifts">Shifts</Link>
          <span className="separator">/</span>
          <span>Post New Shift</span>
        </div>
        <h1 className="page-title">Post a Locum Shift</h1>
        <p className="page-subtitle">Shifts are published immediately and visible to eligible locums.</p>
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: '1.5rem' }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        {/* Shift Timing */}
        <div className="ps-card" style={{ marginBottom: '1.5rem' }}>
          <div className="ps-card-header"><h2 className="ps-card-title">Shift Details</h2></div>
          <div className="ps-card-body">
            <div className="form-group">
              <label className="form-label">Date <span className="required">*</span></label>
              <input
                className="form-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Time <span className="required">*</span></label>
                <input
                  className="form-input"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">End Time <span className="required">*</span></label>
                <input
                  className="form-input"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>
            {hours && (
              <p className="form-hint">Duration: <strong>{hours} hours</strong></p>
            )}
            {startTime >= endTime && startTime && endTime && (
              <p className="form-hint form-hint-error">End time must be after start time.</p>
            )}

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label">Hourly Rate (£) <span className="required">*</span></label>
              <input
                className="form-input"
                type="number"
                min="15"
                max="200"
                step="0.50"
                placeholder="e.g. 25.00"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
                style={{ maxWidth: 160 }}
              />
              {total && hours && (
                <p className="form-hint">
                  Estimated total: <strong>£{total}</strong> for {hours}h
                </p>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label">Notes (visible to applicants)</label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Any special requirements, parking info, system details…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Booking Mode */}
        <div className="ps-card" style={{ marginBottom: '1.5rem' }}>
          <div className="ps-card-header"><h2 className="ps-card-title">Booking Mode</h2></div>
          <div className="ps-card-body">
            {BOOKING_MODES.map((m) => (
              <label key={m.value} className="ps-radio-label" style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="bookingMode"
                  value={m.value}
                  checked={bookingMode === m.value}
                  onChange={() => setBookingMode(m.value as 'auto' | 'manual')}
                  style={{ marginTop: 3 }}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Criteria */}
        <div className="ps-card" style={{ marginBottom: '1.5rem' }}>
          <div className="ps-card-header">
            <h2 className="ps-card-title">Eligibility Criteria</h2>
            <label className="ps-checkbox-label" style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={criteriaEnabled}
                onChange={(e) => setCriteriaEnabled(e.target.checked)}
              />
              Add criteria to filter eligible locums
            </label>
          </div>
          {criteriaEnabled && (
            <div className="ps-card-body">
              <div className="form-group">
                <label className="form-label">Required Services</label>
                <p className="form-hint" style={{ marginBottom: '0.5rem' }}>
                  Only locums who declared these services will see this shift.
                </p>
                <div className="service-checklist" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--ps-border)', borderRadius: 6, padding: '0.5rem' }}>
                  {serviceOptions.map((svc) => (
                    <label key={svc.id} className="ps-checkbox-label" style={{ padding: '2px 0' }}>
                      <input
                        type="checkbox"
                        checked={requiredServiceIds.includes(svc.id)}
                        onChange={() => toggleService(svc.id)}
                      />
                      {svc.name}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem' }}>
                <label className="ps-checkbox-label">
                  <input
                    type="checkbox"
                    checked={referencesRequired}
                    onChange={(e) => setReferencesRequired(e.target.checked)}
                  />
                  References required
                </label>
                <label className="ps-checkbox-label">
                  <input
                    type="checkbox"
                    checked={sopRequired}
                    onChange={(e) => setSopRequired(e.target.checked)}
                  />
                  Must acknowledge SOPs before shift
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Payment notice */}
        <div className="ps-alert ps-alert-info" style={{ marginBottom: '1.5rem' }}>
          <strong>Payments:</strong> All shifts use platform payments (Stripe). A 50p platform fee
          applies per confirmed shift. Locums are paid automatically on the Wednesday after
          their working week.
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="submit"
            className="ps-btn ps-btn-primary"
            disabled={!isValid || submitting}
          >
            {submitting ? 'Posting…' : 'Post Shift'}
          </button>
          <Link to="/shifts" className="ps-btn ps-btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
