// ============================================
// Chat Store — Zustand
// Manages Genie conversations, messages, models
// ============================================

import { create } from 'zustand'
import type {
  AIModel,
  AIOrgSettings,
  ChatConversation,
  ChatMessage,
  ChatAttachment,
  ChatStreamEvent,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface ChatState {
  // Models
  models: AIModel[]
  modelsLoading: boolean
  orgAISettings: AIOrgSettings | null

  // Conversations
  conversations: ChatConversation[]
  conversationsLoading: boolean
  activeConversationId: string | null

  // Messages
  messages: ChatMessage[]
  messagesLoading: boolean

  // Streaming state
  isStreaming: boolean
  streamingContent: string
  streamingToolCalls: { id: string; name: string; arguments: string }[]

  // UI
  isOpen: boolean
  showSettings: boolean
  showHistory: boolean

  // Actions
  loadModels: () => Promise<void>
  loadOrgAISettings: (orgId: string) => Promise<void>
  loadConversations: (orgId: string) => Promise<void>
  loadMessages: (conversationId: string) => Promise<void>
  setActiveConversation: (id: string | null) => void
  startNewConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  sendMessage: (params: {
    organisationId: string
    message: string
    attachments?: ChatAttachment[]
    modelId?: string
    supabaseUrl: string
    accessToken: string
  }) => Promise<void>
  stopStreaming: () => void
  toggleOpen: () => void
  setShowSettings: (show: boolean) => void
  setShowHistory: (show: boolean) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  models: [],
  modelsLoading: false,
  orgAISettings: null,

  conversations: [],
  conversationsLoading: false,
  activeConversationId: null,

  messages: [],
  messagesLoading: false,

  isStreaming: false,
  streamingContent: '',
  streamingToolCalls: [],

  isOpen: false,
  showSettings: false,
  showHistory: false,

  // ============================================
  // Load available AI models
  // ============================================
  loadModels: async () => {
    set({ modelsLoading: true })
    try {
      const { data, error } = await getUserClient()
        .from('ps_ai_models')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (error) throw error
      set({ models: (data as AIModel[]) ?? [] })
    } catch (err) {
      console.error('Failed to load AI models:', err)
    } finally {
      set({ modelsLoading: false })
    }
  },

  // ============================================
  // Load org AI settings
  // ============================================
  loadOrgAISettings: async (orgId: string) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_ai_org_settings')
        .select('*')
        .eq('organisation_id', orgId)
        .maybeSingle()

      if (error) throw error
      set({ orgAISettings: data as AIOrgSettings | null })
    } catch (err) {
      console.error('Failed to load org AI settings:', err)
    }
  },

  // ============================================
  // Load conversation list
  // ============================================
  loadConversations: async (orgId: string) => {
    set({ conversationsLoading: true })
    try {
      const { data, error } = await getUserClient()
        .from('ps_chat_conversations')
        .select('*')
        .eq('organisation_id', orgId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(50)

      if (error) throw error
      set({ conversations: (data as ChatConversation[]) ?? [] })
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      set({ conversationsLoading: false })
    }
  },

  // ============================================
  // Load messages for a conversation
  // ============================================
  loadMessages: async (conversationId: string) => {
    set({ messagesLoading: true, activeConversationId: conversationId })
    try {
      const { data, error } = await getUserClient()
        .from('ps_chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      set({ messages: (data as ChatMessage[]) ?? [] })
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      set({ messagesLoading: false })
    }
  },

  // ============================================
  // Set active conversation
  // ============================================
  setActiveConversation: (id: string | null) => {
    set({ activeConversationId: id, messages: [], showHistory: false })
    if (id) {
      get().loadMessages(id)
    }
  },

  // ============================================
  // Start new conversation
  // ============================================
  startNewConversation: () => {
    set({
      activeConversationId: null,
      messages: [],
      streamingContent: '',
      streamingToolCalls: [],
      showHistory: false,
    })
  },

  // ============================================
  // Delete conversation
  // ============================================
  deleteConversation: async (id: string) => {
    try {
      const { error } = await getUserClient()
        .from('ps_chat_conversations')
        .delete()
        .eq('id', id)

      if (error) throw error

      const { conversations, activeConversationId } = get()
      set({
        conversations: conversations.filter((c) => c.id !== id),
        ...(activeConversationId === id
          ? { activeConversationId: null, messages: [] }
          : {}),
      })
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  },

  // ============================================
  // Rename conversation
  // ============================================
  renameConversation: async (id: string, title: string) => {
    try {
      const { error } = await getUserClient()
        .from('ps_chat_conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error

      set({
        conversations: get().conversations.map((c) =>
          c.id === id ? { ...c, title } : c,
        ),
      })
    } catch (err) {
      console.error('Failed to rename conversation:', err)
    }
  },

  // ============================================
  // Send message — streams response from edge function
  // ============================================
  sendMessage: async ({
    organisationId,
    message,
    attachments,
    modelId,
    supabaseUrl,
    accessToken,
  }) => {
    const { activeConversationId, messages } = get()

    // Optimistic: add user message to UI
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversation_id: activeConversationId ?? '',
      role: 'user',
      content: message,
      tool_calls: null,
      tool_call_id: null,
      tool_name: null,
      attachments: attachments ?? [],
      input_tokens: null,
      output_tokens: null,
      model_provider: null,
      model_id_str: null,
      status: 'completed',
      error_message: null,
      created_at: new Date().toISOString(),
    }

    set({
      messages: [...messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      streamingToolCalls: [],
    })

    let abortController: AbortController | null = new AbortController()

    // Store abort controller for stopStreaming
    ;(get() as unknown as { _abortController: AbortController })._abortController =
      abortController

    try {
      const body: Record<string, unknown> = {
        organisation_id: organisationId,
        message,
        attachments: attachments ?? [],
      }

      if (activeConversationId) {
        body.conversation_id = activeConversationId
      }
      if (modelId) {
        body.model_id = modelId
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || `HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let newConversationId = activeConversationId

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue

          try {
            const event: ChatStreamEvent = JSON.parse(jsonStr)

            switch (event.type) {
              case 'conversation_created':
                newConversationId = event.conversation_id ?? null
                set({ activeConversationId: newConversationId })
                break

              case 'text_delta':
                accumulatedContent += event.content ?? ''
                set({ streamingContent: accumulatedContent })
                break

              case 'tool_call_start':
                set({
                  streamingToolCalls: [
                    ...get().streamingToolCalls,
                    {
                      id: event.tool_call_id ?? '',
                      name: event.tool_name ?? '',
                      arguments: '',
                    },
                  ],
                })
                break

              case 'tool_call_delta':
                set({
                  streamingToolCalls: get().streamingToolCalls.map((tc) =>
                    tc.id === event.tool_call_id
                      ? { ...tc, arguments: tc.arguments + (event.tool_arguments ?? '') }
                      : tc,
                  ),
                })
                break

              case 'tool_result':
                // Tool result received — could display in UI
                break

              case 'done': {
                // Build the final assistant message
                const assistantMsg: ChatMessage = {
                  id: event.message_id ?? crypto.randomUUID(),
                  conversation_id: newConversationId ?? '',
                  role: 'assistant',
                  content: accumulatedContent || null,
                  tool_calls:
                    get().streamingToolCalls.length > 0
                      ? get().streamingToolCalls
                      : null,
                  tool_call_id: null,
                  tool_name: null,
                  attachments: [],
                  input_tokens: event.input_tokens ?? null,
                  output_tokens: event.output_tokens ?? null,
                  model_provider: null,
                  model_id_str: null,
                  status: 'completed',
                  error_message: null,
                  created_at: new Date().toISOString(),
                }

                set({
                  messages: [...get().messages, assistantMsg],
                  isStreaming: false,
                  streamingContent: '',
                  streamingToolCalls: [],
                })
                break
              }

              case 'error':
                set({
                  isStreaming: false,
                  streamingContent: '',
                  messages: [
                    ...get().messages,
                    {
                      id: crypto.randomUUID(),
                      conversation_id: newConversationId ?? '',
                      role: 'assistant',
                      content: `Error: ${event.error ?? 'Unknown error'}`,
                      tool_calls: null,
                      tool_call_id: null,
                      tool_name: null,
                      attachments: [],
                      input_tokens: null,
                      output_tokens: null,
                      model_provider: null,
                      model_id_str: null,
                      status: 'error',
                      error_message: event.error ?? null,
                      created_at: new Date().toISOString(),
                    },
                  ],
                })
                break
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Reload conversations to get the new/updated one
      if (organisationId) {
        get().loadConversations(organisationId)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        set({ isStreaming: false })
        return
      }
      set({
        isStreaming: false,
        streamingContent: '',
        messages: [
          ...get().messages,
          {
            id: crypto.randomUUID(),
            conversation_id: activeConversationId ?? '',
            role: 'assistant',
            content: `Error: ${(err as Error).message}`,
            tool_calls: null,
            tool_call_id: null,
            tool_name: null,
            attachments: [],
            input_tokens: null,
            output_tokens: null,
            model_provider: null,
            model_id_str: null,
            status: 'error',
            error_message: (err as Error).message,
            created_at: new Date().toISOString(),
          },
        ],
      })
    } finally {
      abortController = null
    }
  },

  // ============================================
  // Stop streaming
  // ============================================
  stopStreaming: () => {
    const ctrl = (get() as unknown as { _abortController?: AbortController })
      ._abortController
    if (ctrl) ctrl.abort()
    set({ isStreaming: false })
  },

  // ============================================
  // UI
  // ============================================
  toggleOpen: () => set({ isOpen: !get().isOpen }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowHistory: (show) => set({ showHistory: show }),

  reset: () =>
    set({
      conversations: [],
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      streamingContent: '',
      streamingToolCalls: [],
      isOpen: false,
      showSettings: false,
      showHistory: false,
    }),
}))
