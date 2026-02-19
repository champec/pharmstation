import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogTemplate, LogCategory } from '@pharmstation/types'

const CATEGORY_CONFIG: Record<LogCategory, { label: string; emoji: string; color: string }> = {
  fridge: { label: 'Fridge', emoji: '🌡️', color: 'var(--ps-electric-cyan)' },
  cleaning: { label: 'Cleaning', emoji: '🧹', color: '#22c55e' },
  cd: { label: 'CD', emoji: '💊', color: '#a855f7' },
  visitor: { label: 'Visitor', emoji: '👤', color: '#f59e0b' },
  date_check: { label: 'Date Check', emoji: '📅', color: '#f97316' },
  custom: { label: 'Custom', emoji: '📋', color: 'var(--ps-slate)' },
}

const CATEGORY_ORDER: LogCategory[] = ['fridge', 'cleaning', 'cd', 'visitor', 'date_check', 'custom']

export function LogLibraryPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    templates,
    subscriptions,
    loading,
    error,
    fetchLibrary,
    fetchSubscriptions,
    subscribeToLibrary,
    clearError,
  } = useLogStore()

  const [search, setSearch] = useState('')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchLibrary()
    if (organisation?.id) fetchSubscriptions(organisation.id)
  }, [fetchLibrary, fetchSubscriptions, organisation?.id])

  // Template IDs already subscribed
  const subscribedTemplateIds = useMemo(() => {
    return new Set(subscriptions.map((s) => s.template_id))
  }, [subscriptions])

  // Group by category and filter
  const grouped = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    const filtered = searchLower
      ? templates.filter(
          (t) =>
            t.title.toLowerCase().includes(searchLower) ||
            t.description.toLowerCase().includes(searchLower) ||
            t.category.toLowerCase().includes(searchLower)
        )
      : templates

    const groups: Record<string, LogTemplate[]> = {}
    for (const t of filtered) {
      const cat = t.category || 'custom'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(t)
    }
    return groups
  }, [templates, search])

  const handleSubscribe = async (template: LogTemplate) => {
    if (!organisation?.id) return
    setSubscribing(template.id)
    setSubscribeError(null)
    setSuccessMsg(null)
    try {
      await subscribeToLibrary(organisation.id, template.id)
      setSuccessMsg(`Subscribed to ${template.title}`)
      setTimeout(() => setSuccessMsg(null), 3000)
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
          <a href="/logs" onClick={(e) => { e.preventDefault(); navigate('/logs') }}>Logs</a>
          <span className="separator">/</span>
          <span>Library</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📚 Log Library</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs')}>
            ← Back to Logs
          </button>
        </div>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Browse platform log templates. Subscribe to add them to your workspace.
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
        <input
          className="ps-input"
          placeholder="Search logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {/* Errors / Success */}
      {(error || subscribeError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || subscribeError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubscribeError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}
      {successMsg && (
        <div style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', background: '#dcfce7', color: '#166534', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
          ✅ {successMsg}
        </div>
      )}

      {/* Loading */}
      {loading && templates.length === 0 && (
        <div className="dashboard-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
              <div style={{ height: 20, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', width: '60%' }} />
              <div style={{ height: 14, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '80%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Grouped templates */}
      {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => {
        const config = CATEGORY_CONFIG[cat]
        const items = grouped[cat]
        return (
          <div key={cat} style={{ marginBottom: 'var(--ps-space-xl)' }}>
            <h2 style={{ fontSize: 'var(--ps-font-lg)', color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>
              {config.emoji} {config.label}
            </h2>
            <div className="dashboard-grid">
              {items.map((t) => {
                const isSubscribed = subscribedTemplateIds.has(t.id)
                return (
                  <div
                    key={t.id}
                    className="ps-card"
                    style={{ padding: 'var(--ps-space-lg)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
                      <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
                        {t.title}
                      </h3>
                      <span
                        className="ps-badge"
                        style={{ background: config.color, color: '#fff', fontSize: 'var(--ps-font-xs)' }}
                      >
                        {config.emoji} {config.label}
                      </span>
                    </div>
                    <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-sm)' }}>
                      {t.description}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-md)' }}>
                      <span className="ps-badge ps-badge-blue" style={{ fontSize: 'var(--ps-font-xs)' }}>
                        🗓 {t.schedule_type === 'sporadic' ? 'Sporadic' : t.schedule_type === 'daily' ? 'Daily' : 'Custom Days'}
                      </span>
                    </div>
                    {isSubscribed ? (
                      <span className="ps-badge ps-badge-green" style={{ fontSize: 'var(--ps-font-xs)' }}>
                        ✅ Already subscribed
                      </span>
                    ) : (
                      <button
                        className="ps-btn ps-btn-primary ps-btn-sm"
                        onClick={() => handleSubscribe(t)}
                        disabled={subscribing === t.id}
                      >
                        {subscribing === t.id ? 'Subscribing…' : '+ Subscribe'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* No results */}
      {!loading && Object.keys(grouped).length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)' }}>No log templates found{search ? ` matching "${search}"` : ''}.</p>
        </div>
      )}
    </div>
  )
}
