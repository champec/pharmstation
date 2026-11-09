import { useEffect, useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDriverStore, formatTimeWindow } from '@pharmstation/core'
import type { DeliveryRound, DeliveryRoundStatus } from '@pharmstation/types'

const STATUS_BADGE: Record<DeliveryRoundStatus, { cls: string; label: string }> = {
  draft: { cls: 'ps-badge-muted', label: 'Draft' },
  scheduled: { cls: 'ps-badge-primary', label: 'Scheduled' },
  in_progress: { cls: 'ps-badge-amber', label: 'In progress' },
  completed: { cls: 'ps-badge-success', label: 'Completed' },
  cancelled: { cls: 'ps-badge-danger', label: 'Cancelled' },
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No date set'
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function counts(round: DeliveryRound) {
  const stops = round.patients || []
  return {
    total: stops.length,
    delivered: stops.filter((p) => p.status === 'delivered').length,
    pending: stops.filter((p) => p.status === 'pending').length,
    notDelivered: stops.filter((p) => p.status !== 'delivered' && p.status !== 'pending').length,
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 'var(--ps-space-lg)' }}>
      <h2 style={{ margin: '0 0 var(--ps-space-sm)', fontSize: 'var(--ps-font-lg)' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>{children}</div>
    </section>
  )
}

function RoundCard({
  round,
  badge,
  details,
  action,
  highlight,
  onOpen,
}: {
  round: DeliveryRound
  badge?: { cls: string; label: string }
  details: ReactNode[]
  action?: ReactNode
  highlight?: boolean
  onOpen?: () => void
}) {
  const b = badge ?? STATUS_BADGE[round.status]
  const window = formatTimeWindow(round.scheduled_time_start, round.scheduled_time_end)
  return (
    <div
      className="ps-card"
      role={onOpen ? 'link' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }}
      style={{
        padding: 'var(--ps-space-md)',
        cursor: onOpen ? 'pointer' : 'default',
        border: highlight ? '2px solid var(--ps-deep-blue)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-xs)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--ps-font-base)' }}>{round.title || 'Delivery round'}</h3>
        <span className={`ps-badge ${b.cls}`}>{b.label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ps-space-xs) var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
        {details.map((d, i) => <span key={i}>{d}</span>)}
        {window && <span>{window[0].toUpperCase() + window.slice(1)}</span>}
      </div>
      {round.notes && (
        <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 'var(--ps-space-xs)', fontStyle: 'italic' }}>
          {round.notes}
        </div>
      )}
      {action && <div style={{ marginTop: 'var(--ps-space-sm)' }}>{action}</div>}
    </div>
  )
}

export function DriverDashboardPage() {
  const navigate = useNavigate()
  const { membership } = useAuthStore()
  const { assignedRounds, openRounds, recentRounds, loading, error, fetchAssignedRounds, claimRound, clearError } = useDriverStore()
  const [claiming, setClaiming] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!membership?.id) return
    fetchAssignedRounds(membership.id, membership.organisation_id)
  }, [membership?.id, membership?.organisation_id, fetchAssignedRounds])

  useEffect(() => { load() }, [load])

  const handleClaim = async (roundId: string) => {
    if (!membership?.id) return
    setClaiming(roundId)
    try {
      await claimRound(roundId, membership.id)
      navigate(`/driver/${roundId}`)
    } catch (e: any) {
      alert(e.message)
      load()
    }
    setClaiming(null)
  }

  const inProgress = assignedRounds.filter((r) => r.status === 'in_progress')
  const upcoming = assignedRounds.filter((r) => r.status === 'scheduled')
  const drafts = assignedRounds.filter((r) => r.status === 'draft')
  const nothingToDo = !loading && assignedRounds.length === 0 && openRounds.length === 0

  return (
    <div className="care-home-page">
      <div className="page-header care-home-page-header">
        <div className="care-home-title-row">
          <div>
            <p className="care-home-eyebrow">Driver</p>
            <h1>My deliveries</h1>
            <p className="care-home-subtitle">Rounds assigned to you, open rounds you can take, and what you delivered recently.</p>
          </div>
          <div className="care-home-header-actions">
            <button className="ps-btn ps-btn-secondary" type="button" onClick={load} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
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

      {loading && !assignedRounds.length && !openRounds.length && (
        <div className="care-home-loading">Loading your rounds…</div>
      )}

      {inProgress.length > 0 && (
        <Section title="On the road now">
          {inProgress.map((round) => {
            const c = counts(round)
            return (
              <RoundCard
                key={round.id}
                round={round}
                highlight
                onOpen={() => navigate(`/driver/${round.id}`)}
                details={[formatDate(round.scheduled_date), `${c.delivered} of ${c.total} delivered`, `${c.pending} to go`]}
                action={<button type="button" className="ps-btn ps-btn-primary ps-btn-sm">Continue route →</button>}
              />
            )
          })}
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Upcoming">
          {upcoming.map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              onOpen={() => navigate(`/driver/${round.id}`)}
              details={[formatDate(round.scheduled_date), `${counts(round).total} stops`]}
              action={<button type="button" className="ps-btn ps-btn-secondary ps-btn-sm">View route →</button>}
            />
          ))}
        </Section>
      )}

      {openRounds.length > 0 && (
        <Section title="Open rounds you can take">
          {openRounds.map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              badge={{ cls: 'ps-badge-outline', label: 'No driver' }}
              details={[formatDate(round.scheduled_date), `${(round.patients || []).length} stops`]}
              action={(
                <button
                  type="button"
                  className="ps-btn ps-btn-primary ps-btn-sm"
                  onClick={() => handleClaim(round.id)}
                  disabled={claiming !== null}
                >
                  {claiming === round.id ? 'Taking…' : 'Take this round'}
                </button>
              )}
            />
          ))}
        </Section>
      )}

      {drafts.length > 0 && (
        <Section title="Being planned">
          {drafts.map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              onOpen={() => navigate(`/driver/${round.id}`)}
              details={[`${counts(round).total} stops`, round.scheduled_date ? formatDate(round.scheduled_date) : 'Not scheduled yet']}
            />
          ))}
        </Section>
      )}

      {nothingToDo && (
        <section className="care-home-empty" style={{ marginTop: 'var(--ps-space-lg)' }}>
          <h2>No rounds for you right now</h2>
          <p>When the pharmacy assigns you a round, or posts one any driver can take, it will show here.</p>
        </section>
      )}

      {recentRounds.length > 0 && (
        <Section title="Delivered in the last 30 days">
          {recentRounds.map((round) => {
            const c = counts(round)
            const finished = round.completed_at
              ? new Date(round.completed_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              : formatDate(round.scheduled_date)
            return (
              <RoundCard
                key={round.id}
                round={round}
                onOpen={() => navigate(`/driver/${round.id}`)}
                details={[`Finished ${finished}`, `${c.delivered} of ${c.total} delivered`, ...(c.notDelivered ? [`${c.notDelivered} not delivered`] : [])]}
              />
            )
          })}
        </Section>
      )}
    </div>
  )
}
