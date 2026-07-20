import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import type { Appointment, AppointmentStatus, Service } from '@pharmstation/types'

type StatusFilter = 'all' | 'active' | AppointmentStatus

const STATUS_META: Record<AppointmentStatus, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pending', bg: '#fef3c7', text: '#92400e' },
  confirmed: { label: 'Confirmed', bg: '#dbeafe', text: '#1e40af' },
  completed: { label: 'Completed', bg: '#e5e7eb', text: '#374151' },
  cancelled: { label: 'Cancelled', bg: '#fee2e2', text: '#991b1b' },
  no_show: { label: 'No Show', bg: '#ffedd5', text: '#9a3412' },
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function parseDateBound(value: string, end = false) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return end
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatTimeRange(startIso: string, endIso?: string | null) {
  const start = new Date(startIso)
  const startText = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (!endIso) return startText
  const end = new Date(endIso)
  const endText = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${startText} - ${endText}`
}

function getAppointmentMoment(appointment: Appointment) {
  return appointment.slot?.start_time || appointment.created_at
}

export function AppointmentsListPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    appointments,
    loading,
    error,
    fetchAppointments,
    clearError,
  } = useAppointmentStore()
  const { services, fetchServices } = useServiceStore()

  const today = useMemo(() => startOfDay(new Date()), [])
  const [filterFromDate, setFilterFromDate] = useState(() => toDateInputValue(today))
  const [filterToDate, setFilterToDate] = useState(() => toDateInputValue(today))
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('active')
  const [filterService, setFilterService] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchAppointments(organisation.id)
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchAppointments, fetchServices])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    document.body.setAttribute('data-print-mode', 'appointments-list')
    return () => {
      document.body.removeAttribute('data-print-mode')
    }
  }, [])

  const serviceMap = useMemo(() => new Map(services.map((service) => [service.id, service.name])), [services])

  const filteredAppointments = useMemo(() => {
    const fromDate = parseDateBound(filterFromDate)
    const toDate = parseDateBound(filterToDate, true)
    const loweredSearch = searchTerm.trim().toLowerCase()

    return [...appointments]
      .filter((appointment) => {
        if (filterService && appointment.service_id !== filterService) return false

        if (filterStatus === 'active') {
          if (appointment.status !== 'pending' && appointment.status !== 'confirmed') return false
        } else if (filterStatus !== 'all' && appointment.status !== filterStatus) {
          return false
        }

        const moment = new Date(getAppointmentMoment(appointment))
        if (fromDate && moment < fromDate) return false
        if (toDate && moment > toDate) return false

        if (!loweredSearch) return true

        const patientName = appointment.patient
          ? `${appointment.patient.first_name} ${appointment.patient.last_name}`.toLowerCase()
          : ''
        const serviceName = (appointment.service?.name || serviceMap.get(appointment.service_id || '') || '').toLowerCase()
        const notes = (appointment.notes || '').toLowerCase()
        const phone = (appointment.patient?.phone || '').toLowerCase()
        return [patientName, serviceName, notes, phone].some((value) => value.includes(loweredSearch))
      })
      .sort((left, right) => {
        return new Date(getAppointmentMoment(left)).getTime() - new Date(getAppointmentMoment(right)).getTime()
      })
  }, [appointments, filterFromDate, filterService, filterStatus, filterToDate, searchTerm, serviceMap])

  const printSummary = useMemo(() => {
    const serviceName = filterService
      ? services.find((service: Service) => service.id === filterService)?.name || 'Selected service'
      : 'All services'

    const statusLabel = filterStatus === 'active'
      ? 'Pending and confirmed'
      : filterStatus === 'all'
        ? 'All statuses'
        : STATUS_META[filterStatus].label

    const dateLabel = !filterFromDate && !filterToDate
      ? 'All dates'
      : filterFromDate === filterToDate && filterFromDate
        ? formatDate(`${filterFromDate}T12:00:00`)
        : `${filterFromDate ? formatDate(`${filterFromDate}T12:00:00`) : 'Any start'} to ${filterToDate ? formatDate(`${filterToDate}T12:00:00`) : 'Any end'}`

    return {
      serviceName,
      statusLabel,
      dateLabel,
      generatedAt: new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }
  }, [filterFromDate, filterService, filterStatus, filterToDate, services])

  const setTodayRange = () => {
    const date = startOfDay(new Date())
    const value = toDateInputValue(date)
    setFilterFromDate(value)
    setFilterToDate(value)
  }

  const setTomorrowRange = () => {
    const date = startOfDay(new Date())
    date.setDate(date.getDate() + 1)
    const value = toDateInputValue(date)
    setFilterFromDate(value)
    setFilterToDate(value)
  }

  const setThisWeekRange = () => {
    const start = startOfDay(new Date())
    const end = startOfDay(new Date())
    end.setDate(end.getDate() + 6)
    setFilterFromDate(toDateInputValue(start))
    setFilterToDate(toDateInputValue(end))
  }

  const clearDateRange = () => {
    setFilterFromDate('')
    setFilterToDate('')
  }

  return (
    <div className="appointments-list-page">
      <div className="page-header appointments-list-screen-only">
        <div className="breadcrumbs">
          <a href="/" onClick={(event) => { event.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Appointments</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>Appointments List</h1>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>Defaults to today&apos;s active bookings so the working list is useful straight away.</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments/calendar')}>
              Calendar
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => window.print()}>
              Print List
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/appointments/new')}>
              + New Appointment
            </button>
          </div>
        </div>
      </div>

      <div className="appointments-print-header">
        <div>
          <h1>Appointment List</h1>
          <p>Pharmacy working list</p>
        </div>
        <div>
          <strong>{filteredAppointments.length}</strong>
          <span>{filteredAppointments.length === 1 ? ' appointment' : ' appointments'}</span>
        </div>
      </div>

      {error && (
        <div className="auth-error appointments-list-screen-only" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="ps-card appointments-list-screen-only" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div className="appointments-list-quick-filters">
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={setTodayRange}>Today</button>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={setTomorrowRange}>Tomorrow</button>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={setThisWeekRange}>Next 7 Days</button>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearDateRange}>All Dates</button>
        </div>
        <div className="appointments-list-filters">
          <label>
            <span>From</span>
            <input
              className="ps-input"
              type="date"
              value={filterFromDate}
              onChange={(event) => setFilterFromDate(event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              className="ps-input"
              type="date"
              value={filterToDate}
              onChange={(event) => setFilterToDate(event.target.value)}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              className="ps-input"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value as StatusFilter)}
            >
              <option value="active">Pending and confirmed</option>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </select>
          </label>
          <label>
            <span>Service</span>
            <select
              className="ps-input"
              value={filterService}
              onChange={(event) => setFilterService(event.target.value)}
            >
              <option value="">All services</option>
              {services.map((service: Service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Search</span>
            <input
              className="ps-input"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Patient, notes, phone"
            />
          </label>
        </div>
      </div>

      <div className="appointments-print-summary">
        <div><strong>Date:</strong> {printSummary.dateLabel}</div>
        <div><strong>Status:</strong> {printSummary.statusLabel}</div>
        <div><strong>Service:</strong> {printSummary.serviceName}</div>
        <div><strong>Generated:</strong> {printSummary.generatedAt}</div>
      </div>

      {loading && appointments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>
          Loading appointments...
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <h2 style={{ marginBottom: 'var(--ps-space-sm)' }}>No appointments match these filters</h2>
          <p style={{ margin: 0, color: 'var(--ps-slate)' }}>Try widening the date range or switching the status filter to all statuses.</p>
        </div>
      ) : (
        <div className="ps-card appointments-list-table-wrap" style={{ overflow: 'auto' }}>
          <table className="appointments-list-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Patient</th>
                <th>Service</th>
                <th>Status</th>
                <th>Notes</th>
                <th className="appointments-list-screen-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAppointments.map((appointment) => {
                const patientName = appointment.patient
                  ? `${appointment.patient.first_name} ${appointment.patient.last_name}`
                  : 'Unknown patient'
                const serviceName = appointment.service?.name || serviceMap.get(appointment.service_id || '') || 'General'
                const startTime = getAppointmentMoment(appointment)
                const endTime = appointment.slot?.end_time
                const statusMeta = STATUS_META[appointment.status]

                return (
                  <tr key={appointment.id}>
                    <td>{formatDate(startTime)}</td>
                    <td>{formatTimeRange(startTime, endTime)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{patientName}</div>
                      {appointment.patient?.phone && (
                        <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-xs)' }}>{appointment.patient.phone}</div>
                      )}
                    </td>
                    <td>{serviceName}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          background: statusMeta.bg,
                          color: statusMeta.text,
                          fontSize: 'var(--ps-font-xs)',
                          fontWeight: 700,
                        }}
                      >
                        {statusMeta.label}
                      </span>
                    </td>
                    <td style={{ minWidth: 220 }}>{appointment.notes || '—'}</td>
                    <td className="appointments-list-screen-only">
                      <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate(`/appointments/${appointment.id}`)}>
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}