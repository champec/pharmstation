import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import type { NetworkSmsContact } from '@pharmstation/types'

function timeLabel(t: string) {
  return t ?? '—'
}

export function NetworkSettingsPage() {
  const navigate  = useNavigate()
  const { organisation } = useAuthStore()
  const {
    settings, smsContacts, loading, error,
    fetchSettings, saveSettings,
    fetchSmsContacts, addSmsContact, updateSmsContact, deleteSmsContact,
    clearError,
  } = useNetworkStore()

  // Local settings state
  const [networkEnabled,  setNetworkEnabled]  = useState(true)
  const [smsPingsEnabled, setSmsPingsEnabled] = useState(false)
  const [saving, setSaving] = useState(false)

  // Add contact form
  const [showAddForm,  setShowAddForm]  = useState(false)
  const [newLabel,     setNewLabel]     = useState('')
  const [newPhone,     setNewPhone]     = useState('')
  const [newStart,     setNewStart]     = useState('08:00')
  const [newEnd,       setNewEnd]       = useState('20:00')
  const [addingPhone,  setAddingPhone]  = useState(false)

  // Pause toggles
  const [pausingId, setPausingId] = useState<string | null>(null)

  useEffect(() => {
    if (!organisation?.id) return
    fetchSettings(organisation.id)
    fetchSmsContacts(organisation.id)
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings) {
      setNetworkEnabled(settings.network_enabled)
      setSmsPingsEnabled(settings.sms_pings_enabled)
    }
  }, [settings])

  async function handleSaveSettings() {
    if (!organisation?.id) return
    setSaving(true)
    await saveSettings(organisation.id, {
      network_enabled:   networkEnabled,
      sms_pings_enabled: smsPingsEnabled,
    })
    setSaving(false)
  }

  async function handleAddContact() {
    if (!organisation?.id || !newPhone.trim()) return
    setAddingPhone(true)
    try {
      await addSmsContact(organisation.id, {
        label:       newLabel.trim() || null,
        phone_number: newPhone.trim(),
        is_enabled:  true,
        pause_until: null,
        notify_start: newStart,
        notify_end:   newEnd,
      } as Omit<NetworkSmsContact, 'id' | 'org_id' | 'created_at' | 'updated_at'>)
      setNewLabel(''); setNewPhone(''); setNewStart('08:00'); setNewEnd('20:00')
      setShowAddForm(false)
    } finally {
      setAddingPhone(false)
    }
  }

  async function toggleContactEnabled(contact: NetworkSmsContact) {
    await updateSmsContact(contact.id, { is_enabled: !contact.is_enabled, pause_until: null })
  }

  async function pauseContact(contact: NetworkSmsContact, hours: number) {
    setPausingId(contact.id)
    const pauseUntil = new Date(Date.now() + hours * 3600000).toISOString()
    await updateSmsContact(contact.id, { pause_until: pauseUntil })
    setPausingId(null)
  }

  async function unpauseContact(contact: NetworkSmsContact) {
    await updateSmsContact(contact.id, { pause_until: null })
  }

  function isPaused(c: NetworkSmsContact) {
    return c.pause_until != null && new Date(c.pause_until) > new Date()
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging/network" onClick={(e) => { e.preventDefault(); navigate('/messaging/network') }}>Pharmacy Network</a>
          <span className="separator">/</span>
          <span>Settings</span>
        </div>
        <h1>⚙️ Network Settings</h1>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {/* Core settings */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <h3 style={{ margin: '0 0 var(--ps-space-md)' }}>Network Participation</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={networkEnabled} onChange={(e) => setNetworkEnabled(e.target.checked)} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 600 }}>Enable Pharmacy Network</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                Allow other pharmacies on PharmStation to send you messages and see your pharmacy in search results.
                You can still send messages when disabled; you just won't receive new ones.
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ps-space-sm)', cursor: 'pointer', opacity: networkEnabled ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={smsPingsEnabled}
              onChange={(e) => setSmsPingsEnabled(e.target.checked)}
              disabled={!networkEnabled}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>📱 Enable SMS Pings</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                Allow senders to request an SMS notification to your registered phone numbers for urgent messages.
                You can manage which numbers receive pings below, and set quiet hours.
              </div>
            </div>
          </label>
        </div>

        <div style={{ marginTop: 'var(--ps-space-lg)' }}>
          <button className="ps-btn ps-btn-primary" onClick={handleSaveSettings} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* SMS Contacts */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-md)' }}>
          <div>
            <h3 style={{ margin: '0 0 4px' }}>📱 SMS Notification Numbers</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
              Add phone numbers to receive SMS pings for urgent network messages. Each number can have its own notification window.
            </p>
          </div>
          <button
            className="ps-btn ps-btn-secondary"
            onClick={() => setShowAddForm((v) => !v)}
            disabled={!smsPingsEnabled}
            style={{ flexShrink: 0 }}
          >
            + Add Number
          </button>
        </div>

        {!smsPingsEnabled && (
          <div style={{ padding: 'var(--ps-space-md)', background: '#fff8e6', borderRadius: 'var(--ps-radius)', marginBottom: 'var(--ps-space-md)', fontSize: '0.9rem' }}>
            ⚠️ Enable SMS Pings above to manage notification numbers.
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div style={{ padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius)', marginBottom: 'var(--ps-space-md)' }}>
            <h4 style={{ margin: '0 0 var(--ps-space-sm)' }}>Add phone number</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-sm)' }}>
              <div>
                <label className="ps-label">Phone Number *</label>
                <input
                  className="ps-input"
                  placeholder="+44 7700 900123"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="ps-label">Label (optional)</label>
                <input
                  className="ps-input"
                  placeholder="e.g. Duty Manager"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="ps-label">Notify From</label>
                <input type="time" className="ps-input" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div>
                <label className="ps-label">Notify Until</label>
                <input type="time" className="ps-input" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
              <button className="ps-btn ps-btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleAddContact}
                disabled={!newPhone.trim() || addingPhone}
              >
                {addingPhone ? 'Adding…' : 'Add Number'}
              </button>
            </div>
          </div>
        )}

        {/* Contacts list */}
        {smsContacts.length === 0 ? (
          <p style={{ color: 'var(--ps-slate)', textAlign: 'center', padding: 'var(--ps-space-lg)' }}>
            No numbers added yet.
          </p>
        ) : (
          <div>
            {smsContacts.map((c) => {
              const paused = isPaused(c)
              return (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)',
                  padding: 'var(--ps-space-sm) 0',
                  borderBottom: '1px solid var(--ps-off-white)',
                  flexWrap: 'wrap',
                }}>
                  {/* Status dot */}
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: !c.is_enabled ? 'var(--ps-slate)'
                      : paused ? 'var(--ps-amber, #f59e0b)'
                      : 'var(--ps-green, #22c55e)',
                  }} />

                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>{c.phone_number}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                      {c.label && <>{c.label} · </>}
                      Active: {timeLabel(c.notify_start)} – {timeLabel(c.notify_end)}
                      {paused && c.pause_until && (
                        <span style={{ color: 'var(--ps-amber, #f59e0b)', marginLeft: 8 }}>
                          Paused until {new Date(c.pause_until).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', flexWrap: 'wrap' }}>
                    {/* Enable/disable */}
                    <button
                      className={`ps-btn ${c.is_enabled ? 'ps-btn-secondary' : 'ps-btn-ghost'}`}
                      style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      onClick={() => toggleContactEnabled(c)}
                    >
                      {c.is_enabled ? '⏸ Disable' : '▶ Enable'}
                    </button>

                    {/* Pause */}
                    {c.is_enabled && !paused && (
                      <select
                        className="ps-input"
                        style={{ width: 'auto', fontSize: '0.8rem', padding: '4px 8px' }}
                        defaultValue=""
                        disabled={pausingId === c.id}
                        onChange={(e) => {
                          if (e.target.value) pauseContact(c, Number(e.target.value))
                          e.target.value = ''
                        }}
                      >
                        <option value="">Pause for…</option>
                        <option value="1">1 hour</option>
                        <option value="4">4 hours</option>
                        <option value="8">8 hours</option>
                        <option value="24">24 hours</option>
                        <option value="168">1 week</option>
                      </select>
                    )}

                    {/* Unpause */}
                    {paused && (
                      <button
                        className="ps-btn ps-btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                        onClick={() => unpauseContact(c)}
                      >
                        ▶ Unpause
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      className="ps-btn ps-btn-ghost"
                      style={{ fontSize: '0.8rem', padding: '4px 8px', color: 'var(--ps-red, crimson)' }}
                      onClick={() => deleteSmsContact(c.id)}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
