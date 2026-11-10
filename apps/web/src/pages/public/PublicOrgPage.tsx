import { BookingNavAccount } from '../../components/public/BookingNavAccount'
import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowRight, ShoppingBag } from 'lucide-react'
import { AudienceSwitch } from '../../components/public/AudienceSwitch'
import { formatAddress, parseEwkbPoint, slugMap } from '../../lib/publicDirectory'
import { pharmacyJsonLd } from '../../seo/structuredData'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service } from '@pharmstation/types'
import { orgSlugOrIdFilter } from '../../lib/orgSlugFilter'
import { PublicFooter } from '../../components/public/PublicFooter'
import { usePageMeta, useStructuredData } from '../../seo/RouteMeta'

// Anonymous visitors may only read these columns (column grants on ps_organisations).
const PUBLIC_ORG_COLUMNS = 'id, name, slug, address, geolocation, gphc_premises_number, public_description, public_logo_url, is_public, is_active, organisation_type'

export function PublicOrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [hasShop, setHasShop] = useState(false)
  const serviceSlugs = useMemo(() => slugMap(services), [services])
  const town = org?.address?.city || org?.address?.postcode || ''
  const serviceNames = services.slice(0, 4).map((service) => service.name).join(', ')
  usePageMeta(org ? {
    title: `${org.name}${town ? `, ${town}` : ''}: book pharmacy services online`,
    description: services.length
      ? `Book ${serviceNames}${services.length > 4 ? ' and more' : ''} at ${org.name}${town ? ` in ${town}` : ''}. See prices and live appointment times, and book online.`
      : `${org.name}${town ? ` in ${town}` : ''}. ${(org as any).public_description || 'Book pharmacy services online.'}`,
    image: (org as any).public_logo_url,
    canonicalPath: `/book/${(org as any).slug || org.id}`,
  } : null)
  useStructuredData(org ? pharmacyJsonLd({
    name: org.name,
    slug: (org as any).slug || org.id,
    address: org.address as any,
    description: (org as any).public_description,
    logo: (org as any).public_logo_url,
    point: parseEwkbPoint((org as any).geolocation),
    gphc: (org as any).gphc_premises_number,
    services: services.map((service) => ({ name: service.name, path: `/book/${(org as any).slug || org.id}/${serviceSlugs.get(service.id)}`, price_pence: service.is_chargeable ? service.price_pence ?? null : null, description: service.description })),
  }) : null)
  const [serviceSearch, setServiceSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgSlug) return
    setLoading(true)
    // Try to find org by slug first, then by ID
    getUserClient()
      .from('ps_organisations')
      .select(PUBLIC_ORG_COLUMNS)
      .eq('is_public', true)
      .or(orgSlugOrIdFilter(orgSlug))
      .limit(1)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Pharmacy not found or not accepting online bookings.')
          setLoading(false)
          return
        }
        const o = data as unknown as Organisation
        setOrg(o)
        getUserClient().rpc('ps_shop_list_orgs', { p_lat: null, p_lng: null }).then(({ data: shops }) => {
          setHasShop(((shops ?? []) as Array<{ org_id: string }>).some((shop) => shop.org_id === o.id))
        })
        // Fetch public services
        getUserClient()
          .from('ps_services')
          .select('*')
          .eq('org_id', o.id)
          .is('archived_at', null)
          .eq('is_public', true)
          .eq('is_active', true)
          .order('name')
          .then(({ data: sData }) => {
            setServices((sData as Service[]) || [])
            setLoading(false)
          })
      })
  }, [orgSlug])

  if (loading) {
    return <div className="booking-public"><div className="booking-loading booking-page-state"><i /><span>Loading pharmacy…</span></div></div>
  }

  if (error || !org) {
    return (
      <div className="booking-public"><div className="booking-empty booking-page-state"><strong>{error || 'Pharmacy not found'}</strong><p>Choose another participating pharmacy to continue.</p><button type="button" onClick={() => navigate('/book')}>Back to pharmacy search</button></div></div>
    )
  }

  const slug = (org as any).slug || org.id
  const serviceQuery = serviceSearch.trim().toLowerCase()
  const filteredServices = services.filter((service) =>
    !serviceQuery || `${service.name} ${service.description || ''}`.toLowerCase().includes(serviceQuery),
  )

  return (
    <div className="booking-public">
      <AudienceSwitch active="patients" />
      <header className="booking-nav"><Link to="/pharmacies" className="booking-wordmark">Pharm<span>Station</span><small>Book</small></Link><nav><Link to="/shop">Shop</Link><Link to="/book">All pharmacies</Link><BookingNavAccount /></nav></header>
      <main>
        <button type="button" className="booking-back" onClick={() => navigate('/book')}>← All pharmacies</button>
        <section className="booking-org-hero">
          <div className="booking-org-identity">{(org as any).public_logo_url ? <img src={(org as any).public_logo_url} alt="" /> : <span>{org.name.slice(0, 2).toUpperCase()}</span>}<div><span className="booking-eyebrow">Participating local pharmacy</span><h1>{org.name}</h1><p>{formatAddress(org.address as any)}</p></div></div>
          <div className="booking-org-about"><span>About this pharmacy</span><p>{(org as any).public_description || 'Choose from the pharmacy services currently available to book online.'}</p>{(org as any).gphc_premises_number && <small>GPhC registered premises {(org as any).gphc_premises_number}</small>}{hasShop && <Link className="booking-org-shop-link" to={`/shop/${slug}`}><ShoppingBag size={16} aria-hidden="true" /> Shop online at {org.name} <ArrowRight size={16} aria-hidden="true" /></Link>}</div>
        </section>
        <section className="booking-services">
          <header><div><span className="booking-eyebrow">Step 1 of 3</span><h2>Choose a service</h2></div><p>{services.length} {services.length === 1 ? 'service' : 'services'} available to book</p></header>
          {services.length === 0 ? <div className="booking-empty"><strong>No online services available</strong><p>This pharmacy is not currently listing appointments online.</p><button type="button" onClick={() => navigate('/book')}>Choose another pharmacy</button></div> : <>
            <label className="booking-service-search"><span aria-hidden="true">⌕</span><input type="search" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder="Search this pharmacy's services" aria-label="Search services" />{serviceSearch && <button type="button" onClick={() => setServiceSearch('')} aria-label="Clear service search">×</button>}</label>
            {filteredServices.length ? <div className="booking-service-grid">{filteredServices.map((service) => <article key={service.id} className="booking-service-card"><Link to={`/book/${slug}/${serviceSlugs.get(service.id) || service.id}`}><div className="booking-service-card-copy"><span className="booking-service-category">Pharmacy service</span><h3>{service.name}</h3><p>{service.description || 'Book this service with the pharmacy team.'}</p></div><div className="booking-service-card-meta"><span><b>{service.duration_minutes}</b> min</span>{service.is_chargeable && service.price_pence != null && service.price_pence > 0 ? <strong>£{(service.price_pence / 100).toFixed(2)}</strong> : <strong>No online payment</strong>}</div><footer><span>View appointments</span><b>→</b></footer></Link></article>)}</div> : <div className="booking-empty booking-service-no-results"><strong>No services match “{serviceSearch.trim()}”</strong><p>Try a broader search or view every service at this pharmacy.</p><button type="button" onClick={() => setServiceSearch('')}>Clear search</button></div>}
          </>}
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
