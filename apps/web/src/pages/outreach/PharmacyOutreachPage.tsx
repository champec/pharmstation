import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { PharmacyMapModal, type BoundsPharmacy } from '../../components/maps/PharmacyMapModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'not_contacted' | 'planned' | 'attempted' | 'engaged' | 'follow_up' | 'won' | 'not_interested'
type NextAction = 'none' | 'visit' | 'call' | 'email' | 'follow_up'
type OnboardingStatus = 'not_started' | 'invited' | 'account_created' | 'setup' | 'live' | 'declined'
type ActivityType = 'planned_visit' | 'visit' | 'phone_call' | 'email_sent' | 'email_received' | 'follow_up' | 'note' | 'status_change' | 'onboarding'

interface ContactPerson {
  id: string // client-only uuid for keying
  name: string
  role: string
  phone: string
  email: string
}

interface NhsContactRow {
  ContactMethodType?: string
  ContactValue?: string
}

type OTRow = {
  Weekday?: string
  OpeningTime?: string | null
  ClosingTime?: string | null
  IsOpen?: boolean
  OpeningTimeType?: string
}

interface Pharmacy {
  id: number
  ods_code: string
  organisation_name: string
  address1: string | null
  address2: string | null
  city: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  url: string | null
  contacts: unknown
  opening_times: unknown
}

interface OutreachProfile {
  id: string
  organisation_id: string
  pharmacy_id: number
  stage: Stage
  next_action: NextAction
  onboarding_status: OnboardingStatus
  outreach_contacts: ContactPerson[]
  latest_note: string | null
  last_contacted_at: string | null
  follow_up_at: string | null
  updated_at: string
  pharmacy: Pharmacy
}

interface Activity {
  id: string
  activity_type: ActivityType
  summary: string
  details: string | null
  occurred_at: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES: Array<{ value: Stage; label: string }> = [
  { value: 'not_contacted', label: 'Not contacted' },
  { value: 'planned', label: 'Planned' },
  { value: 'attempted', label: 'Attempted' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'won', label: 'Onboarded' },
  { value: 'not_interested', label: 'Not interested' },
]

const NEXT_ACTIONS: Array<{ value: NextAction; label: string }> = [
  { value: 'none', label: 'No action' },
  { value: 'visit', label: 'Visit' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email / awaiting reply' },
  { value: 'follow_up', label: 'Follow up' },
]

const ONBOARDING: Array<{ value: OnboardingStatus; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'invited', label: 'Invited' },
  { value: 'account_created', label: 'Account created' },
  { value: 'setup', label: 'Setup in progress' },
  { value: 'live', label: 'Live' },
  { value: 'declined', label: 'Declined' },
]

const ACTIVITIES: Array<{ value: ActivityType; label: string; emoji: string }> = [
  { value: 'planned_visit', label: 'Planned visit', emoji: '📅' },
  { value: 'visit', label: 'Visited pharmacy', emoji: '🚶' },
  { value: 'phone_call', label: 'Phone call', emoji: '📞' },
  { value: 'email_sent', label: 'Email sent', emoji: '✉️' },
  { value: 'email_received', label: 'Email reply received', emoji: '📬' },
  { value: 'follow_up', label: 'Follow-up', emoji: '🔔' },
  { value: 'note', label: 'Note', emoji: '📝' },
  { value: 'status_change', label: 'Status update', emoji: '🔄' },
  { value: 'onboarding', label: 'Onboarding update', emoji: '✅' },
]

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ── Helpers ───────────────────────────────────────────────────────────────────

function stageLabel(value: Stage) {
  return STAGES.find((o) => o.value === value)?.label ?? value
}

function parseNhsContacts(contacts: unknown) {
  // contacts is stored as a double-encoded JSON string in JSONB, so Supabase returns
  // it as a plain JS string — parse it first, exactly like parseOpeningTimes does.
  let rows: NhsContactRow[]
  if (Array.isArray(contacts)) {
    rows = contacts as NhsContactRow[]
  } else if (typeof contacts === 'string') {
    try { rows = JSON.parse(contacts) as NhsContactRow[] } catch { return { phone: null, email: null, website: null } }
    if (!Array.isArray(rows)) return { phone: null, email: null, website: null }
  } else {
    return { phone: null, email: null, website: null }
  }
  return {
    phone: rows.find((r) => r.ContactMethodType === 'Telephone')?.ContactValue ?? null,
    email: rows.find((r) => r.ContactMethodType === 'Email')?.ContactValue ?? null,
    website: rows.find((r) => r.ContactMethodType === 'Website')?.ContactValue ?? null,
  }
}

function parseOpeningTimes(raw: unknown): OTRow[] {
  if (Array.isArray(raw)) return raw as OTRow[]
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as OTRow[] } catch { return [] }
  }
  return []
}

