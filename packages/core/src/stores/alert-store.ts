import { create } from 'zustand'
import type {
  AlertChannelConfig,
  AlertEventType,
  NotificationReceipt,
  OrgAlertSettings,
  UserNotificationPreferences,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ============================================================
// Alert Store — the internal, staff-facing notification system
// (header bell + optional staff SMS). Distinct from patient-facing
// messaging (useMessagingStore / psNotify).
//
// Notifications themselves are created server-side by DB triggers (new
// appointment, new PEPS assigned to this pharmacy, new pharmacy-network
// message) calling ps_fanout_notification() — this store only reads the
// resulting feed, manages settings, and marks things read. New event types
// need no frontend change here: they just need a row key in
// ps_org_alert_settings.settings and a DB trigger.
// ============================================================

export const DEFAULT_ALERT_CHANNELS: AlertChannelConfig = {
  web: true, sms: false, mobile: false, desktop: false,
}

export const ALERT_EVENT_TYPES: { key: AlertEventType; label: string; description: string }[] = [
  { key: 'appointment', label: 'New appointments', description: 'A patient books (or a booking is made for them).' },
  { key: 'peps', label: 'Prescription alerts', description: 'A new private prescription (PEPS) is sent to this pharmacy.' },
  { key: 'network_message', label: 'Pharmacy network', description: 'Another pharmacy sends a direct message or broadcast.' },
  { key: 'patient_message', label: 'Patient message', description: 'A patient texts the store. (coming soon)' },
  { key: 'system', label: 'System notifications', description: 'Warnings and alerts from PharmStation itself. (coming soon)' },
]

export interface AlertState {
  // Org-wide routing (manager-controlled)
  orgAlertSettings: OrgAlertSettings | null
  // Personal opt-in (profile-controlled)
  myPreferences: UserNotificationPreferences | null

  // Bell feed
  notifications: NotificationReceipt[]
  unreadCount: number

  loading: boolean
  error: string | null

  _realtimeChannel: RealtimeChannel | null

  // Org settings
  fetchOrgAlertSettings: (orgId: string) => Promise<void>
  saveOrgAlertSettings: (orgId: string, settings: Partial<Record<AlertEventType, AlertChannelConfig>>) => Promise<void>

  // Personal preferences
  fetchMyPreferences: (userId: string) => Promise<void>
  saveMyPreferences: (userId: string, patch: Partial<Omit<UserNotificationPreferences, 'user_id' | 'updated_at'>>) => Promise<void>

  // Bell feed
  fetchNotifications: (orgId: string, userId: string) => Promise<void>
  fetchUnreadCount: (orgId: string, userId: string) => Promise<void>
  markRead: (receiptId: string) => Promise<void>
  markAllRead: (orgId: string, userId: string) => Promise<void>
  subscribeToNotifications: (orgId: string, userId: string) => void
  unsubscribeFromNotifications: () => void

  clearError: () => void
}

export const useAlertStore = create<AlertState>((set, get) => ({
  orgAlertSettings: null,
  myPreferences: null,
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  _realtimeChannel: null,

  // ----------------------------------------------------------------
  // Org settings
  // ----------------------------------------------------------------
  fetchOrgAlertSettings: async (orgId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_org_alert_settings')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) throw error
      set({ orgAlertSettings: (data as OrgAlertSettings | null) ?? null })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  saveOrgAlertSettings: async (orgId, settings) => {
    try {
      const current = get().orgAlertSettings?.settings ?? {}
      const merged = { ...current, ...settings }
      const { data, error } = await getUserClient()
        .from('ps_org_alert_settings')
        .upsert({ org_id: orgId, settings: merged, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
        .select('*')
        .single()
      if (error) throw error
      set({ orgAlertSettings: data as OrgAlertSettings })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
      throw e
    }
  },

  // ----------------------------------------------------------------
  // Personal preferences
  // ----------------------------------------------------------------
  fetchMyPreferences: async (userId) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_user_notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      set({ myPreferences: (data as UserNotificationPreferences | null) ?? null })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  saveMyPreferences: async (userId, patch) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_user_notification_preferences')
        .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        .select('*')
        .single()
      if (error) throw error
      set({ myPreferences: data as UserNotificationPreferences })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
      throw e
    }
  },

  // ----------------------------------------------------------------
  // Bell feed
  // ----------------------------------------------------------------
  fetchNotifications: async (orgId, userId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_notification_receipts')
        .select('*, notification:ps_notifications!inner(*)')
        .eq('user_id', userId)
        .eq('notification.org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      set({ notifications: (data ?? []) as unknown as NotificationReceipt[], loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  fetchUnreadCount: async (orgId, userId) => {
    try {
      const { count, error } = await getUserClient()
        .from('ps_notification_receipts')
        .select('*, notification:ps_notifications!inner(org_id)', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
        .eq('notification.org_id', orgId)
      if (error) throw error
      set({ unreadCount: count || 0 })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  markRead: async (receiptId) => {
    try {
      const client = getUserClient()
      const wasUnread = get().notifications.find((n) => n.id === receiptId && !n.is_read)
      await client
        .from('ps_notification_receipts')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', receiptId)
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === receiptId ? { ...n, is_read: true } : n)),
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  markAllRead: async (orgId, userId) => {
    try {
      const unreadIds = get().notifications.filter((n) => !n.is_read).map((n) => n.id)
      if (unreadIds.length === 0) return
      await getUserClient()
        .from('ps_notification_receipts')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', unreadIds)
      set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, is_read: true })),
        unreadCount: 0,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  // ----------------------------------------------------------------
  // Realtime — new receipt rows for this user (any org, filtered client-side)
  // ----------------------------------------------------------------
  subscribeToNotifications: (orgId, userId) => {
    const existing = get()._realtimeChannel
    if (existing) existing.unsubscribe()

    const client = getUserClient()
    const channel = client
      .channel(`staff_alerts:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ps_notification_receipts', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const receipt = payload.new as NotificationReceipt
          const { data } = await client.from('ps_notifications').select('*').eq('id', receipt.notification_id).maybeSingle()
          if (!data || data.org_id !== orgId) return
          set((s) => ({
            notifications: [{ ...receipt, notification: data as never }, ...s.notifications],
            unreadCount: s.unreadCount + 1,
          }))
          // Best-effort native browser notification — only fires if the user has
          // explicitly granted permission (via the toggle in their profile settings).
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(data.title as string, { body: (data.body as string) ?? undefined })
            } catch {
              // Some browsers restrict constructing Notification directly on mobile; ignore.
            }
          }
        },
      )
      .subscribe()

    set({ _realtimeChannel: channel })
  },

  unsubscribeFromNotifications: () => {
    const existing = get()._realtimeChannel
    if (existing) existing.unsubscribe()
    set({ _realtimeChannel: null })
  },

  clearError: () => set({ error: null }),
}))
