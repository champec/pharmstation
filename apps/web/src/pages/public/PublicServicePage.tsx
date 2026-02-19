import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service, AppointmentSlot } from '@pharmstation/types'

export function PublicServicePage() {
  const { orgSlug, serviceId } = useParams<{ orgSlug: string; serviceId: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [service, setService] = useState<Service | null>(null)
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)

  useEffect(() => {
    if (!orgSlug || !serviceId) return
    setLoading(true)
    getUserClient()
      .from('ps_organisations')
      .select('*')
      .eq('is_public', true)
      .or(`slug.eq.${orgSlug},id.eq.${orgSlug}`)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!data) { setError('Pharmacy not found.'); setLoading(false); return }
        setOrg(data as Organisation)
        return getUserClient()
          .from('ps_services')
          .select('*')
          .eq('id', serviceId)
          .eq('is_public', true)
          .eq('is_active', true)
          .single()
      })
      .then((res) => {
        if (!res || !res.data) { setError('Service not found or not available for public booking.'); setLoading(false); return }
        setService(res.data as Service)
        return getUserClient()
          .from('ps_appointment_slots')
          .select('id, start_time, end_time, max_bookings, booked_count')
          .eq('service_id', serviceId)
          .eq('is_active', true)
          .gt('start_time', new Date().toISOString())
          .order('start_time')
      })
      .then((res) => {
        if (res?.data) setSlots(res.data as AppointmentSlot[])
        setLoading(false)
      })
  }, [orgSlug, serviceId])

  const dateSlots = useMemo(() => {
    return slots.filter((s) => {
      const slotDate = new Date(s.start_time).toISOString().slice(0, 10)
      return slotDate === selectedDate && s.booked_count < s.max_bookings
    })
  }, [slots, selectedDate])

  // Available dates for the date picker hint
  const availableDates = useMemo(() => {
    const dates = new Set<string>()
    slots.forEach((s) => {
      if (s.booked_count < s.max_bookings) {
        dates.add(new Date(s.start_time).toISOString().slice(0, 10))
      }
    })
    return dates
  }, [slots])

  if (loading) {
    return <div style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
  }

  if (error) {
    return (
      <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center' }}>
        <h2>{error}</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/book/${orgSlug}`)}>← Back</button>
      </div>
    )
  }

  const slug = orgSlug || ''

  return (
    <div style={{ maxWidth: '700px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <button className="ps-btn ps-btn-ghost" onClick={() => navigate(`/book/${slug}`)} style={{ marginBottom: 'var(--ps-space-md)' }}>← Back to {org?.name || 'Pharmacy'}</button>

      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-xl)' }}>
        <h2 style={{ margin: '0 0 4px' }}>{service?.name}</h2>
        <p style={{ color: 'var(--ps-slate)', margin: 0 }}>{service?.description}</p>
        <p style={{ color: 'var(--ps-slate)', margin: '4px 0 0', fontSize: 'var(--ps-font-sm)' }}>⏱️ {service?.duration_minutes} minutes</p>
      </div>

      <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>1. Select a date</h3>
      <input
        className="ps-input"
        type="date"
        value={selectedDate}
        min={new Date().toISOString().slice(0, 10)}
        onChange={(e) => { setSelectedDate(e.target.value); setSelectedSlot(null) }}
        style={{ marginBottom: 'var(--ps-space-md)', width: '220px' }}
      />
      {availableDates.size > 0 && (
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-md)' }}>
          {availableDates.size} date{availableDates.size !== 1 ? 's' : ''} with availability
        </p>
      )}

      <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>2. Choose a time slot</h3>
      {dateSlots.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          No available slots on this date. Please select another date.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-xl)' }}>
          {dateSlots.map((slot) => {
            const start = new Date(slot.start_time)
            const end = new Date(slot.end_time)
            const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            const isSelected = selectedSlot === slot.id
            return (
              <button
                key={slot.id}
                className={`ps-btn ${isSelected ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                onClick={() => setSelectedSlot(slot.id)}
                style={{ textAlign: 'center' }}
              >
                {fmt(start)} – {fmt(end)}
                <br />
                <span style={{ fontSize: 'var(--ps-font-xs)' }}>{slot.max_bookings - slot.booked_count} left</span>
              </button>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/book/${slug}`)}>Cancel</button>
        <button
          className="ps-btn ps-btn-primary"
          disabled={!selectedSlot}
          onClick={() => navigate(`/book/${slug}/${serviceId}/confirm`, { state: { slotId: selectedSlot } })}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}
