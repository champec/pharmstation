import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { NETWORK_LABEL_CONFIG } from '@pharmstation/types'
import type { NetworkMessage } from '@pharmstation/types'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Tab = 'inbox' | 'sent'

export function NetworkHubPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    inbox, sent, loading, error,
    myLink, settings,
    unreadCount,
    fetchInbox, fetchSent, fetchMyLink, fetchSettings, fetchUnreadCount,
    subscribeToInbox, unsubscribeFromInbox,
    clearError,
  } = useNetworkStore()

  const [tab, setTab] = useState<Tab>('inbox')

  const load = useCallback(async () => {
    if (!organisation?.id) return
    await Promise.all([
      fetchInbox(organisation.id),
      fetchSent(organisation.id),
      fetchMyLink(organisation.id),
      fetchSettings(organisation.id),
      fetchUnreadCount(organisation.id),
    ])
  }, [organisation?.id, fetchInbox, fetchSent, fetchMyLink, fetchSettings, fetchUnreadCount])

  useEffect(() => {
    load()
    if (organisation?.id) subscribeToInbox(organisation.id)
    return () => unsubscribeFromInbox()
  }, [organisation?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const messages: NetworkMessage[] = tab === 'inbox' ? inbox : sent
  const isNetworkEnabled = settings?.network_enabled !== false

  function renderMessage(msg: NetworkMessage, isInbox: boolean) {
    const labelCfg = NETWORK_LABEL_CONFIG[msg.label]
    const other = isInbox ? msg.from_org : msg.to_org
    const isUnread = isInbox && !msg.is_read

    return (
      <tr
        key={msg.id}
        style={{ cursor: 'pointer', fontWeight: isUnread ? 700 : 400, background: isUnread ? 'var(--ps-off-white)' : undefined }}
        onClick={() => navigate(`/messaging/network/thread/${msg.thread_id}`)}
      >
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)' }}>
            {isUnread && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ps-electric-cyan)', display: 'inline-block', flexShrink: 0 }} />
            )}
            <span>{other?.name ?? '—'}</span>
          </div>
        </td>
        <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {msg.subject && <strong>{msg.subject} · </strong>}
          <span style={{ color: 'var(--ps-slate)' }}>{msg.body.slice(0, 80)}{msg.body.length > 80 ? '…' : ''}</span>
        </td>
        <td><span className={labelCfg.cssClass}>{labelCfg.icon} {labelCfg.label}</span></td>
        {!isInbox && (
          <td>
            <span className={msg.is_read ? 'ps-badge ps-badge-green' : 'ps-badge ps-badge-blue'}>
              {msg.is_read ? '✓ Read' : 'Sent'}
            </span>
          </td>
        )}
        <td style={{ whiteSpace: 'nowrap', color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
          {relativeTime(msg.created_at)}
        </td>
      </tr>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging" onClick={(e) => { e.preventDefault(); navigate('/messaging') }}>Messaging</a>
          <span className="separator">/</span>
          <span>Pharmacy Network</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            <h1>🏥 Pharmacy Network</h1>
            {unreadCount > 0 && (
              <span className="ps-badge ps-badge-red" style={{ fontSize: '0.8rem' }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/network/settings')}>
              ⚙️ Settings
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => navigate('/messaging/network/compose')}
              disabled={!isNetworkEnabled}
            >
              + New Message
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {/* Onboarding prompt */}
      {!myLink && (
        <div className="ps-card" style={{
          padding: 'var(--ps-space-lg)',
          marginBottom: 'var(--ps-space-lg)',
          background: 'var(--ps-off-white)',
          border: '2px solid var(--ps-electric-cyan)',
        }}>
          <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>🔗 Link Your Pharmacy</h3>
          <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)' }}>
            Before you can send or receive network messages, link your PharmStation account to your NHS ODS pharmacy entry. This lets other pharmacies find and message you.
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/network/onboarding')}>
            Link Pharmacy →
          </button>
        </div>
      )}

      {/* Network disabled banner */}
      {myLink && !isNetworkEnabled && (
        <div className="ps-card" style={{
          padding: 'var(--ps-space-md)',
          marginBottom: 'var(--ps-space-lg)',
          background: '#fff8e6',
          border: '1px solid var(--ps-amber)',
        }}>
          <p style={{ margin: 0 }}>
            ⚠️ Network messaging is currently <strong>disabled</strong> for your pharmacy.{' '}
            <button className="ps-btn ps-btn-ghost" style={{ padding: 0 }} onClick={() => navigate('/messaging/network/settings')}>
              Enable in Settings →
            </button>
          </p>
        </div>
      )}

      {/* Linked pharmacy info */}
      {myLink?.pharmacy && (
        <div className="ps-card" style={{
          padding: 'var(--ps-space-md)',
          marginBottom: 'var(--ps-space-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--ps-space-md)',
          flexWrap: 'wrap',
        }}>
          <div>
            <span style={{ fontWeight: 600 }}>🏥 Linked as:</span>{' '}
            {myLink.pharmacy?.organisation_name ?? 'Unknown'}{' '}
            <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
              · {myLink.pharmacy?.ods_code}
            </span>
          </div>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/network/onboarding')}>
            Change link
          </button>
        </div>
      )}

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        {[
          { label: 'Inbox', value: inbox.length, icon: '📨' },
          { label: 'Unread', value: unreadCount, icon: '🔵' },
          { label: 'Sent', value: sent.length, icon: '📤' },
        ].map((card) => (
          <div key={card.label} className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{card.icon}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--ps-deep-blue)' }}>{card.value}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="ps-card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--ps-off-white)', padding: '0 var(--ps-space-md)' }}>
          {(['inbox', 'sent'] as Tab[]).map((t) => (
            <button
              key={t}
              className="ps-btn ps-btn-ghost"
              style={{
                borderRadius: 0,
                borderBottom: tab === t ? '2px solid var(--ps-electric-cyan)' : '2px solid transparent',
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? 'var(--ps-deep-blue)' : 'var(--ps-slate)',
                padding: 'var(--ps-space-md) var(--ps-space-lg)',
              }}
              onClick={() => setTab(t)}
            >
              {t === 'inbox' ? `📨 Inbox${unreadCount > 0 ? ` (${unreadCount})` : ''}` : '📤 Sent'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
            <div className="loading-spinner" />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>
            {tab === 'inbox'
              ? 'No messages yet. Other pharmacies on the platform can message you here.'
              : 'No sent messages yet. Use the "New Message" button to reach out to another pharmacy.'}
          </div>
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>{tab === 'inbox' ? 'From' : 'To'}</th>
                <th>Message</th>
                <th>Label</th>
                {tab === 'sent' && <th>Status</th>}
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((msg) => renderMessage(msg, tab === 'inbox'))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
