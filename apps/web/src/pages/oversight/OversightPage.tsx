import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react'
import { EmptyState, PageHeader } from '../../components/ui'

/* Shape returned by the ps_org_oversight RPC. */
interface OversightAlert { level: 'error' | 'warning' | 'info'; module: string; text: string }
interface OversightOrg {
  id: string
  name: string
  town: string | null
  rp: { name: string | null; since: string } | null
  rp_last: { name: string | null; at: string } | null
  cd: { last_check_at: string | null; last_check_discrepancies: number; entries_7d: number; corrections_7d: number }
  logs: { due_today: number; done_today: number; missing: string[] }
  appointments: { today: number; upcoming_7d: number; awaiting_confirmation: number; no_shows_7d: number }
  deliveries: { today: number; in_progress: number; completed_today: number; overdue: number }
  sops: { outstanding: number }
  staff: { active: number; active_today: number; sign_ins_today: number; failed_sign_ins_7d: number }
  safety: { drafts: number }
  shop: { to_review: number; open_orders: number }
  nhs111: { open: number }
  alerts: OversightAlert[]
}
interface OversightEvent { org_id: string; org_name: string; at: string; module: string; text: string }
interface OversightData { generated_at: string; organisations: OversightOrg[]; activity: OversightEvent[] }

const MODULE_LABEL: Record<string, string> = {
  rp: 'RP', cd: 'CD register', logs: 'Logs', appointments: 'Bookings', deliveries: 'Deliveries',
  sops: 'SOPs', staff: 'Staff', safety: 'Patient safety', shop: 'Shop', nhs111: 'NHS 111',
}
/** Where an alert for each module is fixed (in the pharmacy that is signed in). */
const MODULE_LINK: Record<string, string> = {
  rp: '/registers/rp', cd: '/registers', logs: '/logs', appointments: '/appointments', deliveries: '/deliveries',
  sops: '/sops', staff: '/settings', safety: '/patient-safety', shop: '/shop', nhs111: '/nhs111',
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
function fmtWhen(iso: string) {
  const d = new Date(iso)
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' })
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) === today ? fmtTime(iso) : `${fmtDate(iso)}, ${fmtTime(iso)}`
}

