import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service } from '@pharmstation/types'
import { orgSlugOrIdFilter } from '../../lib/orgSlugFilter'
import { PublicFooter } from '../../components/public/PublicFooter'

export function PublicOrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [serviceSearch, setServiceSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orgSlug) return
    setLoading(true)
    // Try to find org by slug first, then by ID
    getUserClient()
      .from('ps_organisations')
      .select('*')
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
        const o = data as Organisation
        setOrg(o)
        // Fetch public services
        getUserClient()
          .from('ps_services')
          .select('*')
          .eq('org_id', o.id)
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
      <header className="booking-nav"><button type="button" className="booking-wordmark" onClick={() => navigate('/book')}>Pharm<span>Station</span><small>Book</small></button><nav><a href="/shop">Shop</a><a href="/maps">Find a pharmacy</a><a href="/patient/login">Sign in</a></nav></header>
      <main>
        <button type="button" className="booking-back" onClick={() => navigate('/book')}>← All pharmacies</button>
        <section className="booking-org-hero">
          <div className="booking-org-identity">{(org as any).public_logo_url ? <img src={(org as any).public_logo_url} alt="" /> : <span>{org.name.slice(0, 2).toUpperCase()}</span>}<div><span className="booking-eyebrow">Participating local pharmacy</span><h1>{org.name}</h1><p>{[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ')}</p></div></div>
          <div className="booking-org-about"><span>About this pharmacy</span><p>{(org as any).public_description || 'Choose from the pharmacy services currently available to book online.'}</p></div>
        </section>
        <section className="booking-services">
          <header><div><span className="booking-eyebrow">Step 1 of 3</span><h2>Choose a service</h2></div><p>{services.length} {services.length === 1 ? 'service' : 'services'} available to book</p></header>
          {services.length === 0 ? <div className="booking-empty"><strong>No online services available</strong><p>This pharmacy is not currently listing appointments online.</p><button type="button" onClick={() => navigate('/book')}>Choose another pharmacy</button></div> : <>
            <label className="booking-service-search"><span aria-hidden="true">⌕</span><input type="search" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder="Search this pharmacy's services" aria-label="Search services" />{serviceSearch && <button type="button" onClick={() => setServiceSearch('')} aria-label="Clear service search">×</button>}</label>
            {filteredServices.length ? <div className="booking-service-grid">{filteredServices.map((service) => <article key={service.id} className="booking-service-card"><button type="button" onClick={() => navigate(`/book/${slug}/${service.id}`)}><div className="booking-service-card-copy"><span className="booking-service-category">Pharmacy service</span><h3>{service.name}</h3><p>{service.description || 'Book this service with the pharmacy team.'}</p></div><div className="booking-service-card-meta"><span><b>{service.duration_minutes}</b> min</span>{service.is_chargeable && service.price_pence != null && service.price_pence > 0 ? <strong>£{(service.price_pence / 100).toFixed(2)}</strong> : <strong>No online payment</strong>}</div><footer><span>View appointments</span><b>→</b></footer></button></article>)}</div> : <div className="booking-empty booking-service-no-results"><strong>No services match “{serviceSearch.trim()}”</strong><p>Try a broader search or view every service at this pharmacy.</p><button type="button" onClick={() => setServiceSearch('')}>Clear search</button></div>}
          </>}
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
