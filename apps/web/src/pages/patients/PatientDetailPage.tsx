import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Appointment, AppointmentStatus } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const STATUS_BADGE: Record<AppointmentStatus, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-amber', label: 'Pending' },
  confirmed: { cls: 'ps-badge-blue', label: 'Confirmed' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
  no_show: { cls: 'ps-badge-amber', label: 'No Show' },
}

export function PatientDetailPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    activePatient: patient,
    loading,
    error,
    fetchPatientDetail,
    updatePatient,
    clearError,
  } = useAppointmentStore()

  const [patientAppointments, setPatientAppointments] = useState<Appointment[]>([])
  const [apptLoading, setApptLoading] = useState(false)
  const [tab, setTab] = useState<'appointments' | 'messages' | 'video'>('appointments')

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [editDob, setEditDob] = useState('')
  const [editNhs, setEditNhs] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddr1, setEditAddr1] = useState('')
  const [editAddr2, setEditAddr2] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editPostcode, setEditPostcode] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (patientId) fetchPatientDetail(patientId)
  }, [patientId, fetchPatientDetail])

  useEffect(() => { load() }, [load])

  // Load patient appointments
  useEffect(() => {
    if (!patientId || !organisation?.id) return
    setApptLoading(true)
    getUserClient()
      .from('ps_appointments')
      .select(`
        *,
        service:ps_services(id, name, duration_minutes),
        slot:ps_appointment_slots(id, start_time, end_time)
      `)
      .eq('patient_id', patientId)
      .eq('org_id', organisation.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPatientAppointments((data as Appointment[]) || [])
        setApptLoading(false)
      })
  }, [patientId, organisation?.id])

  // Populate edit form
  useEffect(() => {
    if (patient) {
      setEditFirst(patient.first_name)
      setEditLast(patient.last_name)
      setEditDob(patient.dob || '')
      setEditNhs(patient.nhs_number || '')
      setEditEmail(patient.email || '')
      setEditPhone(patient.phone || '')
      setEditAddr1(patient.address_line_1 || '')
      setEditAddr2(patient.address_line_2 || '')
      setEditCity(patient.city || '')
      setEditPostcode(patient.postcode || '')
    }
  }, [patient])

  const handleSave = async () => {
    if (!patientId) return
    setSaving(true)
    try {
      await updatePatient(patientId, {
        first_name: editFirst.trim(),
        last_name: editLast.trim(),
        dob: editDob || null,
        nhs_number: editNhs.trim() || null,
        email: editEmail.trim() || null,
        phone: editPhone.trim() || null,
        address_line_1: editAddr1.trim() || null,
        address_line_2: editAddr2.trim() || null,
        city: editCity.trim() || null,
        postcode: editPostcode.trim() || null,
      })
      setShowEditModal(false)
      fetchPatientDetail(patientId)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  if (loading && !patient) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading patient…</div>
  }
  if (!patient) {
    return (
      <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
        <h2>Patient not found</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/patients')}>Back to Patients</button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/patients" onClick={(e) => { e.preventDefault(); navigate('/patients') }}>Patients</a>
          <span className="separator">/</span>
          <span>{patient.first_name} {patient.last_name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>👤 {patient.first_name} {patient.last_name}</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowEditModal(true)}>✏️ Edit</button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/patients')}>← Back</button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Profile card */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-lg)' }}>
          <div style={{ fontSize: 'var(--ps-font-sm)', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--ps-space-xs)' }}>
            <strong>DOB:</strong> <span>{patient.dob ? new Date(patient.dob).toLocaleDateString('en-GB') : '—'}</span>
            <strong>NHS Number:</strong> <span>{patient.nhs_number || '—'}</span>
            <strong>Phone:</strong> <span>{patient.phone || '—'}</span>
            <strong>Email:</strong> <span>{patient.email || '—'}</span>
          </div>
          <div style={{ fontSize: 'var(--ps-font-sm)', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--ps-space-xs)' }}>
            <strong>Address:</strong> <span>{patient.address_line_1 || '—'}</span>
            {patient.address_line_2 && <><strong></strong> <span>{patient.address_line_2}</span></>}
            <strong>City:</strong> <span>{patient.city || '—'}</span>
            <strong>Postcode:</strong> <span>{patient.postcode || '—'}</span>
          </div>
        </div>
        <div style={{ marginTop: 'var(--ps-space-md)', display: 'flex', gap: 'var(--ps-space-sm)' }}>
          {patient.auth_user_id ? (
            <span className="ps-badge ps-badge-green">✓ Patient has an account</span>
          ) : (
            <span className="ps-badge">No patient account linked</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', borderBottom: '2px solid var(--ps-off-white)' }}>
        {(['appointments', 'messages', 'video'] as const).map((t) => (
          <button
            key={t}
            className="ps-btn ps-btn-ghost"
            style={{
              fontWeight: tab === t ? 700 : 400,
              borderBottom: tab === t ? '2px solid var(--ps-deep-blue)' : '2px solid transparent',
              borderRadius: 0,
              paddingBottom: 'var(--ps-space-sm)',
              textTransform: 'capitalize',
            }}
            onClick={() => setTab(t)}
          >
            {t === 'appointments' ? '📅 Appointments' : t === 'messages' ? '💬 Messages' : '📹 Video Consults'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'appointments' && (
        <div>
          {apptLoading && <p style={{ color: 'var(--ps-slate)' }}>Loading appointments…</p>}
          {!apptLoading && patientAppointments.length === 0 && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)' }}>
              No appointments for this patient.
            </div>
          )}
          {patientAppointments.length > 0 && (
            <div className="ps-card" style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ps-font-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--ps-off-white)' }}>
                    <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Date/Time</th>
                    <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'left', color: 'var(--ps-slate)' }}>Service</th>
                    <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center', color: 'var(--ps-slate)' }}>Status</th>
                    <th style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right', color: 'var(--ps-slate)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {patientAppointments.map((appt) => {
                    const si = STATUS_BADGE[appt.status as AppointmentStatus] || STATUS_BADGE.pending
                    const startTime = appt.slot?.start_time ? new Date(appt.slot.start_time) : null
                    return (
                      <tr key={appt.id} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                          {startTime ? startTime.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date(appt.created_at).toLocaleString('en-GB')}
                        </td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>{appt.service?.name || 'General'}</td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'center' }}>
                          <span className={`ps-badge ${si.cls}`}>{si.label}</span>
                        </td>
                        <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => navigate(`/appointments/${appt.id}`)}>View</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'messages' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          💬 Message history coming soon.
        </div>
      )}

      {tab === 'video' && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          📹 Video consultation history coming soon.
        </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Patient" width="640px">
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>First Name *</label>
              <input className="ps-input" value={editFirst} onChange={(e) => setEditFirst(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input className="ps-input" value={editLast} onChange={(e) => setEditLast(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date of Birth</label>
              <input className="ps-input" type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} />
            </div>
            <div className="form-group">
              <label>NHS Number</label>
              <input className="ps-input" value={editNhs} onChange={(e) => setEditNhs(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="ps-input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input className="ps-input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Address Line 1</label>
            <input className="ps-input" value={editAddr1} onChange={(e) => setEditAddr1(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Address Line 2</label>
            <input className="ps-input" value={editAddr2} onChange={(e) => setEditAddr2(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>City</label>
              <input className="ps-input" value={editCity} onChange={(e) => setEditCity(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Postcode</label>
              <input className="ps-input" value={editPostcode} onChange={(e) => setEditPostcode(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowEditModal(false)} disabled={saving}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving || !editFirst.trim() || !editLast.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
