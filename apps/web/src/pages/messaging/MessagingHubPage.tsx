import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { NotifyMessage } from '@pharmstation/types'
import { MessageDetailModal } from '../../components/messaging/MessageDetailModal'

/* ---- Status badge config ---- */
const STATUS_CONFIG: Record<string, { label: string; cssClass: string }> = {
  pending: { label: 'Pending', cssClass: 'ps-badge' },
  sending: { label: '⏳ Pending', cssClass: 'ps-badge ps-badge-amber' },
  sent: { label: '⏳ Pending', cssClass: 'ps-badge ps-badge-amber' },
  delivered: { label: '✓ Delivered', cssClass: 'ps-badge ps-badge-green' },
  failed: { label: 'Failed', cssClass: 'ps-badge ps-badge-red' },
  'permanent-failure': { label: 'Perm. Failure', cssClass: 'ps-badge ps-badge-red' },
  'temporary-failure': { label: 'Temp. Failure', cssClass: 'ps-badge ps-badge-amber' },
  'technical-failure': { label: 'Tech. Failure', cssClass: 'ps-badge ps-badge-red' },
}

const CHANNEL_BADGE: Record<string, { label: string; cssClass: string }> = {
  sms: { label: 'SMS', cssClass: 'ps-badge ps-badge-blue' },
  email: { label: 'Email', cssClass: 'ps-badge ps-badge-purple' },
  letter: { label: 'Letter', cssClass: 'ps-badge ps-badge-amber' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getRecipient(msg: NotifyMessage): string {
  if (msg.patient) return `${msg.patient.first_name} ${msg.patient.last_name}`
  if (msg.recipient_phone) return msg.recipient_phone
  if (msg.recipient_email) return msg.recipient_email
  if (msg.recipient_address) return (msg.recipient_address as Record<string, string>).address_line_1 || 'Letter'
  return 'Unknown'
}

export function MessagingHubPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    messages,
    stats,
    settings,
    routing,
    smsSettings,
    loading,
    error,
    fetchSettings,
    fetchRouting,
    fetchSmsSettings,
    fetchMessages,
    fetchStats,
    clearError,
  } = useMessagingStore()

  const [recentMessages, setRecentMessages] = useState<NotifyMessage[]>([])
  const [selected, setSelected] = useState<NotifyMessage | null>(null)

  const load = useCallback(async () => {
    if (!organisation?.id) return
    await Promise.all([
      fetchRouting(organisation.id),
      fetchSmsSettings(organisation.id),
      fetchSettings(organisation.id),
      fetchMessages(organisation.id, { page: 0, pageSize: 20 }),
      fetchStats(organisation.id),
    ])
  }, [organisation?.id, fetchRouting, fetchSmsSettings, fetchSettings, fetchMessages, fetchStats])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setRecentMessages(messages.slice(0, 20))
  }, [messages])

  // Configured when SMS (platform SMS Works) is enabled, or — for
  // NHS-affiliated orgs — when NHS Notify is set up for email/letters.
  const isConfigured = !!smsSettings?.is_active ||
    (!!routing?.nhsChannelsEnabled && !!settings?.has_api_key && !!settings?.is_active)

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Messaging</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>💬 Messaging</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/compose')}>
            + Compose Message
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {/* Setup prompt */}
      {!isConfigured && (
        <div className="ps-card" style={{
          padding: 'var(--ps-space-lg)',
          marginBottom: 'var(--ps-space-lg)',
          background: 'var(--ps-off-white)',
          border: '2px solid var(--ps-electric-cyan)',
        }}>
          <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>⚙️ Messaging Not Configured</h3>
          <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)' }}>
            To text patients, enable SMS in Settings → Messaging. SMS is sent through PharmStation's
            gateway — no account or API key needed.
          </p>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => navigate('/settings?tab=messaging')}
          >
            Go to Settings → Messaging
          </button>
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--ps-space-md)',
          marginBottom: 'var(--ps-space-lg)',
        }}>
          {[
            { label: 'Today', value: stats.today, icon: '📩' },
            { label: 'This Week', value: stats.thisWeek, icon: '📅' },
            { label: 'This Month', value: stats.thisMonth, icon: '📊' },
            { label: 'Delivery Rate', value: `${stats.deliveryRate}%`, icon: '✅' },
          ].map((card) => (
            <div key={card.label} className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 'var(--ps-space-xs)' }}>{card.icon}</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--ps-deep-blue)' }}>{card.value}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div style={{
        display: 'flex',
        gap: 'var(--ps-space-sm)',
        marginBottom: 'var(--ps-space-lg)',
        flexWrap: 'wrap',
      }}>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/compose?channel=sms')}>
          📱 Send SMS
        </button>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/compose?channel=email')}>
          📧 Send Email
        </button>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/compose?channel=letter')}>
          ✉️ Send Letter
        </button>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/broadcasts/new')}>
          📢 New Broadcast
        </button>
        <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/history')}>
          📋 Message History
        </button>
      </div>

      {/* Recent messages */}
      <div className="ps-card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: 'var(--ps-space-md) var(--ps-space-lg)',
          borderBottom: '1px solid var(--ps-off-white)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h3 style={{ margin: 0 }}>Recent Messages</h3>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/history')}>
            View All →
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
            <div className="loading-spinner" />
          </div>
        ) : recentMessages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>
            <p>No messages sent yet. Use the Compose button to send your first message.</p>
          </div>
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Channel</th>
                <th>Message</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {recentMessages.map((msg) => {
                const channelBadge = CHANNEL_BADGE[msg.channel] || { label: msg.channel, cssClass: 'ps-badge' }
                const statusBadge = STATUS_CONFIG[msg.status] || { label: msg.status, cssClass: 'ps-badge' }
                return (
                  <tr
                    key={msg.id}
                    onClick={() => setSelected(msg)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view details"
                  >
                    <td style={{ fontWeight: 500 }}>{getRecipient(msg)}</td>
                    <td><span className={channelBadge.cssClass}>{channelBadge.label}</span></td>
                    <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ps-slate)' }}>
                      {msg.body?.slice(0, 80)}{msg.body && msg.body.length > 80 ? '…' : ''}
                    </td>
                    <td><span className={statusBadge.cssClass}>{statusBadge.label}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
                      {msg.sent_at ? relativeTime(msg.sent_at) : relativeTime(msg.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <MessageDetailModal
        message={selected}
        onClose={() => setSelected(null)}
        onChanged={load}
      />
    </div>
  )
}
