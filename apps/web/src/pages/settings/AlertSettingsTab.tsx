import { useEffect, useState } from 'react'
import { useAuthStore, useAlertStore, ALERT_EVENT_TYPES, DEFAULT_ALERT_CHANNELS } from '@pharmstation/core'
import type { AlertChannelConfig } from '@pharmstation/types'

// ============================================================
// Alert Settings — manager-controlled routing matrix.
//
// For each event type (new appointment, new PEPS, pharmacy network message,
// system, patient message) the manager picks which channels are "on":
// web (this dashboard's bell — always available), SMS (comes out of the
// org's SMS Works allowance, requires a staff member to also opt in with a
// phone number under their own profile), and mobile/desktop (stored now so
// the toggle is ready the moment those apps ship).
//
// New features fold in automatically: they just need a new key in the
// settings jsonb (defaulting to { web: true, sms/mobile/desktop: false })
// and a DB trigger that fans out through ps_fanout_notification().
// ============================================================

const cardStyle: React.CSSProperties = { padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-md)' }
const hintStyle: React.CSSProperties = { color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)', fontSize: '0.9rem' }

const CHANNELS: { key: keyof AlertChannelConfig; label: string; comingSoon?: boolean }[] = [
  { key: 'web', label: '🖥️ Web dashboard' },
  { key: 'sms', label: '📱 Text message (SMS)' },
  { key: 'mobile', label: '📲 Mobile app', comingSoon: true },
  { key: 'desktop', label: '💻 Desktop app', comingSoon: true },
]

export function AlertSettingsTab() {
  const { organisation, permissions } = useAuthStore()
  const { orgAlertSettings, fetchOrgAlertSettings, saveOrgAlertSettings, error, clearError } = useAlertStore()

  const [draft, setDraft] = useState<Partial<Record<string, AlertChannelConfig>>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canManage = permissions?.org_settings === true

  useEffect(() => {
    if (organisation?.id) fetchOrgAlertSettings(organisation.id)
  }, [organisation?.id, fetchOrgAlertSettings])

  useEffect(() => {
    setDraft(orgAlertSettings?.settings ?? {})
  }, [orgAlertSettings])

  function channelsFor(eventType: string): AlertChannelConfig {
    return { ...DEFAULT_ALERT_CHANNELS, ...(draft[eventType] ?? {}) }
  }

  function toggle(eventType: string, channel: keyof AlertChannelConfig) {
    if (!canManage) return
    const current = channelsFor(eventType)
    setDraft((prev) => ({ ...prev, [eventType]: { ...current, [channel]: !current[channel] } }))
  }

  async function handleSave() {
    if (!organisation?.id || !canManage) return
    setSaving(true)
    setSaved(false)
    try {
      await saveOrgAlertSettings(organisation.id, draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error} <button className="ps-btn ps-btn-ghost" onClick={clearError}>Dismiss</button>
        </div>
      )}
      {saved && (
        <div style={{
          padding: 'var(--ps-space-sm) var(--ps-space-md)',
          background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)',
          marginBottom: 'var(--ps-space-md)', color: 'var(--ps-deep-blue)',
        }}>
          ✓ Alert settings saved
        </div>
      )}

      <div className="ps-card" style={cardStyle}>
        <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>🔔 Alert Routing</h3>
        <p style={hintStyle}>
          Choose which channels are switched on for each kind of alert. <strong>Web</strong> shows up in the
          bell at the top of the dashboard for every signed-in team member. <strong>SMS</strong> also requires the
          individual staff member to opt in and add their phone number under their own profile — and it uses the
          pharmacy's SMS allowance. Mobile app and desktop app notifications are coming soon; the toggle is here
          ready for when they ship.
        </p>

        {!canManage && (
          <div style={{
            padding: 'var(--ps-space-sm) var(--ps-space-md)', background: '#fff8e6',
            borderRadius: 'var(--ps-radius)', marginBottom: 'var(--ps-space-md)', fontSize: '0.9rem',
          }}>
            This setting is read-only. Organisation settings permission is required to change alert routing.
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--ps-mist)' }}>
                <th style={{ padding: 'var(--ps-space-sm)' }}>Alert type</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} style={{ padding: 'var(--ps-space-sm)', textAlign: 'center' }}>
                    {c.label}
                    {c.comingSoon && <div style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--ps-slate)' }}>(coming soon)</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALERT_EVENT_TYPES.map((evt) => {
                const channels = channelsFor(evt.key)
                return (
                  <tr key={evt.key} style={{ borderBottom: '1px solid var(--ps-off-white)' }}>
                    <td style={{ padding: 'var(--ps-space-sm)' }}>
                      <div style={{ fontWeight: 600 }}>{evt.label}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>{evt.description}</div>
                    </td>
                    {CHANNELS.map((c) => (
                      <td key={c.key} style={{ padding: 'var(--ps-space-sm)', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={channels[c.key]}
                          disabled={!canManage || c.comingSoon}
                          onChange={() => toggle(evt.key as string, c.key)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {canManage && (
          <div style={{ marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Alert Settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
