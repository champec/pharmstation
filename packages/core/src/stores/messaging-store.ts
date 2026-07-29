import { create } from 'zustand'
import type {
  NotifyMessage,
  Broadcast,
  MessageChannel,
  MessagingProvider,
  SmsSettings,
  SmsTemplate,
  SmsInbound,
  SmsInboundDisposition,
  SmsSenderControl,
  SmsSenderControlStatus,
  SmsUsageSummary,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ============================================
// Messaging Store — handles messages, broadcasts, settings, edge function calls
//
// Provider routing (post GOV Notify rejection):
//   • SMS        → sms-works edge fn (platform SMS Works account) for everyone,
//                  unless the org is NHS-affiliated with messaging_provider='nhs_notify'.
//   • email/letter → nhs-notify edge fn, ONLY for orgs with nhs_channels_enabled
//                  (NHS-funded / hospital / military / prison pharmacies).
// The public `notify` / `sendMessage` / `sendBroadcast` signatures are unchanged,
// so feature callers (appointments, video, reminders, delivery) need no edits.
// ============================================

export interface NotifySettingsSafe {
  id: string
  org_id: string
  sms_template_id: string | null
  email_template_id: string | null
  letter_template_id: string | null
  is_active: boolean
  last_tested_at: string | null
  created_at: string
  has_api_key: boolean
  callback_token: string | null
}

export interface CallbackInfo {
  callback_url: string
  callback_token: string | null
}

/**
 * Parameters for the reusable "plug & play" functional notification helper.
 * Any feature (appointments, video consults, reminders, urgent alerts, …)
 * can fire a message through the org's NHS Notify account with one call.
 */
export interface NotifyParams {
  org_id: string
  channel: MessageChannel
  /** phone (sms) or email address (email). Omit to resolve from patient_id. */
  to?: string
  /** GOV.UK Notify address lines for letters. */
  address?: Record<string, string>
  /** When set (and `to`/`address` omitted) the recipient is resolved from the patient. */
  patient_id?: string
  subject?: string
  body?: string
  /** SMS Works: render a pharmacy-authored ps_sms_templates row instead of a raw body. */
  template_id?: string
  /** Values for {{placeholders}} when template_id is used. */
  personalisation?: Record<string, unknown>
  /** Tags the message for analytics/audit, e.g. 'appointment' | 'video' | 'reminder' | 'urgent'. */
  feature?: string
  /** Optional provider reference; defaults to `feature:patient_id`. */
  reference?: string
}

export interface MessageStats {
  today: number
  thisWeek: number
  thisMonth: number
  deliveryRate: number
}

/** Cached per-org routing decision (ps_organisations.messaging_provider / nhs_channels_enabled). */
export interface OrgMessagingRouting {
  provider: MessagingProvider
  nhsChannelsEnabled: boolean
}

export interface SmsConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  timestamp: string
  status?: string
  isRead?: boolean
}

export interface MessagingState {
  // Data
  messages: NotifyMessage[]
  broadcasts: Broadcast[]
  settings: NotifySettingsSafe | null
  stats: MessageStats | null
  loading: boolean
  error: string | null

  // SMS Works data
  smsSettings: SmsSettings | null
  smsTemplates: SmsTemplate[]
  inbound: SmsInbound[]
  smsThread: SmsConversationMessage[]
  smsSenderControls: SmsSenderControl[]
  unreadInboundCount: number
  usage: SmsUsageSummary[]
  routing: OrgMessagingRouting | null
  _inboundRealtimeChannel: RealtimeChannel | null

  // Actions
  fetchRouting: (orgId: string) => Promise<OrgMessagingRouting>
  fetchSettings: (orgId: string) => Promise<void>
  fetchMessages: (orgId: string, filters?: {
    channel?: MessageChannel
    status?: string
    fromDate?: string
    toDate?: string
    search?: string
    page?: number
    pageSize?: number
  }) => Promise<void>
  fetchBroadcasts: (orgId: string) => Promise<void>
  fetchStats: (orgId: string) => Promise<void>

