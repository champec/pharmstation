import { useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'

// Booking rules patients see on their manage link. Stored in
// ps_organisations.settings.appointments and read by the appointments
// edge function (rulesFrom in _shared/appointment-helpers.ts). Keep the
// defaults here in step with DEFAULT_RULES there.

type Rules = { refund_cutoff_hours: number; patient_can_cancel: boolean; reminder_hours: number }
const DEFAULTS: Rules = { refund_cutoff_hours: 24, patient_can_cancel: true, reminder_hours: 24 }

function current(settings: unknown): Rules {
  const a = ((settings ?? {}) as Record<string, any>).appointments ?? {}
  return {
    refund_cutoff_hours: typeof a.refund_cutoff_hours === 'number' ? a.refund_cutoff_hours : DEFAULTS.refund_cutoff_hours,
    patient_can_cancel: typeof a.patient_can_cancel === 'boolean' ? a.patient_can_cancel : DEFAULTS.patient_can_cancel,
    reminder_hours: typeof a.reminder_hours === 'number' ? a.reminder_hours : DEFAULTS.reminder_hours,
  }
}

const NOTICE_OPTIONS = [0, 2, 12, 24, 48, 72]
const REMINDER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 2, label: '2 hours before' },
  { value: 24, label: '24 hours before (recommended)' },
  { value: 48, label: '48 hours before' },
]

// ---- Online booking page: list the pharmacy on /book and choose its address ----
// The database guard (ps_organisations_guard_public_page) checks the address
// format and only lets verified pharmacies be listed.
function suggestSlug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function BookingPageCard() {
  const { organisation, permissions } = useAuthStore()
  const canManage = permissions?.org_settings === true
  const org = (organisation ?? {}) as Record<string, any>
  const [isPublic, setIsPublic] = useState<boolean>(!!org.is_public)
  const [slug, setSlug] = useState<string>(org.slug || suggestSlug(org.name || ''))
  const [description, setDescription] = useState<string>(org.public_description || '')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  if (!organisation) return null

  const verified = org.verification_status === 'verified'
  const savedSlug: string | null = org.slug || null
  const link = savedSlug ? `${window.location.origin}/book/${savedSlug}` : null

  const save = async () => {
    if (!canManage) return
    setSaving(true)
    setMsg(null)
    try {
      const patch = { is_public: isPublic, slug: slug.trim() || null, public_description: description.trim() || null }
      const { data, error } = await getUserClient()
        .from('ps_organisations').update(patch).eq('id', organisation.id)
        .select('is_public, slug, public_description')
      if (error) {
        if (error.code === '23505') throw new Error('That web address is already taken. Please pick another.')
        throw error
      }
      if (!data?.length) throw new Error('Only the pharmacy owner can change this.')
      const saved = data[0] as Record<string, any>
      useAuthStore.setState({ organisation: { ...organisation, ...saved } as typeof organisation })
      setSlug(saved.slug || '')
      setMsg({ type: 'success', text: saved.is_public ? 'Saved. Your pharmacy is listed for online booking.' : 'Saved. Your pharmacy is not listed publicly.' })
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message || 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  return (
    <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
      <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>Online booking page</h3>
      <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
        Patients book your public services at this address. Services also need "Public" switched on, and future slots added.
      </p>
      {!verified && (
        <div className="ps-alert ps-alert-warning" style={{ marginBottom: 'var(--ps-space-md)' }}>
          Your pharmacy can be listed once PharmStation has verified it. You can choose your web address now.
        </div>
      )}
      {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: 'var(--ps-space-md)' }}>{msg.text}</div>}

      <label style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginBottom: 'var(--ps-space-md)' }}>
        <input
          type="checkbox"
          checked={isPublic}
          disabled={!canManage || saving || (!verified && !isPublic)}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        List my pharmacy for online booking
      </label>

      <div className="form-group" style={{ maxWidth: 520 }}>
        <label className="form-label" htmlFor="booking-slug">Web address</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>{window.location.host}/book/</span>
          <input
            id="booking-slug"
            className="ps-input"
            style={{ flex: '1 1 180px' }}
            value={slug}
            maxLength={60}
            disabled={!canManage || saving}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="your-pharmacy-name"
          />
        </div>
        <small style={{ color: 'var(--ps-slate)' }}>Lowercase letters, numbers and dashes. Changing it breaks links you've already shared.</small>
      </div>

      <div className="form-group" style={{ maxWidth: 520 }}>
        <label className="form-label" htmlFor="booking-description">Short description (optional)</label>
        <textarea
          id="booking-description"
          className="ps-input"
          rows={3}
          maxLength={500}
          value={description}
          disabled={!canManage || saving}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Independent pharmacy on the high street. Free parking at the back."
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        {canManage ? (
          <button className="ps-btn ps-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save booking page'}</button>
        ) : (
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Organisation settings permission is needed to change these.</p>
        )}
        {link && org.is_public && (
          <>
            <a className="ps-btn ps-btn-secondary" href={link} target="_blank" rel="noreferrer">Open booking page</a>
            <button className="ps-btn ps-btn-ghost" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
          </>
        )}
      </div>
    </div>
  )
}

