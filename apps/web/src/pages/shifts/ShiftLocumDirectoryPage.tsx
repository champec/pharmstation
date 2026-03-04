import { useCallback, useEffect, useRef, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface LocumEntry {
  locum_id: string
  full_name: string
  gphc_number: string
  services: string[]
  completed_shifts: number
  cancelled_shifts: number
  last_shift_date: string | null
  avg_score: number | null
  is_blacklisted: boolean
  blacklist_reason?: string
}

interface Note {
  id: string
  note: string
  created_at: string
  created_by: string
}

export function ShiftLocumDirectoryPage() {
  const { organisation } = useAuthStore()
  const orgId = organisation?.id
  const [locums, setLocums] = useState<LocumEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  /* Notes panel */
  const [notePanelLocum, setNotePanelLocum] = useState<LocumEntry | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  /* Blacklist dialog */
  const [blacklistTarget, setBlacklistTarget] = useState<LocumEntry | null>(null)
  const [blacklistReason, setBlacklistReason] = useState('')
  const [savingBlacklist, setSavingBlacklist] = useState(false)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    const client = getUserClient()
    try {
      /* All unique locums who've had bookings at this org */
      const { data: bookings, error: bErr } = await client
        .from('ps_locum_bookings')
        .select('locum_id, status, shift_date')
        .eq('org_id', orgId)
      if (bErr) throw bErr

      const locumMap = new Map<string, { completed: number; cancelled: number; lastDate: string | null }>()
      for (const b of (bookings ?? []) as { locum_id: string; status: string; shift_date: string }[]) {
        const curr = locumMap.get(b.locum_id) ?? { completed: 0, cancelled: 0, lastDate: null }
        if (b.status === 'completed') curr.completed++
        if (b.status === 'cancelled_locum') curr.cancelled++
        if (!curr.lastDate || b.shift_date > curr.lastDate) curr.lastDate = b.shift_date
        locumMap.set(b.locum_id, curr)
      }

      if (locumMap.size === 0) { setLocums([]); setLoading(false); return }

      const allLocumIds = [...locumMap.keys()]

      const [profilesRes, reviewsRes, blacklistRes] = await Promise.all([
        client.from('ps_locum_profiles').select('id, gphc_number, user_id').in('id', allLocumIds),
        client.from('ps_locum_reviews').select('locum_id, score').eq('org_id', orgId).in('locum_id', allLocumIds),
        client.from('ps_locum_blacklist').select('locum_id, reason').eq('org_id', orgId).in('locum_id', allLocumIds),
      ])

      const profileUserIds = ((profilesRes.data ?? []) as { id: string; gphc_number: string; user_id: string }[]).map((p) => p.user_id)
      const userRes = await client.from('ps_user_profiles').select('id, full_name').in('id', profileUserIds)
      const userMap = new Map(((userRes.data ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]))

      const reviewMap = new Map<string, number[]>()
      for (const r of (reviewsRes.data ?? []) as { locum_id: string; score: number }[]) {
        const arr = reviewMap.get(r.locum_id) ?? []
        arr.push(r.score)
        reviewMap.set(r.locum_id, arr)
      }

      const blacklistSet = new Map<string, string>()
      for (const b of (blacklistRes.data ?? []) as { locum_id: string; reason: string }[]) {
        blacklistSet.set(b.locum_id, b.reason)
      }

      const profiles = (profilesRes.data ?? []) as { id: string; gphc_number: string; user_id: string }[]
      const entries: LocumEntry[] = profiles.map((p) => {
        const stats = locumMap.get(p.id)!
        const scores = reviewMap.get(p.id) ?? []
        const avg_score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
        return {
          locum_id: p.id,
          full_name: userMap.get(p.user_id) ?? 'Unknown',
          gphc_number: p.gphc_number,
          services: [],
          completed_shifts: stats.completed,
          cancelled_shifts: stats.cancelled,
          last_shift_date: stats.lastDate,
          avg_score,
          is_blacklisted: blacklistSet.has(p.id),
          blacklist_reason: blacklistSet.get(p.id),
        }
      })

      entries.sort((a, b) => a.full_name.localeCompare(b.full_name))
      setLocums(entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function openNotes(locum: LocumEntry) {
    setNotePanelLocum(locum)
    setNotes([])
    setNewNote('')
    setLoadingNotes(true)
    const { data } = await getUserClient()
      .from('ps_locum_notes')
      .select('id, note, created_at, created_by')
      .eq('org_id', orgId)
      .eq('locum_id', locum.locum_id)
      .order('created_at', { ascending: false })
    setNotes((data ?? []) as Note[])
    setLoadingNotes(false)
    setTimeout(() => noteInputRef.current?.focus(), 50)
  }

  async function addNote() {
    if (!newNote.trim() || !notePanelLocum || !orgId) return
    setSavingNote(true)
    const { error: nErr } = await getUserClient().from('ps_locum_notes').insert({
      org_id: orgId,
      locum_id: notePanelLocum.locum_id,
      note: newNote.trim(),
    })
    if (!nErr) {
      setNewNote('')
      await openNotes(notePanelLocum)
    }
    setSavingNote(false)
  }

  async function confirmBlacklist() {
    if (!blacklistTarget || !orgId) return
    setSavingBlacklist(true)
    const { error: bErr } = await getUserClient().from('ps_locum_blacklist').insert({
      org_id: orgId,
      locum_id: blacklistTarget.locum_id,
      reason: blacklistReason.trim() || 'No reason provided',
    })
    if (!bErr) {
      setLocums((prev) =>
        prev.map((l) =>
          l.locum_id === blacklistTarget.locum_id
            ? { ...l, is_blacklisted: true, blacklist_reason: blacklistReason.trim() || 'No reason provided' }
            : l
        )
      )
    }
    setBlacklistTarget(null)
    setBlacklistReason('')
    setSavingBlacklist(false)
  }

  const filtered = locums.filter(
    (l) =>
      search === '' ||
      l.full_name.toLowerCase().includes(search.toLowerCase()) ||
      l.gphc_number.includes(search)
  )

  function fmtDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Locum Directory</h1>
          <p className="page-subtitle">All locums who have worked with your pharmacy</p>
        </div>
        <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ marginBottom: '1.25rem' }}>
        <input
          className="form-input"
          style={{ maxWidth: 320 }}
          type="text"
          placeholder="Search by name or GPhC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-indicator" style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="ps-card">
          <div className="ps-card-body" style={{ padding: '2rem', textAlign: 'center' }}>
            <p className="text-muted">{search ? 'No locums match your search.' : 'No locums have worked here yet.'}</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map((locum) => (
            <div key={locum.locum_id} className="ps-card">
              <div className="ps-card-body" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600 }}>{locum.full_name}</span>
                    {locum.is_blacklisted && <span className="ps-badge ps-badge-danger">Blacklisted</span>}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)', marginBottom: '0.5rem' }}>GPhC: {locum.gphc_number}</div>
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem' }}>
                    <span><strong>{locum.completed_shifts}</strong> shifts completed</span>
                    {locum.cancelled_shifts > 0 && <span style={{ color: 'var(--ps-danger)' }}><strong>{locum.cancelled_shifts}</strong> cancellations</span>}
                    <span>Last shift: {fmtDate(locum.last_shift_date)}</span>
                    {locum.avg_score !== null && (
                      <span>Rating: <strong>{locum.avg_score.toFixed(1)}</strong>/5</span>
                    )}
                  </div>
                  {locum.is_blacklisted && locum.blacklist_reason && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--ps-danger)' }}>
                      Blacklist reason: {locum.blacklist_reason}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => openNotes(locum)}>Notes</button>
                  {!locum.is_blacklisted && (
                    <button className="ps-btn ps-btn-danger ps-btn-sm" onClick={() => { setBlacklistTarget(locum); setBlacklistReason('') }}>Blacklist</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes panel */}
      {notePanelLocum && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
          <div style={{ width: 420, height: '100vh', background: 'var(--ps-background)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.15)' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--ps-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>Notes — {notePanelLocum.full_name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>GPhC {notePanelLocum.gphc_number}</div>
              </div>
              <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setNotePanelLocum(null)}>Close</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {loadingNotes ? (
                <p className="text-muted">Loading…</p>
              ) : notes.length === 0 ? (
                <p className="text-muted">No notes yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--ps-surface)', borderRadius: 8 }}>
                    <p style={{ fontSize: '0.875rem', margin: 0 }}>{n.note}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--ps-slate)', marginTop: '0.25rem' }}>{new Date(n.created_at).toLocaleString('en-GB')}</p>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: '1rem', borderTop: '1px solid var(--ps-border)' }}>
              <textarea
                ref={noteInputRef}
                className="form-input"
                style={{ width: '100%', minHeight: 80, resize: 'vertical', marginBottom: '0.5rem' }}
                placeholder="Add a note…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <button className="ps-btn ps-btn-primary" onClick={addNote} disabled={savingNote || !newNote.trim()}>
                {savingNote ? 'Saving…' : 'Add Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blacklist dialog */}
      {blacklistTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="ps-card" style={{ width: '100%', maxWidth: 440 }}>
            <div className="ps-card-header">
              <h2 className="ps-card-title" style={{ color: 'var(--ps-danger)' }}>Blacklist {blacklistTarget.full_name}?</h2>
            </div>
            <div className="ps-card-body">
              <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
                This locum will no longer be able to apply for shifts at your pharmacy. This action is logged.
              </p>
              <div className="form-group">
                <label className="form-label">Reason (optional)</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: 80, resize: 'vertical' }}
                  placeholder="Reason for blacklisting…"
                  value={blacklistReason}
                  onChange={(e) => setBlacklistReason(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button className="ps-btn ps-btn-ghost" onClick={() => setBlacklistTarget(null)} disabled={savingBlacklist}>Cancel</button>
                <button className="ps-btn ps-btn-danger" onClick={confirmBlacklist} disabled={savingBlacklist}>
                  {savingBlacklist ? 'Processing…' : 'Confirm Blacklist'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
