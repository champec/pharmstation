import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { confirmDialog } from '../../components/ui/dialog'

// PharmStation platform admins post app-wide announcements. The mobile app
// shows live ones as a full-screen notice when it's freshly opened. Access is
// enforced by RLS on ps_app_announcements (ps_is_platform_admin), not this page.

type Announcement = {
  id: string
  title: string
  body: string
  link_url: string | null
  link_label: string | null
  audience: 'mobile' | 'web' | 'all'
  dismissible: boolean
  starts_at: string
  ends_at: string | null
  created_at: string
}

const fmt = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function status(a: Announcement): 'Live' | 'Scheduled' | 'Ended' {
  const now = Date.now()
  if (new Date(a.starts_at).getTime() > now) return 'Scheduled'
  if (a.ends_at && new Date(a.ends_at).getTime() <= now) return 'Ended'
  return 'Live'
}

const emptyForm = { title: '', body: '', link_url: '', link_label: '', dismissible: true, ends_at: '' }

export function AnnouncementsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await getUserClient()
      .from('ps_app_announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) setError(error.message)
    else setRows((data ?? []) as Announcement[])
    setLoading(false)
  }, [])

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data === true) load()
      else setLoading(false)
    })
  }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (form.link_url && !form.link_url.startsWith('https://')) {
      setError('Links must start with https://')
      return
    }
    if (!form.dismissible && !form.ends_at) {
      setError('An announcement people can’t close blocks the app, so give it an end time.')
      return
    }
    setSaving(true)
    const { error } = await getUserClient().from('ps_app_announcements').insert({
      title: form.title.trim(),
      body: form.body.trim(),
      link_url: form.link_url.trim() || null,
      link_label: form.link_label.trim() || null,
      audience: 'mobile',
      dismissible: form.dismissible,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    })
    setSaving(false)
    if (error) setError(error.message)
    else {
      setForm(emptyForm)
      load()
    }
  }

  const endNow = async (a: Announcement) => {
    const { error } = await getUserClient().from('ps_app_announcements').update({ ends_at: new Date().toISOString() }).eq('id', a.id)
    if (error) setError(error.message)
    else load()
  }

  const remove = async (a: Announcement) => {
    if (!await confirmDialog(`Delete "${a.title}"?`)) return
    const { error } = await getUserClient().from('ps_app_announcements').delete().eq('id', a.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="page-container" style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1rem' }}>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/me" onClick={(e) => { e.preventDefault(); navigate('/me') }}>My Account</a>
          <span className="separator">/</span>
          <span>App announcements</span>
        </div>
        <h1>App announcements</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Live announcements pop up in the PharmStation phone app the next time someone opens it. People see each one once.
        </p>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isAdmin === false ? (
        <p className="text-muted">Only PharmStation admins can post announcements.</p>
      ) : (
        <>
          <form className="ps-card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }} onSubmit={create}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>New announcement</h2>
            <div className="form-group">
              <label className="ps-label">Title</label>
              <input className="ps-input" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="New: patient texting from your phone" />
            </div>
            <div className="form-group">
              <label className="ps-label">Message</label>
              <textarea className="ps-input" required maxLength={2000} rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '2 1 240px' }}>
                <label className="ps-label">Link (optional)</label>
                <input className="ps-input" type="url" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://pharmstation.co.uk/…" />
              </div>
              <div className="form-group" style={{ flex: '1 1 140px' }}>
                <label className="ps-label">Button text</label>
                <input className="ps-input" maxLength={40} value={form.link_label} onChange={(e) => setForm({ ...form, link_label: e.target.value })} placeholder="Find out more" />
              </div>
            </div>
            <div className="form-group">
              <label className="ps-label">Ends (optional)</label>
              <input className="ps-input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={!form.dismissible} onChange={(e) => setForm({ ...form, dismissible: !e.target.checked })} />
              <span>Block the app until it ends (outages only). People can’t close it, so it needs an end time.</span>
            </label>
            <button className="ps-btn ps-btn-primary" type="submit" disabled={saving}>{saving ? 'Posting…' : 'Post announcement'}</button>
          </form>

          {loading ? <p className="text-muted">Loading…</p> : rows.length === 0 ? (
            <p className="text-muted">No announcements yet.</p>
          ) : rows.map((a) => {
            const s = status(a)
            return (
              <div key={a.id} className="ps-card" style={{ padding: '1rem 1.25rem', marginBottom: '0.75rem', opacity: s === 'Ended' ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
                  <strong>{a.title}</strong>
                  <span className="text-muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {s}{a.dismissible ? '' : ' · blocks app'}
                  </span>
                </div>
                <p style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{a.body}</p>
                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                  From {fmt(a.starts_at)}{a.ends_at ? ` until ${fmt(a.ends_at)}` : ''}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                  {s !== 'Ended' && <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => endNow(a)}>End now</button>}
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => remove(a)}>Delete</button>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