export function OversightPage() {
  const organisation = useAuthStore((s) => s.organisation)
  const [data, setData] = useState<OversightData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [orgFilter, setOrgFilter] = useState<string>('all')
  const [moduleFilter, setModuleFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error: err } = await getUserClient().rpc('ps_org_oversight', { p_activity_limit: 60 })
    if (err) setError(err.message)
    else { setData(res as OversightData); setError(null) }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = window.setInterval(load, 60_000)
    return () => window.clearInterval(t)
  }, [load])

  const orgs = data?.organisations ?? []
  const shownOrgs = orgFilter === 'all' ? orgs : orgs.filter((o) => o.id === orgFilter)
  const totals = useMemo(() => {
    const t = { errors: 0, warnings: 0, rpOn: 0, logsDue: 0, logsDone: 0, bookings: 0, rounds: 0 }
    for (const o of shownOrgs) {
      t.errors += o.alerts.filter((a) => a.level === 'error').length
      t.warnings += o.alerts.filter((a) => a.level === 'warning').length
      if (o.rp) t.rpOn += 1
      t.logsDue += o.logs.due_today
      t.logsDone += o.logs.done_today
      t.bookings += o.appointments.today
      t.rounds += o.deliveries.today
    }
    return t
  }, [shownOrgs])

  const activity = (data?.activity ?? []).filter((e) =>
    (orgFilter === 'all' || e.org_id === orgFilter) && (moduleFilter === 'all' || e.module === moduleFilter))
  const activityModules = Array.from(new Set((data?.activity ?? []).map((e) => e.module)))

  return (
    <div className="oversight-page">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Oversight' }]}
        title="Oversight"
        subtitle={orgs.length > 1
          ? `What is happening across your ${orgs.length} pharmacies right now.`
          : 'What is happening across your pharmacy right now.'}
        actions={
          <button className="ps-btn ps-btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing' : 'Refresh'}
          </button>
        }
      />

      {error && <div className="ps-card oversight-error" role="alert">Could not load the dashboard: {error}</div>}

      {!loading && !error && orgs.length === 0 && (
        <EmptyState icon={ShieldAlert} title="No pharmacies to oversee">
          This dashboard shows pharmacies where you are an owner or manager. You need two-step sign-in turned on to see it.
        </EmptyState>
      )}

      {orgs.length > 0 && (
        <>
          {orgs.length > 1 && (
            <div className="oversight-chips" role="group" aria-label="Pharmacy">
              <button className={`oversight-chip${orgFilter === 'all' ? ' active' : ''}`} onClick={() => setOrgFilter('all')}>All pharmacies ({orgs.length})</button>
              {orgs.map((o) => (
                <button key={o.id} className={`oversight-chip${orgFilter === o.id ? ' active' : ''}`} onClick={() => setOrgFilter(o.id)}>{o.name}</button>
              ))}
            </div>
          )}

          <div className="stats-grid">
            <div className={`stat-card${totals.errors ? ' stat-card-accent' : ''}`}>
              <div className="stat-card-label">Needs action</div>
              <div className="stat-card-value">{totals.errors + totals.warnings}</div>
              <div className="oversight-stat-sub">{totals.errors} urgent · {totals.warnings} to check</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">RP signed in</div>
              <div className="stat-card-value">{totals.rpOn} of {shownOrgs.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Logs done today</div>
              <div className="stat-card-value">{totals.logsDone} of {totals.logsDue}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Bookings today</div>
              <div className="stat-card-value">{totals.bookings}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Delivery rounds today</div>
              <div className="stat-card-value">{totals.rounds}</div>
            </div>
          </div>

          <div className="oversight-orgs">
            {shownOrgs.map((o) => <OrgCard key={o.id} org={o} isCurrent={o.id === organisation?.id} />)}
          </div>

          <section className="ps-card oversight-activity">
            <div className="oversight-activity-head">
              <h2><Activity size={18} aria-hidden="true" /> Recent activity</h2>
              <span className="oversight-muted">
                Last 7 days{data ? ` · updated ${fmtTime(data.generated_at)}` : ''} · <Link to="/oversight/activity">Full activity log</Link>
              </span>
            </div>
            <div className="oversight-chips" role="group" aria-label="Module">
              <button className={`oversight-chip${moduleFilter === 'all' ? ' active' : ''}`} onClick={() => setModuleFilter('all')}>Everything</button>
              {activityModules.map((m) => (
                <button key={m} className={`oversight-chip${moduleFilter === m ? ' active' : ''}`} onClick={() => setModuleFilter(m)}>{MODULE_LABEL[m] ?? m}</button>
              ))}
            </div>
            {activity.length === 0 ? (
              <EmptyState bare title={moduleFilter === 'all' ? 'No activity yet' : 'No activity matches this filter'}
                actions={moduleFilter !== 'all' ? <button className="ps-btn ps-btn-secondary" onClick={() => setModuleFilter('all')}>Clear filter</button> : undefined}>
                {moduleFilter === 'all' ? 'RP sign-ins, CD entries, logs, bookings, deliveries and staff sign-ins will appear here.' : undefined}
              </EmptyState>
            ) : (
              <ul className="oversight-feed">
                {activity.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="oversight-feed-time">{fmtWhen(e.at)}</span>
                    <span className="ps-badge ps-badge-blue">{MODULE_LABEL[e.module] ?? e.module}</span>
                    <span className="oversight-feed-text">{e.text}</span>
                    {orgs.length > 1 && <span className="oversight-muted">{e.org_name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function OrgCard({ org, isCurrent }: { org: OversightOrg; isCurrent: boolean }) {
  const urgent = org.alerts.some((a) => a.level === 'error')
  const status = urgent ? 'error' : org.alerts.length ? 'warning' : 'ok'
  return (
    <article className={`ps-card oversight-org oversight-org-${status}`}>
      <header className="oversight-org-head">
        <div>
          <h2>{org.name}</h2>
          {org.town && <span className="oversight-muted">{org.town}</span>}
        </div>
        <span className={`ps-badge ${status === 'error' ? 'ps-badge-red' : status === 'warning' ? 'ps-badge-amber' : 'ps-badge-green'}`}>
          {status === 'ok' ? 'All clear' : `${org.alerts.length} to check`}
        </span>
      </header>

      <p className="oversight-rp">
        {org.rp
          ? <>RP: <strong>{org.rp.name ?? 'Pharmacist'}</strong> since {fmtWhen(org.rp.since)}</>
          : <>No RP signed in{org.rp_last ? ` · last ${org.rp_last.name ?? 'RP'}, ${fmtWhen(org.rp_last.at)}` : ''}</>}
      </p>

      <dl className="oversight-metrics">
        <div><dt>Logs today</dt><dd>{org.logs.done_today}/{org.logs.due_today}</dd></div>
        <div><dt>CD entries (7 days)</dt><dd>{org.cd.entries_7d}</dd></div>
        <div><dt>Last CD check</dt><dd>{org.cd.last_check_at ? fmtDate(org.cd.last_check_at) : 'Never'}</dd></div>
        <div><dt>Bookings today</dt><dd>{org.appointments.today}</dd></div>
        <div><dt>Next 7 days</dt><dd>{org.appointments.upcoming_7d}</dd></div>
        <div><dt>Rounds today</dt><dd>{org.deliveries.completed_today}/{org.deliveries.today}</dd></div>
        <div><dt>Staff active today</dt><dd>{org.staff.active_today}/{org.staff.active}</dd></div>
        <div><dt>Open shop orders</dt><dd>{org.shop.open_orders}</dd></div>
      </dl>

      {org.alerts.length > 0 ? (
        <ul className="oversight-alerts">
          {org.alerts.map((a, i) => (
            <li key={i} className={`oversight-alert oversight-alert-${a.level}`}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{a.text}</span>
              {isCurrent && MODULE_LINK[a.module] && <Link to={MODULE_LINK[a.module]} className="oversight-alert-link">Open</Link>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="oversight-allclear"><CheckCircle2 size={16} aria-hidden="true" /> Nothing needs attention.</p>
      )}
      {org.logs.missing.length > 0 && (
        <p className="oversight-muted">Not filled in today: {org.logs.missing.join(', ')}</p>
      )}
      {!isCurrent && <p className="oversight-muted">Sign in to this pharmacy to act on these.</p>}
    </article>
  )
}
