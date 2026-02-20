import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'

interface OdsPharmacy {
  id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
}

export function NetworkOnboardingPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { myLink, fetchMyLink, linkPharmacy, unlinkPharmacy, loading, error, clearError } = useNetworkStore()

  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults]       = useState<OdsPharmacy[]>([])
  const [searching, setSearching]   = useState(false)
  const [unlinking, setUnlinking]   = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (organisation?.id) fetchMyLink(organisation.id)
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async () => {
    if (!searchTerm.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('pharmacies')
        .select('id, ods_code, organisation_name, address1, address2, city, postcode, latitude, longitude')
        .or(`organisation_name.ilike.%${searchTerm}%,postcode.ilike.%${searchTerm}%,ods_code.ilike.%${searchTerm}%`)
        .order('organisation_name')
        .limit(20)
      if (error) throw error
      setResults((data ?? []) as OdsPharmacy[])
    } catch (e: unknown) {
      setSearchError((e as Error).message)
    } finally {
      setSearching(false)
    }
  }, [searchTerm])

  async function handleLink(pharmacy: OdsPharmacy) {
    if (!organisation?.id) return
    await linkPharmacy(organisation.id, pharmacy.id)
    navigate('/messaging/network')
  }

  async function handleUnlink() {
    if (!organisation?.id) return
    setUnlinking(true)
    await unlinkPharmacy(organisation.id)
    setUnlinking(false)
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging/network" onClick={(e) => { e.preventDefault(); navigate('/messaging/network') }}>Pharmacy Network</a>
          <span className="separator">/</span>
          <span>Link Pharmacy</span>
        </div>
        <h1>🔗 Link Your Pharmacy</h1>
      </div>

      {(error || searchError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error ?? searchError}</span>
          <button className="ps-btn ps-btn-ghost" onClick={() => { clearError(); setSearchError(null) }}>✕</button>
        </div>
      )}

      {/* Intro */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', background: 'var(--ps-off-white)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Why link?</h3>
        <p style={{ margin: 0, color: 'var(--ps-slate)', lineHeight: 1.7 }}>
          Linking your PharmStation account to your NHS ODS (Organisation Data Service) entry lets other pharmacies on the platform find you by name, postcode, or ODS code.
          It also powers distance-based search using your pharmacy's registered location. You only need to do this once.
        </p>
      </div>

      {/* Current link */}
      {myLink && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)', border: '2px solid var(--ps-electric-cyan)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>
                ✅ Currently linked
              </div>
              <div style={{ fontWeight: 600 }}>
                {myLink.pharmacy?.organisation_name ?? `Pharmacy #${myLink.pharmacy_id}`}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                ODS: {myLink.pharmacy?.ods_code ?? '—'}
                {myLink.pharmacy?.postcode && ` · ${myLink.pharmacy.postcode}`}
                {myLink.pharmacy?.city && ` · ${myLink.pharmacy.city}`}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginTop: 4 }}>
                Linked {new Date(myLink.linked_at).toLocaleDateString('en-GB')}
              </div>
            </div>
            <button
              className="ps-btn ps-btn-ghost"
              style={{ color: 'var(--ps-red, crimson)' }}
              onClick={handleUnlink}
              disabled={unlinking}
            >
              {unlinking ? 'Removing…' : '🔓 Unlink'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>
          {myLink ? 'Change your linked pharmacy' : 'Find your pharmacy'}
        </h3>
        <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }}>
          Search by pharmacy name, postcode, or ODS code.
        </p>

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
          <input
            className="ps-input"
            placeholder="e.g. Boots, SW1A 1AA, FQ123…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            style={{ flex: 1 }}
          />
          <button className="ps-btn ps-btn-primary" onClick={doSearch} disabled={searching || !searchTerm.trim()}>
            {searching ? '…' : '🔍 Search'}
          </button>
        </div>

        {searching ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
            <div className="loading-spinner" />
          </div>
        ) : results.length > 0 ? (
          <div>
            {results.map((ph) => {
              const isCurrent = myLink?.pharmacy_id === ph.id
              return (
                <div key={ph.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--ps-space-sm) var(--ps-space-md)',
                  borderBottom: '1px solid var(--ps-off-white)',
                  gap: 'var(--ps-space-md)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{ph.organisation_name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                      ODS: {ph.ods_code}
                      {ph.address1 && ` · ${ph.address1}`}
                      {ph.city && `, ${ph.city}`}
                      {ph.postcode && ` ${ph.postcode}`}
                    </div>
                  </div>
                  {isCurrent ? (
                    <span className="ps-badge ps-badge-green">Current</span>
                  ) : (
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleLink(ph)}
                      disabled={loading}
                    >
                      {loading ? 'Linking…' : 'Link'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : searchTerm && !searching ? (
          <p style={{ color: 'var(--ps-slate)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
            No pharmacies found for "{searchTerm}". Try a different search.
          </p>
        ) : null}
      </div>
    </div>
  )
}
