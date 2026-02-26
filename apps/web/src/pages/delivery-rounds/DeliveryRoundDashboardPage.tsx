import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore } from '@pharmstation/core'
import type { DeliveryRound, DeliveryRoundStatus } from '@pharmstation/types'

const STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-slate', label: 'Draft' },
  scheduled: { cls: 'ps-badge-blue', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-amber', label: 'In Progress' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

export function DeliveryRoundDashboardPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { rounds, redeliveryQueue, loading, error, fetchRounds, fetchRedeliveryQueue, clearError } = useDeliveryRoundStore()

  const [tab, setTab] = useState<'active' | 'completed' | 'cancelled'>('active')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    if (!organisation?.id) return
    fetchRounds(organisation.id)
    fetchRedeliveryQueue(organisation.id)
  }, [organisation?.id, fetchRounds, fetchRedeliveryQueue])

  useEffect(() => { load() }, [load])

  const filteredRounds = useMemo(() => {
    let list = rounds
    if (tab === 'active') list = list.filter((r) => ['draft', 'scheduled', 'in_progress'].includes(r.status))
    else if (tab === 'completed') list = list.filter((r) => r.status === 'completed')
    else list = list.filter((r) => r.status === 'cancelled')

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((r) =>
        (r.title && r.title.toLowerCase().includes(q)) ||
        r.id.includes(q)
      )
    }
    return list
  }, [rounds, tab, search])

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  const formatTime = (t: string | null) => t ? t.slice(0, 5) : ''

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Delivery Rounds</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🚚 Delivery Rounds</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            {redeliveryQueue.length > 0 && (
              <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/delivery-rounds/redelivery')}>
                ⚠️ Redelivery Queue ({redeliveryQueue.length})
              </button>
            )}
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/delivery-rounds/templates')}>
              Templates
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/delivery-rounds/new')}>
              + New Round
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', borderBottom: '2px solid var(--ps-off-white)', paddingBottom: 'var(--ps-space-sm)' }}>
        {(['active', 'completed', 'cancelled'] as const).map((t) => (
          <button
            key={t}
            className={`ps-btn ps-btn-ghost ${tab === t ? 'ps-btn-active' : ''}`}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize', fontWeight: tab === t ? 600 : 400, borderBottom: tab === t ? '2px solid var(--ps-primary)' : 'none' }}
          >
            {t === 'active' ? 'Active' : t === 'completed' ? 'Completed' : 'Cancelled'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 'var(--ps-space-md)' }}>
        <input
          className="ps-input"
          placeholder="Search rounds by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {/* Loading */}
      {loading && rounds.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading delivery rounds…</div>
      )}

      {/* Empty */}
      {!loading && rounds.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>🚚</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No delivery rounds yet</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Create your first delivery round to get started.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/delivery-rounds/new')}>+ New Round</button>
        </div>
      )}

      {/* Rounds List */}
      {filteredRounds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
          {filteredRounds.map((round) => (
            <div
              key={round.id}
              className="ps-card"
              style={{ padding: 'var(--ps-space-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => navigate(`/delivery-rounds/${round.id}`)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ps-primary)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ps-midnight)' }}>
                    {round.title || `Round ${round.id.slice(0, 8)}`}
                  </div>
                  <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 2 }}>
                    {formatDate(round.scheduled_date)}
                    {round.scheduled_time_start && ` · ${formatTime(round.scheduled_time_start)}`}
                    {round.scheduled_time_end && `–${formatTime(round.scheduled_time_end)}`}
                    {' · '}
                    {round.patients?.length ?? 0} patient{(round.patients?.length ?? 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)' }}>
                {round.driver && (
                  <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    🚗 {(round.driver as any).user_profile?.full_name}
                  </span>
                )}
                <span className={`ps-badge ${STATUS_BADGE[round.status]?.cls ?? 'ps-badge-slate'}`}>
                  {STATUS_BADGE[round.status]?.label ?? round.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {search && filteredRounds.length === 0 && rounds.length > 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg)', color: 'var(--ps-slate)' }}>
          No rounds match "{search}"
        </div>
      )}
    </div>
  )
}
