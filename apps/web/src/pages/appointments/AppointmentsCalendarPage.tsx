import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import type { Appointment, AppointmentStatus, Service } from '@pharmstation/types'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import type { EventClickArg, DateClickArg } from '@fullcalendar/core'

/* ---- Status colours ---- */

const STATUS_COLOURS: Record<AppointmentStatus, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  completed: '#6b7280',
  cancelled: '#ef4444',
  no_show: '#f97316',
}

export function AppointmentsCalendarPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    appointments,
    slots,
    loading,
    error,
    fetchAppointments,
    fetchSlots,
    clearError,
  } = useAppointmentStore()
  const { services, fetchServices } = useServiceStore()

  const [filterService, setFilterService] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchAppointments(organisation.id)
      fetchSlots(organisation.id)
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchAppointments, fetchSlots, fetchServices])

  useEffect(() => { load() }, [load])

  /* ---- Map appointments to FullCalendar events ---- */
  const calendarEvents = useMemo(() => {
    let filtered = appointments

    if (filterService) {
      filtered = filtered.filter((a) => a.service_id === filterService)
    }
    if (filterStatus) {
      filtered = filtered.filter((a) => a.status === filterStatus)
    }

    const appointmentEvents = filtered.map((appt) => {
      const patientName = appt.patient
        ? `${appt.patient.first_name} ${appt.patient.last_name}`
        : 'Unknown'
      const serviceName = appt.service?.name || 'General'
      return {
        id: appt.id,
        title: `${patientName} — ${serviceName}`,
        start: appt.slot?.start_time || appt.created_at,
        end: appt.slot?.end_time || undefined,
        backgroundColor: STATUS_COLOURS[appt.status as AppointmentStatus] || '#6b7280',
        borderColor: STATUS_COLOURS[appt.status as AppointmentStatus] || '#6b7280',
        textColor: '#ffffff',
        extendedProps: { type: 'appointment', appointment: appt },
      }
    })

    // Slot background events showing available capacity
    const slotEvents = slots
      .filter((s) => !filterService || s.service_id === filterService)
      .filter((s) => s.booked_count < s.max_bookings)
      .map((slot) => ({
        id: `slot-${slot.id}`,
        title: `${slot.max_bookings - slot.booked_count} available`,
        start: slot.start_time,
        end: slot.end_time,
        display: 'background' as const,
        backgroundColor: 'rgba(4,176,255,0.12)',
        extendedProps: { type: 'slot', slot },
      }))

    return [...appointmentEvents, ...slotEvents]
  }, [appointments, slots, filterService, filterStatus])

  const handleEventClick = (info: EventClickArg) => {
    const props = info.event.extendedProps
    if (props.type === 'appointment') {
      navigate(`/appointments/${props.appointment.id}`)
    }
  }

  const handleDateClick = (_info: DateClickArg) => {
    navigate('/appointments/new')
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Appointments</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📅 Appointments</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments/slots')}>
              ⏰ Manage Slots
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/appointments/new')}>
              + New Appointment
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
        <select
          className="ps-input"
          style={{ width: 'auto', minWidth: 180 }}
          value={filterService}
          onChange={(e) => setFilterService(e.target.value)}
        >
          <option value="">All Services</option>
          {services.map((s: Service) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          className="ps-input"
          style={{ width: 'auto', minWidth: 160 }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No Show</option>
        </select>
      </div>

      {/* Loading */}
      {loading && appointments.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>
          Loading appointments…
        </div>
      )}

      {/* Calendar */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)' }}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          events={calendarEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          editable={false}
          selectable={true}
          nowIndicator={true}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          height="auto"
          eventDisplay="block"
        />
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 'var(--ps-space-md)',
        marginTop: 'var(--ps-space-md)',
        flexWrap: 'wrap',
        fontSize: 'var(--ps-font-sm)',
        color: 'var(--ps-slate)',
      }}>
        {(Object.entries(STATUS_COLOURS) as [AppointmentStatus, string][]).map(([status, colour]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: colour }} />
            <span style={{ textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(4,176,255,0.3)' }} />
          <span>Available slot</span>
        </div>
      </div>
    </div>
  )
}
