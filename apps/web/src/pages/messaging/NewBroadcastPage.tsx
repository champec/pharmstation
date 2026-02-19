import { useState, useEffect } from 'react'
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
  const { createBroadcast, sendBroadcast, getRecipientCount, fetchSettings, settings } = useMessagingStore()

  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientFilter, setRecipientFilter] = useState('all')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [loadingCount, setLoadingCount] = useState(false)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (organisation?.id) {
      fetchSettings(organisation.id)
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

  const isNotConfigured = !settings?.has_api_key || !settings?.is_active

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
        <h1>📢 New Broadcast</h1>
      </div>

      {isNotConfigured && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          Messaging is not configured. Please set up your NHS Notify API key in Settings first.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--ps-space-lg)', alignItems: 'start' }}>
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
              {CHANNELS.map((ch) => (
                <button
                  key={ch.value}
                  className={`ps-btn ${channel === ch.value ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                  onClick={() => setChannel(ch.value)}
                >
                  {ch.icon} {ch.label}
                </button>
              ))}
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
