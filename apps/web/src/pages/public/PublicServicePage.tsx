import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service, AppointmentSlot } from '@pharmstation/types'
import { orgSlugOrIdFilter } from '../../lib/orgSlugFilter'
import { PublicFooter } from '../../components/public/PublicFooter'

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
      .or(orgSlugOrIdFilter(orgSlug))
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
    return <div className="booking-public"><div className="booking-loading booking-page-state"><i /><span>Loading appointments…</span></div></div>
  }

  if (error) {
    return (
      <div className="booking-public"><div className="booking-empty booking-page-state"><strong>{error}</strong><p>Return to the pharmacy and choose another service.</p><button type="button" onClick={() => navigate(`/book/${orgSlug}`)}>Back to services</button></div></div>
    )
  }

  const slug = orgSlug || ''

  return (
    <div className="booking-public">
      <header className="booking-nav"><button type="button" className="booking-wordmark" onClick={() => navigate('/book')}>Pharm<span>Station</span><small>Book</small></button><nav><a href="/shop">Shop</a><a href="/maps">Find a pharmacy</a><a href="/patient/login">Sign in</a></nav></header>
      <main className="booking-appointment-main">
        <button type="button" className="booking-back" onClick={() => navigate(`/book/${slug}`)}>← Services at {org?.name || 'pharmacy'}</button>
        <section className="booking-appointment-layout">
          <aside className="booking-service-summary"><span className="booking-eyebrow">Your selection</span><h1>{service?.name}</h1><p>{service?.description}</p><dl><div><dt>Pharmacy</dt><dd>{org?.name}</dd></div><div><dt>Duration</dt><dd>{service?.duration_minutes} minutes</dd></div>{service?.is_chargeable && service.price_pence != null && service.price_pence > 0 && <div><dt>Price</dt><dd>£{(service.price_pence / 100).toFixed(2)} · paid online</dd></div>}</dl></aside>
          <section className="booking-slot-picker">
            <header><span className="booking-eyebrow">Step 2 of 3</span><h2>Choose your appointment</h2><p>Select a date, then choose one of the available times.</p></header>
            <div className="booking-date-field"><label htmlFor="booking-date">Appointment date</label><input id="booking-date" type="date" value={selectedDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => { setSelectedDate(event.target.value); setSelectedSlot(null) }} /><small>{availableDates.size > 0 ? `${availableDates.size} date${availableDates.size === 1 ? '' : 's'} currently have availability` : 'No future availability is listed yet'}</small></div>
            <div className="booking-time-heading"><strong>Available times</strong><span>{dateSlots.length} {dateSlots.length === 1 ? 'time' : 'times'}</span></div>
            {dateSlots.length === 0 ? <div className="booking-slot-empty"><strong>No times on this date</strong><p>Try another date to see the pharmacy's available appointments.</p></div> : <div className="booking-slot-grid">{dateSlots.map((slot) => {
            const start = new Date(slot.start_time)
            const end = new Date(slot.end_time)
            const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            const isSelected = selectedSlot === slot.id
            return (
              <button type="button" key={slot.id} className={isSelected ? 'selected' : ''} onClick={() => setSelectedSlot(slot.id)}><strong>{fmt(start)}</strong><span>to {fmt(end)}</span><small>{slot.max_bookings - slot.booked_count} remaining</small></button>
            )
          })}</div>}
            <footer><button type="button" className="booking-secondary-action" onClick={() => navigate(`/book/${slug}`)}>Cancel</button><button type="button" className="booking-primary-action" disabled={!selectedSlot} onClick={() => navigate(`/book/${slug}/${serviceId}/confirm`, { state: { slotId: selectedSlot } })}>Continue to your details →</button></footer>
          </section>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