  // Edge function calls
  sendMessage: (params: {
    action: 'send_sms' | 'send_email' | 'send_letter'
    org_id: string
    phone_number?: string
    email_address?: string
    address?: Record<string, string>
    subject?: string
    body: string
    patient_id?: string
    template_id?: string
    personalisation?: Record<string, unknown>
  }) => Promise<NotifyMessage>
  /** Reusable functional notification — the plug & play hook for any feature. */
  notify: (params: NotifyParams) => Promise<NotifyMessage>
  createBroadcast: (broadcast: Partial<Broadcast>) => Promise<Broadcast>
  sendBroadcast: (orgId: string, broadcastId: string) => Promise<{ sent_count: number; failed_count: number; total_count: number }>
  checkStatus: (orgId: string, messageId: string) => Promise<{ status: string }>
  testConnection: (orgId: string, apiKey?: string) => Promise<{ valid: boolean; templates?: Array<{ id: string; name: string; type: string }>; error?: string }>
  getCallbackInfo: (orgId: string) => Promise<CallbackInfo>
  saveSettings: (params: {
    org_id: string
    api_key?: string
    sms_template_id?: string
    email_template_id?: string
    letter_template_id?: string
    is_active?: boolean
  }) => Promise<void>
  getRecipientCount: (orgId: string, channel: MessageChannel, recipientFilter?: string) => Promise<number>

  // SMS Works actions
  fetchSmsSettings: (orgId: string) => Promise<void>
  saveSmsSettings: (params: {
    org_id: string
    sender_type?: 'alpha' | 'number'
    sender_id?: string
    signature?: string
    reply_forward_email?: string
    is_active?: boolean
    inbound_filter_mode?: 'open' | 'filtered' | 'approved_only'
    inbound_rate_limit_count?: number
    inbound_rate_limit_minutes?: number
  }) => Promise<void>
  testSmsConnection: (orgId: string) => Promise<{ valid: boolean; balance?: number | null; error?: string }>
  fetchSmsTemplates: (orgId: string) => Promise<void>
  saveSmsTemplate: (params: {
    org_id: string
    id?: string
    name?: string
    category?: string
    body?: string
    description?: string
    is_active?: boolean
  }) => Promise<SmsTemplate>
  deleteSmsTemplate: (orgId: string, templateId: string) => Promise<void>
  assignReplyNumber: (orgId: string) => Promise<{ assigned: boolean; phone_number?: string; pending_provisioning?: boolean; message?: string }>
  releaseReplyNumber: (orgId: string) => Promise<void>
  fetchInbound: (orgId: string, opts?: { unreadOnly?: boolean; limit?: number; disposition?: SmsInboundDisposition }) => Promise<void>
  markInboundRead: (orgId: string, inboundId: string) => Promise<void>
  markSmsConversationRead: (orgId: string, phoneNumber: string) => Promise<void>
  fetchSmsThread: (orgId: string, phoneNumber: string) => Promise<void>
  sendSmsReply: (params: { orgId: string; phoneNumber: string; patientId?: string; body: string }) => Promise<void>
  fetchSmsSenderControls: (orgId: string) => Promise<void>
  setSmsSenderControl: (params: {
    orgId: string
    phoneNumber: string
    status: SmsSenderControlStatus | null
    mutedUntil?: string | null
    reason?: string
    userId?: string
  }) => Promise<void>
  linkSmsSenderToPatient: (orgId: string, phoneNumber: string, patientId: string) => Promise<void>
  subscribeToInbound: (orgId: string) => void
  unsubscribeFromInbound: () => void
  fetchSmsUsage: (orgId: string) => Promise<void>
  clearError: () => void
}

// ============================================
// Edge function helpers + provider routing
// ============================================

type EdgeFn = 'nhs-notify' | 'sms-works'

async function callEdgeFunction(fn: EdgeFn, action: string, params: Record<string, unknown>) {
  const client = getUserClient()
  const { data: { session } } = await client.auth.getSession()

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, ...params }),
    },
  )

  const result = await res.json()
  if (result.error) throw new Error(result.error)
  return result
}

// Back-compat alias used by NHS Notify-only actions.
const callNotifyFunction = (action: string, params: Record<string, unknown>) =>
  callEdgeFunction('nhs-notify', action, params)

// Per-org routing cache (module scope — survives across store consumers).
const routingCache = new Map<string, OrgMessagingRouting>()

