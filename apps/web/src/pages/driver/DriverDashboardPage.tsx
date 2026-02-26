import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDriverStore } from '@pharmstation/core'
import type { DeliveryRound, DeliveryRoundStatus } from '@pharmstation/types'

const STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-slate', label: 'Draft' },
  scheduled: { cls: 'ps-badge-blue', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-amber', label: 'In Progress' },
  completed: { cls: 'ps-badge-green', label: 'Completed' },
  cancelled: { cls: 'ps-badge-red', label: 'Cancelled' },
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function DriverDashboardPage() {
  const navigate = useNavigate()
  const { membership } = useAuthStore()
  const { assignedRounds, loading, error, fetchAssignedRounds, clearError } = useDriverStore()

  const load = useCallback(() => {
    if (!membership?.id) return
    fetchAssignedRounds(membership.id)
  }, [membership?.id, fetchAssignedRounds])

  useEffect(() => { load() }, [load])

  const inProgressRounds = assignedRounds.filter((r) => r.status === 'in_progress')
  const scheduledRounds = assignedRounds.filter((r) => r.status === 'scheduled')
  const draftRounds = assignedRounds.filter((r) => r.status === 'draft')

  const countByStatus = (round: DeliveryRound) => {
    const patients = round.patients || []
    return {
      total: patients.length,
      delivered: patients.filter((p) => p.status === 'delivered').length,
      pending: patients.filter((p) => p.status === 'pending').length,
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>🚗 My Deliveries</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: 'var(--ps-space-xs)' }}>
          Your assigned delivery rounds
        </p>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>✕</button>
        </div>
      )}

      {loading && !assignedRounds.length && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
      )}

      {/* In-Progress Rounds — show first */}
      {inProgressRounds.length > 0 && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <h2 style={{ marginBottom: 'var(--ps-space-sm)', fontSize: '1.1rem' }}>🔴 In Progress</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
            {inProgressRounds.map((round) => {
              const counts = countByStatus(round)
              return (
                <div
                  key={round.id}
                  className="ps-card"
                  style={{ padding: 'var(--ps-space-md)', cursor: 'pointer', border: '2px solid var(--ps-primary)' }}
                  onClick={() => navigate(`/driver/${round.id}`)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-xs)' }}>
                    <h3 style={{ margin: 0 }}>{round.title || 'Delivery Round'}</h3>
                    <span className={`ps-badge ${STATUS_BADGE[round.status].cls}`}>{STATUS_BADGE[round.status].label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    <span>📅 {formatDate(round.scheduled_date)}</span>
                    <span>📦 {counts.delivered}/{counts.total} delivered</span>
                    <span>⏳ {counts.pending} remaining</span>
                  </div>
                  {round.time_window && (
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>
                      🕐 {round.time_window}
                    </div>
                  )}
                  <div style={{ marginTop: 'var(--ps-space-sm)' }}>
                    <button className="ps-btn ps-btn-primary ps-btn-sm">Continue Route →</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Scheduled / Upcoming Rounds */}
      {scheduledRounds.length > 0 && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <h2 style={{ marginBottom: 'var(--ps-space-sm)', fontSize: '1.1rem' }}>📋 Upcoming</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
            {scheduledRounds.map((round) => {
              const counts = countByStatus(round)
              return (
                <div
                  key={round.id}
                  className="ps-card"
                  style={{ padding: 'var(--ps-space-md)', cursor: 'pointer' }}
                  onClick={() => navigate(`/driver/${round.id}`)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-xs)' }}>
                    <h3 style={{ margin: 0 }}>{round.title || 'Delivery Round'}</h3>
                    <span className={`ps-badge ${STATUS_BADGE[round.status].cls}`}>{STATUS_BADGE[round.status].label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    <span>📅 {formatDate(round.scheduled_date)}</span>
                    <span>📦 {counts.total} patients</span>
                  </div>
                  {round.time_window && (
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>
                      🕐 {round.time_window}
                    </div>
                  )}
                  {round.notes && (
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4, fontStyle: 'italic' }}>
                      {round.notes}
                    </div>
                  )}
                  <div style={{ marginTop: 'var(--ps-space-sm)' }}>
                    <button className="ps-btn ps-btn-secondary ps-btn-sm">View Route →</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Draft / Pending Schedule Rounds */}
      {draftRounds.length > 0 && (
        <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <h2 style={{ marginBottom: 'var(--ps-space-sm)', fontSize: '1.1rem' }}>📝 Draft (Awaiting Schedule)</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
            {draftRounds.map((round) => {
              const counts = countByStatus(round)
              return (
                <div
                  key={round.id}
                  className="ps-card"
                  style={{ padding: 'var(--ps-space-md)', cursor: 'pointer', opacity: 0.85 }}
                  onClick={() => navigate(`/driver/${round.id}`)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-xs)' }}>
                    <h3 style={{ margin: 0 }}>{round.title || 'Delivery Round'}</h3>
                    <span className={`ps-badge ${STATUS_BADGE[round.status].cls}`}>{STATUS_BADGE[round.status].label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                    <span>📦 {counts.total} patients</span>
                    {round.scheduled_date && <span>📅 {formatDate(round.scheduled_date)}</span>}
                  </div>
                  {round.notes && (
                    <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4, fontStyle: 'italic' }}>
                      {round.notes}
                    </div>
                  )}
                  <div style={{ marginTop: 'var(--ps-space-sm)' }}>
                    <button className="ps-btn ps-btn-ghost ps-btn-sm">View Details →</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && assignedRounds.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 'var(--ps-space-sm)' }}>📭</div>
          <h3>No Assigned Rounds</h3>
          <p style={{ color: 'var(--ps-slate)' }}>You don't have any delivery rounds assigned yet. Check back later.</p>
        </div>
      )}
    </div>
  )
}
