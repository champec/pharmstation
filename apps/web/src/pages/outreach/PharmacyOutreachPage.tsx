import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import { PharmacyMapModal, type BoundsPharmacy } from '../../components/maps/PharmacyMapModal'

type Stage = 'not_contacted' | 'planned' | 'attempted' | 'engaged' | 'follow_up' | 'won' | 'not_interested'
type NextAction = 'none' | 'visit' | 'call' | 'email' | 'follow_up'
type OnboardingStatus = 'not_started' | 'invited' | 'account_created' | 'setup' | 'live' | 'declined'
type ActivityType = 'planned_visit' | 'visit' | 'phone_call' | 'email_sent' | 'email_received' | 'follow_up' | 'note' | 'status_change' | 'onboarding'

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
  contacts: unknown
}

interface OutreachProfile {
  id: string
  organisation_id: string
  pharmacy_id: number
  stage: Stage
  next_action: NextAction
  onboarding_status: OnboardingStatus
  contact_name: string | null
  contact_role: string | null
  personal_phone: string | null
  personal_email: string | null
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

const ACTIVITIES: Array<{ value: ActivityType; label: string }> = [
  { value: 'planned_visit', label: 'Planned visit' },
  { value: 'visit', label: 'Visited pharmacy' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'email_sent', label: 'Email sent' },
  { value: 'email_received', label: 'Email reply received' },
  { value: 'follow_up', label: 'Follow-up action' },
  { value: 'note', label: 'Note' },
  { value: 'status_change', label: 'Status update' },
  { value: 'onboarding', label: 'Onboarding update' },
]

function stageLabel(value: Stage) {
  return STAGES.find((option) => option.value === value)?.label ?? value
}

function contactValues(contacts: unknown) {
  if (!Array.isArray(contacts)) return { phone: null, email: null }
  const rows = contacts as Array<{ ContactMethodType?: string; ContactValue?: string }>
  return {
    phone: rows.find((row) => row.ContactMethodType === 'Telephone')?.ContactValue ?? null,
    email: rows.find((row) => row.ContactMethodType === 'Email')?.ContactValue ?? null,
  }
}

function toLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

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

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null

  const loadProfiles = useCallback(async (preferId?: string) => {
    if (!organisation?.id) return
    setLoading(true)
    const { data, error: loadError } = await getUserClient()
      .from('ps_pharmacy_outreach')
      .select('*, pharmacy:pharmacies!pharmacy_id(id, ods_code, organisation_name, address1, address2, city, postcode, latitude, longitude, contacts)')
      .eq('organisation_id', organisation.id)
      .order('updated_at', { ascending: false })
    if (loadError) setError(loadError.message)
    else {
      const next = (data ?? []) as unknown as OutreachProfile[]
      setProfiles(next)
      setSelectedId((current) => preferId ?? current ?? next[0]?.id ?? null)
    }
    setLoading(false)
  }, [organisation?.id])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  useEffect(() => {
    if (!selectedId) {
      setActivities([])
      return
    }
    getUserClient()
      .from('ps_pharmacy_outreach_activities')
      .select('id, activity_type, summary, details, occurred_at')
      .eq('outreach_id', selectedId)
      .order('occurred_at', { ascending: false })
      .then(({ data, error: activityError }) => {
        if (activityError) setError(activityError.message)
        else setActivities((data ?? []) as Activity[])
      })
  }, [selectedId])

  const filteredProfiles = useMemo(() => {
    const now = Date.now()
    const normalized = query.trim().toLowerCase()
    return profiles.filter((profile) => {
      if (stageFilter === 'due' && (!profile.follow_up_at || new Date(profile.follow_up_at).getTime() > now)) return false
      if (stageFilter !== 'all' && stageFilter !== 'due' && profile.stage !== stageFilter) return false
      if (!normalized) return true
      const pharmacy = profile.pharmacy
      return [pharmacy.organisation_name, pharmacy.ods_code, pharmacy.postcode, pharmacy.city, profile.contact_name]
        .some((value) => value?.toLowerCase().includes(normalized))
    })
  }, [profiles, query, stageFilter])

  const dueCount = profiles.filter((profile) => profile.follow_up_at && new Date(profile.follow_up_at) <= new Date()).length
  const engagedCount = profiles.filter((profile) => ['engaged', 'follow_up'].includes(profile.stage)).length
  const onboardedCount = profiles.filter((profile) => profile.onboarding_status === 'live' || profile.stage === 'won').length