async function resolveRouting(orgId: string): Promise<OrgMessagingRouting> {
  const cached = routingCache.get(orgId)
  if (cached) return cached
  const { data } = await getUserClient()
    .from('ps_organisations')
    .select('messaging_provider, nhs_channels_enabled')
    .eq('id', orgId)
    .maybeSingle()
  const routing: OrgMessagingRouting = {
    provider: (data?.messaging_provider as MessagingProvider) || 'smsworks',
    nhsChannelsEnabled: Boolean(data?.nhs_channels_enabled),
  }
  routingCache.set(orgId, routing)
  return routing
}

/** Which edge function should deliver a message on this channel for this org? */
async function resolveFnForChannel(orgId: string, channel: MessageChannel): Promise<EdgeFn> {
  const routing = await resolveRouting(orgId)
  if (channel === 'sms') {
    return routing.provider === 'nhs_notify' && routing.nhsChannelsEnabled ? 'nhs-notify' : 'sms-works'
  }
  // email / letter are NHS Notify-only capabilities.
  if (!routing.nhsChannelsEnabled) {
    throw new Error(
      `${channel === 'email' ? 'Email' : 'Letter'} messaging is only available to NHS-affiliated pharmacies ` +
      '(NHS-funded, hospital, military or prison). Please use SMS instead.',
    )
  }
  return 'nhs-notify'
}

