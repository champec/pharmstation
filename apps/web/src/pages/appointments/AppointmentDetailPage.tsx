import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppointmentStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { AppointmentStatus } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const STATUS_COLOURS: Record<AppointmentStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e', label: 'Pending' },
  confirmed: { bg: '#dbeafe', text: '#1e40af', label: 'Confirmed' },
  completed: { bg: '#e5e7eb', text: '#374151', label: 'Completed' },
  cancelled: { bg: '#fee2e2', text: '#991b1b', label: 'Cancelled' },
  no_show: { bg: '#ffedd5', text: '#9a3412', label: 'No Show' },
}

export function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    activeAppointment: appt,
    loading,
    error,
    fetchAppointmentDetail,
    updateStatus,
    updateAppointment,
    clearError,
  } = useAppointmentStore()

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const load = useCallback(() => {
    if (id) fetchAppointmentDetail(id)
  }, [id, fetchAppointmentDetail])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (appt?.notes) setNotesValue(appt.notes)
  }, [appt?.notes])

  const [paidPence, setPaidPence] = useState(0)
  const [refundOnCancel, setRefundOnCancel] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    getUserClient().from('ps_payments')
      .select('amount_pence, refunded_pence')
      .eq('appointment_id', id).in('status', ['succeeded', 'partially_refunded'])
      .then(({ data }) => {
        setPaidPence((data ?? []).reduce((t, p: any) => t + p.amount_pence - (p.refunded_pence ?? 0), 0))
      })
  }, [id, appt?.status])

  const handleStatusChange = async (newStatus: AppointmentStatus) => {
    if (!id) return
    try {
      await updateStatus(id, newStatus)
      fetchAppointmentDetail(id)
    } catch (e: any) {
      alert(e.message)
    }
  }

  // Confirm / cancel go through the server so the patient gets a text and
  // a paid booking can be refunded in the same step.
  const staffSetStatus = async (status: 'confirmed' | 'cancelled') => {
    if (!id) return
    setBusy(true)
    try {
      const { data, error } = await getUserClient().functions.invoke('appointments', {
        body: { action: 'staff_set_status', appointment_id: id, status, refund: status === 'cancelled' && paidPence > 0 && refundOnCancel },
      })
      let msg = data?.error as string | undefined
      const ctx = (error as any)?.context
      if (error && !msg && ctx && typeof ctx.json === 'function') {
        try { msg = (await ctx.json())?.error } catch { /* ignore */ }
      }
      if (error || msg) throw new Error(msg || error?.message || 'Update failed')
      if (data?.refund_error) alert(data.refund_error)
      fetchAppointmentDetail(id)
    } catch (e: any) {
      alert(e.message)
    }
    setBusy(false)
  }

  // Move to another time
  const [moveSlots, setMoveSlots] = useState<{ id: string; start_time: string; end_time: string }[] | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const callFn = async (body: Record<string, unknown>) => {
    const { data, error } = await getUserClient().functions.invoke('appointments', { body })
    let msg = data?.error as string | undefined
    const ctx = (error as any)?.context
    if (error && !msg && ctx && typeof ctx.json === 'function') {
      try { msg = (await ctx.json())?.error } catch { /* ignore */ }
    }
    if (error || msg) throw new Error(msg || error?.message || 'Request failed')
    return data
  }
  const openMove = async () => {
    try {
      const out = await callFn({ action: 'staff_slots', appointment_id: id })
      setMoveSlots(out.slots)
      setMoveTo('')
    } catch (e: any) { alert(e.message) }
  }
  const doMove = async () => {
    if (!moveTo || !id) return
    setBusy(true)
    try {
      await callFn({ action: 'staff_reschedule', appointment_id: id, slot_id: moveTo })
      setMoveSlots(null)
      fetchAppointmentDetail(id)
    } catch (e: any) { alert(e.message) }
    setBusy(false)
  }

  // Video call linked to this appointment
  const [video, setVideo] = useState<{ id: string; status: string } | null>(null)
  useEffect(() => {
    if (!id) return
    getUserClient().from('ps_video_consultations').select('id, status')
      .eq('appointment_id', id).not('status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setVideo(data as any))
  }, [id, appt?.slot_id])
  const setUpVideo = async () => {
    if (!appt) return
    setBusy(true)
    try {
      const { data, error } = await getUserClient().functions.invoke('daily-video', {
        body: {
          action: 'create_room',
          org_id: appt.org_id,
          patient_id: appt.patient_id,
          patient_name: appt.patient ? `${appt.patient.first_name} ${appt.patient.last_name}` : 'Patient',
          patient_phone: appt.patient?.phone ?? null,
          appointment_id: appt.id,
          scheduled_for: appt.slot?.start_time ?? new Date().toISOString(),
        },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message)
      navigate(`/video/${data.consultation.id}`)
    } catch (e: any) { alert(e.message || 'Could not set up the video call') }
    setBusy(false)
  }

  const copyManageLink = async () => {
    if (!appt?.manage_token) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/booking/manage/${appt.manage_token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const handleSaveNotes = async () => {
    if (!id) return
    setSavingNotes(true)
    try {
      await updateAppointment(id, { notes: notesValue })
      setEditingNotes(false)
      fetchAppointmentDetail(id)
    } catch (e: any) {
      alert(e.message)
    }
    setSavingNotes(false)
  }

  if (loading && !appt) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>
        Loading appointment…
      </div>
    )
  }

  if (!appt) {
    return (
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
        <h2>Appointment not found</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>Back to Appointments</button>
      </div>
    )
  }

  const statusInfo = STATUS_COLOURS[appt.status as AppointmentStatus] || STATUS_COLOURS.pending
  const startTime = appt.slot?.start_time ? new Date(appt.slot.start_time) : null
  const endTime = appt.slot?.end_time ? new Date(appt.slot.end_time) : null

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/appointments" onClick={(e) => { e.preventDefault(); navigate('/appointments') }}>Appointments</a>
          <span className="separator">/</span>
          <span>Detail</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📋 Appointment Detail</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>← Back</button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Status badge */}
      <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
        <span style={{
          display: 'inline-block',
          padding: 'var(--ps-space-sm) var(--ps-space-lg)',
          borderRadius: 'var(--ps-radius-lg)',
          background: statusInfo.bg,
          color: statusInfo.text,
          fontWeight: 700,
          fontSize: 'var(--ps-font-lg)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {appt.status === 'pending' && appt.hold_expires_at ? 'Awaiting payment' : statusInfo.label}
        </span>
        {appt.status === 'cancelled' && appt.cancelled_by && (
          <span style={{ marginLeft: 'var(--ps-space-md)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            {appt.cancelled_by === 'patient' ? 'Cancelled by the patient' : appt.cancelled_by === 'system' ? 'Released automatically (not paid in time)' : 'Cancelled by the pharmacy'}
            {appt.cancelled_at ? ` on ${new Date(appt.cancelled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </span>
        )}
        {paidPence > 0 && (
          <span style={{ marginLeft: 'var(--ps-space-md)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            Paid online £{(paidPence / 100).toFixed(2)}
          </span>
        )}
      </div>

      {appt.status === 'pending' && appt.hold_expires_at && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', borderLeft: '4px solid #d97706' }}>
          The patient is paying online. If they don't finish by {new Date(appt.hold_expires_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, the booking is cancelled and the slot is released.
        </div>
      )}

      {appt.patient_review_reason && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', borderLeft: '4px solid var(--ps-error)' }}>
          <strong>Check the patient record.</strong> {appt.patient_review_reason}
        </div>
      )}

      <div className="ps-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-lg)' }}>
        {/* Patient info */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            👤 Patient
          </h3>
          {appt.patient ? (
            <div style={{ fontSize: 'var(--ps-font-sm)' }}>
              <div style={{ marginBottom: 'var(--ps-space-xs)' }}>
                <strong>{appt.patient.first_name} {appt.patient.last_name}</strong>
              </div>
              {appt.patient.phone && <div style={{ color: 'var(--ps-slate)' }}>📞 {appt.patient.phone}</div>}
              {appt.patient.email && <div style={{ color: 'var(--ps-slate)' }}>✉️ {appt.patient.email}</div>}
              {appt.patient.nhs_number && <div style={{ color: 'var(--ps-slate)' }}>NHS: {appt.patient.nhs_number}</div>}
              <button
                className="ps-btn ps-btn-ghost ps-btn-sm"
                style={{ marginTop: 'var(--ps-space-sm)' }}
                onClick={() => navigate(`/patients/${appt.patient_id}`)}
              >
                View Patient Profile →
              </button>
            </div>
          ) : (
            <p style={{ color: 'var(--ps-slate)' }}>No patient info</p>
          )}
        </div>

        {/* Appointment info */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            📅 Details
          </h3>
          <div style={{ fontSize: 'var(--ps-font-sm)', display: 'grid', gridTemplateColumns: '100px 1fr', gap: 'var(--ps-space-xs)' }}>
            <strong>Service:</strong>
            <span>{appt.service?.name || 'General (no service)'}</span>

            {appt.service?.duration_minutes && (
              <>
                <strong>Duration:</strong>
                <span>{appt.service.duration_minutes} min</span>
              </>
            )}

            <strong>Date:</strong>
            <span>{startTime ? startTime.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Not scheduled'}</span>

            <strong>Time:</strong>
            <span>
              {startTime ? startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
              {endTime ? ` – ${endTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>

            <strong>Booked by:</strong>
            <span>{appt.booked_by_user_id ? 'Staff' : 'Self-booked'}</span>

            <strong>Created:</strong>
            <span>{new Date(appt.created_at).toLocaleString('en-GB')}</span>
          </div>
        </div>
      </div>

      {/* Form data */}
      {appt.form_data && Object.keys(appt.form_data).length > 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-lg)' }}>
          <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
            📝 Form Responses
          </h3>
          <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', padding: 'var(--ps-space-md)' }}>
            {Object.entries(appt.form_data).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--ps-space-xs) 0', borderBottom: '1px solid var(--ps-white)', fontSize: 'var(--ps-font-sm)' }}>
                <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--ps-slate)' }}>{typeof val === 'boolean' ? (val ? 'Yes' : 'No') : Array.isArray(val) ? val.join(', ') : String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-md)' }}>
          <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>📝 Notes</h3>
          {!editingNotes && (
            <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setEditingNotes(true)}>Edit</button>
          )}
        </div>
        {editingNotes ? (
          <div>
            <textarea
              className="ps-input"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={4}
              placeholder="Add notes about this appointment…"
            />
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
              <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => { setEditingNotes(false); setNotesValue(appt.notes || '') }}>Cancel</button>
              <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleSaveNotes} disabled={savingNotes}>
                {savingNotes ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: appt.notes ? 'var(--ps-midnight)' : 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            {appt.notes || 'No notes yet.'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-lg)' }}>
        <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
          ⚡ Actions
        </h3>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
          {appt.status === 'pending' && (
            <button className="ps-btn ps-btn-primary" onClick={() => staffSetStatus('confirmed')} disabled={busy}>
              ✓ Confirm and text patient
            </button>
          )}
          {(appt.status === 'pending' || appt.status === 'confirmed') && (
            <button className="ps-btn ps-btn-success" onClick={() => handleStatusChange('completed')}>
              ✓ Complete
            </button>
          )}
          {(appt.status === 'pending' || appt.status === 'confirmed') && (
            <button
              className="ps-btn ps-btn-secondary"
              style={{ color: 'var(--ps-error)' }}
              onClick={() => handleStatusChange('no_show')}
            >
              ⚠ No Show
            </button>
          )}
          {appt.status !== 'cancelled' && appt.status !== 'completed' && (
            <button
              className="ps-btn ps-btn-ghost"
              style={{ color: 'var(--ps-error)' }}
              onClick={() => setShowCancelModal(true)}
            >
              ✕ Cancel Appointment
            </button>
          )}
          {(appt.status === 'pending' || appt.status === 'confirmed') && !appt.hold_expires_at && (
            <button className="ps-btn ps-btn-secondary" onClick={openMove} disabled={busy}>↔ Move</button>
          )}
          {video && (
            <button className="ps-btn ps-btn-primary" onClick={() => navigate(`/video/${video.id}`)}>🎥 Open video call</button>
          )}
          {!video && appt.service?.is_video && (appt.status === 'pending' || appt.status === 'confirmed') && (
            <button className="ps-btn ps-btn-secondary" onClick={setUpVideo} disabled={busy}>🎥 Set up video call</button>
          )}
          {appt.manage_token && (appt.status === 'pending' || appt.status === 'confirmed') && (
            <button className="ps-btn ps-btn-ghost" onClick={copyManageLink} title="A link the patient can use to view or cancel this booking">
              {copied ? 'Link copied' : '🔗 Copy patient link'}
            </button>
          )}
        </div>
      </div>

      <Modal isOpen={!!moveSlots} onClose={() => setMoveSlots(null)} title="Move appointment" width="460px">
        <div>
          {moveSlots && moveSlots.length === 0 ? (
            <p>There are no free slots for this service in the next 90 days. Add slots first.</p>
          ) : (
            <div className="form-group">
              <label>New time</label>
              <select className="ps-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Choose a slot…</option>
                {(moveSlots ?? []).map((sl) => (
                  <option key={sl.id} value={sl.id}>
                    {new Date(sl.start_time).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>The patient is texted the new time.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setMoveSlots(null)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={doMove} disabled={busy || !moveTo}>Move</button>
          </div>
        </div>
      </Modal>

      {/* Cancel confirmation modal */}
      <Modal isOpen={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel Appointment" width="420px">
        <div>
          <p style={{ marginBottom: 'var(--ps-space-lg)' }}>
            Are you sure you want to cancel this appointment? This frees up the time slot and texts the patient.
          </p>
          {paidPence > 0 && (
            <label style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginBottom: 'var(--ps-space-lg)' }}>
              <input type="checkbox" checked={refundOnCancel} onChange={(e) => setRefundOnCancel(e.target.checked)} />
              Refund the £{(paidPence / 100).toFixed(2)} they paid
            </label>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowCancelModal(false)}>Keep Appointment</button>
            <button
              className="ps-btn ps-btn-primary"
              style={{ background: 'var(--ps-error)' }}
              disabled={busy}
              onClick={() => {
                staffSetStatus('cancelled')
                setShowCancelModal(false)
              }}
            >
              Cancel Appointment
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