  async function addFromMap(pharmacy: BoundsPharmacy) {
    if (!organisation?.id) return
    setSaving(true)
    setError(null)
    const existing = profiles.find((profile) => profile.pharmacy_id === pharmacy.pharmacy_id)
    if (existing) {
      setSelectedId(existing.id)
      setMapOpen(false)
      setSaving(false)
      return
    }
    const { data, error: insertError } = await getUserClient()
      .from('ps_pharmacy_outreach')
      .insert({ organisation_id: organisation.id, pharmacy_id: pharmacy.pharmacy_id })
      .select('id')
      .single()
    if (insertError) setError(insertError.message)
    else {
      setMapOpen(false)
      await loadProfiles(data.id)
    }
    setSaving(false)
  }

  async function updateProfile(patch: Partial<OutreachProfile>) {
    if (!selected) return
    setSaving(true)
    setError(null)
    const { error: updateError } = await getUserClient()
      .from('ps_pharmacy_outreach')
      .update(patch)
      .eq('id', selected.id)
    if (updateError) setError(updateError.message)
    else await loadProfiles(selected.id)
    setSaving(false)
  }

  async function addActivity(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !organisation?.id || !activitySummary.trim()) return
    setSaving(true)
    setError(null)
    const now = new Date().toISOString()
    const { error: insertError } = await getUserClient().from('ps_pharmacy_outreach_activities').insert({
      outreach_id: selected.id,
      organisation_id: organisation.id,
      activity_type: activityType,
      summary: activitySummary.trim(),
      details: activityDetails.trim() || null,
      occurred_at: now,
    })
    if (insertError) setError(insertError.message)
    else {
      const contacted = ['visit', 'phone_call', 'email_sent', 'email_received', 'follow_up'].includes(activityType)
      await getUserClient().from('ps_pharmacy_outreach').update({
        latest_note: activityDetails.trim() || activitySummary.trim(),
        ...(contacted ? { last_contacted_at: now } : {}),
      }).eq('id', selected.id)
      setActivitySummary('')
      setActivityDetails('')
      await loadProfiles(selected.id)
      const { data } = await getUserClient().from('ps_pharmacy_outreach_activities')
        .select('id, activity_type, summary, details, occurred_at')
        .eq('outreach_id', selected.id).order('occurred_at', { ascending: false })
      setActivities((data ?? []) as Activity[])
    }
    setSaving(false)
  }

  const contacts = selected ? contactValues(selected.pharmacy.contacts) : { phone: null, email: null }

  return (
    <div className="page-container outreach-page">
      <header className="page-header outreach-header">
        <div>
          <p className="outreach-eyebrow">Pharmacy growth</p>
          <h1 className="page-title">Outreach</h1>
          <p className="page-subtitle">Plan pharmacy visits, capture every conversation, and keep follow-ups moving.</p>
        </div>
        <div className="page-header-actions">
          <button className="ps-btn ps-btn-primary" onClick={() => setMapOpen(true)}>Open pharmacy map</button>
        </div>
      </header>

      {error && <div className="ps-alert ps-alert-error">{error}</div>}

      <section className="outreach-stats" aria-label="Outreach summary">
        <button onClick={() => setStageFilter('all')}><span>Tracked</span><strong>{profiles.length}</strong></button>
        <button onClick={() => setStageFilter('due')}><span>Follow-ups due</span><strong>{dueCount}</strong></button>
        <button onClick={() => setStageFilter('engaged')}><span>Active conversations</span><strong>{engagedCount}</strong></button>
        <button onClick={() => setStageFilter('won')}><span>Onboarded</span><strong>{onboardedCount}</strong></button>
      </section>

      <div className="outreach-toolbar">
        <input className="ps-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, postcode, ODS or contact" />
        <select className="ps-input" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as typeof stageFilter)}>
          <option value="all">All pipeline stages</option>
          <option value="due">Follow-ups due</option>
          {STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select>
      </div>

      <div className="outreach-workspace">
        <section className="outreach-list" aria-label="Tracked pharmacies">
          {loading ? <p className="outreach-empty">Loading outreach records...</p> : filteredProfiles.length === 0 ? (
            <div className="outreach-empty">
              <strong>No pharmacies here yet</strong>
              <span>Use the map to choose a location and add pharmacies to your plan.</span>
            </div>
          ) : filteredProfiles.map((profile) => (
            <button key={profile.id} className={profile.id === selectedId ? 'outreach-list-item active' : 'outreach-list-item'} onClick={() => setSelectedId(profile.id)}>
              <span className="outreach-list-main"><strong>{profile.pharmacy.organisation_name}</strong><small>{profile.pharmacy.postcode} · {profile.pharmacy.ods_code}</small></span>
              <span className={`outreach-stage outreach-stage-${profile.stage}`}>{stageLabel(profile.stage)}</span>
              <small className={profile.follow_up_at && new Date(profile.follow_up_at) <= new Date() ? 'outreach-due' : ''}>
                {profile.follow_up_at ? `Follow up ${formatDate(profile.follow_up_at)}` : NEXT_ACTIONS.find((item) => item.value === profile.next_action)?.label}
              </small>
            </button>
          ))}
        </section>

        <main className="outreach-detail">
          {!selected ? (
            <div className="outreach-empty outreach-empty-detail"><strong>Select a pharmacy</strong><span>Its profile, contact details and timeline will appear here.</span></div>
          ) : (
            <>
              <div className="outreach-detail-header">
                <div><h2>{selected.pharmacy.organisation_name}</h2><p>{[selected.pharmacy.address1, selected.pharmacy.address2, selected.pharmacy.city, selected.pharmacy.postcode].filter(Boolean).join(', ')}</p></div>
                {selected.pharmacy.latitude && selected.pharmacy.longitude && <a className="ps-btn ps-btn-secondary" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.pharmacy.latitude},${selected.pharmacy.longitude}`}>Directions</a>}
              </div>

              <div className="outreach-contact-strip">
                <span><small>NHS phone</small>{contacts.phone ? <a href={`tel:${contacts.phone}`}>{contacts.phone}</a> : 'Not listed'}</span>
                <span><small>NHS email</small>{contacts.email ? <a href={`mailto:${contacts.email}`}>{contacts.email}</a> : 'Not listed'}</span>
                <span><small>Last contact</small>{formatDate(selected.last_contacted_at)}</span>
              </div>

              <section className="outreach-profile-form">
                <label>Pipeline stage<select className="ps-input" value={selected.stage} onChange={(event) => updateProfile({ stage: event.target.value as Stage })}>{STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label>Next action<select className="ps-input" value={selected.next_action} onChange={(event) => updateProfile({ next_action: event.target.value as NextAction })}>{NEXT_ACTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label>Follow-up date<input className="ps-input" type="datetime-local" value={toLocalInput(selected.follow_up_at)} onChange={(event) => updateProfile({ follow_up_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
                <label>Onboarding<select className="ps-input" value={selected.onboarding_status} onChange={(event) => updateProfile({ onboarding_status: event.target.value as OnboardingStatus })}>{ONBOARDING.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label>Contact person<input className="ps-input" defaultValue={selected.contact_name ?? ''} onBlur={(event) => updateProfile({ contact_name: event.target.value || null })} placeholder="Name" /></label>
                <label>Role / who to ask for<input className="ps-input" defaultValue={selected.contact_role ?? ''} onBlur={(event) => updateProfile({ contact_role: event.target.value || null })} placeholder="Manager, assistant, owner..." /></label>
                <label>Direct phone<input className="ps-input" defaultValue={selected.personal_phone ?? ''} onBlur={(event) => updateProfile({ personal_phone: event.target.value || null })} placeholder="Optional personal contact" /></label>
                <label>Direct email<input className="ps-input" type="email" defaultValue={selected.personal_email ?? ''} onBlur={(event) => updateProfile({ personal_email: event.target.value || null })} placeholder="Optional direct email" /></label>
              </section>

              <section className="outreach-timeline-section">
                <div className="outreach-section-heading"><div><h3>Activity timeline</h3><p>Log exactly what happened and what was requested.</p></div>{saving && <span>Saving...</span>}</div>
                <form className="outreach-activity-form" onSubmit={addActivity}>
                  <select className="ps-input" value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityType)}>{ACTIVITIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  <input className="ps-input" value={activitySummary} onChange={(event) => setActivitySummary(event.target.value)} placeholder="Short outcome, e.g. asked me to email the manager" required />
                  <textarea className="ps-input" value={activityDetails} onChange={(event) => setActivityDetails(event.target.value)} placeholder="Notes, what was said, names, objections or next steps" rows={3} />
                  <button className="ps-btn ps-btn-primary" disabled={saving || !activitySummary.trim()}>Add activity</button>
                </form>
                <div className="outreach-timeline">
                  {activities.length === 0 ? <p className="outreach-empty">No activity logged yet.</p> : activities.map((activity) => (
                    <article key={activity.id}><span className="outreach-timeline-mark" /><div><small>{ACTIVITIES.find((item) => item.value === activity.activity_type)?.label} · {formatDate(activity.occurred_at)}</small><strong>{activity.summary}</strong>{activity.details && <p>{activity.details}</p>}</div></article>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <PharmacyMapModal isOpen={mapOpen} onClose={() => setMapOpen(false)} onAddToOutreach={addFromMap} trackedPharmacyIds={profiles.map((profile) => profile.pharmacy_id)} />
    </div>
  )
}