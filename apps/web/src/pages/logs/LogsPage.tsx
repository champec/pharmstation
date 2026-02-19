import { useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogSubscription, LogCategory, LogScheduleType } from '@pharmstation/types'

/* ---- Category styling ---- */

const CATEGORY_CONFIG: Record<LogCategory, { label: string; emoji: string; color: string }> = {
  fridge: { label: 'Fridge', emoji: '🌡️', color: 'var(--ps-electric-cyan)' },
  cleaning: { label: 'Cleaning', emoji: '🧹', color: '#22c55e' },
  cd: { label: 'CD', emoji: '💊', color: '#a855f7' },
  visitor: { label: 'Visitor', emoji: '👤', color: '#f59e0b' },
  date_check: { label: 'Date Check', emoji: '📅', color: '#f97316' },
  custom: { label: 'Custom', emoji: '📋', color: 'var(--ps-slate)' },
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function scheduleLabel(type: LogScheduleType, days?: number[]): string {
  if (type === 'daily') return 'Daily'
  if (type === 'sporadic') return 'Sporadic'
  if (type === 'custom_days' && days?.length) {
    if (days.length === 7) return 'Daily'
    return days.sort().map((d) => DAY_ABBR[d]).join(', ')
  }
  return type
}

function todayStatus(sub: LogSubscription, todayEntryExists: boolean): { icon: string; label: string; cssClass: string } {
  const template = sub.template
  if (!template) return { icon: '—', label: 'Unknown', cssClass: '' }

  if (template.schedule_type === 'sporadic') {
    return { icon: '📝', label: 'Sporadic', cssClass: '' }
  }

  const today = new Date().getDay() // 0=Sun…6=Sat
  const requiredDays = template.required_days || []
  const isRequired = template.schedule_type === 'daily' || requiredDays.includes(today)

  if (!isRequired) return { icon: '➖', label: 'Not Required', cssClass: 'ps-badge-grey' }
  if (todayEntryExists) return { icon: '✅', label: 'Complete', cssClass: 'ps-badge-green' }
  return { icon: '⏳', label: 'Pending', cssClass: 'ps-badge-amber' }
}

export function LogsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { subscriptions, entries, loading, error, fetchSubscriptions, fetchEntries, clearError } = useLogStore()

  const load = useCallback(() => {
    if (organisation?.id) {
      fetchSubscriptions(organisation.id)
    }
  }, [organisation?.id, fetchSubscriptions])

  useEffect(() => { load() }, [load])

  // Build a set of subscription IDs that have entries for today
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const todayEntryBySub = useMemo(() => {
    const map = new Set<string>()
    for (const e of entries) {
      if (e.entry_date === todayStr) map.add(e.subscription_id)
    }
    return map
  }, [entries, todayStr])

  // Fetch today's entries for all subscriptions
  useEffect(() => {
    for (const sub of subscriptions) {
      fetchEntries(sub.id, { start: todayStr, end: todayStr })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptions.length, todayStr])

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Logs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📒 My Logs</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs/library')}>
              📚 Browse Library
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>
              + Create Custom Log
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && subscriptions.length === 0 && (
        <div className="dashboard-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
              <div style={{ height: 20, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', width: '60%' }} />
              <div style={{ height: 14, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '40%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && subscriptions.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>📒</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No logs yet</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)', maxWidth: 400, margin: '0 auto var(--ps-space-lg)' }}>
            You haven't subscribed to any logs yet. Browse the library to get started.
          </p>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/logs/library')}>
              📚 Browse Library
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/logs/new')}>
              + Create Custom Log
            </button>
          </div>
        </div>
      )}

      {/* Log cards */}
      {subscriptions.length > 0 && (
        <div className="dashboard-grid">
          {subscriptions.map((sub) => {
            const template = sub.template
            const cat = template?.category || 'custom'
            const config = CATEGORY_CONFIG[cat as LogCategory] || CATEGORY_CONFIG.custom
            const schedule = scheduleLabel(
              (template?.schedule_type || 'sporadic') as LogScheduleType,
              template?.required_days,
            )
            const status = todayStatus(sub, todayEntryBySub.has(sub.id))

            return (
              <div
                key={sub.id}
                className="ps-card"
                onClick={() => navigate(`/logs/${sub.id}`)}
                style={{
                  padding: 'var(--ps-space-lg)',
                  cursor: 'pointer',
                  transition: 'all var(--ps-transition-fast)',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ps-electric-cyan)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--ps-shadow-md)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = ''
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = ''
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
                  <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
                    {sub.custom_title || template?.title || 'Untitled Log'}
                  </h3>
                  <span
                    className="ps-badge"
                    style={{ background: config.color, color: '#fff', fontSize: 'var(--ps-font-xs)' }}
                  >
                    {config.emoji} {config.label}
                  </span>
                </div>

                <p style={{
                  fontSize: 'var(--ps-font-sm)',
                  color: 'var(--ps-slate)',
                  margin: '0 0 var(--ps-space-md)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {template?.description || ''}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
                  <span className="ps-badge ps-badge-blue" style={{ fontSize: 'var(--ps-font-xs)' }}>
                    🗓 {schedule}
                  </span>
                  <span className={`ps-badge ${status.cssClass}`} style={{ fontSize: 'var(--ps-font-xs)' }}>
                    {status.icon} {status.label}
                  </span>
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/logs/${sub.id}/settings`)
                    }}
                  >
                    ⚙️ Settings
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
