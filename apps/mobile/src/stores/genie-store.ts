// ============================================
// Genie (mobile) — AI assistant store
//
// Same backend as the web panel: the `ai-chat` edge function streams the
// answer as server-sent events, and conversations live in
// ps_chat_conversations / ps_chat_messages (readable only by their owner).
// The server enforces the model, plan, monthly allowance, permissions and
// the patient-data switch; this store only displays what it is given.
// ============================================

import { create } from 'zustand'
import { fetch as streamingFetch } from 'expo/fetch'
import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

/** Monthly allowance shown before the server reports one (Essential plan). */
export const DEFAULT_GENIE_LIMIT = 300
export const COMPLETE_GENIE_LIMIT = 1500

export interface GenieConversation {
  id: string
  title: string
  updated_at: string
}

export interface GenieToolCall {
  id: string
  name: string
}

/** A photo or PDF sent with a question (stored in the genie-attachments bucket). */
export interface GenieAttachment {
  type: 'image' | 'pdf'
  /** Storage path: {user_id}/... */
  url: string
  name: string
  size?: number
  mime_type: string
  /** Local file for the thumbnail while the chat is open (never sent). */
  localUri?: string
}

const ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

/** Uploads a picked photo to the user's own folder. Throws a friendly message on failure. */
export async function uploadGenieAttachment(asset: {
  uri: string
  mimeType?: string | null
  fileName?: string | null
  fileSize?: number | null
}): Promise<GenieAttachment> {
  const userId = useAuthStore.getState().userSession?.user?.id
  if (!userId) throw new Error('Your session has ended. Please sign in again.')
  const mime = asset.mimeType || 'image/jpeg'
  if (!ATTACHMENT_MIME.includes(mime)) throw new Error('That file type can’t be attached. Use a photo (JPEG or PNG) or a PDF.')
  if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) throw new Error('That file is over 10 MB. Choose a smaller one.')
  const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1].replace('jpeg', 'jpg')
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = await (await fetch(asset.uri)).arrayBuffer()
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('That file is over 10 MB. Choose a smaller one.')
  const { error } = await userClient.storage.from('genie-attachments').upload(path, bytes, { contentType: mime, upsert: false })
  if (error) throw new Error('The file could not be uploaded. Please try again.')
  return {
    type: mime === 'application/pdf' ? 'pdf' : 'image',
    url: path,
    name: asset.fileName || (mime === 'application/pdf' ? 'Document.pdf' : 'Photo'),
    size: bytes.byteLength,
    mime_type: mime,
    localUri: asset.uri,
  }
}

export interface GenieMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: GenieAttachment[]
  status: 'completed' | 'error'
  error?: string | null
  toolCalls: GenieToolCall[]
  created_at: string
}

/** A change Genie proposed; nothing happens until the user confirms it. */
export interface GenieAction {
  id: string
  tool: string
  summary: string
  details: string[]
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed' | 'expired'
  result?: { message?: string; link?: string | null } | null
  message_id?: string | null
}

/** Where the user is in the app when they ask (sent to Genie as context). */
export interface GeniePageContext {
  path: string
  title: string
  details?: string
}

export interface GenieUsage {
  used: number
  limit: number
}

interface StreamEvent {
  type: string
  content?: string
  conversation_id?: string
  tool_call_id?: string
  tool_name?: string
  message_id?: string
  usage?: GenieUsage
  error?: string
  action?: GenieAction
}

interface GenieState {
  /** Pharmacy the loaded data belongs to; switching pharmacy clears it. */
  orgId: string | null
  conversations: GenieConversation[]
  conversationsLoading: boolean
  activeConversationId: string | null
  messages: GenieMessage[]
  messagesLoading: boolean

  isStreaming: boolean
  streamingContent: string
  streamingTools: GenieToolCall[]
  abort: AbortController | null

  usage: GenieUsage | null
  patientDataOn: boolean
  lastError: string | null
  /** Proposed changes (confirm cards) in the open chat. */
  actions: GenieAction[]

  /** Clears everything if the pharmacy changed. */
  selectOrg: (orgId: string) => void
  loadOverview: (orgId: string) => Promise<void>
  loadConversations: (orgId: string) => Promise<void>
  openConversation: (id: string) => Promise<void>
  newConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  send: (orgId: string, text: string, context?: GeniePageContext | null, attachments?: GenieAttachment[]) => Promise<void>
  decideAction: (actionId: string, decision: 'confirm' | 'cancel') => Promise<void>
  stop: () => void
  reset: () => void
}

