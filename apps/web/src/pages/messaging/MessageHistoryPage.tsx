import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { MessageChannel, NotifyMessageStatus } from '@pharmstation/types'

const STATUS_BADGES: Record<string, string> = {
  created: 'ps-badge',
  sending: 'ps-badge ps-badge-amber',
  delivered: 'ps-badge ps-badge-green',
  failed: 'ps-badge ps-badge-red',
  'permanent-failure': 'ps-badge ps-badge-red',
  'temporary-failure': 'ps-badge ps-badge-amber',
  'technical-failure': 'ps-badge ps-badge-red',
}

const CHANNEL_ICON: Record<string, string> = { sms: '📱', email: '📧', letter: '✉️' }
const PAGE_SIZE = 50

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function MessageHistoryPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { messages, fetchMessages, loading, error, clearError } = useMessagingStore()

  // Filters
  const [channelFilter, setChannelFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!organisation?.id) return
    const filters: Record<string, string> = {}
    if (channelFilter !== 'all') filters.channel = channelFilter
    if (statusFilter !== 'all') filters.status = statusFilter
    if (search.trim()) filters.search = search.trim()
    fetchMessages(organisation.id, filters, page, PAGE_SIZE)
  }, [organisation?.id, channelFilter, statusFilter, search, page, fetchMessages])

  const handleCheckStatus = async (messageId: string, notifyId: string | null) => {
    if (!organisation?.id || !notifyId) return
    const { checkStatus } = useMessagingStore.getState()
    try {
      await checkStatus(organisation.id, notifyId)
      // Refresh
      const filters: Record<string, string> = {}
      if (channelFilter !== 'all') filters.channel = channelFilter
      if (statusFilter !== 'all') filters.status = statusFilter
      if (search.trim()) filters.search = search.trim()
      fetchMessages(organisation.id, filters, page, PAGE_SIZE)
    } catch { /* errors already in store */ }
  }

  const handleExportCsv = () => {
    if (messages.length === 0) return
    const headers = ['Date', 'Channel', 'Recipient', 'Status', 'Notify ID']
    const rows = messages.map((m) => [
      formatDate(m.created_at),
      m.channel,
      m.recipient_identifier || '—',
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
            <option value="sending">Sending</option>
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
                  <tr key={m.id}>
                    <td>{formatDate(m.created_at)}</td>
                    <td>{CHANNEL_ICON[m.channel] || ''} {m.channel.toUpperCase()}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.recipient_identifier || '—'}
                    </td>
                    <td>
                      <span className={STATUS_BADGES[m.status] || 'ps-badge'}>{m.status}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--ps-slate)' }}>
                      {m.notify_message_id ? m.notify_message_id.slice(0, 8) + '...' : '—'}
                    </td>
                    <td>
                      {m.notify_message_id && !['delivered', 'permanent-failure'].includes(m.status) && (
                        <button
                          className="ps-btn ps-btn-ghost"
                          style={{ fontSize: '0.85rem' }}
                          onClick={() => handleCheckStatus(m.id, m.notify_message_id)}
                        >
                          🔄 Check
                        </button>
                      )}
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
    </div>
  )
}
