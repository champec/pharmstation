import { create } from 'zustand'
import type {
  NotifyMessage,
  Broadcast,
  MessageChannel,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

// ============================================
// Messaging Store — handles messages, broadcasts, settings, edge function calls
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
}

export interface MessageStats {
  today: number
  thisWeek: number
  thisMonth: number
  deliveryRate: number
}

export interface MessagingState {
  // Data
  messages: NotifyMessage[]
  broadcasts: Broadcast[]
  settings: NotifySettingsSafe | null
  stats: MessageStats | null
  loading: boolean
  error: string | null

  // Actions
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
  }) => Promise<NotifyMessage>
  createBroadcast: (broadcast: Partial<Broadcast>) => Promise<Broadcast>
  sendBroadcast: (orgId: string, broadcastId: string) => Promise<{ sent_count: number; failed_count: number; total_count: number }>
  checkStatus: (orgId: string, messageId: string) => Promise<{ status: string }>
  testConnection: (orgId: string) => Promise<{ valid: boolean; templates?: Array<{ id: string; name: string; type: string }>; error?: string }>
  saveSettings: (params: {
    org_id: string
    api_key?: string
    sms_template_id?: string
    email_template_id?: string
    letter_template_id?: string
  }) => Promise<void>
  getRecipientCount: (orgId: string, channel: MessageChannel) => Promise<number>
  clearError: () => void
}

// Helper to call the nhs-notify edge function
async function callNotifyFunction(action: string, params: Record<string, unknown>) {
  const client = getUserClient()
  const { data: { session } } = await client.auth.getSession()

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nhs-notify`,
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

export const useMessagingStore = create<MessagingState>((set) => ({
  messages: [],
  broadcasts: [],
  settings: null,
  stats: null,
  loading: false,
  error: null,

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
    const result = await callNotifyFunction(params.action, params)
    // Add to local messages
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
    const result = await callNotifyFunction('send_broadcast', { org_id: orgId, broadcast_id: broadcastId })

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
    const result = await callNotifyFunction('check_status', { org_id: orgId, message_id: messageId })

    // Update message in local state
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, status: result.status } : m
      ),
    }))

    return result
  },

  testConnection: async (orgId) => {
    return callNotifyFunction('test_connection', { org_id: orgId })
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

  getRecipientCount: async (orgId, channel) => {
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

  clearError: () => set({ error: null }),
}))