/** First day of this month in the UK, as YYYY-MM-01. */
function ukMonthStart(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  return `${year}-${month}-01`
}

function rowToMessage(row: {
  id: string
  role: string
  content: string | null
  status: string
  error_message: string | null
  tool_calls: { id: string; name: string }[] | null
  attachments?: GenieAttachment[] | null
  created_at: string
}): GenieMessage {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content ?? '',
    status: row.status === 'error' ? 'error' : 'completed',
    error: row.error_message,
    toolCalls: (row.tool_calls ?? []).map((t) => ({ id: t.id, name: t.name })),
    attachments: row.attachments ?? [],
    created_at: row.created_at,
  }
}

const initial = {
  orgId: null as string | null,
  conversations: [] as GenieConversation[],
  conversationsLoading: false,
  activeConversationId: null as string | null,
  messages: [] as GenieMessage[],
  messagesLoading: false,
  isStreaming: false,
  streamingContent: '',
  streamingTools: [] as GenieToolCall[],
  abort: null as AbortController | null,
  usage: null as GenieUsage | null,
  patientDataOn: false,
  lastError: null as string | null,
  actions: [] as GenieAction[],
}

export const useGenieStore = create<GenieState>((set, get) => ({
  ...initial,

  selectOrg: (orgId) => {
    if (get().orgId === orgId) return
    get().abort?.abort()
    set({ ...initial, orgId })
  },

  loadOverview: async (orgId) => {
    const [{ data: usageRow }, { data: settings }, { data: effectivePlan }] = await Promise.all([
      userClient
        .from('ps_ai_usage_monthly')
        .select('messages')
        .eq('organisation_id', orgId)
        .eq('month', ukMonthStart())
        .maybeSingle(),
      userClient
        .from('ps_ai_org_settings')
        .select('genie_patient_data')
        .eq('organisation_id', orgId)
        .maybeSingle(),
      userClient.rpc('ps_org_effective_plan', { p_org_id: orgId }),
    ])
    // Same rule as the server: Complete (including complimentary upgrades) gets the larger
    // allowance; everyone else gets at least the Essential allowance until plans are enforced.
    const planLimit = effectivePlan === 'complete' ? COMPLETE_GENIE_LIMIT : DEFAULT_GENIE_LIMIT
    set({
      usage: {
        used: (usageRow as { messages: number } | null)?.messages ?? 0,
        limit: planLimit,
      },
      patientDataOn: (settings as { genie_patient_data?: boolean } | null)?.genie_patient_data === true,
    })
  },

  loadConversations: async (orgId) => {
    set({ conversationsLoading: true })
    const { data, error } = await userClient
      .from('ps_chat_conversations')
      .select('id, title, updated_at')
      .eq('organisation_id', orgId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(50)
    set({
      conversations: error ? get().conversations : ((data ?? []) as GenieConversation[]),
      conversationsLoading: false,
    })
  },

  openConversation: async (id) => {
    get().abort?.abort()
    set({ activeConversationId: id, messages: [], actions: [], messagesLoading: true, lastError: null })
    const [{ data, error }, { data: actions }] = await Promise.all([
      userClient
        .from('ps_chat_messages')
        .select('id, role, content, status, error_message, tool_calls, attachments, created_at')
        .eq('conversation_id', id)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true }),
      userClient
        .from('ps_genie_actions')
        .select('id, tool, summary, details, status, result, message_id')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
    ])
    if (get().activeConversationId !== id) return
    set({
      actions: (actions as GenieAction[] | null) ?? [],
      messages: error ? [] : (data ?? []).map(rowToMessage),
      messagesLoading: false,
      lastError: error ? 'Could not load this chat.' : null,
    })
  },

  newConversation: () => {
    get().abort?.abort()
    set({
      activeConversationId: null,
      messages: [],
      actions: [],
      isStreaming: false,
      streamingContent: '',
      streamingTools: [],
      lastError: null,
    })
  },

  deleteConversation: async (id) => {
    const { error } = await userClient.from('ps_chat_conversations').delete().eq('id', id)
    if (error) return
    set({ conversations: get().conversations.filter((c) => c.id !== id) })
    if (get().activeConversationId === id) get().newConversation()
  },

  send: async (orgId, text, context, attachments = []) => {
    const message = text.trim()
    if ((!message && attachments.length === 0) || get().isStreaming) return
    const token = useAuthStore.getState().userSession?.access_token
    if (!token) {
      set({ lastError: 'Your session has ended. Please sign in again.' })
      return
    }

    const startedIn = get().activeConversationId
    const now = new Date().toISOString()
    const abort = new AbortController()
    set({
      messages: [
        ...get().messages,
        { id: `local-${Date.now()}`, role: 'user', content: message, attachments, status: 'completed', toolCalls: [], created_at: now },
      ],
      isStreaming: true,
      streamingContent: '',
      streamingTools: [],
      lastError: null,
      abort,
    })

    let content = ''
    let finished = false
    const fail = (error: string) => {
      set({
        messages: [
          ...get().messages,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: 'Genie could not complete that request.',
            status: 'error',
            error,
            toolCalls: [],
            created_at: new Date().toISOString(),
          },
        ],
        lastError: error,
      })
    }

    try {
      const response = await streamingFetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organisation_id: orgId,
          message,
          ...(startedIn ? { conversation_id: startedIn } : {}),
          ...(context ? { page_context: context } : {}),
          ...(attachments.length ? { attachments: attachments.map(({ localUri: _local, ...a }) => a) } : {}),
        }),
        signal: abort.signal,
      })

      if (!response.ok) {
        let error = 'Genie could not start this request. Please try again.'
        try {
          const parsed = JSON.parse(await response.text())
          if (typeof parsed.error === 'string') error = parsed.error
          if (parsed.usage && typeof parsed.usage.used === 'number') set({ usage: parsed.usage })
        } catch {
          // keep the friendly fallback
        }
        fail(error)
        return
      }
      if (!response.body) throw new Error('No response from Genie.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case 'conversation_created':
            if (event.conversation_id) set({ activeConversationId: event.conversation_id })
            break
          case 'text_delta':
            content += event.content ?? ''
            set({ streamingContent: content })
            break
          case 'action_proposed':
            if (event.action) set({ actions: [...get().actions, { ...event.action, message_id: null }] })
            break
          case 'tool_call_start':
            set({ streamingTools: [...get().streamingTools, { id: event.tool_call_id ?? '', name: event.tool_name ?? '' }] })
            break
          case 'done': {
            finished = true
            const answerId = event.message_id ?? `answer-${Date.now()}`
            set({
              actions: get().actions.map((a) => (a.message_id ? a : { ...a, message_id: answerId })),
              messages: [
                ...get().messages,
                {
                  id: answerId,
                  role: 'assistant',
                  content,
                  status: 'completed',
                  toolCalls: get().streamingTools,
                  created_at: new Date().toISOString(),
                },
              ],
              ...(event.usage ? { usage: event.usage } : {}),
            })
            break
          }
          case 'error':
            finished = true
            fail(event.error ?? 'Genie could not complete this request.')
            break
        }
      }

      const drain = (flush: boolean) => {
        const lines = buffer.split('\n')
        buffer = flush ? '' : (lines.pop() ?? '')
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '')
          if (!line.startsWith('data: ')) continue
          try {
            handle(JSON.parse(line.slice(6)) as StreamEvent)
          } catch {
            // ignore a malformed line
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        drain(false)
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        buffer += '\n'
        drain(true)
      }

      if (!finished) fail('The connection ended before Genie finished. Please try again.')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        fail('Genie could not be reached. Check your connection and try again.')
      }
    } finally {
      set({ isStreaming: false, streamingContent: '', streamingTools: [], abort: null })
      void get().loadConversations(orgId)
    }
  },

  decideAction: async (actionId, decision) => {
    const patch = (changes: Partial<GenieAction>) =>
      set({ actions: get().actions.map((a) => (a.id === actionId ? { ...a, ...changes } : a)) })
    const token = useAuthStore.getState().userSession?.access_token
    if (!token) {
      patch({ result: { message: 'Your session has ended. Please sign in again.' } })
      return
    }
    patch({ status: 'running' })
    try {
      const response = await streamingFetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action_id: actionId, decision }),
      })
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(await response.text())
      } catch {
        // keep defaults
      }
      patch({
        status: (body.status as GenieAction['status']) ?? (response.ok ? 'done' : 'failed'),
        result: {
          message: (body.message as string) ?? (body.error as string) ?? (response.ok ? undefined : 'That change could not be made.'),
          link: (body.link as string) ?? null,
        },
      })
    } catch {
      patch({ status: 'pending', result: { message: 'Genie could not be reached. Check your connection and try again.' } })
    }
  },

  stop: () => {
    get().abort?.abort()
    set({ isStreaming: false })
  },

  reset: () => {
    get().abort?.abort()
    set({ ...initial })
  },
}))
