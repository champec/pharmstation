import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation, Service } from '@pharmstation/types'

export function PublicOrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [services, setServices] = useState<Service[]>([])
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
      .or(`slug.eq.${orgSlug},id.eq.${orgSlug}`)
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
    return <div style={{ maxWidth: '800px', margin: '60px auto', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading pharmacy…</div>
  }

  if (error || !org) {
    return (
      <div style={{ maxWidth: '600px', margin: '80px auto', textAlign: 'center' }}>
        <h2>{error || 'Pharmacy not found'}</h2>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/book')}>← Back to Search</button>
      </div>
    )
  }

  const slug = (org as any).slug || org.id

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/book')} style={{ marginBottom: 'var(--ps-space-md)' }}>← Back to Pharmacies</button>

      <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', marginBottom: 'var(--ps-space-xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-lg)' }}>
          {(org as any).public_logo_url ? (
            <img
              src={(org as any).public_logo_url}
              alt={org.name}
              style={{ width: 80, height: 80, borderRadius: 'var(--ps-radius-lg)', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: 'var(--ps-radius-lg)', background: 'var(--ps-off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem' }}>🏥</div>
          )}
          <div>
            <h1 style={{ margin: 0 }}>{org.name}</h1>
            <p style={{ color: 'var(--ps-slate)', margin: '4px 0 0' }}>
              {[org.address?.line_1, org.address?.city, org.address?.postcode].filter(Boolean).join(', ')}
            </p>
          </div>
        </div>
        {(org as any).public_description && (
          <p style={{ marginTop: 'var(--ps-space-md)', color: 'var(--ps-slate)' }}>{(org as any).public_description}</p>
        )}
      </div>

      <h2 style={{ marginBottom: 'var(--ps-space-md)' }}>Available Services</h2>

      {services.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center', color: 'var(--ps-slate)' }}>
          This pharmacy has no services available for online booking at the moment.
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--ps-space-md)' }}>
        {services.map((svc) => (
          <div
            key={svc.id}
            className="ps-card"
            style={{ padding: 'var(--ps-space-lg)', cursor: 'pointer' }}
            onClick={() => navigate(`/book/${slug}/${svc.id}`)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 'var(--ps-font-md)' }}>{svc.name}</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{svc.description}</p>
                <p style={{ margin: '4px 0 0', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                  ⏱️ {svc.duration_minutes} minutes
                </p>
              </div>
              <button className="ps-btn ps-btn-primary ps-btn-sm">Book Now →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
