import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useNetworkStore } from '@pharmstation/core'
import { NETWORK_LABEL_CONFIG, NETWORK_PING_STATUS_TEXT } from '@pharmstation/types'
import type { NetworkMessageLabel } from '@pharmstation/types'
import { ChatComposer, JumpToLatest, WithDayDividers, formatChatTime, useStickToBottom } from '../../../components/chat/chat'
import { Smartphone } from 'lucide-react'

const REPLY_LABELS: NetworkMessageLabel[] = ['other', 'stock_query', 'prescription_query', 'community_alert']

export function NetworkMessageDetailPage() {
  const { threadId } = useParams<{ threadId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    thread, loading, error,
    fetchThread, markThreadRead, sendMessage, clearError,
    subscribeToInbox, unsubscribeFromInbox,
  } = useNetworkStore()

  const [replyBody, setReplyBody]   = useState('')
  const [replyLabel, setReplyLabel] = useState<NetworkMessageLabel>('other')
  const [sending, setSending]       = useState(false)

  const load = useCallback(async () => {
    if (!threadId || !organisation?.id) return
    await fetchThread(threadId, organisation.id)
    await markThreadRead(threadId, organisation.id)
  }, [threadId, organisation?.id, fetchThread, markThreadRead])

  useEffect(() => { load() }, [load])

  // Live replies: new messages for this thread arrive on the shared inbox
  // channel and are appended to the open conversation.
  useEffect(() => {
    if (!organisation?.id) return
    subscribeToInbox(organisation.id)
    return () => unsubscribeFromInbox()
  }, [organisation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark replies that arrive while the thread is open as read.
  const unreadForMe = thread.some((m) => m.to_org_id === organisation?.id && !m.is_read)
  useEffect(() => {
    if (unreadForMe && threadId && organisation?.id) markThreadRead(threadId, organisation.id)
  }, [unreadForMe, threadId, organisation?.id, markThreadRead])

  // Determine the "other party" (the one that is not us)
  const orgId = organisation?.id
  const rootMsg = thread[0]
  const otherOrg = rootMsg
    ? (rootMsg.from_org_id === orgId ? rootMsg.to_org : rootMsg.from_org)
    : null

  const lastId = thread[thread.length - 1]?.id
  const { ref: streamRef, onScroll, showJump, scrollToBottom } = useStickToBottom<HTMLDivElement>(`${thread.length}:${lastId}`, threadId)

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
      setReplyLabel('other')
    } catch {
      // error shown via store
    } finally {
      setSending(false)
    }
  }

  const rootLabel = rootMsg ? NETWORK_LABEL_CONFIG[rootMsg.label] : null
  const title = otherOrg?.name ?? 'Conversation'

  return (
    <div className="chat-page">
      <div className="page-header chat-page-crumbs">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/messaging/network" onClick={(e) => { e.preventDefault(); navigate('/messaging/network') }}>Pharmacy Network</a>
          <span className="separator">/</span>
          <span>{title}</span>
        </div>
      </div>

      <section className="chat-window">
        <header className="chat-head">
          <button type="button" className="chat-back" onClick={() => navigate('/messaging/network')} aria-label="Back to Pharmacy Network">
            ←
          </button>
          <span className="chat-avatar" aria-hidden="true">{title[0]?.toUpperCase() ?? '?'}</span>
          <div className="chat-head-copy">
            <h1>{title}</h1>
            <span>
              {rootMsg?.subject && <>{rootMsg.subject} · </>}
              {rootLabel && <>{rootLabel.label}</>}
            </span>
          </div>
        </header>

        {error && (
          <div className="chat-banner chat-banner-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={clearError} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="chat-stream-wrap">
          <div className="chat-stream" ref={streamRef} onScroll={onScroll}>
            {loading && thread.length === 0 ? (
              <div className="chat-empty"><div className="loading-spinner" /></div>
            ) : thread.length === 0 ? (
              <div className="chat-empty">No messages in this conversation.</div>
            ) : (
              <WithDayDividers
                items={thread}
                getTime={(msg) => msg.created_at}
                render={(msg, index) => {
                  const isFromMe = msg.from_org_id === orgId
                  const prev = thread[index - 1]
                  const grouped = prev && prev.from_org_id === msg.from_org_id &&
                    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
                  const labelCfg = NETWORK_LABEL_CONFIG[msg.label]
                  return (
                    <div className={`chat-msg ${isFromMe ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`}>
                      {msg.label !== 'other' && labelCfg && (
                        <span className={`chat-msg-tag ${labelCfg.cssClass}`}>{labelCfg.label}</span>
                      )}
                      <div className="chat-bubble">{msg.body}</div>
                      <div className="chat-meta">
                        <time dateTime={msg.created_at} title={new Date(msg.created_at).toLocaleString('en-GB')}>{formatChatTime(msg.created_at)}</time>
                        {msg.request_sms_ping && (
                          <span title={isFromMe && msg.sms_ping_status ? NETWORK_PING_STATUS_TEXT[msg.sms_ping_status] : 'Marked urgent with a text alert'}>
                            <Smartphone size={13} strokeWidth={1.75} aria-hidden="true" style={{ verticalAlign: '-2px' }} />{isFromMe && msg.sms_ping_status ? ` ${NETWORK_PING_STATUS_TEXT[msg.sms_ping_status]}` : ' Urgent'}
                          </span>
                        )}
                        {isFromMe && (
                          <span className={msg.is_read ? 'chat-read' : undefined}>
                            {msg.is_read ? '✓✓ Read' : '✓ Sent'}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
            )}
          </div>
          <JumpToLatest show={showJump} onClick={() => scrollToBottom(true)} />
        </div>

        {otherOrg && (
          <ChatComposer
            value={replyBody}
            onChange={setReplyBody}
            onSend={handleReply}
            sending={sending}
            maxLength={2000}
            placeholder={`Message ${otherOrg.name}`}
            before={
              <div className="chat-tags" role="radiogroup" aria-label="Message type">
                {REPLY_LABELS.map((l) => {
                  const cfg = NETWORK_LABEL_CONFIG[l]
                  return (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={replyLabel === l}
                      className={replyLabel === l ? 'active' : undefined}
                      onClick={() => setReplyLabel(l)}
                    >
                      {l === 'other' ? 'General' : cfg.label}
                    </button>
                  )
                })}
              </div>
            }
            after={replyBody.length > 1800 ? <span>{2000 - replyBody.length} characters left</span> : undefined}
          />
        )}
      </section>
    </div>
  )
}
