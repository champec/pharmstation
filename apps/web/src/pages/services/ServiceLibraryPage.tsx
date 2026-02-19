import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore } from '@pharmstation/core'
import type { ServiceLibraryItem } from '@pharmstation/types'

const CATEGORY_LABELS: Record<string, string> = {
  vaccination: '💉 Vaccinations',
  screening: '🔬 Screening',
  consultation: '🗣 Consultations',
  pharmacy_first: '🏥 Pharmacy First',
  general: '📋 General',
}

const CATEGORY_ORDER = ['vaccination', 'screening', 'consultation', 'pharmacy_first', 'general']

export function ServiceLibraryPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    libraryItems,
    services,
    loading,
    error,
    fetchLibrary,
    fetchServices,
    subscribeToLibraryService,
    clearError,
  } = useServiceStore()

  const [search, setSearch] = useState('')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)

  useEffect(() => {
    fetchLibrary()
    if (organisation?.id) {
      fetchServices(organisation.id)
    }
  }, [fetchLibrary, fetchServices, organisation?.id])

  // Set of library service IDs already subscribed
  const subscribedLibraryIds = useMemo(() => {
    return new Set(services.filter((s) => s.library_service_id).map((s) => s.library_service_id!))
  }, [services])

  // Filter + group by category
  const grouped = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    const filtered = searchLower
      ? libraryItems.filter(
          (item) =>
            item.name.toLowerCase().includes(searchLower) ||
            item.description.toLowerCase().includes(searchLower) ||
            item.category.toLowerCase().includes(searchLower)
        )
      : libraryItems

    const groups: Record<string, ServiceLibraryItem[]> = {}
    for (const item of filtered) {
      const cat = item.category || 'general'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    return groups
  }, [libraryItems, search])

  const handleSubscribe = async (libraryItemId: string) => {
    if (!organisation?.id) return
    setSubscribing(libraryItemId)
    setSubscribeError(null)
    try {
      await subscribeToLibraryService(organisation.id, libraryItemId)
    } catch (e: any) {
      setSubscribeError(e.message)
    } finally {
      setSubscribing(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <span>Library</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📚 Service Library</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
            ← Back to Services
          </button>
        </div>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Browse and adopt standard UK pharmacy services. Customise them after adding.
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
        <input
          className="ps-input"
          placeholder="Search services…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {/* Errors */}
      {(error || subscribeError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || subscribeError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubscribeError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && libraryItems.length === 0 && (
        <div className="dashboard-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
              <div style={{ height: 18, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', width: '70%' }} />
              <div style={{ height: 14, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '90%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Grouped library items */}
      {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
        <div key={cat} style={{ marginBottom: 'var(--ps-space-xl)' }}>
          <h2 style={{
            fontSize: 'var(--ps-font-lg)',
            fontWeight: 600,
            color: 'var(--ps-midnight)',
            marginBottom: 'var(--ps-space-md)',
          }}>
            {CATEGORY_LABELS[cat] || cat}
          </h2>

          <div className="dashboard-grid">
            {grouped[cat].map((item) => {
              const alreadyAdded = subscribedLibraryIds.has(item.id)
              const isSubscribing = subscribing === item.id

              return (
                <div key={item.id} className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
                  <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: '0 0 var(--ps-space-xs)' }}>
                    {item.name}
                  </h3>
                  <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)' }}>
                    {item.description}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="ps-badge ps-badge-blue">{CATEGORY_LABELS[item.category]?.split(' ')[0] || '📋'} {item.category}</span>
                    {alreadyAdded ? (
                      <span className="ps-badge ps-badge-green">✓ Added</span>
                    ) : (
                      <button
                        className="ps-btn ps-btn-primary ps-btn-sm"
                        onClick={() => handleSubscribe(item.id)}
                        disabled={isSubscribing}
                      >
                        {isSubscribing ? 'Adding…' : '+ Add to My Services'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* No results */}
      {!loading && Object.keys(grouped).length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)' }}>No services match your search.</p>
        </div>
      )}
    </div>
  )
}