export function AppointmentSettingsTab() {
  const { organisation, permissions } = useAuthStore()
  const canManage = permissions?.org_settings === true
  const [rules, setRules] = useState<Rules>(() => current(organisation?.settings))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const save = async () => {
    if (!organisation || !canManage) return
    setSaving(true)
    setMsg(null)
    try {
      const settings = { ...(organisation.settings ?? {}), appointments: rules }
      const { data, error } = await getUserClient()
        .from('ps_organisations')
        .update({ settings })
        .eq('id', organisation.id)
        .select('settings')
      if (error) throw error
      if (!data?.length) throw new Error('Only the pharmacy owner can change this.')
      useAuthStore.setState({ organisation: { ...organisation, settings } })
      setMsg({ type: 'success', text: 'Saved. New rules apply to every booking straight away.' })
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message || 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <BookingPageCard />
    <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
      <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>Booking rules</h3>
      <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
        What patients can do from the link in their booking text, and when they're reminded.
      </p>
      {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: 'var(--ps-space-md)' }}>{msg.text}</div>}

      <label style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', marginBottom: 'var(--ps-space-md)' }}>
        <input
          type="checkbox"
          checked={rules.patient_can_cancel}
          disabled={!canManage || saving}
          onChange={(e) => setRules({ ...rules, patient_can_cancel: e.target.checked })}
        />
        Patients can cancel or move their own booking online
      </label>

      <div className="form-group" style={{ maxWidth: 420 }}>
        <label className="form-label" htmlFor="notice">Notice needed for a refund or to move a booking</label>
        <select
          id="notice"
          className="ps-input"
          value={rules.refund_cutoff_hours}
          disabled={!canManage || saving || !rules.patient_can_cancel}
          onChange={(e) => setRules({ ...rules, refund_cutoff_hours: Number(e.target.value) })}
        >
          {NOTICE_OPTIONS.map((h) => <option key={h} value={h}>{h === 0 ? 'Any time before the appointment' : `${h} hours`}</option>)}
        </select>
        <small style={{ color: 'var(--ps-slate)' }}>
          Cancelling with at least this much notice refunds a paid booking in full. Later cancellations are not refunded, and the booking can't be moved online.
        </small>
      </div>

      <div className="form-group" style={{ maxWidth: 420 }}>
        <label className="form-label" htmlFor="reminder">Reminder text</label>
        <select
          id="reminder"
          className="ps-input"
          value={rules.reminder_hours}
          disabled={!canManage || saving}
          onChange={(e) => setRules({ ...rules, reminder_hours: Number(e.target.value) })}
        >
          {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <small style={{ color: 'var(--ps-slate)' }}>
          Sent to confirmed bookings. For video appointments the reminder includes the video link and code. Uses your text credits.
        </small>
      </div>

      {canManage ? (
        <button className="ps-btn ps-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save booking rules'}</button>
      ) : (
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Organisation settings permission is needed to change these.</p>
      )}
    </div>
    </>
  )
}
