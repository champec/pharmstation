import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppointmentStore } from '@pharmstation/core'
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

  const handleStatusChange = async (newStatus: AppointmentStatus) => {
    if (!id) return
    try {
      await updateStatus(id, newStatus)
      fetchAppointmentDetail(id)
    } catch (e: any) {
      alert(e.message)
    }
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
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>Back to Calendar</button>
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
          {statusInfo.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-lg)' }}>
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
            <button className="ps-btn ps-btn-primary" onClick={() => handleStatusChange('confirmed')}>
              ✓ Confirm
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
        </div>
      </div>

      {/* Cancel confirmation modal */}
      <Modal isOpen={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel Appointment" width="420px">
        <div>
          <p style={{ marginBottom: 'var(--ps-space-lg)' }}>
            Are you sure you want to cancel this appointment? This action will free up the time slot.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowCancelModal(false)}>Keep Appointment</button>
            <button
              className="ps-btn ps-btn-primary"
              style={{ background: 'var(--ps-error)' }}
              onClick={() => {
                handleStatusChange('cancelled')
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