function toLocalInput(value: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function newContactPerson(): ContactPerson {
  return { id: crypto.randomUUID(), name: '', role: '', phone: '', email: '' }
}

// ── Opening hours sub-component ───────────────────────────────────────────────

function OpeningHoursBlock({ opening_times }: { opening_times: unknown }) {
  const rows = parseOpeningTimes(opening_times).filter(
    (r) => r.OpeningTimeType === 'General' || !r.OpeningTimeType
  )
  if (rows.length === 0) return <span className="outreach-hours-none">Not available</span>

  // Group by weekday
  const byDay: Record<string, OTRow[]> = {}
  for (const row of rows) {
    const day = row.Weekday ?? 'Unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(row)
  }

  return (
    <div className="outreach-hours-grid">
      {DAYS.map((day) => {
        const slots = byDay[day] ?? []
        const openSlots = slots.filter((s) => s.IsOpen !== false && s.OpeningTime && s.ClosingTime)
        return (
          <div key={day} className="outreach-hours-row">
            <span className="outreach-hours-day">{day.slice(0, 3)}</span>
            {openSlots.length === 0
              ? <span className="outreach-hours-closed">Closed</span>
              : <span className="outreach-hours-time">{openSlots.map((s, i) => <span key={i}>{s.OpeningTime}–{s.ClosingTime}</span>)}</span>
            }
          </div>
        )
      })}
    </div>
  )
}

// ── Contact person repeater ───────────────────────────────────────────────────
// Fully controlled — local draft state kept in sync with props.
// Keyed on pharmacy id by the parent so it resets when you switch pharmacies.

function ContactsRepeater({
  contacts,
  onChange,
}: {
  contacts: ContactPerson[]
  onChange: (next: ContactPerson[]) => void
}) {
  const [draft, setDraft] = useState<ContactPerson[]>(contacts)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if parent passes new contacts (e.g. after save round-trip)
  useEffect(() => { setDraft(contacts) }, [contacts])

  function update(id: string, field: keyof ContactPerson, value: string) {
    const next = draft.map((c) => c.id === id ? { ...c, [field]: value } : c)
    setDraft(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onChange(next), 800)
  }

  function remove(id: string) {
    const next = draft.filter((c) => c.id !== id)
    setDraft(next)
    onChange(next)
  }

  function add() {
    const next = [...draft, newContactPerson()]
    setDraft(next)
    onChange(next)
  }

  return (
    <div className="outreach-contacts-repeater">
      {draft.map((contact, i) => (
        <div key={contact.id} className="outreach-contact-card">
          <div className="outreach-contact-card-header">
            <span>Contact {i + 1}</span>
            <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => remove(contact.id)}>Remove</button>
          </div>
          <div className="outreach-contact-card-fields">
            <label>Name<input className="ps-input" value={contact.name} onChange={(e) => update(contact.id, 'name', e.target.value)} placeholder="e.g. Sarah" /></label>
            <label>Role / who to ask for<input className="ps-input" value={contact.role} onChange={(e) => update(contact.id, 'role', e.target.value)} placeholder="Manager, owner, superintendent..." /></label>
            <label>Direct phone<input className="ps-input" value={contact.phone} onChange={(e) => update(contact.id, 'phone', e.target.value)} placeholder="Personal or direct line" /></label>
            <label>Direct email<input className="ps-input" type="email" value={contact.email} onChange={(e) => update(contact.id, 'email', e.target.value)} placeholder="Direct email address" /></label>
          </div>
        </div>
      ))}
      <button type="button" className="ps-btn ps-btn-secondary outreach-add-contact-btn" onClick={add}>
        + Add contact person
      </button>
    </div>
  )
}

