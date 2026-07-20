import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppointmentStore, useServiceStore } from '@pharmstation/core'
import type { Service } from '@pharmstation/types'

function formatDateTime(iso: string) {
  const date = new Date(iso)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AppointmentSlotsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { slots, loading, error, fetchSlots, clearError } = useAppointmentStore()
  const { services, fetchServices } = useServiceStore()

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchSlots(organisation.id)
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchSlots, fetchServices])

  useEffect(() => { load() }, [load])

  const visibleServices = useMemo(() => {
    return services.filter((service) => {
      if (service.is_active) return true
      return slots.some((slot) => slot.service_id === service.id)
    })
  }, [services, slots])

  const now = useMemo(() => new Date(), [])

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/appointments" onClick={(e) => { e.preventDefault(); navigate('/appointments') }}>Appointments</a>
          <span className="separator">/</span>
          <span>Slots</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>⏰ Appointment Slots</h1>
            <p style={{ margin: 0, color: 'var(--ps-slate)' }}>
              Pick a service first, then manage its slots on a focused page with date and recurrence controls.
            </p>
          </div>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/appointments')}>
            Back to Appointments
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {loading && visibleServices.length === 0 && (
        <div className="dashboard-grid">
          {[1, 2, 3].map((item) => (
            <div key={item} className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.55 }}>
              <div style={{ height: 22, width: '60%', borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', marginBottom: 'var(--ps-space-sm)' }} />
              <div style={{ height: 14, width: '85%', borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', marginBottom: 'var(--ps-space-sm)' }} />
              <div style={{ height: 14, width: '50%', borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && visibleServices.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>⏰</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No services ready for slots</h2>
          <p style={{ color: 'var(--ps-slate)', margin: '0 auto var(--ps-space-lg)', maxWidth: 440 }}>
            Create or activate a service first, then open it here to manage bookable slots without one long recurring list.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/services')}>
            Go to Services
          </button>
        </div>
      )}

      {visibleServices.length > 0 && (
        <div className="dashboard-grid">
          {visibleServices.map((service: Service) => {
            const serviceSlots = slots.filter((slot) => slot.service_id === service.id)
            const futureSlots = serviceSlots.filter((slot) => new Date(slot.start_time) >= now)
            const recurringCount = serviceSlots.filter((slot) => slot.is_recurring).length
            const nextSlot = futureSlots
              .slice()
              .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())[0]

            return (
              <div key={service.id} className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', color: 'var(--ps-midnight)' }}>{service.name}</h3>
                    <p style={{ margin: 0, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                      {service.duration_minutes} min appointments
                    </p>
                  </div>
                  {!service.is_active && <span className="ps-badge ps-badge-amber">Inactive</span>}
                </div>

                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap', marginBottom: 'var(--ps-space-md)' }}>
                  <span className="ps-badge ps-badge-blue">{futureSlots.length} upcoming</span>
                  <span className="ps-badge">{recurringCount} recurring</span>
                  <span className="ps-badge">{serviceSlots.length} total slots</span>
                </div>

                <p style={{ minHeight: 40, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: '0 0 var(--ps-space-md)' }}>
                  {nextSlot ? `Next slot: ${formatDateTime(nextSlot.start_time)}` : 'No upcoming slots yet for this service.'}
                </p>

                <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => navigate(`/appointments/slots/${service.id}`)}>
                  Manage Slots
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
