// ============================================================
// PatientHubPage — /pharmacies
// The patient front door: find a participating pharmacy near you,
// then shop or book a service there in one tap.
// ============================================================

import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, BadgeCheck, CalendarCheck, LocateFixed, MapPin, Package, Search, ShieldCheck,
  ShoppingBag, Store, Truck, Video,
} from 'lucide-react'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { BookingNavAccount } from '../../components/public/BookingNavAccount'
import { PublicFooter } from '../../components/public/PublicFooter'
import {
  currentLocation, formatAddress, formatPounds, geocodePostcode, matchesQuery, orgPath,
  usePharmacyDirectory, type LatLng,
} from '../../lib/publicDirectory'
import { useStructuredData } from '../../seo/RouteMeta'
import { SITE_URL } from '../../seo/routeMeta'

export function PatientHubPage() {
  const navigate = useNavigate()
  const [location, setLocation] = useState<LatLng | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)
  const [postcode, setPostcode] = useState('')
  const [need, setNeed] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const { pharmacies, loading } = usePharmacyDirectory(location)

  useStructuredData({
    '@type': 'WebSite',
    name: 'PharmStation',
    url: `${SITE_URL}/pharmacies`,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/book?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  })

  // Every service name offered anywhere, most common first, for the "popular" chips.
  const popularServices = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    pharmacies.forEach((pharmacy) => pharmacy.services.forEach((service) => {
      const key = service.name.trim().toLowerCase()
      const entry = counts.get(key) ?? { name: service.name.trim(), count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }))
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10)
  }, [pharmacies])

  const participating = pharmacies.filter((pharmacy) => pharmacy.shop_enabled || pharmacy.services.length > 0)

  const search = async (event: FormEvent) => {
    event.preventDefault()
    setLocationError(null)
    let coords = location
    if (postcode.trim() && postcode.trim().toUpperCase() !== locationLabel) {
      setLocating(true)
      coords = await geocodePostcode(postcode)
      setLocating(false)
      if (!coords) {
        setLocationError('We could not find that postcode. Check it and try again.')
        return
      }
      setLocation(coords)
      setLocationLabel(postcode.trim().toUpperCase())
    }
    const params = new URLSearchParams()
    if (need.trim()) params.set('q', need.trim())
    if (postcode.trim()) params.set('postcode', postcode.trim().toUpperCase())
    // A need that matches a bookable service goes to booking; anything else is a shop search.
    const query = need.trim()
    if (!query) {
      document.getElementById('nearby-pharmacies')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const isService = pharmacies.some((pharmacy) => pharmacy.services.some((service) => matchesQuery(service.name, query)))
    navigate(`${isService ? '/book' : '/shop'}?${params.toString()}`)
  }

  const useMyLocation = async () => {
    setLocating(true)
    setLocationError(null)
    const coords = await currentLocation()
    setLocating(false)
    if (!coords) {
      setLocationError('Location is turned off. Enter your postcode instead.')
      return
    }
    setLocation(coords)
    setLocationLabel('your location')
    setPostcode('')
  }

  return (
    <div className="booking-public patient-hub">
      <AudienceSwitch active="patients" />
      <header className="booking-nav">
        <Link to="/pharmacies" className="booking-wordmark">Pharm<span>Station</span></Link>
        <nav aria-label="Patient">
          <Link to="/shop">Shop</Link>
          <Link to="/book">Book a service</Link>
          <Link to="/shop/order">Track an order</Link>
          <BookingNavAccount />
        </nav>
      </header>

      <main>
        <section className="patient-hub-hero">
          <div>
            <span className="booking-eyebrow">Independent pharmacies near you</span>
            <h1>Your local pharmacy, online.</h1>
            <p>
              Shop health essentials for click and collect or local delivery, and book consultations,
              vaccinations and health checks with a registered pharmacy team near you.
            </p>
          </div>
          <form className="patient-hub-search" onSubmit={search}>
            <label htmlFor="hub-need">What do you need?</label>
            <div className="patient-hub-input">
              <Search size={18} aria-hidden="true" />
              <input id="hub-need" value={need} onChange={(event) => setNeed(event.target.value)} placeholder="e.g. flu jab, travel vaccines, hay fever" />
            </div>
            <label htmlFor="hub-postcode">Near</label>
            <div className="patient-hub-input">
              <MapPin size={18} aria-hidden="true" />
              <input id="hub-postcode" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder={locationLabel === 'your location' ? 'Using your location' : 'Postcode'} autoComplete="postal-code" />
              <button type="button" className="patient-hub-locate" onClick={useMyLocation} disabled={locating} aria-label="Use my location">
                <LocateFixed size={18} aria-hidden="true" />
              </button>
            </div>
            {locationError && <small className="patient-hub-error" role="alert">{locationError}</small>}
            <button type="submit" className="booking-primary-action" disabled={locating}>
              {locating ? 'Finding you…' : 'Search'}
            </button>
          </form>
        </section>

        <section className="patient-hub-actions" aria-label="What would you like to do?">
          <Link to="/shop"><ShoppingBag size={26} aria-hidden="true" /><strong>Shop</strong><span>Health, beauty and pharmacy medicines from a local pharmacy</span></Link>
          <Link to="/book"><CalendarCheck size={26} aria-hidden="true" /><strong>Book a service</strong><span>Consultations, vaccinations and health checks</span></Link>
          <Link to="/maps"><MapPin size={26} aria-hidden="true" /><strong>Find any pharmacy</strong><span>Opening hours and contact details on a map</span></Link>
          <Link to="/shop/order"><Package size={26} aria-hidden="true" /><strong>Track an order</strong><span>Check where your order is with your order number</span></Link>
        </section>

        {popularServices.length > 0 && (
          <section className="patient-hub-popular">
            <h2>Popular services</h2>
            <div>
              {popularServices.map((service) => (
                <Link key={service.name} to={`/book?q=${encodeURIComponent(service.name)}`}>{service.name}</Link>
              ))}
            </div>
          </section>
        )}

        <section className="patient-hub-list" id="nearby-pharmacies">
          <header>
            <div>
              <span className="booking-eyebrow">{locationLabel ? `Nearest to ${locationLabel}` : 'Participating pharmacies'}</span>
              <h2>Pharmacies on PharmStation</h2>
            </div>
            {!locationLabel && <p>Add your postcode above to see the nearest first.</p>}
          </header>
          {loading && <div className="booking-loading"><i /><span>Finding pharmacies…</span></div>}
          {!loading && participating.length === 0 && (
            <div className="booking-empty"><strong>No pharmacies are online yet</strong><p>Use the pharmacy map to find any pharmacy near you.</p><Link to="/maps">Open the map</Link></div>
          )}
          <div className="patient-hub-pharmacies">
            {participating.map((pharmacy) => (
              <article key={pharmacy.org_id}>
                <div className="patient-hub-pharmacy-head">
                  {pharmacy.public_logo_url
                    ? <img src={pharmacy.public_logo_url} alt="" />
                    : <span className="booking-pharmacy-initials" aria-hidden="true">{pharmacy.name.slice(0, 2).toUpperCase()}</span>}
                  <div>
                    <h3>{pharmacy.name}</h3>
                    <p>{formatAddress(pharmacy.address)}{pharmacy.distance_km != null && <b> · {pharmacy.distance_km.toFixed(1)} km</b>}</p>
                  </div>
                </div>
                <ul className="patient-hub-badges">
                  {pharmacy.shop_enabled && <li><Store size={14} aria-hidden="true" /> Online shop</li>}
                  {pharmacy.delivery_enabled && <li><Truck size={14} aria-hidden="true" /> Local delivery</li>}
                  {pharmacy.services.some((service) => service.is_video) && <li><Video size={14} aria-hidden="true" /> Video consultations</li>}
                </ul>
                {pharmacy.services.length > 0 && (
                  <div className="patient-hub-services">
                    {pharmacy.services.slice(0, 4).map((service) => (
                      <Link key={service.id} to={`/book/${orgPath(pharmacy)}/${service.slug || service.id}`}>
                        {service.name}{service.price_pence ? <small>{formatPounds(service.price_pence)}</small> : null}
                      </Link>
                    ))}
                    {pharmacy.services.length > 4 && <Link to={`/book/${orgPath(pharmacy)}`}>+{pharmacy.services.length - 4} more</Link>}
                  </div>
                )}
                <footer>
                  {pharmacy.shop_enabled && <Link className="booking-primary-action" to={`/shop/${orgPath(pharmacy)}`}>Shop <ArrowRight size={16} aria-hidden="true" /></Link>}
                  {pharmacy.services.length > 0 && <Link className={pharmacy.shop_enabled ? 'booking-secondary-action' : 'booking-primary-action'} to={`/book/${orgPath(pharmacy)}`}>Book a service</Link>}
                </footer>
              </article>
            ))}
          </div>
        </section>

        <section className="patient-hub-trust">
          <div><BadgeCheck size={24} aria-hidden="true" /><strong>Registered pharmacies</strong><span>Every shop shows its GPhC registration and pharmacist in charge.</span></div>
          <div><ShieldCheck size={24} aria-hidden="true" /><strong>Checked by a pharmacist</strong><span>Pharmacy medicines are reviewed by a pharmacist before your order is ready.</span></div>
          <div><Store size={24} aria-hidden="true" /><strong>Pay your way</strong><span>Pay by card online where the pharmacy offers it, or in store when you collect.</span></div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
