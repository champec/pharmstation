import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { MessageChannel } from '@pharmstation/types'

type Channel = 'sms' | 'email' | 'letter'

const CHANNELS: { value: Channel; label: string; icon: string }[] = [
  { value: 'sms', label: 'SMS', icon: '📱' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'letter', label: 'Letter', icon: '✉️' },
]

function smsFragments(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 160)
}

export function NewBroadcastPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { createBroadcast, sendBroadcast, getRecipientCount, fetchSettings, settings, routing, fetchRouting, smsSettings, fetchSmsSettings } = useMessagingStore()

  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientFilter, setRecipientFilter] = useState('all')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [loadingCount, setLoadingCount] = useState(false)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Don't flash "SMS is not enabled" while settings are still loading.
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useEffect(() => {
    if (organisation?.id) {
      setSettingsLoaded(false)
      Promise.allSettled([
        fetchRouting(organisation.id),
        fetchSmsSettings(organisation.id),
        fetchSettings(organisation.id), // NHS Notify (email/letter, NHS-affiliated orgs only)
      ]).then(() => setSettingsLoaded(true))
      loadRecipientCount()
    }
  }, [organisation?.id])

  const loadRecipientCount = async () => {
    if (!organisation?.id) return
    setLoadingCount(true)
    try {
      const count = await getRecipientCount(organisation.id, channel, recipientFilter)
      setRecipientCount(count)
    } catch { setRecipientCount(null) }
    setLoadingCount(false)
  }

  useEffect(() => {
    loadRecipientCount()
  }, [channel, recipientFilter])

  const validate = (): string | null => {
    if (!name.trim()) return 'Broadcast name is required'
    if (!body.trim()) return 'Message body is required'
    return null
  }

  const handleSaveAsDraft = async () => {
    const err = validate()
    if (err) { setFormError(err); return }
    if (!organisation?.id) return

    setSaving(true)
    setFormError(null)
    try {
      await createBroadcast({
        org_id: organisation.id,
        name: name.trim(),
        channel,
        body: body.trim(),
        subject: channel === 'email' ? subject.trim() || undefined : undefined,
        recipient_filter: recipientFilter,
      })
      navigate('/messaging/broadcasts')
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save broadcast')
    }
    setSaving(false)
  }

  const handleSendNow = async () => {
    const err = validate()
    if (err) { setFormError(err); return }
    if (!organisation?.id) return

    setSaving(true)
    setFormError(null)
    try {
      const broadcast = await createBroadcast({
        org_id: organisation.id,
        name: name.trim(),
        channel,
        body: body.trim(),
        subject: channel === 'email' ? subject.trim() || undefined : undefined,
        recipient_filter: recipientFilter,
      })
      if (broadcast?.id) {
        await sendBroadcast(organisation.id, broadcast.id)
      }
      navigate('/messaging/broadcasts')
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to send broadcast')
    }
    setSaving(false)
  }

  // Email and letters are NHS Notify only; fall back to SMS for everyone else.
  useEffect(() => {
    if (settingsLoaded && !routing?.nhsChannelsEnabled && channel !== 'sms') setChannel('sms')
  }, [settingsLoaded, routing?.nhsChannelsEnabled, channel])

  // Provider-aware availability:
  //  • SMS → platform SMS Works gateway (ps_sms_settings.is_active)
  //  • Email/Letter → NHS Notify, only for NHS-affiliated orgs (nhs_channels_enabled)
  const smsReady = !!smsSettings?.is_active
  const nhsReady = !!routing?.nhsChannelsEnabled && !!settings?.has_api_key && !!settings?.is_active
  const isNotConfigured = settingsLoaded && (channel === 'sms' ? !smsReady : !nhsReady)

  const configureMessage = channel === 'sms'
    ? <>SMS is not enabled for this pharmacy. Enable it in <a href="/settings?tab=messaging" onClick={(e) => { e.preventDefault(); navigate('/settings?tab=messaging') }}>Settings → Messaging</a>.</>
    : routing?.nhsChannelsEnabled
      ? <>NHS Notify is not fully configured. Add your API key in <a href="/settings?tab=messaging" onClick={(e) => { e.preventDefault(); navigate('/settings?tab=messaging') }}>Settings → Messaging</a>.</>
      : <>Email and letters are only available to NHS-affiliated organisations (via NHS Notify). Use SMS instead, or contact support if your pharmacy qualifies.</>

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging" onClick={(e) => { e.preventDefault(); navigate('/messaging') }}>Messaging</a>
          <span className="separator">/</span>
          <a href="/messaging/broadcasts" onClick={(e) => { e.preventDefault(); navigate('/messaging/broadcasts') }}>Broadcasts</a>
          <span className="separator">/</span>
          <span>New</span>
        </div>
        <h1>New Broadcast</h1>
      </div>

      {!settingsLoaded && (
        <p className="text-muted" style={{ marginBottom: 'var(--ps-space-md)' }}>Checking your messaging settings…</p>
      )}

      {isNotConfigured && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {configureMessage}
        </div>
      )}

      <div className="ps-split" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--ps-space-lg)', alignItems: 'start' }}>
        {/* Left: form */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          {/* Name */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Broadcast Name *</label>
            <input
              className="ps-input"
              placeholder="e.g. Flu Vaccine Reminder 2025"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Channel */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Channel</label>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
              {CHANNELS.filter((ch) => ch.value === 'sms' || routing?.nhsChannelsEnabled).map((ch) => {
                const unavailable = ch.value !== 'sms' && !routing?.nhsChannelsEnabled
                return (
                  <button
                    key={ch.value}
                    className={`ps-btn ${channel === ch.value ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                    onClick={() => setChannel(ch.value)}
                    style={unavailable ? { opacity: 0.5 } : undefined}
                    title={unavailable ? 'NHS-affiliated organisations only' : undefined}
                  >
                    {ch.label}{unavailable && <Lock size={12} aria-label="Not available" style={{ marginLeft: 4 }} />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Recipients */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Recipients</label>
            <select
              className="ps-input"
              value={recipientFilter}
              onChange={(e) => setRecipientFilter(e.target.value)}
            >
              <option value="all">All patients with {channel === 'sms' ? 'phone numbers' : channel === 'email' ? 'email addresses' : 'postal addresses'}</option>
            </select>
            <div style={{ marginTop: 'var(--ps-space-xs)', fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
              {loadingCount ? 'Counting...' : recipientCount !== null ? `${recipientCount} recipient${recipientCount !== 1 ? 's' : ''} matched` : ''}
            </div>
          </div>

          {/* Subject (email only) */}
          {channel === 'email' && (
            <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>Subject</label>
              <input
                className="ps-input"
                placeholder="Message from your pharmacy"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          {/* Body */}
          <div style={{ marginBottom: 'var(--ps-space-lg)' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>
              Message *
              {channel === 'sms' && (
                <span style={{ fontWeight: 400, color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: '0.85rem' }}>
                  {body.length} chars · {smsFragments(body)} SMS fragment{smsFragments(body) !== 1 ? 's' : ''}
                </span>
              )}
            </label>
            <textarea
              className="ps-input"
              rows={8}
              placeholder="Type your broadcast message here..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Error */}
          {formError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{formError}</div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className="ps-btn ps-btn-secondary"
              onClick={handleSaveAsDraft}
              disabled={saving || isNotConfigured}
            >
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleSendNow}
              disabled={saving || isNotConfigured}
            >
              {saving ? 'Sending...' : 'Send Now'}
            </button>
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/broadcasts')}>
              Cancel
            </button>
          </div>
        </div>

        {/* Right: preview */}
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
          <h3 style={{ margin: '0 0 var(--ps-space-md)', fontSize: '0.95rem' }}>Preview</h3>

          <div style={{
            background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-lg)',
            padding: 'var(--ps-space-md)', minHeight: '100px',
          }}>
            {channel === 'email' && (
              <div style={{ fontWeight: 600, marginBottom: 'var(--ps-space-sm)' }}>
                {subject || 'Message from your pharmacy'}
              </div>
            )}
            <div style={{ fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--ps-midnight)' }}>
              {body || 'Your message will appear here...'}
            </div>
          </div>

          {recipientCount !== null && (
            <div style={{
              marginTop: 'var(--ps-space-md)', padding: 'var(--ps-space-sm) var(--ps-space-md)',
              background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)',
              fontSize: '0.85rem',
            }}>
              <strong>{recipientCount}</strong> recipient{recipientCount !== 1 ? 's' : ''} will receive this {channel === 'sms' ? 'SMS' : channel === 'email' ? 'email' : 'letter'}
              {channel === 'sms' && body && (
                <> ({smsFragments(body)} fragment{smsFragments(body) !== 1 ? 's' : ''} × {recipientCount} = {smsFragments(body) * recipientCount} SMS units)</>
              )}
              {channel === 'sms' && (
                <div style={{ marginTop: 4, color: 'var(--ps-slate)' }}>
                  One text per mobile number. Patients who replied STOP are skipped automatically, and if you text from your reply number we add "Reply STOP to opt out".
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
