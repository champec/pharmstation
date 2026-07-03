import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { MessageChannel, NotifyMessage, NotifyMessageStatus } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const STATUS_BADGES: Record<string, string> = {
  created: 'ps-badge',
  sending: 'ps-badge ps-badge-amber',
  sent: 'ps-badge ps-badge-amber',
  delivered: 'ps-badge ps-badge-green',
  failed: 'ps-badge ps-badge-red',
  'permanent-failure': 'ps-badge ps-badge-red',
  'temporary-failure': 'ps-badge ps-badge-amber',
  'technical-failure': 'ps-badge ps-badge-red',
}

const FAILED_STATUSES = ['failed', 'permanent-failure', 'temporary-failure', 'technical-failure']

/** "sent" only means the provider accepted it — delivery is unconfirmed
 *  until the webhook reports, so we present it as pending. */
const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  sending: '⏳ Pending',
  sent: '⏳ Pending',
  delivered: '✓ Delivered',
  failed: 'Failed',
  'permanent-failure': 'Perm. failure',
  'temporary-failure': 'Temp. failure',
  'technical-failure': 'Tech. failure',
}

const CHANNEL_ICON: Record<string, string> = { sms: '📱', email: '📧', letter: '✉️' }
const PAGE_SIZE = 50

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function MessageHistoryPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { messages, fetchMessages, sendMessage, loading, error, clearError } = useMessagingStore()

  // Filters
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  // Detail modal
  const [selected, setSelected] = useState<NotifyMessage | null>(null)
  const [checking, setChecking] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => {
    if (!organisation?.id) return
    const filters: Record<string, string> = {}
    if (channelFilter !== 'all') filters.channel = channelFilter
    if (statusFilter !== 'all') filters.status = statusFilter
    if (search.trim()) filters.search = search.trim()
    fetchMessages(organisation.id, { ...filters, page, pageSize: PAGE_SIZE })
  }, [organisation?.id, channelFilter, statusFilter, search, page, fetchMessages])

  useEffect(() => { refresh() }, [refresh])

  // Keep the open modal in sync after a refresh updates the list.
  useEffect(() => {
    if (!selected) return
    const updated = messages.find((m) => m.id === selected.id)
    if (updated) setSelected(updated)
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  const openMessage = (m: NotifyMessage) => {
    setActionNotice(null)
    setCopied(false)
    setSelected(m)
  }

  const handleCheckStatus = async (m: NotifyMessage) => {
    if (!organisation?.id || !m.notify_message_id) return
    setChecking(true)
    setActionNotice(null)
    const { checkStatus } = useMessagingStore.getState()
    try {
      const r = await checkStatus(organisation.id, m.id)
      setActionNotice(`Status refreshed: ${r.status}`)
      refresh()
    } catch (e: unknown) {
      setActionNotice(e instanceof Error ? e.message : 'Status check failed')
    }
    setChecking(false)
  }

  const handleRetry = async (m: NotifyMessage) => {
    if (!organisation?.id || !m.body) return
    setRetrying(true)
    setActionNotice(null)
    try {
      const base = { org_id: organisation.id, body: m.body, patient_id: m.patient_id ?? undefined }
      if (m.channel === 'sms' && m.recipient_phone) {
        await sendMessage({ action: 'send_sms', phone_number: m.recipient_phone, ...base })
      } else if (m.channel === 'email' && m.recipient_email) {
        await sendMessage({ action: 'send_email', email_address: m.recipient_email, subject: m.subject ?? undefined, ...base })
      } else if (m.channel === 'letter' && m.recipient_address) {
        await sendMessage({ action: 'send_letter', address: m.recipient_address, ...base })
      } else {
        throw new Error('Original recipient details are missing — use "Reuse message" instead')
      }
      setActionNotice('✓ Message re-sent — it will appear at the top of the history')
      refresh()
    } catch (e: unknown) {
      setActionNotice(e instanceof Error ? e.message : 'Retry failed')
    }
    setRetrying(false)
  }

  const handleReuse = (m: NotifyMessage) => {
    // Prefill Compose with this message's content (recipient left blank on purpose).
    navigate(`/messaging/compose?channel=${m.channel}`, {
      state: { body: m.body ?? '', subject: m.subject ?? '' },
    })
  }

  const copyProviderId = (id: string) => {
    navigator.clipboard?.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleExportCsv = () => {
    if (messages.length === 0) return
    const headers = ['Date', 'Channel', 'Recipient', 'Status', 'Notify ID']
    const rows = messages.map((m) => [
      formatDate(m.created_at),
      m.channel,
      m.recipient_email || m.recipient_phone || '—',
      m.status,
      m.notify_message_id || '—',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `message-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging" onClick={(e) => { e.preventDefault(); navigate('/messaging') }}>Messaging</a>
          <span className="separator">/</span>
          <span>History</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>📋 Message History</h1>
          <button className="ps-btn ps-btn-secondary" onClick={handleExportCsv} disabled={messages.length === 0}>
            ⬇ Download CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error} <button className="ps-btn ps-btn-ghost" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', display: 'flex', gap: 'var(--ps-space-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Channel</label>
          <select className="ps-input" value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setPage(0) }}>
            <option value="all">All Channels</option>
            <option value="sms">📱 SMS</option>
            <option value="email">📧 Email</option>
            <option value="letter">✉️ Letter</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Status</label>
          <select className="ps-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
            <option value="all">All Statuses</option>
            <option value="created">Created</option>
            <option value="sent">Pending (awaiting delivery report)</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="permanent-failure">Permanent Failure</option>
            <option value="temporary-failure">Temporary Failure</option>
            <option value="technical-failure">Technical Failure</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>Search</label>
          <input className="ps-input" placeholder="Search recipient..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
        </div>
      </div>

      {/* Table */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        {loading && messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)' }}>
            <div className="loading-spinner" />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)', color: 'var(--ps-slate)' }}>
            <p style={{ fontSize: '1.1rem' }}>No messages found</p>
            <p>Send a message to see it appear here.</p>
          </div>
        ) : (
          <>
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Notify ID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => openMessage(m)}
                    style={{ cursor: 'pointer' }}
                    title="Click for details"
                  >
                    <td>{formatDate(m.created_at)}</td>
                    <td>{CHANNEL_ICON[m.channel] || ''} {m.channel.toUpperCase()}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.patient ? `${m.patient.first_name} ${m.patient.last_name} · ` : ''}
                      {m.recipient_email || m.recipient_phone || '—'}
                    </td>
                    <td>
                      <span className={STATUS_BADGES[m.status] || 'ps-badge'}>{STATUS_LABELS[m.status] ?? m.status}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--ps-slate)' }}>
                      {m.notify_message_id ? m.notify_message_id.slice(0, 8) + '...' : '—'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="ps-btn ps-btn-ghost"
                        style={{ fontSize: '0.85rem' }}
                        onClick={() => openMessage(m)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--ps-space-md)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--ps-slate)' }}>
                Page {page + 1} · Showing {messages.length} message{messages.length !== 1 ? 's' : ''}
              </span>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
                <button className="ps-btn ps-btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ← Previous
                </button>
                <button className="ps-btn ps-btn-ghost" disabled={messages.length < PAGE_SIZE} onClick={() => setPage(page + 1)}>
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Message detail modal ── */}
      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${CHANNEL_ICON[selected.channel] || ''} ${selected.channel.toUpperCase()} Message` : ''}
        width="680px"
      >
        {selected && (
          <div>
            {/* Status + notice */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
              <span className={STATUS_BADGES[selected.status] || 'ps-badge'} style={{ fontSize: '0.9rem' }}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
              {selected.provider && (
                <span style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                  via {selected.provider === 'nhs_notify' ? 'NHS Notify' : 'SMS Works'}
                </span>
              )}
            </div>

            {actionNotice && (
              <div style={{
                padding: 'var(--ps-space-sm) var(--ps-space-md)', marginBottom: 'var(--ps-space-md)',
                background: 'var(--ps-ice-blue)', borderRadius: 'var(--ps-radius-md)', fontSize: '0.9rem',
              }}>
                {actionNotice}
              </div>
            )}

            {/* Details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', rowGap: 'var(--ps-space-sm)', columnGap: 'var(--ps-space-md)', fontSize: '0.9rem', marginBottom: 'var(--ps-space-md)' }}>
              <strong>Patient</strong>
              <span>{selected.patient ? `${selected.patient.first_name} ${selected.patient.last_name}` : '—'}</span>

              <strong>To</strong>
              <span style={{ fontFamily: 'monospace' }}>
                {selected.recipient_phone || selected.recipient_email ||
                  (selected.recipient_address ? Object.values(selected.recipient_address).join(', ') : '—')}
              </span>

              {selected.sms_sender && (<>
                <strong>From (sender)</strong>
                <span>{selected.sms_sender}</span>
              </>)}

              <strong>Created</strong>
              <span>{formatDate(selected.created_at)}</span>

              {selected.sent_at && (<>
                <strong>Submitted</strong>
                <span>{formatDate(selected.sent_at)}</span>
              </>)}

              {selected.delivered_at && (<>
                <strong>Delivered</strong>
                <span style={{ color: 'var(--ps-success)' }}>{formatDate(selected.delivered_at)}</span>
              </>)}

              {selected.failed_at && (<>
                <strong>Failed</strong>
                <span style={{ color: 'var(--ps-error)' }}>{formatDate(selected.failed_at)}</span>
              </>)}

              {selected.failure_reason && (<>
                <strong>Failure reason</strong>
                <span style={{ color: 'var(--ps-error)' }}>{selected.failure_reason}</span>
              </>)}

              {(selected.segments ?? null) !== null && (<>
                <strong>Segments</strong>
                <span>{selected.segments} SMS segment{selected.segments === 1 ? '' : 's'}{typeof selected.credits === 'number' ? ` · ${selected.credits} credit${selected.credits === 1 ? '' : 's'}` : ''}</span>
              </>)}

              {selected.feature && (<>
                <strong>Source</strong>
                <span>{selected.feature}{selected.reference ? ` (${selected.reference})` : ''}</span>
              </>)}

              {selected.notify_message_id && (<>
                <strong>Provider ID</strong>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                  {selected.notify_message_id}
                  <button className="ps-btn ps-btn-ghost" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => copyProviderId(selected.notify_message_id!)}>
                    {copied ? '✓' : 'Copy'}
                  </button>
                </span>
              </>)}
            </div>

            {/* Message body */}
            {(selected.subject || selected.body) && (
              <div style={{
                padding: 'var(--ps-space-md)', background: 'var(--ps-off-white)',
                borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)',
                whiteSpace: 'pre-wrap', fontSize: '0.95rem',
              }}>
                {selected.subject && <div style={{ fontWeight: 600, marginBottom: 'var(--ps-space-xs)' }}>{selected.subject}</div>}
                {selected.body}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', flexWrap: 'wrap' }}>
              {selected.notify_message_id && (
                <button className="ps-btn ps-btn-secondary" disabled={checking} onClick={() => handleCheckStatus(selected)}>
                  {checking ? 'Checking…' : '🔄 Check status'}
                </button>
              )}
              {FAILED_STATUSES.includes(selected.status) && selected.body && (
                <button className="ps-btn ps-btn-primary" disabled={retrying} onClick={() => handleRetry(selected)}>
                  {retrying ? 'Re-sending…' : '↩️ Retry (same recipient)'}
                </button>
              )}
              {selected.body && (
                <button className="ps-btn ps-btn-secondary" onClick={() => handleReuse(selected)}>
                  📝 Reuse message
                </button>
              )}
              <button className="ps-btn ps-btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
