import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface UpcomingBooking {
  id: string
  shift_id: string
  status: string
  shift: { date: string; start_time: string; end_time: string; rate_per_hour: number; org_id: string } | null
}

interface RecentInvoice {
  id: string
  invoice_number: string
  week_start: string
  week_end: string
  total_pence: number
  status: string
  due_date: string
}

interface ExpiryAlert {
  label: string
  expiry: string
  daysLeft: number
}

function fmt(t: string) { return t.slice(0, 5) }
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}
function penceToGBP(p: number) { return `£${(p / 100).toFixed(2)}` }

const INV_BADGE: Record<string, string> = {
  pending: 'ps-badge ps-badge-warning',
  processing: 'ps-badge ps-badge-primary',
  paid: 'ps-badge ps-badge-success',
  overdue: 'ps-badge ps-badge-danger',
}

export function LocumDashboardPage() {
  const navigate = useNavigate()
  const { activeUser: userProfile, locumProfile } = useAuthStore()

  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([])
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locumProfile) return
    const client = getUserClient()
    const today = new Date().toISOString().split('T')[0]
    setLoading(true)
    setError(null)

    try {
      const [upcomingRes, pendingRes, invoicesRes] = await Promise.all([
        // Upcoming confirmed bookings (this + future shifts)
        client
          .from('ps_locum_bookings')
          .select('id, shift_id, status, shift:ps_locum_shifts(date, start_time, end_time, rate_per_hour, org_id)')
          .eq('locum_id', locumProfile.id)
          .eq('status', 'confirmed')
          .gte('ps_locum_shifts.date', today)
          .order('ps_locum_shifts(date)', { ascending: true })
          .limit(5),

        // Pending applications count
        client
          .from('ps_locum_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('locum_id', locumProfile.id)
          .eq('status', 'pending'),

        // Recent invoices
        client
          .from('ps_locum_invoices')
          .select('id, invoice_number, week_start, week_end, total_pence, status, due_date')
          .eq('locum_id', locumProfile.id)
          .order('week_start', { ascending: false })
          .limit(4),
      ])

      setUpcoming((upcomingRes.data ?? []) as unknown as UpcomingBooking[])
      setPendingCount(pendingRes.count ?? 0)
      setRecentInvoices((invoicesRes.data ?? []) as RecentInvoice[])

      // Expiry alerts from locum profile
      const alerts: ExpiryAlert[] = []
      const addAlert = (label: string, expiry: string | null | undefined) => {
        if (!expiry) return
        const d = daysUntil(expiry)
        if (d <= 60) alerts.push({ label, expiry, daysLeft: d })
      }
      addAlert('GPhC Registration', locumProfile.gphc_expiry)
      addAlert('Indemnity Insurance', locumProfile.indemnity_expiry)
      addAlert('DBS Certificate', locumProfile.dbs_expiry)
      setExpiryAlerts(alerts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [locumProfile])

  useEffect(() => { load() }, [load])

  const firstName = userProfile?.first_name ?? userProfile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's your locum overview</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {expiryAlerts.map((a) => (
            <div key={a.label} className={`ps-alert ${a.daysLeft <= 14 ? 'ps-alert-error' : 'ps-alert-warning'}`}>
              <strong>{a.label}</strong> expires on {new Date(a.expiry).toLocaleDateString('en-GB')}
              {a.daysLeft <= 0 ? ' — EXPIRED' : ` — ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left`}.{' '}
              <Link to="/locum/profile">Update now →</Link>
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="stat-card">
          <div className="stat-card-label">Upcoming Shifts</div>
          <div className="stat-card-value">{loading ? '…' : upcoming.length}</div>
          <Link to="/locum/bookings" className="stat-card-link">View bookings →</Link>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-card-label">Pending Applications</div>
          <div className="stat-card-value">{loading ? '…' : pendingCount}</div>
          <Link to="/locum/bookings" className="stat-card-link">View pending →</Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Invoices</div>
          <div className="stat-card-value">{loading ? '…' : recentInvoices.length}</div>
          <Link to="/locum/invoices" className="stat-card-link">View invoices →</Link>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Stripe Account</div>
          <div className="stat-card-value">{locumProfile?.stripe_onboarded ? '✓ Connected' : '—'}</div>
          <Link to="/locum/profile" className="stat-card-link">Profile →</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Upcoming shifts */}
        <div className="ps-card">
          <div className="ps-card-header">
            <h2 className="ps-card-title">Upcoming Shifts</h2>
            <Link to="/locum/bookings" className="ps-btn ps-btn-ghost ps-btn-xs">View all</Link>
          </div>
          {loading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
          ) : upcoming.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
              <p className="text-muted">No upcoming shifts.</p>
              <Link to="/locum/shifts" className="ps-btn ps-btn-primary ps-btn-sm" style={{ marginTop: '0.75rem' }}>Browse Shifts</Link>
            </div>
          ) : (
            <div style={{ padding: '0.5rem 0' }}>
              {upcoming.map((b) => b.shift && (
                <div key={b.id} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ps-border)' }}
                  className="hover-row" onClick={() => navigate('/locum/bookings')}>
                  <div style={{ fontWeight: 600 }}>{fmtDate(b.shift.date)}</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--ps-slate)' }}>
                    {fmt(b.shift.start_time)} – {fmt(b.shift.end_time)} · £{Number(b.shift.rate_per_hour).toFixed(2)}/hr
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent invoices */}
        <div className="ps-card">
          <div className="ps-card-header">
            <h2 className="ps-card-title">Recent Invoices</h2>
            <Link to="/locum/invoices" className="ps-btn ps-btn-ghost ps-btn-xs">View all</Link>
          </div>
          {loading ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--ps-slate)' }}>Loading…</div>
          ) : recentInvoices.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
              <p className="text-muted">No invoices yet. Invoices are generated the Wednesday after each working week.</p>
            </div>
          ) : (
            <table className="ps-table">
              <thead><tr><th>Invoice</th><th>Period</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {recentInvoices.map((inv) => (
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/locum/invoices')}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{inv.invoice_number}</td>
                    <td style={{ fontSize: '0.85rem' }}>{fmtDate(inv.week_start)}</td>
                    <td>{penceToGBP(inv.total_pence)}</td>
                    <td><span className={INV_BADGE[inv.status] ?? 'ps-badge'}>{inv.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Link to="/locum/shifts" className="ps-btn ps-btn-primary">Browse Shifts</Link>
        <Link to="/locum/bookings" className="ps-btn ps-btn-outline">My Bookings</Link>
        <Link to="/locum/invoices" className="ps-btn ps-btn-outline">Invoices</Link>
        <Link to="/locum/profile" className="ps-btn ps-btn-outline">My Profile</Link>
      </div>
    </div>
  )
}
