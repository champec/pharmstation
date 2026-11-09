import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { getUserClient } from '@pharmstation/supabase-client'
import { EmptyState, PageHeader } from '../../components/ui'

// PharmStation platform admins triage messages from the contact page and the
// in-app Help & support form. Each one is also emailed to the team inbox; reply
// from there (or with the Reply button below). Access is enforced by RLS on
// ps_support_tickets (ps_is_platform_admin), not this page.

type Ticket = {
  id: string
  reference: string
  source: 'public' | 'app'
  topic: 'support' | 'sales' | 'billing' | 'privacy' | 'safety' | 'network' | 'other'
  name: string
  email: string
  phone: string | null
  organisation_name: string | null
  message: string
  status: 'new' | 'open' | 'waiting' | 'closed'
  email_forwarded: boolean
  admin_note: string | null
  created_at: string
}

const TOPIC_LABELS: Record<Ticket['topic'], string> = {
  support: 'Help', sales: 'Demo / pricing', billing: 'Billing',
  privacy: 'Data protection', safety: 'Clinical safety', network: 'Network dispute', other: 'Other',
}
const STATUS_LABELS: Record<Ticket['status'], string> = {
  new: 'New', open: 'In progress', waiting: 'Waiting on them', closed: 'Closed',
}
const FILTERS = ['active', 'new', 'open', 'waiting', 'closed', 'all'] as const
type Filter = typeof FILTERS[number]

const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export function SupportInboxPage() {
  const [rows, setRows] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (f: Filter) => {
    setLoading(true)
    setError(null)
    let query = getUserClient().from('ps_support_tickets').select('*').order('created_at', { ascending: false }).limit(200)
    if (f === 'active') query = query.neq('status', 'closed')
    else if (f !== 'all') query = query.eq('status', f)
    const { data, error } = await query
    if (error) setError(error.message)
    else setRows((data ?? []) as Ticket[])
    setLoading(false)
  }, [])

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data !== true) setLoading(false)
    })
  }, [])

  useEffect(() => { if (isAdmin) load(filter) }, [isAdmin, filter, load])

  const update = async (t: Ticket, patch: Partial<Pick<Ticket, 'status' | 'admin_note'>>) => {
    setBusyId(t.id)
    const { error } = await getUserClient().from('ps_support_tickets')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', t.id)
    setBusyId(null)
    if (error) setError(error.message)
    else load(filter)
  }

  const editNote = (t: Ticket) => {
    const note = window.prompt('Internal note (only admins see this)', t.admin_note ?? '')
    if (note === null) return
    update(t, { admin_note: note.trim() || null })
  }

  const replyHref = (t: Ticket) =>
    `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`Re: your message to PharmStation (${t.reference})`)}`

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'My Account', to: '/me' }, { label: 'Support inbox' }]}
        title="Support inbox"
        subtitle="Messages from the contact page and the in-app Help form. Each one is also emailed to the team inbox."
      />

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isAdmin === false ? (
        <p className="text-muted">Only PharmStation admins can see support messages.</p>
      ) : (
        <>
          <div className="support-filters" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`ps-btn ps-btn-sm ${filter === f ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'active' ? 'Not closed' : f === 'all' ? 'All' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>

          {loading ? <p className="text-muted">Loading…</p> : rows.length === 0 ? (
            <EmptyState icon={LifeBuoy} title={filter === 'active' ? 'No open support messages' : 'No messages match this filter'}>
              New messages from the contact page and the app appear here.
            </EmptyState>
          ) : rows.map((t) => (
            <div key={t.id} className={`ps-card support-ticket ${t.topic === 'safety' ? 'support-ticket-safety' : ''}`}>
              <div className="support-ticket-head">
                <div>
                  <strong>{t.name}</strong>{' '}
                  <a href={`mailto:${t.email}`}>{t.email}</a>
                  {t.phone && <span className="text-muted"> · {t.phone}</span>}
                  {t.organisation_name && <div className="text-muted">{t.organisation_name}</div>}
                </div>
                <div className="support-ticket-meta">
                  <span className={`support-pill support-pill-${t.topic}`}>{TOPIC_LABELS[t.topic]}</span>
                  <span className="text-muted">{t.reference}</span>
                  <span className="text-muted">{fmt(t.created_at)} · {t.source === 'app' ? 'In app' : 'Website'}</span>
                </div>
              </div>
              <p className="support-ticket-message">{t.message}</p>
              {t.admin_note && <p className="support-ticket-note"><strong>Note:</strong> {t.admin_note}</p>}
              {!t.email_forwarded && (
                <p className="support-ticket-note">The email copy didn't send, so this one is only here.</p>
              )}
              <div className="support-ticket-actions">
                <label className="support-status">
                  <span className="text-muted">Status</span>
                  <select
                    className="ps-input"
                    value={t.status}
                    disabled={busyId === t.id}
                    onChange={(e) => update(t, { status: e.target.value as Ticket['status'] })}
                  >
                    {(Object.keys(STATUS_LABELS) as Ticket['status'][]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <a className="ps-btn ps-btn-secondary ps-btn-sm" href={replyHref(t)}>Reply by email</a>
                <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === t.id} onClick={() => editNote(t)}>
                  {t.admin_note ? 'Edit note' : 'Add note'}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
