import { useCallback, useEffect, useState } from 'react'
import { ListFilter } from 'lucide-react'
import { getUserClient } from '@pharmstation/supabase-client'
import { EmptyState } from '../../components/ui'
import { confirmDialog, promptDialog } from '../../components/ui/dialog'

// Platform activity log (Monitoring → Activity). One stream across every
// pharmacy, narrowed with filters so it stays readable. Data comes from
// ps_admin_activity_log (platform admins only). Saved views live in this
// browser only.

type Kind = 'action' | 'view' | 'error'
type Row = {
  at: string
  kind: Kind
  module: string
  platform: string
  text: string
  org_id: string | null
  org_name: string | null
  user_id: string | null
  user_name: string | null
  role: string | null
}
type Filters = {
  range: '24h' | '7d' | '30d' | '90d' | 'custom'
  from: string
  to: string
  orgId: string
  userId: string
  role: string
  module: string
  kinds: Kind[]
  platform: string
  search: string
}
type Option = { id: string; name: string }

const DEFAULT_FILTERS: Filters = {
  range: '7d', from: '', to: '', orgId: '', userId: '', role: '', module: '',
  kinds: ['action', 'error'], platform: '', search: '',
}
const KIND_LABELS: Record<Kind, string> = { action: 'Actions', view: 'Page views', error: 'Errors' }
const MODULES: Array<[string, string]> = [
  ['rp', 'RP log'], ['cd', 'CD register'], ['logs', 'Logs'], ['appointments', 'Appointments'],
  ['deliveries', 'Deliveries'], ['staff', 'Sign-ins and staff'], ['registers', 'Registers pages'],
  ['shop', 'Shop'], ['messaging', 'Messaging'], ['patients', 'Patients'], ['services', 'Services'],
  ['sops', 'SOPs'], ['locum', 'Locum'], ['peps', 'PEPS'], ['care-homes', 'Care homes'], ['me', 'My account'],
]
const PLATFORM_LABELS: Record<string, string> = { web: 'Web', mobile: 'App', edge: 'Server' }
const SAVED_KEY = 'ps-activity-saved-views'
const RANGE_HOURS = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 } as const

function loadSaved(): Array<{ name: string; filters: Filters }> {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') } catch { return [] }
}
function storeSaved(v: Array<{ name: string; filters: Filters }>) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(v)) } catch { /* private window */ }
}

