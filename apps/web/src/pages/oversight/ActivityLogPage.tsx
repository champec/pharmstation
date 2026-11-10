import { useCallback, useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { Download, History, Search } from 'lucide-react'
import { EmptyState, PageHeader } from '../../components/ui'

// Searchable activity log: who did what, when, at which pharmacy.
// Managers (owner/manager, two-step on) see the pharmacies they run.
// Platform admins open it with `platform` to see every pharmacy.
// Data: ps_activity_log + ps_activity_scope RPCs.

interface ActivityRow {
  at: string
  org_id: string
  org_name: string
  module: string
  action: string
  actor_id: string | null
  actor_name: string
  detail: string | null
  record_id: string | null
}
interface Scope { organisations: { id: string; name: string }[]; people: { id: string; name: string }[] }

export const ACTIVITY_MODULES: Record<string, string> = {
  rp: 'RP', cd: 'CD and returns', logs: 'Logs', appointments: 'Bookings', services: 'Services',
  deliveries: 'Deliveries', sops: 'SOPs', shop: 'Shop', safety: 'Patient safety', nhs111: 'NHS 111', staff: 'Staff and sign-ins',
}

/** Platform admins only, off by default: usage and error events from monitoring. */
const MONITOR_MODULES: Record<string, string> = { pageviews: 'Page views', errors: 'Errors' }
const LABELS: Record<string, string> = { ...ACTIVITY_MODULES, ...MONITOR_MODULES }
const PAGE = 200
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
})

export function ActivityLogPage({ platform = false }: { platform?: boolean }) {
  const [scope, setScope] = useState<Scope | null>(null)
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [orgId, setOrgId] = useState('')
  const [userId, setUserId] = useState('')
  const [module, setModule] = useState('')
  const [source, setSource] = useState('')
  const isMonitor = module in MONITOR_MODULES
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    getUserClient().rpc('ps_activity_scope', { p_platform: platform }).then(({ data }) => setScope(data as Scope))
  }, [platform])

  // Debounce the free-text search.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const fetchRows = useCallback(async (offset: number, limit: number) => {
    const { data, error: err } = await getUserClient().rpc('ps_activity_log', {
      p_from: new Date(`${from}T00:00:00`).toISOString(),
      p_to: new Date(`${to}T23:59:59.999`).toISOString(),
      p_org_ids: orgId ? [orgId] : null,
      p_user_id: userId || null,
      p_module: module || null,
      p_search: search || null,
      p_limit: limit,
      p_offset: offset,
      p_platform: platform,
      p_source: isMonitor && source ? source : null,
    })
    if (err) throw err
    return (data ?? []) as ActivityRow[]
  }, [from, to, orgId, userId, module, search, platform, isMonitor, source])

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchRows(0, PAGE)
      .then((r) => { if (live) { setRows(r); setHasMore(r.length === PAGE); setError(null) } })
      .catch((e) => live && setError(e.message ?? String(e)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [fetchRows])

  const loadMore = async () => {
    setLoading(true)
    try {
      const r = await fetchRows(rows.length, PAGE)
      setRows((prev) => [...prev, ...r])
      setHasMore(r.length === PAGE)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchRows(0, 2000)
      const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`
      const lines = [
        ['When', 'Pharmacy', 'Module', 'Action', 'Person', 'Details'].join(','),
        ...all.map((r) => [fmt(r.at), r.org_name, LABELS[r.module] ?? r.module, r.action, r.actor_name, r.detail].map(esc).join(',')),
      ]
      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `pharmstation-activity-${from}-to-${to}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const filtered = !!(orgId || userId || module || search)
  const clear = () => { setSource(''); setOrgId(''); setUserId(''); setModule(''); setSearchInput(''); setSearch('') }
  const multiOrg = (scope?.organisations.length ?? 0) > 1

  return (
    <div className="activity-log-page">
      <PageHeader
        breadcrumbs={platform
          ? [{ label: 'My Account', to: '/me' }, { label: 'Activity log' }]
          : [{ label: 'Dashboard', to: '/' }, { label: 'Oversight', to: '/oversight' }, { label: 'Activity log' }]}
        title={platform ? 'Platform activity log' : 'Activity log'}
        subtitle={platform
          ? 'Everything people do in every pharmacy on PharmStation. Filter to find what you need.'
          : 'Who did what, when, and at which pharmacy. Covers every pharmacy you own or manage.'}
        actions={
          <button className="ps-btn ps-btn-secondary" onClick={exportCsv} disabled={exporting || rows.length === 0}>
            <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting' : 'Export CSV'}
          </button>
        }
      />

      <div className="ps-card activity-filters">
        <label>
          <span>From</span>
          <input type="date" className="ps-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" className="ps-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(multiOrg || platform) && (
          <label>
            <span>Pharmacy</span>
            <select className="ps-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">All pharmacies</option>
              {scope?.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Person</span>
          <select className="ps-input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {scope?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>
          <span>Module</span>
          <select className="ps-input" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">All modules</option>
            {Object.entries(ACTIVITY_MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {platform && (
              <optgroup label="Monitoring">
                {Object.entries(MONITOR_MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {platform && isMonitor && (
          <label>
            <span>Platform</span>
            <select className="ps-input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Web, app and server</option>
              <option value="web">Web</option>
              <option value="mobile">App</option>
              {module === 'errors' && <option value="edge">Server</option>}
            </select>
          </label>
        )}
        <label className="activity-search">
          <span>Search</span>
          <span className="activity-search-box">
            <Search size={16} aria-hidden="true" />
            <input className="ps-input" placeholder="Drug, action, name, order number" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </span>
        </label>
      </div>

      {error && <div className="ps-card oversight-error" role="alert">Could not load activity: {error}</div>}

      {!loading && !error && rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={History} title="No activity matches these filters"
            actions={<button className="ps-btn ps-btn-secondary" onClick={clear}>Clear filters</button>}>
            Try a wider date range or a different person or module.
          </EmptyState>
        ) : (
          <EmptyState icon={History} title="No activity in this period">
            RP sign-ins, CD entries, logs, bookings, deliveries, SOP sign-offs and staff sign-ins will appear here.
            {!platform && ' Only owners and managers with two-step sign-in can see this log.'}
          </EmptyState>
        )
      ) : (
        <div className="ps-card activity-table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th>When</th>
                {(multiOrg || platform) && <th>Pharmacy</th>}
                <th>Module</th>
                <th>Action</th>
                <th>Person</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.record_id}-${r.at}-${i}`}>
                  <td className="activity-when">{fmt(r.at)}</td>
                  {(multiOrg || platform) && <td>{r.org_name}</td>}
                  <td><span className="ps-badge ps-badge-blue">{LABELS[r.module] ?? r.module}</span></td>
                  <td>{r.action}</td>
                  <td>{r.actor_name}</td>
                  <td className="activity-detail">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="activity-foot">
            <span className="oversight-muted">{rows.length} shown</span>
            {hasMore && (
              <button className="ps-btn ps-btn-secondary" onClick={loadMore} disabled={loading}>
                {loading ? 'Loading' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function PlatformActivityLogPage() {
  return <ActivityLogPage platform />
}
