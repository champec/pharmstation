// ============================================
// Genie — floating assistant
// A button in the corner of every staff page opens Genie in a floating panel.
// The page underneath stays usable, and Genie is told which page the user is on.
// Changes Genie proposes appear as cards the user must confirm.
// ============================================

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CircleCheck, Eye, History, Lock, Minus, Sparkles, SquarePen, Trash2, User, Wrench } from 'lucide-react'
import { PLANS, useAuthStore, useChatStore, useSubscriptionStore } from '@pharmstation/core'
import type { ChatMessage, GenieAction, GeniePageContext } from '@pharmstation/types'
import { PLANS_ENFORCED } from '../../lib/billing'
import { JumpToLatest, useAutoGrow, useStickToBottom } from '../chat/chat'
import { Markdown } from '../chat/Markdown'

export function GeniePanel() {
  const {
    isOpen,
    toggleOpen,
    models,
    conversations,
    messages,
    activeConversationId,
    isStreaming,
    streamingContent,
    streamingToolCalls,
    lastError,
    showHistory,
    modelsLoading,
    loadModels,
    loadConversations,
    loadOrgAISettings,
    loadUsage,
    usage,
    orgAISettings,
    setActiveConversation,
    startNewConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    setShowHistory,
    actions,
    decideAction,
  } = useChatStore()
  const location = useLocation()

  const { organisation, userSession } = useAuthStore()
  const planLoaded = useSubscriptionStore((s) => s.loaded)
  const plan = useSubscriptionStore((s) => s.plan)
  // Plan gate (only once billing is enforced). Before that every pharmacy gets the Essential allowance.
  const locked = PLANS_ENFORCED && planLoaded && PLANS[plan].genieMonthlyMessages <= 0
  // Same rule as the server: the effective plan's allowance (complimentary upgrades included),
  // and at least the Essential allowance until plans are enforced.
  const monthlyLimit = PLANS_ENFORCED
    ? PLANS[plan].genieMonthlyMessages
    : Math.max(PLANS[plan].genieMonthlyMessages, PLANS.essential.genieMonthlyMessages)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  // Load models and conversations on mount
  useEffect(() => {
    if (isOpen && organisation?.id) {
      if (models.length === 0 && !modelsLoading) {
        loadModels()
      }
      loadConversations(organisation.id)
      loadOrgAISettings(organisation.id)
      loadUsage(organisation.id, monthlyLimit)
    }
  }, [isOpen, organisation?.id, monthlyLimit])

  // Keep the newest message in view by scrolling the message list itself, never the page.
  // Follows streaming text only while the reader is at the bottom.
  const { ref: messagesRef, onScroll, showJump, scrollToBottom } = useStickToBottom<HTMLDivElement>(
    `${messages.length}:${streamingContent.length}:${isStreaming}`,
    `${activeConversationId}:${showHistory}`,
  )
  useAutoGrow(inputRef, inputValue, 140)

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen, activeConversationId])

  const sendText = async (text: string) => {
    if (!text || isStreaming || locked || !organisation?.id || !userSession?.access_token) return
    await sendMessage({
      organisationId: organisation.id,
      message: text,
      supabaseUrl,
      accessToken: userSession.access_token,
      pageContext: readPageContext(location.pathname),
    })
  }

  const decide = (actionId: string, decision: 'confirm' | 'cancel') => {
    if (!userSession?.access_token) return
    void decideAction({ actionId, decision, supabaseUrl, accessToken: userSession.access_token })
  }

  const sendSuggestion = (text: string) => {
    // A suggestion ending in a space needs finishing: put it in the box instead of sending.
    if (text.endsWith(' ')) {
      setInputValue(text)
      setTimeout(() => inputRef.current?.focus(), 0)
      return
    }
    setInputValue('')
    void sendText(text)
  }

  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text) return
    setInputValue('')
    await sendText(text)
  }

  const handleRetry = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (lastUserMessage?.content) void sendText(lastUserMessage.content)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Genie only uses approved models; show the one the server will pick.
  const genieModels = models.filter((m) => m.genie_enabled)
  const activeModel =
    genieModels.find((m) => m.id === orgAISettings?.standard_model_id) ??
    genieModels.find((m) => m.is_default) ??
    genieModels[0]
  const patientDataOn = orgAISettings?.genie_patient_data === true
  const usedUp = !!usage && usage.limit > 0 && usage.used >= usage.limit

  const suggestions = suggestionsFor(location.pathname)
  const pageTitle = pageTitleFor(location.pathname)
  const pendingActions = actions.filter((a) => !a.message_id)

  if (!isOpen) {
    return (
      <button type="button" className="genie-fab" onClick={toggleOpen} aria-label="Ask Genie" title="Ask Genie">
        <Sparkles size={22} strokeWidth={1.75} aria-hidden="true" />
        <span className="genie-fab-label">Ask Genie</span>
      </button>
    )
  }

  return (
    <div className="genie-panel" role="dialog" aria-label="Genie assistant">
      {/* Header */}
      <div className="genie-header">
        <div className="genie-header-left">
          <span className="genie-header-icon"><Sparkles size={18} strokeWidth={1.75} aria-hidden="true" /></span>
          <span className="genie-header-title">Genie</span>
          {activeModel && (
            <span className="genie-model-badge">{activeModel.display_name}</span>
          )}
        </div>
        <div className="genie-header-actions">
          <button
            className="genie-icon-btn"
            onClick={() => startNewConversation()}
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            className={`genie-icon-btn ${showHistory ? 'active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title="Chat history"
            aria-label="Chat history"
          >
            <History size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button className="genie-icon-btn" onClick={toggleOpen} title="Minimise" aria-label="Minimise Genie">
            <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* History sidebar */}
      {showHistory && (
        <div className="genie-history">
          <div className="genie-history-header">
            <span>Conversations</span>
          </div>
          <div className="genie-history-list">
            {conversations.length === 0 ? (
              <div className="genie-history-empty">No conversations yet</div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`genie-history-item ${activeConversationId === conv.id ? 'active' : ''}`}
                  onClick={() => setActiveConversation(conv.id)}
                >
                  <span className="genie-history-title">{conv.title}</span>
                  <span className="genie-history-date">
                    {new Date(conv.updated_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <button
                    className="genie-history-delete"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                    title="Delete"
                    aria-label="Delete chat"
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Messages area */}
      {!showHistory && locked && (
        <div className="genie-messages-wrap">
          <div className="genie-welcome">
            <div className="genie-welcome-icon"><Lock size={26} strokeWidth={1.75} aria-hidden="true" /></div>
            <h3>Genie is part of the Essential plan</h3>
            <p>
              Upgrade to Essential or Complete in Settings to ask Genie about your registers, logs and team.
            </p>
          </div>
        </div>
      )}

      {!showHistory && !locked && (
        <div className="genie-messages-wrap">
        <div className="genie-messages" ref={messagesRef} onScroll={onScroll}>
          {messages.length === 0 && !isStreaming && (
            <div className="genie-welcome">
              <div className="genie-welcome-icon"><Sparkles size={26} strokeWidth={1.75} aria-hidden="true" /></div>
              <h3>Hello! I'm Genie</h3>
              <p>
                Your pharmacy assistant. Ask about your CD register, RP log, team,
                locum shifts and appointments. I can also set up shifts and manage
                appointments for you. You confirm every change.
              </p>
              {!patientDataOn && (
                <p className="genie-privacy-note">
                  Patient details are hidden from Genie. Please don't type patient names or details.
                </p>
              )}
              <div className="genie-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    className="genie-suggestion"
                    onClick={() => sendSuggestion(s.text)}
                    disabled={usedUp}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onRetry={handleRetry}
              actions={actions.filter((a) => a.message_id === msg.id)}
              onDecide={decide}
            />
          ))}

          {/* Streaming message */}
          {isStreaming && (
            <div className="genie-message genie-message-assistant">
              <div className="genie-message-avatar"><Sparkles size={16} strokeWidth={1.75} aria-hidden="true" /></div>
              <div className="genie-message-content">
                {streamingContent ? (
                  <div className="genie-message-text"><Markdown text={streamingContent} /></div>
                ) : (
                  <div className="genie-typing">
                    <span className="genie-typing-dot" />
                    <span className="genie-typing-dot" />
                    <span className="genie-typing-dot" />
                  </div>
                )}
                {streamingToolCalls.length > 0 && (
                  <div className="genie-tool-calls">
                    {streamingToolCalls.map((tc) => (
                      <div key={tc.id} className="genie-tool-call">
                        <span className="genie-tool-icon"><Wrench size={14} strokeWidth={1.75} aria-hidden="true" /></span>
                        <span className="genie-tool-name">{formatActiveToolName(tc.name)}</span>
                        <span className="genie-tool-spinner" />
                      </div>
                    ))}
                  </div>
                )}
                {pendingActions.map((a) => (
                  <ActionCard key={a.id} action={a} onDecide={decide} disabled />
                ))}
              </div>
            </div>
          )}

        </div>
        <JumpToLatest show={showJump} onClick={() => scrollToBottom(true)} />
        </div>
      )}

      {/* Input area */}
      <div className="genie-input-area">
        {lastError && !isStreaming && (
          <div className="genie-error-notice" role="alert">
            <span>{lastError}</span>
            <button type="button" onClick={handleRetry}>Retry</button>
          </div>
        )}
        {isStreaming && (
          <button className="genie-stop-btn" onClick={stopStreaming}>
            Stop
          </button>
        )}
        {pageTitle && (
          <div className="genie-page-chip" title="Genie knows which page you are on">
            <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
            <span>Using this page: {pageTitle}</span>
          </div>
        )}
        <div className="genie-input-wrapper">
          <textarea
            ref={inputRef}
            className="genie-input"
            placeholder={usedUp ? 'Monthly Genie allowance used' : 'Ask Genie anything...'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming || locked || usedUp}
          />
          <button
            className="genie-send-btn"
            aria-label="Send"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming || locked || usedUp}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          </button>
        </div>
        {!locked && (
          <div className="genie-footnote">
            Genie can make mistakes. Check answers and changes before you rely on them.
            {usage && usage.limit > 0 && (
              <> · {usage.used.toLocaleString('en-GB')} of {usage.limit.toLocaleString('en-GB')} questions used this month</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Sub-components
// ============================================

function ActionCard({
  action,
  onDecide,
  disabled = false,
}: {
  action: GenieAction
  onDecide: (id: string, decision: 'confirm' | 'cancel') => void
  disabled?: boolean
}) {
  const busy = action.status === 'running'
  const statusText: Record<string, string> = {
    done: 'Done',
    cancelled: 'Cancelled',
    failed: 'Not done',
    expired: 'Expired',
  }
  return (
    <div className={`genie-action genie-action-${action.status}`}>
      <div className="genie-action-summary">{action.summary}</div>
      {action.details.length > 0 && (
        <ul className="genie-action-details">
          {action.details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
      {action.status === 'pending' || busy ? (
        <>
          {action.result?.message && <div className="genie-action-result">{action.result.message}</div>}
          <div className="genie-action-buttons">
            <button
              type="button"
              className="ps-btn ps-btn-secondary"
              onClick={() => onDecide(action.id, 'cancel')}
              disabled={busy || disabled}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ps-btn ps-btn-primary"
              onClick={() => onDecide(action.id, 'confirm')}
              disabled={busy || disabled}
            >
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </div>
          {disabled && <div className="genie-action-result">You can confirm once Genie has finished.</div>}
        </>
      ) : (
        <div className="genie-action-result">
          <strong>{statusText[action.status] ?? action.status}</strong>
          {action.result?.message ? ` · ${action.result.message}` : ''}
          {action.status === 'done' && action.result?.link && (
            <> · <Link to={action.result.link}>Open</Link></>
          )}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  onRetry,
  actions,
  onDecide,
}: {
  message: ChatMessage
  onRetry: () => void
  actions: GenieAction[]
  onDecide: (id: string, decision: 'confirm' | 'cancel') => void
}) {
  const isUser = message.role === 'user'
  const isError = message.status === 'error'

  return (
    <div className={`genie-message genie-message-${message.role} ${isError ? 'error' : ''}`}>
      {!isUser && <div className="genie-message-avatar"><Sparkles size={16} strokeWidth={1.75} aria-hidden="true" /></div>}
      <div className="genie-message-content">
        <div className="genie-message-text">
          {isUser ? message.content : <Markdown text={message.content ?? ''} />}
        </div>
        {message.tool_calls && (message.tool_calls as { id: string; name: string }[]).length > 0 && (
          <div className="genie-tool-calls">
            {(message.tool_calls as { id: string; name: string }[]).map((tc) => (
              <div key={tc.id} className="genie-tool-call completed">
                <span className="genie-tool-icon"><CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="genie-tool-name">{formatToolName(tc.name)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="genie-message-meta">
          <span>{new Date(message.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          {!isUser && !isError && message.content && (
            <button type="button" onClick={() => navigator.clipboard?.writeText(message.content ?? '')}>Copy</button>
          )}
          {isError && <button type="button" onClick={onRetry}>Retry</button>}
        </div>
        {actions.map((a) => (
          <ActionCard key={a.id} action={a} onDecide={onDecide} />
        ))}
      </div>
      {isUser && <div className="genie-message-avatar genie-avatar-user"><User size={16} strokeWidth={1.75} aria-hidden="true" /></div>}
    </div>
  )
}

// ============================================
// Helpers
// ============================================

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatActiveToolName(name: string): string {
  const labels: Record<string, string> = {
    search_cd_register: 'Searching the CD register…',
    search_rp_log: 'Searching the RP log…',
    get_drug_info: 'Looking up drug information…',
    list_organisation_members: 'Checking organisation members…',
    get_register_balance: 'Checking the register balance…',
    list_locum_shifts: 'Checking locum shifts…',
    create_locum_shift: 'Preparing the shift…',
    update_locum_shift: 'Preparing the change…',
    cancel_locum_shift: 'Preparing the cancellation…',
    review_locum_application: 'Checking the application…',
    list_services: 'Checking your services…',
    list_appointment_slots: 'Checking appointment times…',
    create_appointment_slots: 'Preparing appointment times…',
    list_appointments: 'Checking appointments…',
    set_appointment_status: 'Preparing the change…',
    reschedule_appointment: 'Preparing the move…',
    find_patients: 'Finding the patient…',
    book_appointment: 'Preparing the booking…',
  }
  return labels[name] ?? `${formatToolName(name)}…`
}

// ============================================
// Page awareness
// ============================================

const PAGE_TITLES: [RegExp, string][] = [
  [/^\/shifts\/new/, 'New locum shift'],
  [/^\/shifts\/calendar/, 'Shift calendar'],
  [/^\/shifts\/locums/, 'Locum directory'],
  [/^\/shifts\/[0-9a-f-]{36}/, 'Shift details'],
  [/^\/shifts/, 'Locum shifts'],
  [/^\/appointments\/slots/, 'Appointment times'],
  [/^\/appointments\/calendar/, 'Appointment calendar'],
  [/^\/appointments\/new/, 'New appointment'],
  [/^\/appointments\/[0-9a-f-]{36}/, 'Appointment details'],
  [/^\/appointments/, 'Appointments'],
  [/^\/services/, 'Services'],
  [/^\/registers\/cd|^\/cd/, 'CD register'],
  [/^\/registers\/rp|^\/rp/, 'RP log'],
  [/^\/registers/, 'Registers'],
]

function headingText(): string {
  if (typeof document === 'undefined') return ''
  const h1 = document.querySelector('.dashboard-content h1')
  return (h1?.textContent ?? '').trim()
}

function pageTitleFor(path: string): string {
  const heading = headingText()
  if (heading) return heading.slice(0, 80)
  return PAGE_TITLES.find(([re]) => re.test(path))?.[1] ?? ''
}

/** What Genie is told about the page: path, title and the page's heading and intro. */
function readPageContext(path: string): GeniePageContext {
  const title = pageTitleFor(path) || document.title || path
  let details = ''
  if (typeof document !== 'undefined') {
    const header = document.querySelector('.dashboard-content .page-header, .dashboard-content header')
    details = (header?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  }
  return { path, title, details }
}

type Suggestion = { label: string; text: string }

function suggestionsFor(path: string): Suggestion[] {
  if (/^\/shifts\/[0-9a-f-]{36}/.test(path)) {
    return [
      { label: 'Summarise this shift', text: 'Summarise this shift and who has applied.' },
      { label: 'Change the rate', text: 'Change the rate on this shift to ' },
      { label: 'Cancel this shift', text: 'Cancel this shift.' },
    ]
  }
  if (path.startsWith('/shifts')) {
    return [
      { label: 'Upcoming shifts', text: 'Show our upcoming locum shifts and who is booked.' },
      { label: 'Applications to review', text: 'Which locum applications are waiting for a decision?' },
      { label: 'Post a shift', text: 'Create a locum shift next Saturday 09:00 to 17:00 at £45 an hour.' },
    ]
  }
  if (/^\/appointments\/[0-9a-f-]{36}/.test(path)) {
    return [
      { label: 'Mark completed', text: 'Mark this appointment as completed.' },
      { label: 'Move it', text: 'Move this appointment to the next free slot.' },
      { label: 'Cancel it', text: 'Cancel this appointment.' },
    ]
  }
  if (path.startsWith('/appointments') || path.startsWith('/services')) {
    return [
      { label: 'Today’s appointments', text: 'What appointments do we have today?' },
      { label: 'Free slots this week', text: 'Which appointment slots are still free this week?' },
      { label: 'Add slots', text: 'Add appointment slots for ' },
    ]
  }
  return [
    { label: 'Today’s CD entries', text: 'Show me today’s CD register entries.' },
    { label: 'Yesterday’s RP', text: 'Who was the RP yesterday?' },
    { label: 'Upcoming shifts', text: 'Show our upcoming locum shifts.' },
    { label: 'Today’s appointments', text: 'What appointments do we have today?' },
  ]
}
