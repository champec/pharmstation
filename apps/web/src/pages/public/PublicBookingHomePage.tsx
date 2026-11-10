import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, LocateFixed, MapPin, Search, Video } from 'lucide-react'
import { BookingNavAccount } from '../../components/public/BookingNavAccount'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { PublicFooter } from '../../components/public/PublicFooter'
import {
  currentLocation, formatAddress, formatPounds, geocodePostcode, matchesQuery, orgPath,
  usePharmacyDirectory, type LatLng,
} from '../../lib/publicDirectory'
import { usePageMeta } from '../../seo/RouteMeta'

// /book — search every participating pharmacy by what you need (service) and where (postcode).
// ?q=flu+jab&postcode=SW1A1AA come from the patient hub, popular-service chips and ads.
export function PublicBookingHomePage() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [postcode, setPostcode] = useState(params.get('postcode') ?? '')
  const [location, setLocation] = useState<LatLng | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const { pharmacies, loading } = usePharmacyDirectory(location)

  // A postcode in the link (e.g. from an ad or the hub) is looked up straight away.
  useEffect(() => {
    const initial = params.get('postcode')
    if (initial) applyPostcode(initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyPostcode = async (value: string) => {
    if (!value.trim()) { setLocation(null); setLocationLabel(null); return }
    setLocating(true)
    setLocationError(null)
    const coords = await geocodePostcode(value)
    setLocating(false)
    if (!coords) { setLocationError('We could not find that postcode. Check it and try again.'); return }
    setLocation(coords)
    setLocationLabel(value.trim().toUpperCase())
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = new URLSearchParams()
    if (query.trim()) next.set('q', query.trim())
    if (postcode.trim()) next.set('postcode', postcode.trim().toUpperCase())
    setParams(next, { replace: true })
    if (postcode.trim().toUpperCase() !== locationLabel) applyPostcode(postcode)
  }

  const useMyLocation = async () => {
    setLocating(true)
    setLocationError(null)
    const coords = await currentLocation()
    setLocating(false)
    if (!coords) { setLocationError('Location is turned off. Enter your postcode instead.'); return }
    setPostcode('')
    setLocation(coords)
    setLocationLabel('your location')
  }

  const q = query.trim()
  usePageMeta(params.get('q') ? {
    title: `Book ${params.get('q')} at a pharmacy near you`,
    description: `Find a local pharmacy offering ${params.get('q')} and book online. See prices, times and the nearest pharmacy first.`,
    canonicalPath: '/book',
  } : null)

  // Pharmacies that take bookings, with the services that match the search highlighted.
  const results = useMemo(() => pharmacies
    .filter((pharmacy) => pharmacy.services.length > 0)
    .map((pharmacy) => {
      const pharmacyMatch = !q || matchesQuery(`${pharmacy.name} ${formatAddress(pharmacy.address)}`, q)
      const matching = q ? pharmacy.services.filter((service) => matchesQuery(service.name, q)) : pharmacy.services
      return { pharmacy, matching: pharmacyMatch && !matching.length ? pharmacy.services : matching, show: pharmacyMatch || matching.length > 0 }
    })
    .filter((row) => row.show), [pharmacies, q])

  return (
    <div className="booking-public">
      <AudienceSwitch active="patients" />
      <header className="booking-nav">
        <Link to="/pharmacies" className="booking-wordmark">Pharm<span>Station</span><small>Book</small></Link>
        <nav><Link to="/shop">Shop</Link><Link to="/maps">Find a pharmacy</Link><BookingNavAccount /></nav>
      </header>
      <main>
        <section className="booking-discovery-hero">
          <div>
            <span className="booking-eyebrow">Pharmacy care, booked around you</span>
            <h1>Find the right service.<br />Choose a time that works.</h1>
            <p>Search by what you need and where you are. You'll see prices, available times and the nearest pharmacy first.</p>
          </div>
          <form className="booking-search-panel patient-hub-search" onSubmit={submit}>
            <label htmlFor="booking-need">What do you need?</label>
            <div className="patient-hub-input">
              <Search size={18} aria-hidden="true" />
              <input id="booking-need" type="search" placeholder="Service or pharmacy, e.g. flu jab" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <label htmlFor="booking-postcode">Near</label>
            <div className="patient-hub-input">
              <MapPin size={18} aria-hidden="true" />
              <input id="booking-postcode" placeholder={locationLabel === 'your location' ? 'Using your location' : 'Postcode'} value={postcode} onChange={(event) => setPostcode(event.target.value)} autoComplete="postal-code" />
              <button type="button" className="patient-hub-locate" onClick={useMyLocation} disabled={locating} aria-label="Use my location"><LocateFixed size={18} aria-hidden="true" /></button>
            </div>
            {locationError && <small className="patient-hub-error" role="alert">{locationError}</small>}
            <button type="submit" className="booking-primary-action" disabled={locating}>{locating ? 'Finding you…' : 'Search'}</button>
            <small>{loading ? 'Finding participating pharmacies…' : `${results.length} ${results.length === 1 ? 'pharmacy' : 'pharmacies'} available`}</small>
          </form>
        </section>

        <section className="booking-trust-strip"><div><b>01</b><span><strong>Choose a service</strong>See duration and cost upfront</span></div><div><b>02</b><span><strong>Pick a time</strong>Live available times</span></div><div><b>03</b><span><strong>Confirm</strong>Pay online or at the pharmacy</span></div></section>

        <section className="booking-results">
          <header>
            <div>
              <span className="booking-eyebrow">{locationLabel ? `Nearest to ${locationLabel}` : 'Participating pharmacies'}</span>
              <h2>{q ? `Results for “${q}”` : 'Choose where to book'}</h2>
            </div>
            <p>Appointments are provided directly by each pharmacy.</p>
          </header>
          {loading && <div className="booking-loading"><i /><span>Loading pharmacies…</span></div>}
          {!loading && results.length === 0 && (
            <div className="booking-empty">
              <strong>{q ? `No pharmacies offer “${q}” online yet` : 'No pharmacies are accepting online bookings yet'}</strong>
              <p>{q ? 'Try a different word, such as “vaccine” or “consultation”, or find a pharmacy on the map and call them.' : 'Please check again soon, or find a pharmacy on the map.'}</p>
              {q ? <button type="button" onClick={() => { setQuery(''); setParams(new URLSearchParams(), { replace: true }) }}>Show all services</button> : <Link to="/maps">Open the pharmacy map</Link>}
            </div>
          )}
          <div className="booking-directory">
            {results.map(({ pharmacy, matching }) => (
              <article key={pharmacy.org_id}>
                <Link to={`/book/${orgPath(pharmacy)}`} className="booking-directory-head">
                  {pharmacy.public_logo_url ? <img src={pharmacy.public_logo_url} alt="" /> : <span className="booking-pharmacy-initials" aria-hidden="true">{pharmacy.name.slice(0, 2).toUpperCase()}</span>}
                  <span>
                    <strong>{pharmacy.name}</strong>
                    <small>{formatAddress(pharmacy.address) || 'Contact pharmacy for address'}{pharmacy.distance_km != null && ` · ${pharmacy.distance_km.toFixed(1)} km`}</small>
                  </span>
                  <span className="booking-result-action">All services <ArrowRight size={16} aria-hidden="true" /></span>
                </Link>
                <ul>
                  {matching.slice(0, 6).map((service) => (
                    <li key={service.id}>
                      <Link to={`/book/${orgPath(pharmacy)}/${service.slug || service.id}`}>
                        <span><strong>{service.name}</strong><small>{service.duration_minutes} min{service.is_video && <> · <Video size={12} aria-hidden="true" /> Video</>}</small></span>
                        <b>{service.price_pence ? formatPounds(service.price_pence) : ''}</b>
                        <em>Book</em>
                      </Link>
                    </li>
                  ))}
                  {matching.length > 6 && <li><Link to={`/book/${orgPath(pharmacy)}`}>+{matching.length - 6} more services</Link></li>}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
