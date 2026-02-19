import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation } from '@pharmstation/types'

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
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-2xl)' }}>
        <h1 style={{ fontSize: 'var(--ps-font-2xl)', marginBottom: 'var(--ps-space-sm)' }}>📋 Book a Pharmacy Service</h1>
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-md)' }}>Search for your pharmacy and book an appointment online.</p>
      </div>

      <div style={{ marginBottom: 'var(--ps-space-xl)' }}>
        <input
          className="ps-input"
          placeholder="Search by pharmacy name, city or postcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', fontSize: 'var(--ps-font-md)', padding: 'var(--ps-space-md)' }}
        />
      </div>

      {loading && <p style={{ textAlign: 'center', color: 'var(--ps-slate)' }}>Loading pharmacies…</p>}

      {!loading && filtered.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          {search ? 'No pharmacies match your search.' : 'No pharmacies have enabled public booking yet.'}
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
        {filtered.map((org) => (
          <div
            key={org.id}
            className="ps-card"
            style={{ padding: 'var(--ps-space-lg)', cursor: 'pointer' }}
            onClick={() => {
              const slug = (org as any).slug || org.id
              navigate(`/book/${slug}`)
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
              {(org as any).public_logo_url ? (
                <img
                  src={(org as any).public_logo_url}
                  alt={org.name}
                  style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 'var(--ps-radius-md)', background: 'var(--ps-off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🏥</div>
              )}
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 'var(--ps-font-md)' }}>{org.name}</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                  {[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ') || 'Address not set'}
                </p>
                {(org as any).public_description && (
                  <p style={{ margin: '4px 0 0', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                    {(org as any).public_description}
                  </p>
                )}
              </div>
              <span style={{ color: 'var(--ps-deep-blue)', fontWeight: 600 }}>→</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-2xl)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
        <p>Already have a patient account? <a href="/patient/login" onClick={(e) => { e.preventDefault(); navigate('/patient/login') }} style={{ color: 'var(--ps-deep-blue)' }}>Sign in</a></p>
      </div>
    </div>
  )
}
