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
  const [category, setCategory] = useState<'all' | LogCategory>('all')
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

  const filteredTemplates = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    return (searchLower
      ? templates.filter(
          (t) =>
            t.title.toLowerCase().includes(searchLower) ||
            t.description.toLowerCase().includes(searchLower) ||
            t.category.toLowerCase().includes(searchLower)
        )
      : templates)
      .filter((template) => category === 'all' || template.category === category)
      .sort((left, right) => left.title.localeCompare(right.title))
  }, [category, templates, search])

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
          <div>
            <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>📚 Log Library</h1>
            <p style={{ color: 'var(--ps-slate)', margin: 0 }}>
              Browse platform log templates as cards, subscribe to what you need, then head back to the log menu.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs')}>
              ← Back to Logs
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>
              + Create Custom Log
            </button>
          </div>
        </div>
      </div>

      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 'var(--ps-space-sm)' }}>
          <input
            className="ps-input"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="ps-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'all' | LogCategory)}
          >
            <option value="all">All categories</option>
            <option value="fridge">Fridge</option>
            <option value="cleaning">Cleaning</option>
            <option value="cd">CD</option>
            <option value="visitor">Visitor</option>
            <option value="date_check">Date Check</option>
            <option value="custom">Custom</option>
          </select>
        </div>
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

      {filteredTemplates.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 'var(--ps-space-md)',
          }}
        >
          {filteredTemplates.map((template) => {
            const config = CATEGORY_CONFIG[template.category]
            const isSubscribed = subscribedTemplateIds.has(template.id)
            return (
              <div
                key={template.id}
                className="ps-card"
                style={{
                  padding: 'var(--ps-space-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 220,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
                  <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
                    {template.title}
                  </h3>
                  <span
                    className="ps-badge"
                    style={{ background: config.color, color: '#fff', fontSize: 'var(--ps-font-xs)', whiteSpace: 'nowrap' }}
                  >
                    {config.emoji} {config.label}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', flex: 1 }}>
                  {template.description}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', flexWrap: 'wrap', marginBottom: 'var(--ps-space-md)' }}>
                  <span className="ps-badge ps-badge-blue" style={{ fontSize: 'var(--ps-font-xs)' }}>
                    🗓 {template.schedule_type === 'sporadic' ? 'Sporadic' : template.schedule_type === 'daily' ? 'Daily' : 'Custom Days'}
                  </span>
                </div>
                {isSubscribed ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-sm)', marginTop: 'auto' }}>
                    <span className="ps-badge ps-badge-green" style={{ fontSize: 'var(--ps-font-xs)' }}>
                      ✅ Already subscribed
                    </span>
                    <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate('/logs')}>
                      Back to Logs
                    </button>
                  </div>
                ) : (
                  <button
                    className="ps-btn ps-btn-primary ps-btn-sm"
                    onClick={() => handleSubscribe(template)}
                    disabled={subscribing === template.id}
                    style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
                  >
                    {subscribing === template.id ? 'Subscribing…' : '+ Subscribe'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* No results */}
      {!loading && filteredTemplates.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)' }}>No log templates found{search ? ` matching "${search}"` : ''}.</p>
        </div>
      )}
    </div>
  )
}
