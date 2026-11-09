import { BookingNavAccount } from '../../components/public/BookingNavAccount'
import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service, AppointmentSlot } from '@pharmstation/types'
import { orgSlugOrIdFilter } from '../../lib/orgSlugFilter'
import { PublicFooter } from '../../components/public/PublicFooter'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { findBySlug, parseEwkbPoint, slugMap } from '../../lib/publicDirectory'
import { usePageMeta, useStructuredData } from '../../seo/RouteMeta'
import { serviceJsonLd } from '../../seo/structuredData'

// Anonymous visitors may only read these columns (column grants on ps_organisations).
const PUBLIC_ORG_COLUMNS = 'id, name, slug, address, geolocation, gphc_premises_number, public_description, public_logo_url, is_public, is_active, organisation_type'

/** YYYY-MM-DD in the visitor's own time zone (UTC would show the wrong day around midnight in BST). */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PublicServicePage() {
  const { orgSlug, serviceId } = useParams<{ orgSlug: string; serviceId: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [service, setService] = useState<Service | null>(null)
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState(localDay(new Date()))
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [serviceSlug, setServiceSlug] = useState<string | null>(null)
  const orgSegment = (org as any)?.slug || org?.id || orgSlug || ''
  const town = org?.address?.city || org?.address?.postcode || ''
  const servicePath = `/book/${orgSegment}/${serviceSlug || serviceId}`
  usePageMeta(org && service ? {
    title: `${service.name}${town ? ` in ${town}` : ''} at ${org.name}`,
    description: `${service.description ? `${service.description.replace(/\s+/g, ' ').slice(0, 150)} ` : ''}Book ${service.name} at ${org.name}${town ? `, ${town}` : ''}. ${service.duration_minutes} minutes${service.is_chargeable && service.price_pence ? `, £${(service.price_pence / 100).toFixed(2)}` : ''}. Choose a time and book online.`,
    image: (org as any).public_logo_url,
    canonicalPath: servicePath,
  } : null)
  useStructuredData(org && service ? serviceJsonLd({
    name: service.name,
    description: service.description,
    path: servicePath,
    price_pence: service.is_chargeable ? service.price_pence : null,
    isVideo: service.is_video,
    pharmacy: {
      name: org.name,
      slug: orgSegment,
      address: org.address as any,
      description: (org as any).public_description,
      logo: (org as any).public_logo_url,
      point: parseEwkbPoint((org as any).geolocation),
      gphc: (org as any).gphc_premises_number,
    },
  }) : null)

  useEffect(() => {
    if (!orgSlug || !serviceId) return
    setLoading(true)
    getUserClient()
      .from('ps_organisations')
      .select(PUBLIC_ORG_COLUMNS)
      .eq('is_public', true)
      .or(orgSlugOrIdFilter(orgSlug))
      .limit(1)
      .single()
      .then(async ({ data }) => {
        if (!data) { setError('Pharmacy not found.'); setLoading(false); return }
        const o = data as unknown as Organisation
        setOrg(o)
        // The URL holds a readable slug (or an id from older links): find the service among the pharmacy's.
        const { data: list } = await getUserClient()
          .from('ps_services')
          .select('*')
          .eq('org_id', o.id)
          .eq('is_public', true)
          .eq('is_active', true)
          .is('archived_at', null)
        const all = (list as Service[]) || []
        const slugs = slugMap(all)
        const found = findBySlug(all, slugs, serviceId)
        if (!found) { setError('Service not found or not available for public booking.'); setLoading(false); return }
        setService(found)
        setServiceSlug(slugs.get(found.id) || found.id)
        return getUserClient()
          .from('ps_appointment_slots')
          .select('id, start_time, end_time, max_bookings, booked_count')
          .eq('service_id', found.id)
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
      const slotDate = localDay(new Date(s.start_time))
      return slotDate === selectedDate && s.booked_count < s.max_bookings
    })
  }, [slots, selectedDate])

  // Dates that still have a free place, in order. The picker shows only these.
  const availableDates = useMemo(() => {
    const dates = new Set<string>()
    slots.forEach((s) => {
      if (s.booked_count < s.max_bookings) {
        dates.add(localDay(new Date(s.start_time)))
      }
    })
    return Array.from(dates).sort()
  }, [slots])

  // Open on the first date that has times, not today (which is often empty).
  useEffect(() => {
    if (availableDates.length && !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0])
      setSelectedSlot(null)
    }
  }, [availableDates]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <AudienceSwitch active="patients" />
      <header className="booking-nav"><Link to="/pharmacies" className="booking-wordmark">Pharm<span>Station</span><small>Book</small></Link><nav><Link to="/shop">Shop</Link><Link to="/book">All pharmacies</Link><BookingNavAccount /></nav></header>
      <main className="booking-appointment-main">
        <button type="button" className="booking-back" onClick={() => navigate(`/book/${slug}`)}>← Services at {org?.name || 'pharmacy'}</button>
        <section className="booking-appointment-layout">
          <aside className="booking-service-summary"><span className="booking-eyebrow">Your selection</span><h1>{service?.name}</h1><p>{service?.description}</p><dl><div><dt>Pharmacy</dt><dd>{org?.name}</dd></div><div><dt>Duration</dt><dd>{service?.duration_minutes} minutes</dd></div>{service?.is_chargeable && service.price_pence != null && service.price_pence > 0 && <div><dt>Price</dt><dd>£{(service.price_pence / 100).toFixed(2)} · paid online</dd></div>}</dl></aside>
          <section className="booking-slot-picker">
            <header><span className="booking-eyebrow">Step 2 of 3</span><h2>Choose your appointment</h2><p>Only dates with free times are shown. Choose a date, then a time.</p></header>
            <div className="booking-date-field booking-date-strip">
              <span className="booking-date-label" id="booking-date-label">Appointment date</span>
              {availableDates.length === 0 ? (
                <small>No times are available to book online yet. Please contact the pharmacy.</small>
              ) : (
                <div className="booking-date-chips" role="radiogroup" aria-labelledby="booking-date-label">
                  {availableDates.map((d) => {
                    const date = new Date(`${d}T12:00:00`)
                    const on = d === selectedDate
                    return (
                      <button type="button" key={d} role="radio" aria-checked={on} className={on ? 'selected' : ''}
                        onClick={() => { setSelectedDate(d); setSelectedSlot(null) }}>
                        <span>{date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                        <strong>{date.getDate()}</strong>
                        <span>{date.toLocaleDateString('en-GB', { month: 'short' })}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="booking-time-heading"><strong>Available times</strong><span>{dateSlots.length} {dateSlots.length === 1 ? 'time' : 'times'}</span></div>
            {dateSlots.length === 0 ? <div className="booking-slot-empty"><strong>No times on this date</strong><p>Choose one of the other dates above.</p></div> : <div className="booking-slot-grid">{dateSlots.map((slot) => {
            const start = new Date(slot.start_time)
            const end = new Date(slot.end_time)
            const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            const isSelected = selectedSlot === slot.id
            return (
              <button type="button" key={slot.id} className={isSelected ? 'selected' : ''} onClick={() => setSelectedSlot(slot.id)}><strong>{fmt(start)}</strong><span>to {fmt(end)}</span><small>{slot.max_bookings - slot.booked_count} remaining</small></button>
            )
          })}</div>}
            <footer><button type="button" className="booking-secondary-action" onClick={() => navigate(`/book/${slug}`)}>Cancel</button><button type="button" className="booking-primary-action" disabled={!selectedSlot} onClick={() => navigate(`/book/${slug}/${service?.id}/confirm`, { state: { slotId: selectedSlot } })}>Continue to your details →</button></footer>
          </section>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
