import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Bug } from 'lucide-react'
import { getUserClient } from '@pharmstation/supabase-client'
import { EmptyState, PageHeader } from '../../components/ui'
import { promptDialog } from '../../components/ui/dialog'
import { ActivityLog } from './ActivityLog'

// Platform oversight for PharmStation admins: who uses the app and how, and
// what broke. Data comes from ps_monitor_* on the London project; RLS and
// ps_admin_monitoring_overview only return data to platform admins.

const SUPABASE_PROJECT = 'dbgwfdrvqzuevbfrmsdt'

type Overview = {
  generated_at: string
  days: number
  totals: Record<string, number>
  daily: Array<{ day: string; users: number; events: number; errors: number }>
  top_pages: Array<{ source: string; path: string; views: number; users: number }>
  pharmacies: Array<{ id: string; name: string | null; users: number; events: number; last_seen: string; uses_app: boolean; errors: number }>
  people: Array<{ id: string; name: string; pharmacy: string | null; events: number; sessions: number; last_seen: string; platforms: string; errors: number }>
}

type Issue = {
  id: string
  source: 'web' | 'mobile' | 'edge'
  title: string
  culprit: string | null
  first_seen: string
  last_seen: string
  event_count: number
  last_release: string | null
  status: 'open' | 'resolved' | 'ignored'
  regressed: boolean
  fix_note: string | null
}

type Occurrence = {
  id: number
  occurred_at: string
  message: string
  stack: string | null
  route: string | null
  release: string | null
  device: string | null
  user_id: string | null
  organisation_id: string | null
  context: Record<string, unknown> | null
}

const TABS = ['overview', 'activity', 'issues', 'pharmacies', 'people'] as const
type Tab = typeof TABS[number]
const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', activity: 'Activity log', issues: 'Errors', pharmacies: 'Pharmacies', people: 'People' }
const SOURCE_LABELS = { web: 'Web app', mobile: 'Mobile app', edge: 'Server function' } as const

