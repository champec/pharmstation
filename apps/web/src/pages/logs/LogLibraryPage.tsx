import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogTemplate, LogCategory } from '@pharmstation/types'
import { CATEGORY_CONFIG, categoryOf, scheduleLabel } from './logUtils'
import { Celebration, useCelebration } from './LogBits'

const FILTERS: ('all' | LogCategory)[] = ['all', 'fridge', 'cleaning', 'cd', 'visitor', 'date_check', 'custom']

export function LogLibraryPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { templates, subscriptions, loading, error, fetchLibrary, fetchSubscriptions, subscribeToLibrary, clearError } = useLogStore()
  const { celebration, celebrate, dismiss } = useCelebration()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | LogCategory>('all')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)

  useEffect(() => {
    fetchLibrary()
    if (organisation?.id) fetchSubscriptions(organisation.id)
  }, [fetchLibrary, fetchSubscriptions, organisation?.id])

  const subByTemplate = useMemo(() => new Map(subscriptions.map((s) => [s.template_id, s.id])), [subscriptions])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return templates
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
      .filter((t) => category === 'all' || t.category === category)
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [category, templates, search])

  const handleAdd = async (template: LogTemplate) => {
    if (!organisation?.id) return
    setSubscribing(template.id)
    setSubscribeError(null)
    try {
      await subscribeToLibrary(organisation.id, template.id)
      celebrate(`${template.title} added`, 'It is now on your Logs page.', categoryOf(template).emoji)
    } catch (e) {
      setSubscribeError(e instanceof Error ? e.message : 'Could not add this log')
    } finally {
      setSubscribing(null)
    }
  }

  const fieldCount = (t: LogTemplate) => {
    const f = (t as unknown as { fields?: { count: number }[] }).fields
    return Array.isArray(f) && f[0] && typeof f[0].count === 'number' ? f[0].count : null
  }

  return (
    <div className="logs-page">
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/logs" onClick={(e) => { e.preventDefault(); navigate('/logs') }}>Logs</a>
          <span className="separator">/</span>
          <span>Library</span>
        </div>
        <div className="logs-header">
          <div>
            <h1>Log library</h1>
            <p className="log-muted">Ready-made logs for UK pharmacies. Add one in a click; you can rename it later.</p>
          </div>
          <div className="logs-header-actions">
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs')}>← My logs</button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>+ Build your own</button>
          </div>
        </div>
      </div>

      <div className="log-library-filters">
        <input className="ps-input" placeholder="Search logs…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search logs" />
        <div className="log-chips">
          {FILTERS.map((c) => (
            <button key={c} className={`log-chip${category === c ? ' is-on' : ''}`} onClick={() => setCategory(c)}>
              {c === 'all' ? 'All' : `${CATEGORY_CONFIG[c].emoji} ${CATEGORY_CONFIG[c].label}`}
            </button>
          ))}
        </div>
      </div>

      {(error || subscribeError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || subscribeError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setSubscribeError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {loading && templates.length === 0 && (
        <div className="logs-grid">{[1, 2, 3].map((i) => <div key={i} className="log-card log-card-skeleton" />)}</div>
      )}

      {filtered.length > 0 && (
        <div className="logs-grid">
          {filtered.map((template) => {
            const cat = categoryOf(template)
            const subId = subByTemplate.get(template.id)
            const n = fieldCount(template)
            return (
              <article key={template.id} className="log-card log-library-card" style={{ ['--cat' as string]: cat.color, ['--cat-tint' as string]: cat.tint }}>
                <div className="log-card-main as-div">
                  <div className="log-card-top">
                    <span className="log-card-emoji" aria-hidden>{cat.emoji}</span>
                    <div className="log-card-titles">
                      <h3>{template.title}</h3>
                      <span className="log-muted">{scheduleLabel(template.schedule_type, template.required_days)}{n ? ` · ${n} fields` : ''}</span>
                    </div>
                  </div>
                  <p className="log-library-desc">{template.description}</p>
                </div>
                <div className="log-card-actions">
                  {subId ? (
                    <>
                      <span className="log-status ok">✓ In your logs</span>
                      <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate(`/logs/${subId}`)}>Open</button>
                    </>
                  ) : (
                    <button className="ps-btn ps-btn-primary ps-btn-sm log-cta" onClick={() => handleAdd(template)} disabled={subscribing === template.id}>
                      {subscribing === template.id ? 'Adding…' : '+ Add to my logs'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="ps-card logs-empty">
          <p className="log-muted">No logs found{search ? ` matching "${search}"` : ''}. You can always build your own.</p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>+ Build your own</button>
        </div>
      )}

      <Celebration state={celebration} onDismiss={dismiss} />
    </div>
  )
}
