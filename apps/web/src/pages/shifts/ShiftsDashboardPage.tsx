import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface ShiftRow {
  id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  status: string
  booking_mode: string
  _booking_count?: number
}

interface Stats {
  open: number
  confirmed: number
  pendingApplications: number
  completedThisMonth: number
}

function fmt(time: string) {
  return time.slice(0, 5)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'open': return 'ps-badge ps-badge-success'
    case 'draft': return 'ps-badge ps-badge-warning'
    case 'confirmed': return 'ps-badge ps-badge-primary'
    case 'completed': return 'ps-badge ps-badge-muted'
    case 'cancelled': return 'ps-badge ps-badge-danger'
    default: return 'ps-badge'
  }
}

export function ShiftsDashboardPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()

  const [stats, setStats] = useState<Stats>({ open: 0, confirmed: 0, pendingApplications: 0, completedThisMonth: 0 })
  const [upcomingShifts, setUpcomingShifts] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organisation?.id) return
    const orgId = organisation.id
    const client = getUserClient()
    const today = new Date().toISOString().split('T')[0]
    const inTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    const startOfMonthStr = startOfMonth.toISOString().split('T')[0]

    setLoading(true)
    setError(null)

    try {
      const [openRes, confirmedRes, completedRes, upcomingRes] = await Promise.all([
        // Open shifts (date >= today)
        client
          .from('ps_locum_shifts')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .in('status', ['open', 'draft'])
          .gte('date', today),

        // Confirmed upcoming
        client
          .from('ps_locum_shifts')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('status', 'confirmed')
          .gte('date', today),

        // Completed this month
        client
          .from('ps_locum_shifts')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('status', 'completed')
          .gte('date', startOfMonthStr),

        // Upcoming shifts list (next 14 days)
        client
          .from('ps_locum_shifts')
          .select('id, date, start_time, end_time, rate_per_hour, status, booking_mode')
          .eq('org_id', orgId)
          .in('status', ['open', 'draft', 'confirmed'])
          .gte('date', today)
          .lte('date', inTwoWeeks)
          .order('date')
          .order('start_time')
          .limit(10),
      ])

      // Pending applications — count bookings with status=pending for this org's shifts
      const shiftIds = (upcomingRes.data ?? []).map((s: { id: string }) => s.id)
      let pendingCount = 0
      if (shiftIds.length > 0) {
        const { count } = await client
          .from('ps_locum_bookings')
          .select('id', { count: 'exact', head: true })
          .in('shift_id', shiftIds)
          .eq('status', 'pending')
        pendingCount = count ?? 0
      }

      // Also get global pending across all org shifts
      const { data: allOrgShifts } = await client
        .from('ps_locum_shifts')
        .select('id')
        .eq('org_id', orgId)
      
      if (allOrgShifts && allOrgShifts.length > 0) {
        const allIds = allOrgShifts.map((s: { id: string }) => s.id)
        const { count } = await client
          .from('ps_locum_bookings')
          .select('id', { count: 'exact', head: true })
          .in('shift_id', allIds)
          .eq('status', 'pending')
        pendingCount = count ?? 0
      }

      setStats({
        open: openRes.count ?? 0,
        confirmed: confirmedRes.count ?? 0,
        pendingApplications: pendingCount,
        completedThisMonth: completedRes.count ?? 0,
      })

      setUpcomingShifts((upcomingRes.data as ShiftRow[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts data')
    } finally {
      setLoading(false)
    }
  }, [organisation?.id])

  useEffect(() => { load() }, [load])

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shifts Overview</h1>
          <p className="page-subtitle">Manage locum shifts for {organisation?.name ?? 'your pharmacy'}</p>
        </div>
        <div className="page-header-actions">
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
          <Link to="/shifts/new" className="ps-btn ps-btn-primary ps-btn-sm">
            + Post Shift
          </Link>
        </div>
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {/* Stats cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-card-label">Open Shifts</div>
          <div className="stat-card-value">{loading ? '…' : stats.open}</div>
          <Link to="/shifts/calendar" className="stat-card-link">View calendar →</Link>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-card-label">Pending Applications</div>
          <div className="stat-card-value">{loading ? '…' : stats.pendingApplications}</div>
          <Link to="/shifts" className="stat-card-link">Review applicants →</Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Confirmed (upcoming)</div>
          <div className="stat-card-value">{loading ? '…' : stats.confirmed}</div>
          <Link to="/shifts/calendar" className="stat-card-link">View calendar →</Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Completed (this month)</div>
          <div className="stat-card-value">{loading ? '…' : stats.completedThisMonth}</div>
          <Link to="/shifts/payments" className="stat-card-link">View payments →</Link>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <Link to="/shifts/new" className="ps-btn ps-btn-primary">Post a Shift</Link>
        <Link to="/shifts/calendar" className="ps-btn ps-btn-outline">Shift Calendar</Link>
        <Link to="/shifts/locums" className="ps-btn ps-btn-outline">Locum Directory</Link>
        <Link to="/shifts/sops" className="ps-btn ps-btn-outline">Manage SOPs</Link>
        <Link to="/shifts/payments" className="ps-btn ps-btn-outline">Payments</Link>
      </div>

      {/* Upcoming shifts table */}
      <div className="ps-card">
        <div className="ps-card-header">
          <h2 className="ps-card-title">Upcoming Shifts (next 14 days)</h2>
        </div>
        {loading ? (
          <div className="loading-indicator" style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
        ) : upcomingShifts.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">No upcoming shifts in the next 14 days.</p>
            <Link to="/shifts/new" className="ps-btn ps-btn-primary ps-btn-sm" style={{ marginTop: '1rem' }}>
              Post your first shift
            </Link>
          </div>
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Rate</th>
                <th>Mode</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {upcomingShifts.map((shift) => (
                <tr key={shift.id}>
                  <td>{fmtDate(shift.date)}</td>
                  <td>{fmt(shift.start_time)} – {fmt(shift.end_time)}</td>
                  <td>£{Number(shift.rate_per_hour).toFixed(2)}/hr</td>
                  <td><span className="ps-badge">{shift.booking_mode}</span></td>
                  <td><span className={statusBadgeClass(shift.status)}>{shift.status}</span></td>
                  <td>
                    <button
                      className="ps-btn ps-btn-ghost ps-btn-xs"
                      onClick={() => navigate(`/shifts/${shift.id}`)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
