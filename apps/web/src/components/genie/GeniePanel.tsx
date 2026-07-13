// ============================================
// Genie Chat Panel
// Floating chatbot panel anchored to the SideNav
// ============================================

import { useEffect, useRef, useState } from 'react'
import { useAuthStore, useChatStore } from '@pharmstation/core'
import type { ChatMessage, AIModel } from '@pharmstation/types'

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
    showSettings,
    modelsLoading,
    loadModels,
    loadConversations,
    loadOrgAISettings,
    orgAISettings,
    setActiveConversation,
    startNewConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    setShowHistory,
    setShowSettings,
  } = useChatStore()

  const { organisation, userSession } = useAuthStore()
  const [inputValue, setInputValue] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
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
    }
  }, [isOpen, organisation?.id])

  // Scroll to bottom on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [isOpen, activeConversationId])

  const sendText = async (text: string) => {
    if (!text || isStreaming || !organisation?.id || !userSession?.access_token) return
    await sendMessage({
      organisationId: organisation.id,
      message: text,
      modelId: selectedModelId ?? undefined,
      supabaseUrl,
      accessToken: userSession.access_token,
    })
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

  // Get active model info
  const activeModel = selectedModelId
    ? models.find((m) => m.id === selectedModelId)
    : orgAISettings?.standard_model_id
      ? models.find((m) => m.id === orgAISettings.standard_model_id)
      : models.find((m) => m.is_default && m.model_type === 'standard')

  if (!isOpen) return null

  return (
    <div className="genie-panel">
      {/* Header */}
      <div className="genie-header">
        <div className="genie-header-left">
          <span className="genie-header-icon">✨</span>
          <span className="genie-header-title">Genie</span>
          {activeModel && (
            <span className="genie-model-badge">{activeModel.display_name} · OpenRouter</span>
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
            onClick={() => { setShowHistory(!showHistory); setShowSettings(false) }}
            title="Chat history"
          >
            📋
          </button>
          <button
            className={`genie-icon-btn ${showSettings ? 'active' : ''}`}
            onClick={() => { setShowSettings(!showSettings); setShowHistory(false) }}
            title="Model settings"
          >
            ⚙️
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

      {/* Settings panel */}
      {showSettings && (
        <div className="genie-settings">
          <div className="genie-settings-header">Model Settings</div>
          <div className="genie-settings-body">
            <label className="genie-settings-label">Chat Model</label>
            <div className="genie-model-list">
              {models
                .filter((m) => m.model_type === 'standard')
                .map((model) => (
                  <ModelOption
                    key={model.id}
                    model={model}
                    isSelected={
                      selectedModelId
                        ? model.id === selectedModelId
                        : model.id === activeModel?.id
                    }
                    onSelect={() => setSelectedModelId(model.id)}
                  />
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      {!showHistory && !showSettings && (
        <div className="genie-messages">
          {messages.length === 0 && !isStreaming && (
            <div className="genie-welcome">
              <div className="genie-welcome-icon">✨</div>
              <h3>Hello! I'm Genie</h3>
              <p>
                Your pharmacy AI assistant. I can search registers, look up
                drugs, check stock, and answer compliance questions.
              </p>
              <div className="genie-suggestions">
                <button
                  className="genie-suggestion"
                  onClick={() => setInputValue('Show me today\'s CD register entries')}
                >
                  📑 Today's CD entries
                </button>
                <button
                  className="genie-suggestion"
                  onClick={() => setInputValue('Who was the RP yesterday?')}
                >
                  👤 Yesterday's RP
                </button>
                <button
                  className="genie-suggestion"
                  onClick={() => setInputValue('Check balance for morphine')}
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
                  <div className="genie-message-text">{streamingContent}</div>
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

          <div ref={messagesEndRef} />
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
            placeholder="Ask Genie anything..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="genie-send-btn"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
          >
            ➤
          </button>
        </div>
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
        <div className="genie-message-text">{message.content}</div>
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

function ModelOption({
  model,
  isSelected,
  onSelect,
}: {
  model: AIModel
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`genie-model-option ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span className="genie-model-provider-icon">
        🔀
      </span>
      <div className="genie-model-info">
        <span className="genie-model-name">{model.display_name}</span>
        <span className="genie-model-desc">
          OpenRouter ·{' '}
          ${model.input_cost_per_1k}/1k in · ${model.output_cost_per_1k}/1k out
        </span>
      </div>
      {isSelected && <span className="genie-model-check">✓</span>}
    </button>
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