const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
function ago(d: string) {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

/** Plain-English first step for common failures, shown on each error. */
function fixHint(issue: Issue): string {
  const t = issue.title.toLowerCase()
  if (/dynamically imported module|loading chunk|importing a module script failed/.test(t))
    return 'Someone had an old version open while a new one was released. A reload fixes it. Only worth acting on if it keeps happening after a release.'
  if (/permission denied|row-level security|violates row-level/.test(t))
    return 'The database refused the request. Check the RLS policies and grants for the table or function named in the message.'
  if (/failed to fetch|networkerror|network request failed|load failed/.test(t))
    return 'The device lost connection or a request was blocked. Usually patchy Wi-Fi in the pharmacy. Act if many people or one server function show it.'
  if (/jwt|not authenticated|auth session missing|invalid refresh token/.test(t))
    return 'The person’s sign-in expired. If it repeats for the same person, check session refresh on that platform.'
  if (/cannot read properties of (undefined|null)|is not a function|undefined is not an object/.test(t))
    return 'A code bug: something expected data that was missing. Open the stack trace below to find the file and line, then fix it in the code.'
  if (issue.source === 'edge')
    return 'A server function failed. Open its logs in Supabase (link below) around the time shown to see the full request, then fix the function.'
  return 'Open the latest occurrence below for the page, release and stack trace, then reproduce it there.'
}

export function MonitoringPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(14)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [issueFilter, setIssueFilter] = useState<'open' | 'resolved' | 'ignored' | 'all'>('open')
  const [openIssue, setOpenIssue] = useState<string | null>(null)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data !== true) setLoading(false)
    })
  }, [])

  const loadOverview = useCallback(async () => {
    const { data, error } = await getUserClient().rpc('ps_admin_monitoring_overview', { p_days: days })
    if (error) setError(error.message)
    else setOverview(data as Overview)
  }, [days])

  const loadIssues = useCallback(async () => {
    let q = getUserClient().from('ps_monitor_issues').select('*').order('last_seen', { ascending: false }).limit(200)
    if (issueFilter !== 'all') q = q.eq('status', issueFilter)
    const { data, error } = await q
    if (error) setError(error.message)
    else setIssues((data ?? []) as Issue[])
  }, [issueFilter])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([loadOverview(), loadIssues()])
    setLoading(false)
  }, [loadOverview, loadIssues])

  useEffect(() => { if (isAdmin) void reload() }, [isAdmin, reload])

  const toggleIssue = async (id: string) => {
    if (openIssue === id) return setOpenIssue(null)
    setOpenIssue(id)
    setOccurrences([])
    const { data } = await getUserClient().from('ps_monitor_errors')
      .select('id, occurred_at, message, stack, route, release, device, user_id, organisation_id, context')
      .eq('issue_id', id).order('occurred_at', { ascending: false }).limit(5)
    setOccurrences((data ?? []) as Occurrence[])
  }

  const setStatus = async (issue: Issue, status: Issue['status']) => {
    const { data: u } = await getUserClient().auth.getUser()
    const patch = status === 'resolved'
      ? { status, regressed: false, resolved_at: new Date().toISOString(), resolved_by: u.user?.id ?? null }
      : { status, resolved_at: null, resolved_by: null }
    const { error } = await getUserClient().from('ps_monitor_issues').update(patch).eq('id', issue.id)
    if (error) setError(error.message)
    else void reload()
  }

  const editNote = async (issue: Issue) => {
    const note = await promptDialog({ title: 'How to fix', label: 'Cause and fix (only admins see this)', defaultValue: issue.fix_note ?? '' })
    if (note === null) return
    const { error } = await getUserClient().from('ps_monitor_issues').update({ fix_note: note.trim() || null }).eq('id', issue.id)
    if (error) setError(error.message)
    else void loadIssues()
  }

  const maxDaily = useMemo(() => Math.max(1, ...(overview?.daily ?? []).map((d) => d.users)), [overview])
  const t = overview?.totals ?? {}

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'My Account', to: '/me' }, { label: 'Monitoring' }]}
        title="Platform monitoring"
        subtitle="Who is using PharmStation, how they use it, and what has broken. Stored in the UK with patient details removed."
        actions={isAdmin ? (
          <>
            <select className="ps-input" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button className="ps-btn ps-btn-secondary" onClick={() => void reload()} disabled={loading}>Refresh</button>
          </>
        ) : undefined}
      />

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isAdmin === false ? (
        <p className="text-muted">Only PharmStation admins can see monitoring.</p>
      ) : isAdmin === null || (loading && !overview) ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <div role="tablist" aria-label="Monitoring sections" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {TABS.map((k) => (
              <button key={k} role="tab" aria-selected={tab === k}
                className={`ps-btn ps-btn-sm ${tab === k ? 'ps-btn-primary' : 'ps-btn-ghost'}`} onClick={() => setTab(k)}>
                {TAB_LABELS[k]}{k === 'issues' && t.open_issues ? ` (${t.open_issues})` : ''}
              </button>
            ))}
          </div>

          {tab === 'overview' && overview && (
            <>
              <div className="stats-grid" style={{ marginBottom: '1.25rem' }}>
                <Stat label="Active today" value={t.users_1d} />
                <Stat label="Active this week" value={t.users_7d} />
                <Stat label="Active this month" value={t.users_30d} />
                <Stat label="Pharmacies this week" value={t.pharmacies_7d} />
                <Stat label="Web / app users (7d)" value={`${t.web_users_7d ?? 0} / ${t.mobile_users_7d ?? 0}`} />
                <Stat label="Errors (24h)" value={t.errors_24h} accent={(t.errors_24h ?? 0) > 0} sub={t.users_hit_by_errors_24h ? `${t.users_hit_by_errors_24h} people affected` : undefined} />
                <Stat label="Open errors" value={t.open_issues} accent={(t.open_issues ?? 0) > 0} sub={t.regressed_issues ? `${t.regressed_issues} came back after a fix` : undefined} onClick={() => setTab('issues')} />
              </div>

              <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
                <div className="ps-card-header"><h2 className="ps-card-title">Daily active people</h2></div>
                <div className="ps-card-body">
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }} role="img"
                    aria-label={`Daily active people over the last ${overview.days} days`}>
                    {overview.daily.map((d) => (
                      <div key={d.day} title={`${new Date(d.day).toLocaleDateString('en-GB')}: ${d.users} people, ${d.events} views, ${d.errors} errors`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                        <div style={{ height: `${(d.users / maxDaily) * 100}%`, minHeight: d.users ? 3 : 1, background: d.users ? 'var(--ps-deep-blue)' : 'var(--ps-mist)', borderRadius: '3px 3px 0 0' }} />
                        {d.errors > 0 && <div style={{ height: 3, background: 'var(--ps-error)', marginTop: 1 }} />}
                      </div>
                    ))}
                  </div>
                  <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--ps-font-xs)', marginTop: 6 }}>
                    <span>{overview.daily[0] && new Date(overview.daily[0].day).toLocaleDateString('en-GB')}</span>
                    <span>Red marks show days with errors</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>

              <div className="ps-card">
                <div className="ps-card-header"><h2 className="ps-card-title">Most used pages and screens</h2></div>
                <div className="ps-card-body">
                  {overview.top_pages.length === 0 ? (
                    <EmptyState bare icon={Activity} title="No usage recorded yet">Page and screen views appear here once people use the web or mobile app.</EmptyState>
                  ) : (
                    <Table head={['Page', 'Where', 'Views', 'People']} rows={overview.top_pages.map((p) => [
                      <code key="p">{p.path}</code>, SOURCE_LABELS[p.source as 'web'] ?? p.source, p.views, p.users,
                    ])} />
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'activity' && <ActivityLog />}

          {tab === 'issues' && (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                {(['open', 'resolved', 'ignored', 'all'] as const).map((f) => (
                  <button key={f} className={`ps-btn ps-btn-sm ${issueFilter === f ? 'ps-btn-secondary' : 'ps-btn-ghost'}`} onClick={() => setIssueFilter(f)}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              {issues.length === 0 ? (
                <EmptyState icon={Bug} title={issueFilter === 'open' ? 'Nothing is broken right now' : 'No errors here'}>
                  Errors from the web app, the mobile app and server functions are grouped here, with where they happened and how to fix them.
                </EmptyState>
              ) : issues.map((i) => (
                <div key={i.id} className="ps-card" style={{ marginBottom: '0.75rem' }}>
                  <div className="ps-card-body">
                    <button onClick={() => void toggleIssue(i.id)} aria-expanded={openIssue === i.id}
                      style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <strong style={{ wordBreak: 'break-word' }}>{i.title}</strong>
                        <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>{i.event_count}× · last {ago(i.last_seen)}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: 'var(--ps-font-sm)', marginTop: 4 }}>
                        {SOURCE_LABELS[i.source]}{i.culprit ? ` · ${i.culprit}` : ''} · first seen {fmt(i.first_seen)}
                        {i.last_release ? ` · ${i.last_release}` : ''}
                        {i.regressed && <span style={{ color: 'var(--ps-error)', fontWeight: 600 }}> · came back after a fix</span>}
                        {i.status !== 'open' && ` · ${i.status}`}
                      </div>
                    </button>

                    {openIssue === i.id && (
                      <div style={{ marginTop: '0.75rem' }}>
                        <div className="ps-alert ps-alert-info" style={{ marginBottom: '0.75rem' }}>
                          <strong>Where to start:</strong> {fixHint(i)}
                          {i.source === 'edge' && i.culprit && (
                            <> {' '}<a href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/functions/${encodeURIComponent(i.culprit)}/logs`} target="_blank" rel="noreferrer">Open {i.culprit} logs</a></>
                          )}
                        </div>
                        {i.fix_note && <p style={{ marginBottom: '0.75rem' }}><strong>Fix notes:</strong> {i.fix_note}</p>}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                          {i.status !== 'resolved' && <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={() => void setStatus(i, 'resolved')}>Mark fixed</button>}
                          {i.status === 'open' && <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => void setStatus(i, 'ignored')}>Ignore</button>}
                          {i.status !== 'open' && <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => void setStatus(i, 'open')}>Reopen</button>}
                          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => void editNote(i)}>{i.fix_note ? 'Edit fix notes' : 'Add fix notes'}</button>
                        </div>
                        <h3 style={{ fontSize: 'var(--ps-font-md)', margin: '0.5rem 0' }}>Latest occurrences</h3>
                        {occurrences.length === 0 ? <p className="text-muted">Loading…</p> : occurrences.map((o) => (
                          <details key={o.id} style={{ borderTop: '1px solid var(--ps-mist)', padding: '0.5rem 0' }}>
                            <summary style={{ cursor: 'pointer' }}>
                              {fmt(o.occurred_at)} · {o.route ?? 'unknown page'}{o.release ? ` · ${o.release}` : ''}
                              {o.organisation_id ? ` · ${overview?.pharmacies.find((p) => p.id === o.organisation_id)?.name ?? 'a pharmacy'}` : ''}
                              {o.user_id ? ` · ${overview?.people.find((p) => p.id === o.user_id)?.name ?? 'signed-in user'}` : ' · signed out'}
                            </summary>
                            <p style={{ margin: '0.5rem 0', wordBreak: 'break-word' }}>{o.message}</p>
                            {o.device && <p className="text-muted" style={{ fontSize: 'var(--ps-font-xs)' }}>{o.device}</p>}
                            {o.context && <pre style={preStyle}>{JSON.stringify(o.context, null, 2)}</pre>}
                            {o.stack && <pre style={preStyle}>{o.stack}</pre>}
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'pharmacies' && overview && (
            <div className="ps-card"><div className="ps-card-body">
              {overview.pharmacies.length === 0 ? (
                <EmptyState bare icon={Activity} title="No pharmacy activity yet">Pharmacies appear here once their staff use PharmStation.</EmptyState>
              ) : (
                <Table head={['Pharmacy', 'People', 'Views', 'Mobile app', 'Errors', 'Last active']} rows={overview.pharmacies.map((p) => [
                  p.name ?? 'Unknown', p.users, p.events, p.uses_app ? 'Yes' : 'No',
                  <span key="e" style={{ color: p.errors ? 'var(--ps-error)' : undefined }}>{p.errors}</span>, ago(p.last_seen),
                ])} />
              )}
            </div></div>
          )}

          {tab === 'people' && overview && (
            <div className="ps-card"><div className="ps-card-body">
              {overview.people.length === 0 ? (
                <EmptyState bare icon={Activity} title="No one signed in yet">People appear here once they sign in and use PharmStation.</EmptyState>
              ) : (
                <Table head={['Person', 'Pharmacy', 'Uses', 'Sessions', 'Views', 'Errors', 'Last active']} rows={overview.people.map((p) => [
                  p.name, p.pharmacy ?? '—', p.platforms, p.sessions, p.events,
                  <span key="e" style={{ color: p.errors ? 'var(--ps-error)' : undefined }}>{p.errors}</span>, ago(p.last_seen),
                ])} />
              )}
            </div></div>
          )}
        </>
      )}
    </div>
  )
}

const preStyle: React.CSSProperties = {
  background: 'var(--ps-off-white)', border: '1px solid var(--ps-mist)', borderRadius: 'var(--ps-radius-sm)',
  padding: '0.5rem', fontSize: 'var(--ps-font-xs)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260,
}

function Stat({ label, value, sub, accent, onClick }: { label: string; value: number | string | undefined; sub?: string; accent?: boolean; onClick?: () => void }) {
  return (
    <div className={`stat-card${accent ? ' stat-card-accent' : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value ?? 0}</div>
      {sub && <div className="text-muted" style={{ fontSize: 'var(--ps-font-xs)' }}>{sub}</div>}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ps-table" style={{ width: '100%' }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
