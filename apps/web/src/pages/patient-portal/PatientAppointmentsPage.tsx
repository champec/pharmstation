import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatientStore } from '@pharmstation/core'
import { getPatientClient } from '@pharmstation/supabase-client'
import type { Appointment, AppointmentStatus } from '@pharmstation/types'

const STATUS_BADGE: Record<AppointmentStatus, { cls: string; label: string }> = {
  pending: { cls: 'ps-badge-amber', label: 'Pending' },
  confirmed: { cls: 'ps-badge-blue', label: 'Confirmed' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
  no_show: { cls: 'ps-badge-amber', label: 'No Show' },
}

export function PatientAppointmentsPage() {
  const navigate = useNavigate()
  const { patient, isLoggedIn, loading: authLoading } = usePatientStore()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isLoggedIn || !patient) {
      navigate('/patient/login')
      return
    }
    setLoading(true)
    getPatientClient()
      .from('ps_appointments')
      .select(`
        *,
        service:ps_services(id, name, duration_minutes),
        slot:ps_appointment_slots(id, start_time, end_time)
      `)
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setAppointments((data as Appointment[]) || [])
        setLoading(false)
      })
  }, [patient, isLoggedIn, authLoading, navigate])

  const handleCancel = async (apptId: string) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return
    setCancelling(apptId)
    try {
      await getPatientClient()
        .from('ps_appointments')
        .update({ status: 'cancelled' })
        .eq('id', apptId)
      setAppointments((prev) =>
        prev.map((a) => (a.id === apptId ? { ...a, status: 'cancelled' as AppointmentStatus } : a))
      )
    } catch (e: any) {
      alert(e.message || 'Failed to cancel appointment.')
    }
    setCancelling(null)
  }

  const now = new Date()
  const upcoming = appointments.filter((a) => {
    if (a.status === 'cancelled' || a.status === 'completed' || a.status === 'no_show') return false
    const slotTime = a.slot?.start_time ? new Date(a.slot.start_time) : null
    return !slotTime || slotTime >= now
  })
  const past = appointments.filter((a) => !upcoming.includes(a))
  const displayed = tab === 'upcoming' ? upcoming : past

  if (authLoading) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
  }

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-lg)' }}>
        <h1>📅 My Appointments</h1>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate('/patient/profile')}>👤 Profile</button>
          <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => navigate('/book')}>Book New</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)', borderBottom: '2px solid var(--ps-off-white)' }}>
        {(['upcoming', 'past'] as const).map((t) => (
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
            {t === 'upcoming' ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
          </button>
        ))}
      </div>

      {loading && <p style={{ textAlign: 'center', color: 'var(--ps-slate)' }}>Loading appointments…</p>}

      {!loading && displayed.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          {tab === 'upcoming' ? 'No upcoming appointments.' : 'No past appointments.'}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
        {displayed.map((appt) => {
          const si = STATUS_BADGE[appt.status as AppointmentStatus] || STATUS_BADGE.pending
          const startTime = appt.slot?.start_time ? new Date(appt.slot.start_time) : null
          const canCancel = tab === 'upcoming' && appt.status !== 'cancelled'
          return (
            <div key={appt.id} className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px' }}>{appt.service?.name || 'General Appointment'}</h3>
                  <p style={{ color: 'var(--ps-slate)', margin: '0 0 4px', fontSize: 'var(--ps-font-sm)' }}>
                    {startTime
                      ? startTime.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'Time not set'}
                  </p>
                  {appt.notes && <p style={{ color: 'var(--ps-slate)', margin: '4px 0 0', fontSize: 'var(--ps-font-sm)' }}>Notes: {appt.notes}</p>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                  <span className={`ps-badge ${si.cls}`}>{si.label}</span>
                  {canCancel && (
                    <button
                      className="ps-btn ps-btn-ghost ps-btn-sm"
                      style={{ color: 'var(--ps-red)' }}
                      onClick={() => handleCancel(appt.id)}
                      disabled={cancelling === appt.id}
                    >
                      {cancelling === appt.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
