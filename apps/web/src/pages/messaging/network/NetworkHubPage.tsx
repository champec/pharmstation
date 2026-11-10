import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { NETWORK_LABEL_CONFIG } from '@pharmstation/types'
import type { NetworkMessage } from '@pharmstation/types'
import { PharmacyMapModal } from '../../../components/maps/PharmacyMapModal'
import { Settings, Map as MapIcon, MessagesSquare, MailOpen, Send, Inbox } from 'lucide-react'
import { PageHeader } from '../../../components/ui/PageHeader'
import { EmptyState } from '../../../components/ui/EmptyState'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Tab = 'all' | 'unread' | 'sent'

/** One row per conversation: its latest message in either direction. */
interface Conversation {
  latest: NetworkMessage
  otherName: string
  unread: boolean
}

export function NetworkHubPage() {
  const navigate = useNavigate()
  const { organisation, permissions } = useAuthStore()
  const canManageLink = permissions?.org_settings === true
  const {
    inbox, sent, loading, error,
    myLink, settings,
    unreadCount,
    fetchInbox, fetchSent, fetchMyLink, fetchSettings, fetchUnreadCount,
    subscribeToInbox, unsubscribeFromInbox,
    clearError,
  } = useNetworkStore()

  const [tab, setTab] = useState<Tab>('all')
  const [showMap, setShowMap] = useState(false)

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

  const isNetworkEnabled = settings?.network_enabled !== false
  const verification = organisation?.verification_status
  const awaitingVerification = verification === 'pending' || verification === 'rejected'
  // A link whose postcode/ODS didn't match the NHS record waits for our team to check it.
  const linkPending = !!myLink && !myLink.is_verified

  const conversations = useMemo<Conversation[]>(() => {
    const unreadThreads = new Set(inbox.filter((m) => !m.is_read).map((m) => m.thread_id))
    const byThread = new Map<string, NetworkMessage>()
    for (const m of [...inbox, ...sent]) {
      const cur = byThread.get(m.thread_id)
      if (!cur || m.created_at > cur.created_at) byThread.set(m.thread_id, m)
    }
    return Array.from(byThread.values())
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((latest) => {
        const fromMe = latest.from_org_id === organisation?.id
        return {
          latest,
          otherName: (fromMe ? latest.to_org?.name : latest.from_org?.name) ?? 'Unknown pharmacy',
          unread: unreadThreads.has(latest.thread_id),
        }
      })
  }, [inbox, sent, organisation?.id])

  const sentThreads = useMemo(() => new Set(sent.map((m) => m.thread_id)), [sent])
  const shown = conversations.filter((c) =>
    tab === 'unread' ? c.unread : tab === 'sent' ? sentThreads.has(c.latest.thread_id) : true,
  )

  function renderConversation(c: Conversation) {
    const msg = c.latest
    const labelCfg = NETWORK_LABEL_CONFIG[msg.label] ?? NETWORK_LABEL_CONFIG.other
    const fromMe = msg.from_org_id === organisation?.id

    return (
      <tr
        key={msg.thread_id}
        style={{ cursor: 'pointer', fontWeight: c.unread ? 700 : 400, background: c.unread ? 'var(--ps-off-white)' : undefined }}
        onClick={() => navigate(`/messaging/network/thread/${msg.thread_id}`)}
      >
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)' }}>
            {c.unread && (
              <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ps-electric-cyan)', display: 'inline-block', flexShrink: 0 }} />
            )}
            <span>{c.otherName}</span>
          </div>
        </td>
        <td className="ps-cell-wide" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {msg.subject && <strong>{msg.subject} · </strong>}
          <span style={{ color: 'var(--ps-slate)' }}>
            {fromMe ? 'You: ' : ''}{msg.body.slice(0, 80)}{msg.body.length > 80 ? '…' : ''}
          </span>
        </td>
        <td><span className={labelCfg.cssClass}>{labelCfg.label}</span></td>
        <td>
          {fromMe ? (
            <span className={msg.is_read ? 'ps-badge ps-badge-green' : 'ps-badge ps-badge-blue'}>
              {msg.is_read ? '✓ Read' : 'Sent'}
            </span>
          ) : (
            <span className={c.unread ? 'ps-badge ps-badge-blue' : 'ps-badge'}>{c.unread ? 'New' : 'Replied to you'}</span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap', color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
          {relativeTime(msg.created_at)}
        </td>
      </tr>
    )
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Messaging', to: '/messaging' }, { label: 'Pharmacy Network' }]}
        title={<>Pharmacy Network{unreadCount > 0 && <span className="ps-badge ps-badge-blue" style={{ marginLeft: 'var(--ps-space-sm)', verticalAlign: 'middle' }}>{unreadCount} new</span>}</>}
        subtitle="Message verified pharmacies near you about stock, prescriptions and local alerts."
        actions={<>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/messaging/network/settings')}>
            <Settings size={16} strokeWidth={1.75} aria-hidden="true" /> Settings
          </button>
          <button className="ps-btn ps-btn-secondary" onClick={() => setShowMap(true)}>
            <MapIcon size={16} strokeWidth={1.75} aria-hidden="true" /> Map
          </button>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => navigate('/messaging/network/compose')}
            disabled={!isNetworkEnabled || !myLink || awaitingVerification || linkPending}
            title={awaitingVerification ? 'Available once your pharmacy is verified' : !myLink ? 'Link your pharmacy first' : linkPending ? 'Available once we have checked your linked pharmacy' : !isNetworkEnabled ? 'Turn the network back on in Settings' : undefined}
          >
            + New message
          </button>
        </>}
      />

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {awaitingVerification && (
        <div className={`ps-alert ${verification === 'rejected' ? 'ps-alert-error' : 'ps-alert-info'}`} style={{ marginBottom: 'var(--ps-space-lg)' }}>
          {verification === 'pending' ? (
            <span>
              <strong>Your pharmacy is being verified.</strong> We check every pharmacy against the GPhC premises register
              before it can join the network, so other pharmacies know who they are talking to. This usually takes one
              working day. You can read any messages already sent to you.
            </span>
          ) : (
            <span>
              <strong>We couldn&rsquo;t verify this pharmacy</strong>, so it can&rsquo;t join the network.{' '}
              {organisation?.verification_note ?? ''} Contact <a href="mailto:hello@pharmstation.co.uk">hello@pharmstation.co.uk</a>.
            </span>
          )}
        </div>
      )}

      {linkPending && !awaitingVerification && (
        <div className="ps-alert ps-alert-info" style={{ marginBottom: 'var(--ps-space-lg)' }}>
          <span>
            <strong>We&rsquo;re checking your linked pharmacy.</strong> Your address doesn&rsquo;t match the NHS record for{' '}
            {myLink?.pharmacy?.organisation_name ?? 'this pharmacy'}, so our team will confirm it before other pharmacies can find
            or message you. This usually takes one working day.
          </span>
        </div>
      )}

      {/* Onboarding prompt */}
      {!myLink && !awaitingVerification && (
        <div className="ps-card" style={{
          padding: 'var(--ps-space-lg)',
          marginBottom: 'var(--ps-space-lg)',
          background: 'var(--ps-off-white)',
          border: '2px solid var(--ps-electric-cyan)',
        }}>
          <h3 style={{ margin: '0 0 var(--ps-space-sm)' }}>Link your pharmacy</h3>
          <p style={{ color: 'var(--ps-slate)', margin: '0 0 var(--ps-space-md)' }}>
            Before you can send or receive network messages, link your PharmStation account to your NHS ODS pharmacy entry. This lets other pharmacies find and message you.
          </p>
          {canManageLink ? (
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/network/onboarding')}>
              Link pharmacy
            </button>
          ) : (
            <p style={{ margin: 0, fontSize: '0.9rem' }}>Ask an owner or manager to link your pharmacy.</p>
          )}
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
            You are <strong>not accepting new messages</strong>, so other pharmacies can&rsquo;t start conversations with you.{' '}
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
            <span style={{ fontWeight: 600 }}>Linked as:</span>{' '}
            {myLink.pharmacy?.organisation_name ?? 'Unknown'}{' '}
            <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>
              · {myLink.pharmacy?.ods_code}
            </span>
            {linkPending && <span className="ps-badge" style={{ marginLeft: 8 }}>Being checked</span>}
          </div>
          {canManageLink && (
            <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/network/onboarding')}>
              Change link
            </button>
          )}
        </div>
      )}

      {/* Quick stats */}
      <div className="ps-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-lg)' }}>
        {[
          { label: 'Conversations', value: conversations.length, icon: MessagesSquare },
          { label: 'Unread messages', value: unreadCount, icon: MailOpen },
          { label: 'Messages sent', value: sent.length, icon: Send },
        ].map((card) => (
          <div key={card.label} className="ps-card" style={{ padding: 'var(--ps-space-lg)', textAlign: 'center' }}>
            <card.icon size={22} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--ps-slate)', marginBottom: 4 }} />
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--ps-deep-blue)' }}>{card.value}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="ps-card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--ps-off-white)', padding: '0 var(--ps-space-md)' }}>
          {(['all', 'unread', 'sent'] as Tab[]).map((t) => (
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
              {t === 'all' ? 'All conversations' : t === 'unread' ? `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` : 'Started or replied by you'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
            <div className="loading-spinner" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            bare
            icon={Inbox}
            title={tab === 'unread' ? 'You are all caught up' : tab === 'sent' ? 'You haven’t messaged anyone yet' : 'No conversations yet'}
            actions={tab !== 'unread' && myLink && !awaitingVerification && isNetworkEnabled
              ? <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/network/compose')}>+ New message</button>
              : undefined}
          >
            {tab === 'unread'
              ? 'New messages from other pharmacies will show here.'
              : 'Ask nearby pharmacies about stock, prescriptions or local alerts. Their replies appear here.'}
          </EmptyState>
        ) : (
          <table className="ps-table ps-table-stack">
            <thead>
              <tr>
                <th>Pharmacy</th>
                <th>Latest message</th>
                <th>Label</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(renderConversation)}
            </tbody>
          </table>
        )}
      </div>

      <PharmacyMapModal isOpen={showMap} onClose={() => setShowMap(false)} />
    </div>
  )
}
