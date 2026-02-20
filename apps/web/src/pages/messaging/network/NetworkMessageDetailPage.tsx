import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { NETWORK_LABEL_CONFIG } from '@pharmstation/types'
import type { NetworkMessageLabel } from '@pharmstation/types'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function NetworkMessageDetailPage() {
  const { threadId } = useParams<{ threadId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    thread, loading, error,
    fetchThread, markThreadRead, sendMessage, clearError,
  } = useNetworkStore()

  const [replyBody, setReplyBody]   = useState('')
  const [replyLabel, setReplyLabel] = useState<NetworkMessageLabel>('other')
  const [sending, setSending]       = useState(false)
  const [showReply, setShowReply]   = useState(false)

  const load = useCallback(async () => {
    if (!threadId || !organisation?.id) return
    await fetchThread(threadId, organisation.id)
    await markThreadRead(threadId, organisation.id)
  }, [threadId, organisation?.id, fetchThread, markThreadRead])

  useEffect(() => { load() }, [load])

  // Determine the "other party" (the one that is not us)
  const orgId = organisation?.id
  const rootMsg = thread[0]
  const otherOrg = rootMsg
    ? (rootMsg.from_org_id === orgId ? rootMsg.to_org : rootMsg.from_org)
    : null

  async function handleReply() {
    if (!replyBody.trim() || !orgId || !otherOrg || !threadId) return
    setSending(true)
    try {
      await sendMessage({
        fromOrgId: orgId,
        toOrgIds:  [otherOrg.id],
        body:      replyBody.trim(),
        label:     replyLabel,
        threadId,
      })
      setReplyBody('')
      setShowReply(false)
      await fetchThread(threadId, orgId)
    } catch {
      // error shown via store
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging/network" onClick={(e) => { e.preventDefault(); navigate('/messaging/network') }}>Pharmacy Network</a>
          <span className="separator">/</span>
          <span>{otherOrg?.name ?? 'Thread'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1>
              {rootMsg?.subject
                ? rootMsg.subject
                : `Conversation with ${otherOrg?.name ?? '—'}`}
            </h1>
            {rootMsg && (
              <p style={{ color: 'var(--ps-slate)', margin: 0 }}>
                <span className={NETWORK_LABEL_CONFIG[rootMsg.label]?.cssClass}>
                  {NETWORK_LABEL_CONFIG[rootMsg.label]?.icon} {NETWORK_LABEL_CONFIG[rootMsg.label]?.label}
                </span>
              </p>
            )}
          </div>
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/messaging/network')}>
            ← Back
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {loading && thread.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
          <div className="loading-spinner" />
        </div>
      ) : (
        <div style={{ maxWidth: 720 }}>
          {/* Thread messages */}
          {thread.map((msg) => {
            const isFromMe = msg.from_org_id === orgId
            const senderName = isFromMe
              ? (organisation?.name ?? 'You')
              : (msg.from_org?.name ?? '—')
            const labelCfg = NETWORK_LABEL_CONFIG[msg.label]

            return (
              <div key={msg.id} className="ps-card" style={{
                marginBottom: 'var(--ps-space-md)',
                border: isFromMe ? '1px solid var(--ps-electric-cyan)' : '1px solid var(--ps-off-white)',
              }}>
                {/* Header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--ps-space-sm) var(--ps-space-md)',
                  borderBottom: '1px solid var(--ps-off-white)',
                  background: isFromMe ? '#f0faff' : 'var(--ps-off-white)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: isFromMe ? 'var(--ps-electric-cyan)' : 'var(--ps-slate)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
                    }}>
                      {senderName[0]?.toUpperCase()}
                    </span>
                    <div>
                      <span style={{ fontWeight: 600 }}>{senderName}</span>
                      {isFromMe && <span className="ps-badge ps-badge-blue" style={{ marginLeft: 8, fontSize: '0.7rem' }}>You</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
                    <span className={labelCfg?.cssClass} style={{ fontSize: '0.75rem' }}>
                      {labelCfg?.icon} {labelCfg?.label}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--ps-slate)' }}>
                      {formatDateTime(msg.created_at)}
                    </span>
                    {msg.request_sms_ping && (
                      <span title="SMS ping was requested" style={{ fontSize: '1rem' }}>📱</span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: 'var(--ps-space-md)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  {msg.body}
                </div>

                {/* Read receipt (outbound) */}
                {isFromMe && (
                  <div style={{
                    padding: '4px var(--ps-space-md)',
                    borderTop: '1px solid var(--ps-off-white)',
                    fontSize: '0.78rem',
                    color: msg.is_read ? 'var(--ps-green, #22c55e)' : 'var(--ps-slate)',
                    textAlign: 'right',
                  }}>
                    {msg.is_read
                      ? `✓✓ Read ${msg.read_at ? formatDateTime(msg.read_at) : ''}`
                      : '✓ Sent'}
                  </div>
                )}
              </div>
            )
          })}

          {/* Reply box */}
          {otherOrg && (
            !showReply ? (
              <button
                className="ps-btn ps-btn-primary"
                onClick={() => setShowReply(true)}
                style={{ marginTop: 'var(--ps-space-sm)' }}
              >
                ↩ Reply to {otherOrg.name}
              </button>
            ) : (
              <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginTop: 'var(--ps-space-md)' }}>
                <h4 style={{ margin: '0 0 var(--ps-space-md)' }}>↩ Reply to {otherOrg.name}</h4>

                {/* Label for reply */}
                <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', flexWrap: 'wrap', marginBottom: 'var(--ps-space-sm)' }}>
                  {(['prescription_query', 'stock_query', 'community_alert', 'other'] as NetworkMessageLabel[]).map((l) => {
                    const cfg = NETWORK_LABEL_CONFIG[l]
                    return (
                      <button
                        key={l}
                        className={`ps-btn ${replyLabel === l ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                        onClick={() => setReplyLabel(l)}
                      >
                        {cfg.icon} {cfg.label}
                      </button>
                    )
                  })}
                </div>

                <textarea
                  className="ps-input"
                  rows={4}
                  placeholder="Write your reply…"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  maxLength={2000}
                  style={{ resize: 'vertical', marginBottom: 'var(--ps-space-sm)', width: '100%' }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
                  <button className="ps-btn ps-btn-ghost" onClick={() => setShowReply(false)}>
                    Cancel
                  </button>
                  <button
                    className="ps-btn ps-btn-primary"
                    onClick={handleReply}
                    disabled={!replyBody.trim() || sending}
                  >
                    {sending ? 'Sending…' : '↩ Send Reply'}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
