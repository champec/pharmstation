import { useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import { DEFAULT_IDLE_LOCK_MINUTES, idleLockMinutes } from '../../components/IdleLock'

const IDLE_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes (recommended)' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 0, label: 'Never (not recommended on shared computers)' },
]

export function GeneralSettingsTab() {
  const { organisation, permissions } = useAuthStore()
  const canManage = permissions?.org_settings === true
  const current = idleLockMinutes(organisation?.settings)
  const [minutes, setMinutes] = useState(current)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const save = async () => {
    if (!organisation || !canManage) return
    setSaving(true)
    setMsg(null)
    try {
      const settings = { ...(organisation.settings ?? {}), idle_lock_minutes: minutes }
      const { data, error } = await getUserClient()
        .from('ps_organisations')
        .update({ settings })
        .eq('id', organisation.id)
        .select('settings')
      if (error) throw error
      if (!data?.length) throw new Error('Only the pharmacy owner can change this.')
      useAuthStore.setState({ organisation: { ...organisation, settings } })
      setMsg({ type: 'success', text: 'Saved. It applies on every computer signed in to this pharmacy.' })
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message || 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
      <h3 style={{ marginBottom: 'var(--ps-space-xs)' }}>Counter computer security</h3>
      <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)' }}>
        Sign staff out automatically when a computer is left alone, so nobody else can make entries under their
        name. The pharmacy stays signed in. A warning shows a minute before.
      </p>
      {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: 'var(--ps-space-md)' }}>{msg.text}</div>}
      <div className="form-group" style={{ maxWidth: 420 }}>
        <label className="form-label" htmlFor="idle-lock">Sign staff out after</label>
        <select
          id="idle-lock"
          className="ps-input"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          disabled={!canManage || saving}
        >
          {IDLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {canManage ? (
        <button type="button" className="ps-btn ps-btn-primary" onClick={save} disabled={saving || minutes === current}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      ) : (
        <p className="text-muted" style={{ fontSize: 'var(--ps-font-sm)' }}>
          Only the pharmacy owner can change this. Currently {current === 0 ? 'off' : `${current} minutes`}
          {current === DEFAULT_IDLE_LOCK_MINUTES ? ' (the default)' : ''}.
        </p>
      )}
    </div>
  )
}
