import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore } from '@pharmstation/core'
import type { DeliveryRound, DeliveryRoundStatus } from '@pharmstation/types'

// Kanban columns mapped onto the delivery-round lifecycle, mirroring the
// care-home groups board so the two modules feel like one system.
const columns: Array<{
  key: 'draft' | 'scheduled' | 'in_progress' | 'completed'
  statuses: DeliveryRoundStatus[]
  label: string
  hint: string
  accent: string
}> = [
  { key: 'draft', statuses: ['draft'], label: 'Draft', hint: 'Being built — add patients and medicines', accent: 'idle' },
  { key: 'scheduled', statuses: ['scheduled'], label: 'Scheduled', hint: 'Ready to go, awaiting the driver', accent: 'ready' },
  { key: 'in_progress', statuses: ['in_progress'], label: 'Out for delivery', hint: 'Driver is on the road', accent: 'in_transit' },
  { key: 'completed', statuses: ['completed'], label: 'Completed', hint: 'Delivered and closed off', accent: 'delivered' },
]

const STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-muted', label: 'Draft' },
  scheduled: { cls: 'ps-badge-primary', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-blue', label: 'In transit' },
  completed: { cls: 'ps-badge-success', label: 'Completed' },
  cancelled: { cls: 'ps-badge-danger', label: 'Cancelled' },
}

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No date set'
}

function formatTime(value: string | null) {
  return value ? value.slice(0, 5) : ''
}

export function DeliveryRoundDashboardPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { rounds, redeliveryQueue, loading, error, fetchRounds, fetchRedeliveryQueue, clearError } = useDeliveryRoundStore()

  const [search, setSearch] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  const load = useCallback(() => {
    if (!organisation?.id) return
    fetchRounds(organisation.id)
    fetchRedeliveryQueue(organisation.id)
  }, [organisation?.id, fetchRounds, fetchRedeliveryQueue])

  useEffect(() => { load() }, [load])

  const visibleRounds = useMemo(() => {
    let list = rounds.filter((round) => round.status !== 'cancelled')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((round) =>
        (round.title && round.title.toLowerCase().includes(q)) || round.id.includes(q),
      )
    }
    return list
  }, [rounds, search])

  const renderCard = (round: DeliveryRound) => {
    const patientCount = round.patients?.length ?? 0
    const driverName = (round.driver as { user_profile?: { full_name?: string } } | null)?.user_profile?.full_name
    return (
      <button
        key={round.id}
        type="button"
        className="care-home-group-card"
        onClick={() => navigate(`/deliveries/${round.id}`)}
      >
        <div className="care-home-group-card-top">
          <strong>{round.title || `Delivery ${round.id.slice(0, 8)}`}</strong>
          <span className={`ps-badge ${STATUS_BADGE[round.status]?.cls ?? 'ps-badge-muted'}`}>
            {STATUS_BADGE[round.status]?.label ?? round.status}
          </span>
        </div>
        <div className="care-home-group-card-meta">
          <span>{patientCount} patient{patientCount === 1 ? '' : 's'}</span>
          {round.care_home_batch_id && <span>Care home</span>}
        </div>
        <small className="care-home-group-card-batch">
          {formatDate(round.scheduled_date)}
          {round.scheduled_time_start && ` · ${formatTime(round.scheduled_time_start)}`}
          {round.scheduled_time_end && `–${formatTime(round.scheduled_time_end)}`}
        </small>
        {driverName && <small className="care-home-group-card-time">🚗 {driverName}</small>}
      </button>
    )
  }

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Deliveries</span>
        </div>
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Delivery workflow</p>
            <h1>Deliveries</h1>
            <p className="care-home-subtitle">
              Plan, pack and track medicine deliveries to patients at home.
            </p>
          </div>
          <div className="care-home-header-actions care-home-no-print">
            {redeliveryQueue.length > 0 && (
              <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate('/deliveries/redelivery')}>
                ⚠️ Redelivery queue ({redeliveryQueue.length})
              </button>
            )}
            <button className="ps-btn ps-btn-secondary" type="button" onClick={() => navigate('/deliveries/templates')}>
              Templates
            </button>
            <button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/deliveries/new')}>
              + New delivery
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error care-home-alert" role="alert">
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}

      <div className="care-home-context-bar care-home-no-print">
        <input
          className="ps-input"
          placeholder="Search deliveries by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <label className="care-home-check-label">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
        <span className="care-home-filter-count">{visibleRounds.length} active</span>
      </div>

      {loading && rounds.length === 0 ? (
        <div className="care-home-loading">Loading deliveries...</div>
      ) : rounds.length === 0 ? (
        <section className="care-home-empty">
          <p className="care-home-empty-mark" aria-hidden="true">🚚</p>
          <h2>No deliveries yet</h2>
          <p>Create your first delivery to plan a route and pack medicines for your patients.</p>
          <button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/deliveries/new')}>+ New delivery</button>
        </section>
      ) : (
        <div className="care-home-kanban">
          {columns
            .filter((column) => showCompleted || column.key !== 'completed')
            .map((column) => {
              const columnRounds = visibleRounds.filter((round) => column.statuses.includes(round.status))
              return (
                <section key={column.key} className={`care-home-kanban-column care-home-kanban-${column.accent}`}>
                  <header>
                    <h3>{column.label}</h3>
                    <span className="care-home-kanban-count">{columnRounds.length}</span>
                  </header>
                  <p className="care-home-kanban-hint">{column.hint}</p>
                  <div className="care-home-kanban-cards">
                    {columnRounds.length === 0 ? (
                      column.key === 'draft' ? (
                        <button type="button" className="care-home-kanban-add care-home-no-print" onClick={() => navigate('/deliveries/new')}>
                          + New delivery
                        </button>
                      ) : (
                        <div className="care-home-kanban-empty">Nothing here</div>
                      )
                    ) : columnRounds.map(renderCard)}
                  </div>
                </section>
              )
            })}
        </div>
      )}

      {search && visibleRounds.length === 0 && rounds.length > 0 && (
        <div className="care-home-inline-empty">No deliveries match "{search}"</div>
      )}
    </div>
  )
}