export const useMessagingStore = create<MessagingState>((set, get) => ({
  messages: [],
  broadcasts: [],
  settings: null,
  stats: null,
  loading: false,
  error: null,

  smsSettings: null,
  smsTemplates: [],
  inbound: [],
  smsThread: [],
  smsSenderControls: [],
  unreadInboundCount: 0,
  usage: [],
  routing: null,
  _inboundRealtimeChannel: null,

  fetchRouting: async (orgId) => {
    const routing = await resolveRouting(orgId)
    set({ routing })
    return routing
  },

  fetchSettings: async (orgId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_notify_settings_safe')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      set({ settings: data as NotifySettingsSafe | null })
    } catch (e: unknown) {
      // No settings yet — that's fine
      set({ settings: null })
    }
  },

  fetchMessages: async (orgId, filters = {}) => {
    set({ loading: true, error: null })
    try {
      const { channel, status, fromDate, toDate, search, page = 0, pageSize = 50 } = filters
      let query = getUserClient()
        .from('ps_messages')
        .select('*, patient:ps_patients(id, first_name, last_name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (channel) query = query.eq('channel', channel)
      if (status) query = query.eq('status', status)
      if (fromDate) query = query.gte('created_at', fromDate)
      if (toDate) query = query.lte('created_at', toDate)
      if (search) {
        query = query.or(`recipient_phone.ilike.%${search}%,recipient_email.ilike.%${search}%,body.ilike.%${search}%`)
      }

      const from = page * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error } = await query
      if (error) throw error
      set({ messages: (data ?? []) as NotifyMessage[], loading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to fetch messages', loading: false })
    }
  },

  fetchBroadcasts: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_broadcasts')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (error) throw error
      set({ broadcasts: (data ?? []) as Broadcast[], loading: false })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : 'Failed to fetch broadcasts', loading: false })
    }
  },

  fetchStats: async (orgId) => {
    try {
      const client = getUserClient()
      const now = new Date()

      // Today
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const { count: todayCount } = await client
        .from('ps_messages')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .gte('created_at', todayStart)

      // This week
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - now.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const { count: weekCount } = await client
        .from('ps_messages')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .gte('created_at', weekStart.toISOString())

      // This month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const { count: monthCount } = await client
        .from('ps_messages')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .gte('created_at', monthStart)

      // Delivery rate
      const { count: totalSent } = await client
        .from('ps_messages')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .not('status', 'in', '("pending")')

      const { count: deliveredCount } = await client
        .from('ps_messages')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'delivered')

      const deliveryRate = totalSent && totalSent > 0
        ? Math.round(((deliveredCount || 0) / totalSent) * 100)
        : 0

      set({
        stats: {
          today: todayCount || 0,
          thisWeek: weekCount || 0,
          thisMonth: monthCount || 0,
          deliveryRate,
        },
      })
    } catch {
      // Stats are non-critical
    }
  },

  sendMessage: async (params) => {
    const channel: MessageChannel =
      params.action === 'send_sms' ? 'sms' : params.action === 'send_email' ? 'email' : 'letter'
    const fn = await resolveFnForChannel(params.org_id, channel)
    const result = await callEdgeFunction(fn, params.action, params)
    // Add to local messages
    set((s) => ({ messages: [result as NotifyMessage, ...s.messages] }))
    return result as NotifyMessage
  },

  notify: async (params) => {
    const fn = await resolveFnForChannel(params.org_id, params.channel)
    const result = await callEdgeFunction(fn, 'notify', params as unknown as Record<string, unknown>)
    set((s) => ({ messages: [result as NotifyMessage, ...s.messages] }))
    return result as NotifyMessage
  },

  createBroadcast: async (broadcast) => {
    const { data, error } = await getUserClient()
      .from('ps_broadcasts')
      .insert(broadcast)
      .select()
      .single()

    if (error) throw new Error(error.message)
    const created = data as Broadcast
    set((s) => ({ broadcasts: [created, ...s.broadcasts] }))
    return created
  },

  sendBroadcast: async (orgId, broadcastId) => {
    // Route on the broadcast's channel (sms → provider routing; email/letter → NHS Notify, gated).
    let broadcast = get().broadcasts.find((b) => b.id === broadcastId)
    if (!broadcast) {
      const { data } = await getUserClient()
        .from('ps_broadcasts').select('*').eq('id', broadcastId).maybeSingle()
      broadcast = (data ?? undefined) as Broadcast | undefined
    }
    const channel: MessageChannel = broadcast?.channel ?? 'sms'
    const fn = await resolveFnForChannel(orgId, channel)
    const result = await callEdgeFunction(fn, 'send_broadcast', { org_id: orgId, broadcast_id: broadcastId })

    // Update broadcast in local state
    set((s) => ({
      broadcasts: s.broadcasts.map((b) =>
        b.id === broadcastId
          ? { ...b, status: result.status as Broadcast['status'], sent_count: result.sent_count, failed_count: result.failed_count, total_count: result.total_count }
          : b
      ),
    }))

    return result
  },

  checkStatus: async (orgId, messageId) => {
    // Route on the message's provider (falls back to a DB lookup, then org routing).
    let provider = get().messages.find((m) => m.id === messageId)?.provider
    if (!provider) {
      const { data } = await getUserClient()
        .from('ps_messages').select('provider').eq('id', messageId).maybeSingle()
      provider = (data?.provider as MessagingProvider | undefined)
    }
    const fn: EdgeFn = provider === 'nhs_notify' ? 'nhs-notify' : 'sms-works'
    const result = await callEdgeFunction(fn, 'check_status', { org_id: orgId, message_id: messageId })

    // Update message in local state
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, status: result.status } : m
      ),
    }))

    return result
  },

  testConnection: async (orgId, apiKey) => {
    return callNotifyFunction('test_connection', { org_id: orgId, api_key: apiKey })
  },

  getCallbackInfo: async (orgId) => {
    return callNotifyFunction('get_callback_info', { org_id: orgId }) as Promise<CallbackInfo>
  },

  saveSettings: async (params) => {
    await callNotifyFunction('save_settings', params)
    // Refresh settings
    const { data } = await getUserClient()
      .from('ps_notify_settings_safe')
      .select('*')
      .eq('org_id', params.org_id)
      .single()
    set({ settings: data as NotifySettingsSafe | null })
  },

  getRecipientCount: async (orgId, channel, _recipientFilter?: string) => {
    const client = getUserClient()
    let query = client
      .from('ps_patients')
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', orgId)

    if (channel === 'sms') query = query.not('phone', 'is', null)
    if (channel === 'email') query = query.not('email', 'is', null)
    if (channel === 'letter') query = query.not('address_line_1', 'is', null)

    const { count } = await query
    return count || 0
  },

  // ============================================
  // SMS Works actions
  // ============================================

  fetchSmsSettings: async (orgId) => {
    try {
      const data = await callEdgeFunction('sms-works', 'get_settings', { org_id: orgId })
      set({ smsSettings: data as SmsSettings | null })
    } catch {
      set({ smsSettings: null })
    }
  },

  saveSmsSettings: async (params) => {
    const data = await callEdgeFunction('sms-works', 'save_settings', params)
    set({ smsSettings: data as SmsSettings })
  },

  testSmsConnection: async (orgId) => {
    return callEdgeFunction('sms-works', 'test_connection', { org_id: orgId })
  },

  fetchSmsTemplates: async (orgId) => {
    // Direct RLS-protected read — templates are org-member CRUD.
    const { data, error } = await getUserClient()
      .from('ps_sms_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ error: error.message })
      return
    }
    set({ smsTemplates: (data ?? []) as SmsTemplate[] })
  },

  saveSmsTemplate: async (params) => {
    const data = await callEdgeFunction('sms-works', 'save_template', params)
    const saved = data as SmsTemplate
    set((s) => {
      const exists = s.smsTemplates.some((t) => t.id === saved.id)
      return {
        smsTemplates: exists
          ? s.smsTemplates.map((t) => (t.id === saved.id ? saved : t))
          : [saved, ...s.smsTemplates],
      }
    })
    return saved
  },

  deleteSmsTemplate: async (orgId, templateId) => {
    await callEdgeFunction('sms-works', 'delete_template', { org_id: orgId, id: templateId })
    set((s) => ({ smsTemplates: s.smsTemplates.filter((t) => t.id !== templateId) }))
  },

  assignReplyNumber: async (orgId) => {
    const result = await callEdgeFunction('sms-works', 'assign_reply_number', { org_id: orgId })
    if (result.assigned) {
      // Reflect the new reply number in settings immediately.
      await get().fetchSmsSettings(orgId)
    }
    return result
  },

  releaseReplyNumber: async (orgId) => {
    await callEdgeFunction('sms-works', 'release_reply_number', { org_id: orgId })
    await get().fetchSmsSettings(orgId)
  },

  fetchInbound: async (orgId, opts = {}) => {
    const { unreadOnly = false, limit = 100, disposition = 'inbox' } = opts
    let query = getUserClient()
      .from('ps_sms_inbound')
      .select('*, patient:ps_patients(id, first_name, last_name, dob, nhs_number, phone, email, address_line_1, address_line_2, city, postcode)')
      .eq('org_id', orgId)
      .eq('disposition', disposition)
      .order('received_at', { ascending: false })
      .limit(limit)
    if (unreadOnly) query = query.eq('is_read', false)

    const [{ data, error }, { count }] = await Promise.all([
      query,
      getUserClient().from('ps_sms_inbound')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('disposition', 'inbox').eq('is_read', false),
    ])
    if (error) {
      set({ error: error.message })
      return
    }
    const rows = (data ?? []) as SmsInbound[]
    set({
      inbound: rows,
      unreadInboundCount: count ?? 0,
    })
  },

  markInboundRead: async (orgId, inboundId) => {
    const { error } = await getUserClient()
      .from('ps_sms_inbound')
      .update({ is_read: true })
      .eq('id', inboundId)
      .eq('org_id', orgId)
    if (error) throw new Error(error.message)
    set((s) => ({
      inbound: s.inbound.map((r) => (r.id === inboundId ? { ...r, is_read: true } : r)),
      unreadInboundCount: Math.max(0, s.unreadInboundCount - 1),
    }))
  },

  markSmsConversationRead: async (orgId, phoneNumber) => {
    const { error } = await getUserClient().from('ps_sms_inbound')
      .update({ is_read: true })
      .eq('org_id', orgId).eq('normalized_from_number', phoneNumber)
      .eq('disposition', 'inbox').eq('is_read', false)
    if (error) throw new Error(error.message)
    set((s) => ({
      inbound: s.inbound.map((row) => row.normalized_from_number === phoneNumber ? { ...row, is_read: true } : row),
      unreadInboundCount: Math.max(0, s.unreadInboundCount - s.inbound.filter((row) => row.normalized_from_number === phoneNumber && !row.is_read).length),
    }))
  },

  fetchSmsThread: async (orgId, phoneNumber) => {
    const client = getUserClient()
    const [{ data: inbound, error: inboundError }, { data: outbound, error: outboundError }] = await Promise.all([
      client.from('ps_sms_inbound').select('*')
        .eq('org_id', orgId).eq('normalized_from_number', phoneNumber)
        .order('received_at', { ascending: true }),
      client.from('ps_messages').select('*')
        .eq('org_id', orgId).eq('channel', 'sms').eq('recipient_phone_normalized', phoneNumber)
        .order('created_at', { ascending: true }),
    ])
    if (inboundError || outboundError) throw new Error(inboundError?.message || outboundError?.message)
    const thread: SmsConversationMessage[] = [
      ...((inbound ?? []) as SmsInbound[]).map((row) => ({
        id: row.id, direction: 'inbound' as const, body: row.content,
        timestamp: row.received_at, isRead: row.is_read,
      })),
      ...((outbound ?? []) as NotifyMessage[]).map((row) => ({
        id: row.id, direction: 'outbound' as const, body: row.body ?? '',
        timestamp: row.created_at, status: row.status,
      })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    set({ smsThread: thread })
  },

  sendSmsReply: async ({ orgId, phoneNumber, patientId, body }) => {
    const result = await callEdgeFunction('sms-works', 'send_sms', {
      org_id: orgId,
      phone_number: phoneNumber,
      patient_id: patientId,
      body,
      feature: 'patient_message',
      reference: `patient_message:${phoneNumber}`,
      use_reply_number: true,
    }) as NotifyMessage
    set((s) => ({
      messages: [result, ...s.messages],
      smsThread: [...s.smsThread, {
        id: result.id, direction: 'outbound', body: result.body ?? body,
        timestamp: result.created_at, status: result.status,
      }],
    }))
  },

  fetchSmsSenderControls: async (orgId) => {
    const { data, error } = await getUserClient().from('ps_sms_sender_controls')
      .select('*').eq('org_id', orgId).order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    set({ smsSenderControls: (data ?? []) as SmsSenderControl[] })
  },

  setSmsSenderControl: async ({ orgId, phoneNumber, status, mutedUntil, reason, userId }) => {
    const client = getUserClient()
    if (!status) {
      const { error } = await client.from('ps_sms_sender_controls')
        .delete().eq('org_id', orgId).eq('phone_number', phoneNumber)
      if (error) throw new Error(error.message)
      set((s) => ({ smsSenderControls: s.smsSenderControls.filter((row) => row.phone_number !== phoneNumber) }))
      return
    }
    const { data, error } = await client.from('ps_sms_sender_controls').upsert({
      org_id: orgId,
      phone_number: phoneNumber,
      status,
      muted_until: status === 'muted' ? mutedUntil ?? null : null,
      reason: reason || null,
      created_by: userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,phone_number' }).select().single()
    if (error) throw new Error(error.message)

    if (status === 'blocked') {
      const { error: moveError } = await client.from('ps_sms_inbound')
        .update({ disposition: 'blocked', disposition_reason: 'sender_blocked' })
        .eq('org_id', orgId).eq('normalized_from_number', phoneNumber)
      if (moveError) throw new Error(moveError.message)
    } else if (status === 'approved') {
      const { error: releaseError } = await client.from('ps_sms_inbound')
        .update({ disposition: 'inbox', disposition_reason: null })
        .eq('org_id', orgId).eq('normalized_from_number', phoneNumber)
        .eq('disposition', 'quarantine')
      if (releaseError) throw new Error(releaseError.message)
    }
    set((s) => ({
      smsSenderControls: [data as SmsSenderControl, ...s.smsSenderControls.filter((row) => row.phone_number !== phoneNumber)],
    }))
  },

  linkSmsSenderToPatient: async (orgId, phoneNumber, patientId) => {
    const { error } = await getUserClient().from('ps_sms_inbound')
      .update({ patient_id: patientId })
      .eq('org_id', orgId).eq('normalized_from_number', phoneNumber)
    if (error) throw new Error(error.message)
    set((s) => ({
      inbound: s.inbound.map((row) => row.normalized_from_number === phoneNumber ? { ...row, patient_id: patientId } : row),
    }))
  },

  subscribeToInbound: (orgId) => {
    const existing = get()._inboundRealtimeChannel
    if (existing) getUserClient().removeChannel(existing)
    const channel = getUserClient().channel(`sms-inbound:${orgId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ps_sms_inbound', filter: `org_id=eq.${orgId}`,
      }, () => {
        get().fetchInbound(orgId)
      })
      .subscribe()
    set({ _inboundRealtimeChannel: channel })
  },

  unsubscribeFromInbound: () => {
    const channel = get()._inboundRealtimeChannel
    if (channel) getUserClient().removeChannel(channel)
    set({ _inboundRealtimeChannel: null })
  },

  fetchSmsUsage: async (orgId) => {
    const { data, error } = await getUserClient()
      .from('ps_sms_billing_summary')
      .select('*')
      .eq('org_id', orgId)
      .order('period', { ascending: false })
    if (error) {
      set({ error: error.message })
      return
    }
    set({ usage: (data ?? []) as SmsUsageSummary[] })
  },

  clearError: () => set({ error: null }),
}))
