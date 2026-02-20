import { create } from 'zustand'
import type {
  NetworkMessage,
  NetworkPharmacy,
  NetworkSettings,
  NetworkSmsContact,
  OrgPharmacyLink,
  NetworkMessageLabel,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ============================================================
// Network Store — Pharmacy-to-Pharmacy messaging
// ============================================================

export interface NetworkState {
  // Inbox / sent / thread data
  inbox:        NetworkMessage[]
  sent:         NetworkMessage[]
  thread:       NetworkMessage[]
  activeMessage: NetworkMessage | null

  // Recipient search
  searchResults: NetworkPharmacy[]
  searchLoading: boolean

  // Pharmacy link (onboarding)
  myLink:       OrgPharmacyLink | null

  // Settings + SMS contacts
  settings:     NetworkSettings | null
  smsContacts:  NetworkSmsContact[]

  // Notification badge
  unreadCount:  number

  loading: boolean
  error:   string | null

  // Realtime
  _realtimeChannel: RealtimeChannel | null

  // Actions — inbox/sent
  fetchInbox:   (orgId: string) => Promise<void>
  fetchSent:    (orgId: string) => Promise<void>
  fetchThread:  (threadId: string, orgId: string) => Promise<void>
  setActiveMessage: (msg: NetworkMessage | null) => void
  markRead:     (messageId: string) => Promise<void>
  markThreadRead: (threadId: string, orgId: string) => Promise<void>
  fetchUnreadCount: (orgId: string) => Promise<void>

  // Actions — compose & send
  searchPharmacies: (params: {
    orgId: string
    search?: string
    radiusKm?: number
    onlyPlatform?: boolean
    limit?: number
  }) => Promise<void>
  sendMessage: (params: {
    fromOrgId: string
    toOrgIds: string[]          // multiple = broadcast
    subject?: string
    body: string
    label: NetworkMessageLabel
    requestSmsPing?: boolean
    threadId?: string           // if replying to a thread
  }) => Promise<void>

  // Actions — onboarding link
  fetchMyLink:  (orgId: string) => Promise<void>
  linkPharmacy: (orgId: string, pharmacyId: number) => Promise<void>
  unlinkPharmacy: (orgId: string) => Promise<void>

  // Actions — settings
  fetchSettings:     (orgId: string) => Promise<void>
  saveSettings:      (orgId: string, patch: Partial<Omit<NetworkSettings, 'org_id' | 'updated_at'>>) => Promise<void>

  // Actions — SMS contacts
  fetchSmsContacts:  (orgId: string) => Promise<void>
  addSmsContact:     (orgId: string, data: Omit<NetworkSmsContact, 'id' | 'org_id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateSmsContact:  (id: string, patch: Partial<NetworkSmsContact>) => Promise<void>
  deleteSmsContact:  (id: string) => Promise<void>

  // Realtime
  subscribeToInbox:   (orgId: string) => void
  unsubscribeFromInbox: () => void

  clearError: () => void
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  inbox:         [],
  sent:          [],
  thread:        [],
  activeMessage: null,
  searchResults: [],
  searchLoading: false,
  myLink:        null,
  settings:      null,
  smsContacts:   [],
  unreadCount:   0,
  loading:       false,
  error:         null,
  _realtimeChannel: null,

  // ----------------------------------------------------------------
  // Inbox
  // ----------------------------------------------------------------
  fetchInbox: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_messages')
        .select(`
          *,
          from_org:from_org_id ( id, name ),
          to_org:to_org_id     ( id, name )
        `)
        .eq('to_org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      // Deduplicate threads — show latest message per thread
      const threadMap = new Map<string, NetworkMessage>()
      for (const msg of (data ?? []) as NetworkMessage[]) {
        if (!threadMap.has(msg.thread_id) || msg.created_at > (threadMap.get(msg.thread_id)!.created_at)) {
          threadMap.set(msg.thread_id, msg)
        }
      }
      set({ inbox: Array.from(threadMap.values()), loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Sent
  // ----------------------------------------------------------------
  fetchSent: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_messages')
        .select(`
          *,
          from_org:from_org_id ( id, name ),
          to_org:to_org_id     ( id, name )
        `)
        .eq('from_org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      set({ sent: (data ?? []) as NetworkMessage[], loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Thread
  // ----------------------------------------------------------------
  fetchThread: async (threadId, orgId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_messages')
        .select(`
          *,
          from_org:from_org_id ( id, name ),
          to_org:to_org_id     ( id, name )
        `)
        .eq('thread_id', threadId)
        .or(`from_org_id.eq.${orgId},to_org_id.eq.${orgId}`)
        .order('created_at', { ascending: true })
      if (error) throw error
      set({ thread: (data ?? []) as NetworkMessage[], loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  setActiveMessage: (msg) => set({ activeMessage: msg }),

  // ----------------------------------------------------------------
  // Mark read
  // ----------------------------------------------------------------
  markRead: async (messageId) => {
    try {
      const client = getUserClient()
      await client
        .from('ps_network_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', messageId)
      set((s) => ({
        inbox: s.inbox.map((m) => m.id === messageId ? { ...m, is_read: true } : m),
        thread: s.thread.map((m) => m.id === messageId ? { ...m, is_read: true } : m),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  markThreadRead: async (threadId, orgId) => {
    try {
      const client = getUserClient()
      await client
        .from('ps_network_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('to_org_id', orgId)
        .eq('is_read', false)
      set((s) => {
        const unreadInThread = s.thread.filter((m) => m.to_org_id === orgId && !m.is_read).length
        return {
          inbox: s.inbox.map((m) => m.thread_id === threadId ? { ...m, is_read: true } : m),
          thread: s.thread.map((m) => m.to_org_id === orgId ? { ...m, is_read: true } : m),
          unreadCount: Math.max(0, s.unreadCount - unreadInThread),
        }
      })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  fetchUnreadCount: async (orgId) => {
    try {
      const client = getUserClient()
      const { count, error } = await client
        .from('ps_network_messages')
        .select('id', { count: 'exact', head: true })
        .eq('to_org_id', orgId)
        .eq('is_read', false)
      if (error) throw error
      set({ unreadCount: count ?? 0 })
    } catch (e: unknown) {
      // silent — don't break the UI
      console.error('[network] fetchUnreadCount:', e)
    }
  },

  // ----------------------------------------------------------------
  // Search pharmacies (RPC)
  // ----------------------------------------------------------------
  searchPharmacies: async ({ orgId, search = '', radiusKm = 10, onlyPlatform = false, limit = 50 }) => {
    set({ searchLoading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client.rpc('search_network_pharmacies', {
        p_org_id:        orgId,
        p_search:        search,
        p_radius_km:     radiusKm,
        p_only_platform: onlyPlatform,
        p_limit:         limit,
      })
      if (error) throw error
      set({ searchResults: (data ?? []) as NetworkPharmacy[], searchLoading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, searchLoading: false })
    }
  },

  // ----------------------------------------------------------------
  // Send message / broadcast
  // ----------------------------------------------------------------
  sendMessage: async ({ fromOrgId, toOrgIds, subject, body, label, requestSmsPing = false, threadId }) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const isBroadcast = toOrgIds.length > 1
      const broadcastId = isBroadcast ? crypto.randomUUID() : null

      const rows = toOrgIds.map((toOrgId) => {
        const msgId = crypto.randomUUID()
        return {
          id:              msgId,
          from_org_id:     fromOrgId,
          to_org_id:       toOrgId,
          thread_id:       threadId ?? msgId,   // new thread: thread_id = own id
          broadcast_id:    broadcastId,
          subject:         subject ?? null,
          body,
          label,
          request_sms_ping: requestSmsPing,
        }
      })

      const { error } = await client.from('ps_network_messages').insert(rows)
      if (error) throw error
      set({ loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
      throw e
    }
  },

  // ----------------------------------------------------------------
  // Onboarding — link org to ODS pharmacy
  // ----------------------------------------------------------------
  fetchMyLink: async (orgId) => {
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_org_pharmacy_link')
        .select('*, pharmacy:pharmacy_id(id, ods_code, organisation_name, address1, city, postcode, latitude, longitude)')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      set({ myLink: data as OrgPharmacyLink | null })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  linkPharmacy: async (orgId, pharmacyId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_org_pharmacy_link')
        .upsert({ org_id: orgId, pharmacy_id: pharmacyId }, { onConflict: 'org_id' })
        .select('*, pharmacy:pharmacy_id(id, ods_code, organisation_name, address1, city, postcode, latitude, longitude)')
        .single()
      if (error) throw error
      set({ myLink: data as OrgPharmacyLink, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
      throw e
    }
  },

  unlinkPharmacy: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { error } = await client
        .from('ps_org_pharmacy_link')
        .delete()
        .eq('org_id', orgId)
      if (error) throw error
      set({ myLink: null, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Network settings
  // ----------------------------------------------------------------
  fetchSettings: async (orgId) => {
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_settings')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      set({ settings: data as NetworkSettings | null })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  saveSettings: async (orgId, patch) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_settings')
        .upsert({ org_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
        .select('*')
        .single()
      if (error) throw error
      set({ settings: data as NetworkSettings, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // SMS contacts
  // ----------------------------------------------------------------
  fetchSmsContacts: async (orgId) => {
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_network_sms_contacts')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true })
      if (error) throw error
      set({ smsContacts: (data ?? []) as NetworkSmsContact[] })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  addSmsContact: async (orgId, data) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data: row, error } = await client
        .from('ps_network_sms_contacts')
        .insert({ org_id: orgId, ...data })
        .select('*')
        .single()
      if (error) throw error
      set((s) => ({ smsContacts: [...s.smsContacts, row as NetworkSmsContact], loading: false }))
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
      throw e
    }
  },

  updateSmsContact: async (id, patch) => {
    try {
      const client = getUserClient()
      const { data: row, error } = await client
        .from('ps_network_sms_contacts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      set((s) => ({
        smsContacts: s.smsContacts.map((c) => c.id === id ? row as NetworkSmsContact : c),
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  deleteSmsContact: async (id) => {
    try {
      const client = getUserClient()
      const { error } = await client.from('ps_network_sms_contacts').delete().eq('id', id)
      if (error) throw error
      set((s) => ({ smsContacts: s.smsContacts.filter((c) => c.id !== id) }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  // ----------------------------------------------------------------
  // Realtime subscription
  // ----------------------------------------------------------------
  subscribeToInbox: (orgId) => {
    const existing = get()._realtimeChannel
    if (existing) existing.unsubscribe()

    const client = getUserClient()
    const channel = client
      .channel(`network_inbox:${orgId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'ps_network_messages',
          filter: `to_org_id=eq.${orgId}`,
        },
        (payload) => {
          const msg = payload.new as NetworkMessage
          set((s) => ({
            inbox:       [msg, ...s.inbox],
            unreadCount: s.unreadCount + 1,
          }))
        },
      )
      .subscribe()

    set({ _realtimeChannel: channel })
  },

  unsubscribeFromInbox: () => {
    const ch = get()._realtimeChannel
    if (ch) {
      ch.unsubscribe()
      set({ _realtimeChannel: null })
    }
  },

  clearError: () => set({ error: null }),
}))
