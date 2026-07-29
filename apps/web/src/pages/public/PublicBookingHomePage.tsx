import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation } from '@pharmstation/types'
import { PublicFooter } from '../../components/public/PublicFooter'

export function PublicBookingHomePage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch all public orgs (anon read)
    getUserClient()
      .from('ps_organisations')
      .select('*')
      .eq('is_public', true)
      .order('name')
      .then(({ data }) => {
        setOrgs((data as Organisation[]) || [])
        setLoading(false)
      })
  }, [])

  const filtered = orgs.filter((o) => {
    const q = search.toLowerCase()
    if (!q) return true
    return (
      o.name.toLowerCase().includes(q) ||
      (o.address?.postcode || '').toLowerCase().includes(q) ||
      (o.address?.city || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="booking-public">
      <header className="booking-nav">
        <button type="button" className="booking-wordmark" onClick={() => navigate('/book')}>Pharm<span>Station</span><small>Book</small></button>
        <nav><a href="/shop">Shop</a><a href="/maps">Find a pharmacy</a><a href="/patient/login">Sign in</a></nav>
      </header>
      <main>
        <section className="booking-discovery-hero">
          <div><span className="booking-eyebrow">Pharmacy care, booked around you</span><h1>Find the right service.<br />Choose a time that works.</h1><p>Book trusted care with a participating local pharmacy in a few clear steps.</p></div>
          <div className="booking-search-panel">
            <label htmlFor="booking-pharmacy-search">Find your pharmacy</label>
            <div><span aria-hidden="true">⌕</span><input id="booking-pharmacy-search" placeholder="Pharmacy name, city or postcode" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <small>{loading ? 'Finding participating pharmacies…' : `${filtered.length} ${filtered.length === 1 ? 'pharmacy' : 'pharmacies'} available`}</small>
          </div>
        </section>

        <section className="booking-trust-strip"><div><b>01</b><span><strong>Choose a pharmacy</strong>Near home or work</span></div><div><b>02</b><span><strong>Select a service</strong>See duration and cost</span></div><div><b>03</b><span><strong>Pick your appointment</strong>Live available times</span></div></section>

        <section className="booking-results">
          <header><div><span className="booking-eyebrow">Participating pharmacies</span><h2>{search ? 'Search results' : 'Choose where to book'}</h2></div><p>Appointments are managed directly by each pharmacy.</p></header>
          {loading && <div className="booking-loading"><i /><span>Loading pharmacies…</span></div>}
          {!loading && filtered.length === 0 && <div className="booking-empty"><strong>{search ? 'No pharmacies match your search' : 'No pharmacies are accepting online bookings yet'}</strong><p>{search ? 'Check the spelling or try a nearby town or postcode.' : 'Please check again soon.'}</p>{search && <button type="button" onClick={() => setSearch('')}>Clear search</button>}</div>}
          <div className="booking-pharmacy-list">{filtered.map((org, index) => <button type="button" key={org.id} onClick={() => navigate(`/book/${(org as any).slug || org.id}`)}>
            <span className="booking-result-number">{String(index + 1).padStart(2, '0')}</span>
            {(org as any).public_logo_url ? <img src={(org as any).public_logo_url} alt="" /> : <span className="booking-pharmacy-initials" aria-hidden="true">{org.name.slice(0, 2).toUpperCase()}</span>}
            <span className="booking-pharmacy-copy"><strong>{org.name}</strong><small>{[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ') || 'Contact pharmacy for address'}</small>{(org as any).public_description && <p>{(org as any).public_description}</p>}</span>
            <span className="booking-result-action">View services <b>→</b></span>
          </button>)}</div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