const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ActivityLog() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [searchDraft, setSearchDraft] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<{ pharmacies: Option[]; people: Option[]; roles: string[] }>({ pharmacies: [], people: [], roles: [] })
  const [saved, setSaved] = useState(loadSaved)

  useEffect(() => {
    getUserClient().rpc('ps_admin_activity_filters').then(({ data }) => {
      if (data) setOptions({ pharmacies: data.pharmacies ?? [], people: data.people ?? [], roles: data.roles ?? [] })
    })
  }, [])

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft })), 400)
    return () => clearTimeout(t)
  }, [searchDraft])

  const fetchPage = useCallback(async (before: string | null) => {
    const f = filters
    const from = f.range === 'custom'
      ? (f.from ? new Date(f.from).toISOString() : null)
      : new Date(Date.now() - RANGE_HOURS[f.range] * 3600_000).toISOString()
    const to = f.range === 'custom' && f.to ? new Date(new Date(f.to).getTime() + 86_400_000).toISOString() : null
    const { data, error } = await getUserClient().rpc('ps_admin_activity_log', {
      p_from: from, p_to: to,
      p_org_id: f.orgId || null, p_user_id: f.userId || null, p_role: f.role || null,
      p_module: f.module || null, p_kinds: f.kinds.length ? f.kinds : ['action', 'view', 'error'],
      p_platform: f.platform || null, p_search: f.search || null,
      p_before: before, p_limit: 100,
    })
    if (error) throw error
    return data as { rows: Row[]; has_more: boolean }
  }, [filters])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPage(null)
      .then((d) => { if (!cancelled) { setRows(d.rows); setHasMore(d.has_more) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPage])

  const loadMore = async () => {
    if (!rows.length) return
    setLoading(true)
    try {
      const d = await fetchPage(rows[rows.length - 1].at)
      setRows((r) => [...r, ...d.rows])
      setHasMore(d.has_more)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const toggleKind = (k: Kind) => set('kinds', filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k])

  const saveView = async () => {
    const name = await promptDialog({ title: 'Save this view', label: 'Name', required: true })
    if (!name) return
    const next = [...saved.filter((s) => s.name !== name.trim()), { name: name.trim(), filters }]
    setSaved(next)
    storeSaved(next)
  }
  const deleteView = async (name: string) => {
    if (!(await confirmDialog(`Delete the saved view "${name}"?`))) return
    const next = saved.filter((s) => s.name !== name)
    setSaved(next)
    storeSaved(next)
  }
  const applyView = (f: Filters) => { setFilters(f); setSearchDraft(f.search) }
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  const quickFilter = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  return (
    <>
      <div className="ps-card" style={{ marginBottom: '1rem' }}>
        <div className="ps-card-body" style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <input className="ps-input" type="search" placeholder="Search text, pharmacy or person" value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)} aria-label="Search activity" />
            <select className="ps-input" value={filters.range} onChange={(e) => set('range', e.target.value as Filters['range'])} aria-label="Time range">
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom dates</option>
            </select>
            {filters.range === 'custom' && (
              <>
                <input className="ps-input" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
                <input className="ps-input" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
              </>
            )}
            <select className="ps-input" value={filters.orgId} onChange={(e) => set('orgId', e.target.value)} aria-label="Pharmacy">
              <option value="">All pharmacies</option>
              {options.pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="ps-input" value={filters.userId} onChange={(e) => set('userId', e.target.value)} aria-label="Person">
              <option value="">Everyone</option>
              {options.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="ps-input" value={filters.role} onChange={(e) => set('role', e.target.value)} aria-label="Role">
              <option value="">All roles</option>
              {options.roles.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1).replace(/_/g, ' ')}</option>)}
            </select>
            <select className="ps-input" value={filters.module} onChange={(e) => set('module', e.target.value)} aria-label="Module">
              <option value="">All modules</option>
              {MODULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="ps-input" value={filters.platform} onChange={(e) => set('platform', e.target.value)} aria-label="Platform">
              <option value="">Web, app and server</option>
              <option value="web">Web only</option>
              <option value="mobile">Mobile app only</option>
              <option value="edge">Server functions only</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
              <label key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: '0.5rem' }}>
                <input type="checkbox" checked={filters.kinds.includes(k)} onChange={() => toggleKind(k)} /> {KIND_LABELS[k]}
              </label>
            ))}
            <span style={{ flex: 1 }} />
            {isFiltered && <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => applyView(DEFAULT_FILTERS)}>Clear filters</button>}
            <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => void saveView()}>Save view</button>
          </div>

          {saved.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="text-muted" style={{ fontSize: 'var(--ps-font-sm)' }}>Saved views:</span>
              {saved.map((s) => (
                <span key={s.name} style={{ display: 'inline-flex' }}>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => applyView(s.filters)}>{s.name}</button>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" aria-label={`Delete saved view ${s.name}`} title="Delete saved view" onClick={() => void deleteView(s.name)}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="ps-card"><div className="ps-card-body">
        {!loading && rows.length === 0 ? (
          <EmptyState bare icon={ListFilter} title={isFiltered ? 'Nothing matches these filters' : 'No activity yet'}
            actions={isFiltered ? <button className="ps-btn ps-btn-secondary" onClick={() => applyView(DEFAULT_FILTERS)}>Clear filters</button> : undefined}>
            {isFiltered ? 'Try a longer time range or fewer filters.' : 'Actions, page views and errors from every pharmacy appear here.'}
          </EmptyState>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ps-table" style={{ width: '100%' }}>
              <thead><tr>
                <th style={{ textAlign: 'left' }}>When</th><th style={{ textAlign: 'left' }}>What</th>
                <th style={{ textAlign: 'left' }}>Who</th><th style={{ textAlign: 'left' }}>Pharmacy</th>
                <th style={{ textAlign: 'left' }}>Where</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.at)}</td>
                    <td style={{ color: r.kind === 'error' ? 'var(--ps-error)' : r.kind === 'view' ? 'var(--ps-slate)' : undefined, wordBreak: 'break-word' }}>
                      {r.text}
                    </td>
                    <td>
                      {r.user_id ? (
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" style={{ padding: 0 }} title="Show only this person"
                          onClick={() => quickFilter({ userId: r.user_id! })}>{r.user_name ?? 'Unknown'}</button>
                      ) : <span className="text-muted">—</span>}
                      {r.role && <div className="text-muted" style={{ fontSize: 'var(--ps-font-xs)' }}>{r.role.replace(/_/g, ' ')}</div>}
                    </td>
                    <td>
                      {r.org_id ? (
                        <button className="ps-btn ps-btn-ghost ps-btn-sm" style={{ padding: 0 }} title="Show only this pharmacy"
                          onClick={() => quickFilter({ orgId: r.org_id! })}>{r.org_name ?? 'Unknown'}</button>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {MODULES.find(([v]) => v === r.module)?.[1] ?? r.module} · {PLATFORM_LABELS[r.platform] ?? r.platform}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {loading && <p className="text-muted" style={{ marginTop: '0.5rem' }}>Loading…</p>}
        {hasMore && !loading && (
          <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => void loadMore()}>Load older activity</button>
          </div>
        )}
      </div></div>
    </>
  )
}