// ── Activity entry (editable) ─────────────────────────────────────────────────

function ActivityEntry({
  activity,
  onSave,
  onDelete,
}: {
  activity: Activity
  onSave: (patch: { summary: string; details: string | null; activity_type: ActivityType }) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [type, setType] = useState<ActivityType>(activity.activity_type)
  const [summary, setSummary] = useState(activity.summary)
  const [details, setDetails] = useState(activity.details ?? '')
  const [busy, setBusy] = useState(false)
  const meta = ACTIVITIES.find((o) => o.value === activity.activity_type)

  async function save() {
    if (!summary.trim()) return
    setBusy(true)
    await onSave({ activity_type: type, summary: summary.trim(), details: details.trim() || null })
    setBusy(false)
    setEditing(false)
  }

  async function remove() {
    if (!window.confirm('Remove this activity entry?')) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }

  if (editing) {
    return (
      <article className="outreach-timeline-editing">
        <span className="outreach-timeline-mark">{meta?.emoji ?? '·'}</span>
        <div className="outreach-timeline-edit-form">
          <select className="ps-input" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
            {ACTIVITIES.map((o) => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
          </select>
          <input className="ps-input" value={summary} onChange={(e) => setSummary(e.target.value)} required />
          <textarea className="ps-input" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} />
          <div className="outreach-timeline-edit-actions">
            <button className="ps-btn ps-btn-primary ps-btn-sm" disabled={busy || !summary.trim()} onClick={save}>Save</button>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article>
      <span className="outreach-timeline-mark">{meta?.emoji ?? '·'}</span>
      <div>
        <div className="outreach-timeline-header">
          <small>{meta?.label} · {formatDate(activity.occurred_at)}</small>
          <div className="outreach-timeline-actions">
            <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busy} onClick={remove}>Delete</button>
          </div>
        </div>
        <strong>{activity.summary}</strong>
        {activity.details && <p>{activity.details}</p>}
      </div>
    </article>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PharmacyOutreachPage() {
  const { organisation } = useAuthStore()
  const [profiles, setProfiles] = useState<OutreachProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | Stage | 'due'>('all')
  const [activityType, setActivityType] = useState<ActivityType>('visit')
  const [activitySummary, setActivitySummary] = useState('')
  const [activityDetails, setActivityDetails] = useState('')

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadProfiles = useCallback(async (preferId?: string) => {
    if (!organisation?.id) return
    setLoading(true)
    const { data, error: err } = await getUserClient()
      .from('ps_pharmacy_outreach')
      .select(`
        *,
        pharmacy:pharmacies!pharmacy_id(
          id, ods_code, organisation_name,
          address1, address2, city, postcode,
          latitude, longitude, url,
          contacts, opening_times
        )
      `)
      .eq('organisation_id', organisation.id)
      .order('updated_at', { ascending: false })
    if (err) setError(err.message)
    else {
      const next = (data ?? []) as unknown as OutreachProfile[]
      // Ensure outreach_contacts is always an array
      for (const p of next) {
        if (!Array.isArray(p.outreach_contacts)) p.outreach_contacts = []
      }
      setProfiles(next)
      setSelectedId((cur) => preferId ?? cur ?? next[0]?.id ?? null)
    }
    setLoading(false)
  }, [organisation?.id])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const loadActivities = useCallback(async (outreachId: string) => {
    const { data, error: err } = await getUserClient()
      .from('ps_pharmacy_outreach_activities')
      .select('id, activity_type, summary, details, occurred_at')
      .eq('outreach_id', outreachId)
      .order('occurred_at', { ascending: false })
    if (err) setError(err.message)
    else setActivities((data ?? []) as Activity[])
  }, [])

  useEffect(() => {
    if (!selectedId) { setActivities([]); return }
    loadActivities(selectedId)
  }, [selectedId, loadActivities])

  // ── Filters / stats ───────────────────────────────────────────────────────

  const filteredProfiles = useMemo(() => {
    const now = Date.now()
    const q = query.trim().toLowerCase()
    return profiles.filter((p) => {
      if (stageFilter === 'due' && (!p.follow_up_at || new Date(p.follow_up_at).getTime() > now)) return false
      if (stageFilter !== 'all' && stageFilter !== 'due' && p.stage !== stageFilter) return false
      if (!q) return true
      const ph = p.pharmacy
      const contactNames = p.outreach_contacts.map((c) => c.name).join(' ')
      return [ph.organisation_name, ph.ods_code, ph.postcode, ph.city, contactNames]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [profiles, query, stageFilter])

  const dueCount = profiles.filter((p) => p.follow_up_at && new Date(p.follow_up_at) <= new Date()).length
  const engagedCount = profiles.filter((p) => ['engaged', 'follow_up'].includes(p.stage)).length
  const onboardedCount = profiles.filter((p) => p.onboarding_status === 'live' || p.stage === 'won').length

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function addFromMap(pharmacy: BoundsPharmacy) {
    if (!organisation?.id) return
    setSaving(true)
    setError(null)
    const existing = profiles.find((p) => p.pharmacy_id === pharmacy.pharmacy_id)
    if (existing) { setSelectedId(existing.id); setMapOpen(false); setSaving(false); return }
    const { data, error: err } = await getUserClient()
      .from('ps_pharmacy_outreach')
      .insert({ organisation_id: organisation.id, pharmacy_id: pharmacy.pharmacy_id })
      .select('id').single()
    if (err) setError(err.message)
    else { setMapOpen(false); await loadProfiles(data.id) }
    setSaving(false)
  }

  async function updateProfile(patch: Record<string, unknown>) {
    if (!selected) return
    setSaving(true)
    setError(null)
    const { error: err } = await getUserClient()
      .from('ps_pharmacy_outreach').update(patch).eq('id', selected.id)
    if (err) setError(err.message)
    else await loadProfiles(selected.id)
    setSaving(false)
  }

  async function addActivity(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !organisation?.id || !activitySummary.trim()) return
    setSaving(true)
    setError(null)
    const now = new Date().toISOString()
    const { error: err } = await getUserClient().from('ps_pharmacy_outreach_activities').insert({
      outreach_id: selected.id,
      organisation_id: organisation.id,
      activity_type: activityType,
      summary: activitySummary.trim(),
      details: activityDetails.trim() || null,
      occurred_at: now,
    })
    if (err) { setError(err.message) }
    else {
      const contacted = ['visit', 'phone_call', 'email_sent', 'email_received', 'follow_up'].includes(activityType)
      await getUserClient().from('ps_pharmacy_outreach').update({
        latest_note: activityDetails.trim() || activitySummary.trim(),
        ...(contacted ? { last_contacted_at: now } : {}),
      }).eq('id', selected.id)
      setActivitySummary('')
      setActivityDetails('')
      await loadProfiles(selected.id)
      await loadActivities(selected.id)
    }
    setSaving(false)
  }

  // ── NHS contact data (derived from pharmacy row) ──────────────────────────

  const nhsContacts = selected ? parseNhsContacts(selected.pharmacy.contacts) : null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-container outreach-page">
      <header className="page-header outreach-header">
        <div>
          <p className="outreach-eyebrow">Pharmacy growth</p>
          <h1 className="page-title">Outreach</h1>
          <p className="page-subtitle">Plan visits, capture conversations, and keep follow-ups moving.</p>
        </div>
        <div className="page-header-actions">
          <button className="ps-btn ps-btn-primary" onClick={() => setMapOpen(true)}>Open pharmacy map</button>
        </div>
      </header>

      {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <section className="outreach-stats" aria-label="Outreach summary">
        <button onClick={() => setStageFilter('all')}><span>Tracked</span><strong>{profiles.length}</strong></button>
        <button onClick={() => setStageFilter('due')}><span>Follow-ups due</span><strong>{dueCount}</strong></button>
        <button onClick={() => setStageFilter('engaged')}><span>Active conversations</span><strong>{engagedCount}</strong></button>
        <button onClick={() => setStageFilter('won')}><span>Onboarded</span><strong>{onboardedCount}</strong></button>
      </section>

      <div className="outreach-toolbar">
        <input className="ps-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, postcode, ODS or contact" />
        <select className="ps-input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)}>
          <option value="all">All pipeline stages</option>
          <option value="due">Follow-ups due</option>
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="outreach-workspace">
        {/* ── Left: pharmacy list ── */}
        <section className="outreach-list" aria-label="Tracked pharmacies">
          {loading ? (
            <p className="outreach-empty">Loading outreach records...</p>
          ) : filteredProfiles.length === 0 ? (
            <div className="outreach-empty">
              <strong>No pharmacies here yet</strong>
              <span>Open the pharmacy map and click a pharmacy to add it.</span>
            </div>
          ) : filteredProfiles.map((p) => (
            <button key={p.id} className={p.id === selectedId ? 'outreach-list-item active' : 'outreach-list-item'} onClick={() => setSelectedId(p.id)}>
              <span className="outreach-list-main"><strong>{p.pharmacy.organisation_name}</strong><small>{p.pharmacy.postcode} · {p.pharmacy.ods_code}</small></span>
              <span className={`outreach-stage outreach-stage-${p.stage}`}>{stageLabel(p.stage)}</span>
              <small className={p.follow_up_at && new Date(p.follow_up_at) <= new Date() ? 'outreach-due' : ''}>
                {p.follow_up_at ? `Follow up ${formatDate(p.follow_up_at)}` : NEXT_ACTIONS.find((o) => o.value === p.next_action)?.label}
              </small>
            </button>
          ))}
        </section>

        {/* ── Right: detail panel ── */}
        <main className="outreach-detail">
          {!selected ? (
            <div className="outreach-empty outreach-empty-detail">
              <strong>Select a pharmacy</strong>
              <span>Its NHS contact info, your tracked contacts and the activity timeline will appear here.</span>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="outreach-detail-header">
                <div>
                  <h2>{selected.pharmacy.organisation_name}</h2>
                  <p>{[selected.pharmacy.address1, selected.pharmacy.address2, selected.pharmacy.city, selected.pharmacy.postcode].filter(Boolean).join(', ')}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexShrink: 0 }}>
                  {saving && <span className="outreach-saving">Saving…</span>}
                  {selected.pharmacy.latitude && selected.pharmacy.longitude && (
                    <a className="ps-btn ps-btn-secondary" target="_blank" rel="noreferrer"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selected.pharmacy.latitude},${selected.pharmacy.longitude}`}>
                      Directions
                    </a>
                  )}
                </div>
              </div>

              {/* NHS contact info */}
              <div className="outreach-nhs-info">
                <div className="outreach-nhs-info-header">NHS pharmacy information</div>
                <div className="outreach-nhs-contacts">
                  <div className="outreach-nhs-row">
                    <span className="outreach-nhs-label">📞 Phone</span>
                    <span>{nhsContacts?.phone ? <a href={`tel:${nhsContacts.phone}`}>{nhsContacts.phone}</a> : <em>Not listed</em>}</span>
                  </div>
                  <div className="outreach-nhs-row">
                    <span className="outreach-nhs-label">✉ Email</span>
                    <span>{nhsContacts?.email ? <a href={`mailto:${nhsContacts.email}`}>{nhsContacts.email}</a> : <em>Not listed</em>}</span>
                  </div>
                  <div className="outreach-nhs-row">
                    <span className="outreach-nhs-label">🌐 Website</span>
                    <span>{nhsContacts?.website
                      ? <a href={nhsContacts.website} target="_blank" rel="noreferrer">{nhsContacts.website.replace(/^https?:\/\//, '').slice(0, 50)}</a>
                      : <em>Not listed</em>}
                    </span>
                  </div>
                  <div className="outreach-nhs-row outreach-nhs-hours">
                    <span className="outreach-nhs-label">🕐 Hours</span>
                    <OpeningHoursBlock opening_times={selected.pharmacy.opening_times} />
                  </div>
                  <div className="outreach-nhs-row">
                    <span className="outreach-nhs-label">🔄 ODS</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{selected.pharmacy.ods_code}</span>
                  </div>
                </div>
              </div>

              {/* Pipeline settings */}
              <section className="outreach-profile-form">
                <label>Pipeline stage
                  <select className="ps-input" value={selected.stage} onChange={(e) => updateProfile({ stage: e.target.value })}>
                    {STAGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label>Next action
                  <select className="ps-input" value={selected.next_action} onChange={(e) => updateProfile({ next_action: e.target.value })}>
                    {NEXT_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label>Follow-up date
                  <input className="ps-input" type="datetime-local" value={toLocalInput(selected.follow_up_at)}
                    onChange={(e) => updateProfile({ follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </label>
                <label>Onboarding status
                  <select className="ps-input" value={selected.onboarding_status} onChange={(e) => updateProfile({ onboarding_status: e.target.value })}>
                    {ONBOARDING.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <div className="outreach-last-contact-row">
                  <span className="outreach-nhs-label">Last contacted</span>
                  <span>{formatDate(selected.last_contacted_at)}</span>
                </div>
              </section>

              {/* Your contacts (repeater) */}
              <section className="outreach-section outreach-contacts-section">
                <div className="outreach-section-heading">
                  <div>
                    <h3>Your contacts at this pharmacy</h3>
                    <p>People you have spoken to or need to speak to — names, roles, direct numbers, email addresses.</p>
                  </div>
                </div>
                <ContactsRepeater
                  key={selected.id}
                  contacts={selected.outreach_contacts}
                  onChange={(next) => updateProfile({ outreach_contacts: next })}
                />
              </section>

              {/* Activity timeline */}
              <section className="outreach-section outreach-timeline-section">
                <div className="outreach-section-heading">
                  <div>
                    <h3>Activity timeline</h3>
                    <p>Log every visit, call, email and follow-up. Entries can be edited or removed.</p>
                  </div>
                </div>

                <form className="outreach-activity-form" onSubmit={addActivity}>
                  <div className="outreach-activity-row">
                    <select className="ps-input" value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
                      {ACTIVITIES.map((o) => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
                    </select>
                    <input className="ps-input" value={activitySummary} onChange={(e) => setActivitySummary(e.target.value)}
                      placeholder="One-line outcome, e.g. 'Asked to email the manager, name is Sarah'" required />
                  </div>
                  <textarea className="ps-input" value={activityDetails} onChange={(e) => setActivityDetails(e.target.value)}
                    placeholder="Full notes — what was said, objections, next steps, anything useful" rows={3} />
                  <button className="ps-btn ps-btn-primary" disabled={saving || !activitySummary.trim()}>
                    Add to timeline
                  </button>
                </form>

                <div className="outreach-timeline">
                  {activities.length === 0 ? (
                    <p className="outreach-empty" style={{ paddingTop: 'var(--ps-space-lg)' }}>No activity logged yet.</p>
                  ) : activities.map((a) => (
                    <ActivityEntry
                      key={a.id}
                      activity={a}
                      onSave={async (patch) => {
                        await getUserClient().from('ps_pharmacy_outreach_activities').update(patch).eq('id', a.id)
                        if (selected) await loadActivities(selected.id)
                      }}
                      onDelete={async () => {
                        await getUserClient().from('ps_pharmacy_outreach_activities').delete().eq('id', a.id)
                        if (selected) await loadActivities(selected.id)
                      }}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <PharmacyMapModal
        isOpen={mapOpen}
        onClose={() => setMapOpen(false)}
        onAddToOutreach={addFromMap}
        trackedPharmacyIds={profiles.map((p) => p.pharmacy_id)}
      />
    </div>
  )
}