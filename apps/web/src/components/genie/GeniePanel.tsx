// ============================================
// Genie Chat Panel
// Floating chatbot panel anchored to the SideNav
// ============================================

import { useEffect, useRef, useState } from 'react'
import { PLANS, useAuthStore, useChatStore, useSubscriptionStore } from '@pharmstation/core'
import type { ChatMessage } from '@pharmstation/types'
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
  } = useChatStore()

  const { organisation, userSession } = useAuthStore()
  const planLoaded = useSubscriptionStore((s) => s.loaded)
  const plan = useSubscriptionStore((s) => s.plan)
  // Plan gate (only once billing is enforced). Before that every pharmacy gets the Essential allowance.
  const locked = PLANS_ENFORCED && planLoaded && PLANS[plan].genieMonthlyMessages <= 0
  const monthlyLimit = PLANS_ENFORCED ? PLANS[plan].genieMonthlyMessages : PLANS.essential.genieMonthlyMessages
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
    })
  }

  const sendSuggestion = (text: string) => {
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

  if (!isOpen) return null

  return (
    <div className="genie-panel">
      {/* Header */}
      <div className="genie-header">
        <div className="genie-header-left">
          <span className="genie-header-icon">✨</span>
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
          >
            ✏️
          </button>
          <button
            className={`genie-icon-btn ${showHistory ? 'active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title="Chat history"
          >
            📋
          </button>
          <button className="genie-icon-btn" onClick={toggleOpen} title="Close">
            ✕
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
                  >
                    🗑
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
            <div className="genie-welcome-icon">🔒</div>
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
              <div className="genie-welcome-icon">✨</div>
              <h3>Hello! I'm Genie</h3>
              <p>
                Your pharmacy assistant. I can search the CD register and RP
                log, check CD balances, look up controlled drugs and your team,
                and answer pharmacy questions.
              </p>
              {!patientDataOn && (
                <p className="genie-privacy-note">
                  Patient details are hidden from Genie. Please don't type patient names or details.
                </p>
              )}
              <div className="genie-suggestions">
                <button
                  className="genie-suggestion"
                  onClick={() => sendSuggestion('Show me today\'s CD register entries')}
                >
                  📑 Today's CD entries
                </button>
                <button
                  className="genie-suggestion"
                  onClick={() => sendSuggestion('Who was the RP yesterday?')}
                >
                  👤 Yesterday's RP
                </button>
                <button
                  className="genie-suggestion"
                  onClick={() => sendSuggestion('Check balance for morphine')}
                >
                  💊 Drug balance
                </button>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRetry={handleRetry} />
          ))}

          {/* Streaming message */}
          {isStreaming && (
            <div className="genie-message genie-message-assistant">
              <div className="genie-message-avatar">✨</div>
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
                        <span className="genie-tool-icon">🔧</span>
                        <span className="genie-tool-name">{formatActiveToolName(tc.name)}</span>
                        <span className="genie-tool-spinner" />
                      </div>
                    ))}
                  </div>
                )}
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
            ⏹ Stop
          </button>
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
            Genie can make mistakes. Check the register before acting.
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

function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  const isUser = message.role === 'user'
  const isError = message.status === 'error'

  return (
    <div className={`genie-message genie-message-${message.role} ${isError ? 'error' : ''}`}>
      {!isUser && <div className="genie-message-avatar">✨</div>}
      <div className="genie-message-content">
        <div className="genie-message-text">
          {isUser ? message.content : <Markdown text={message.content ?? ''} />}
        </div>
        {message.tool_calls && (message.tool_calls as { id: string; name: string }[]).length > 0 && (
          <div className="genie-tool-calls">
            {(message.tool_calls as { id: string; name: string }[]).map((tc) => (
              <div key={tc.id} className="genie-tool-call completed">
                <span className="genie-tool-icon">✅</span>
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
      </div>
      {isUser && <div className="genie-message-avatar genie-avatar-user">👤</div>}
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
  }
  return labels[name] ?? `${formatToolName(name)}…`
}
