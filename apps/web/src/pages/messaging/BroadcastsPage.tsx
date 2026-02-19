import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useMessagingStore } from '@pharmstation/core'
import type { Broadcast } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

const STATUS_BADGES: Record<string, string> = {
  draft: 'ps-badge ps-badge-purple',
  sending: 'ps-badge ps-badge-amber',
  sent: 'ps-badge ps-badge-green',
  failed: 'ps-badge ps-badge-red',
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function BroadcastsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { broadcasts, fetchBroadcasts, sendBroadcast, loading, error, clearError } = useMessagingStore()
  const [confirmBroadcast, setConfirmBroadcast] = useState<Broadcast | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    if (organisation?.id) fetchBroadcasts(organisation.id)
  }, [organisation?.id, fetchBroadcasts])

  const handleSend = async () => {
    if (!confirmBroadcast || !organisation?.id) return
    setSending(true)
    setSendError(null)
    try {
      await sendBroadcast(organisation.id, confirmBroadcast.id)
      setConfirmBroadcast(null)
      fetchBroadcasts(organisation.id)
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Failed to send broadcast')
    }
    setSending(false)
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging" onClick={(e) => { e.preventDefault(); navigate('/messaging') }}>Messaging</a>
          <span className="separator">/</span>
          <span>Broadcasts</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>📢 Broadcasts</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/broadcasts/new')}>
            + New Broadcast
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error} <button className="ps-btn ps-btn-ghost" onClick={clearError}>Dismiss</button>
        </div>
      )}

      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
        {loading && broadcasts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)' }}>
            <div className="loading-spinner" />
          </div>
        ) : broadcasts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--ps-space-xl)', color: 'var(--ps-slate)' }}>
            <p style={{ fontSize: '1.1rem' }}>No broadcasts yet</p>
            <p style={{ marginBottom: 'var(--ps-space-md)' }}>Create your first broadcast to send messages to multiple patients at once.</p>
            <button className="ps-btn ps-btn-primary" onClick={() => navigate('/messaging/broadcasts/new')}>
              + New Broadcast
            </button>
          </div>
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Failed</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.name}</td>
                  <td>
                    <span style={{ textTransform: 'uppercase', fontSize: '0.85rem' }}>
                      {b.channel === 'sms' ? '📱' : b.channel === 'email' ? '📧' : '✉️'} {b.channel}
                    </span>
                  </td>
                  <td>
                    <span className={STATUS_BADGES[b.status] || 'ps-badge'}>{b.status}</span>
                  </td>
                  <td>{b.recipient_count ?? '—'}</td>
                  <td>{b.failed_count ?? 0}</td>
                  <td>{formatDate(b.created_at)}</td>
                  <td>
                    {b.status === 'draft' && (
                      <button
                        className="ps-btn ps-btn-primary"
                        style={{ fontSize: '0.85rem', padding: 'var(--ps-space-xs) var(--ps-space-sm)' }}
                        onClick={() => setConfirmBroadcast(b)}
                      >
                        Send
                      </button>
                    )}
                    {b.status === 'sent' && (
                      <span style={{ color: 'var(--ps-slate)', fontSize: '0.85rem' }}>Delivered</span>
                    )}
                    {b.status === 'sending' && (
                      <span className="ps-badge ps-badge-amber">In progress...</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm modal */}
      <Modal isOpen={!!confirmBroadcast} onClose={() => { setConfirmBroadcast(null); setSendError(null) }} title="Confirm Broadcast">
        {confirmBroadcast && (
          <>
            <p style={{ color: 'var(--ps-slate)' }}>
              You are about to send broadcast <strong>"{confirmBroadcast.name}"</strong> via{' '}
              <strong>{confirmBroadcast.channel.toUpperCase()}</strong> to{' '}
              <strong>{confirmBroadcast.recipient_count ?? 'all'}</strong> recipients.
            </p>
            <p style={{ color: 'var(--ps-slate)', marginTop: 'var(--ps-space-sm)' }}>
              This action cannot be undone. Messages will be sent immediately.
            </p>
            {sendError && <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)' }}>{sendError}</div>}
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
              <button className="ps-btn ps-btn-primary" onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Send Now'}
              </button>
              <button className="ps-btn ps-btn-ghost" onClick={() => { setConfirmBroadcast(null); setSendError(null) }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
