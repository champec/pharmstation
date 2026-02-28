import { create } from 'zustand'
import { getUserClient } from '@pharmstation/supabase-client'
import type {
  NHS111Referral,
  NHS111ReferralStatus,
} from '@pharmstation/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ============================================================
// State interface
// ============================================================

export interface NHS111State {
  // Data
  referrals: NHS111Referral[]
  activeReferral: NHS111Referral | null
  loading: boolean
  error: string | null

  // Counts
  totalCount: number
  unreadCount: number // 'received' status

  // Filters
  statusFilter: NHS111ReferralStatus | 'all'
  setStatusFilter: (filter: NHS111ReferralStatus | 'all') => void

  // CRUD
  fetchReferrals: (orgId: string) => Promise<void>
  fetchReferral: (referralId: string) => Promise<void>
  acceptReferral: (referralId: string, userId: string) => Promise<void>
  startConsultation: (referralId: string, userId: string) => Promise<void>
  completeReferral: (referralId: string, userId: string, opts?: {
    linkedDeliveryId?: string
    notes?: string
  }) => Promise<void>
  rejectReferral: (referralId: string, userId: string, reason: string) => Promise<void>
  addNote: (referralId: string, note: string) => Promise<void>

  // Realtime
  subscribeToReferrals: (orgId: string) => void
  unsubscribeFromReferrals: () => void
  _realtimeChannel: RealtimeChannel | null

  clearError: () => void
}

// ============================================================
// Store
// ============================================================

export const useNHS111Store = create<NHS111State>((set, get) => ({
  referrals: [],
  activeReferral: null,
  loading: false,
  error: null,
  totalCount: 0,
  unreadCount: 0,
  statusFilter: 'all',
  _realtimeChannel: null,

  setStatusFilter: (filter) => set({ statusFilter: filter }),

  // ----------------------------------------------------------------
  // Fetch all referrals for the org
  // ----------------------------------------------------------------
  fetchReferrals: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const filter = get().statusFilter

      let query = client
        .from('ps_nhs111_referrals')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .order('received_at', { ascending: false })
        .limit(200)

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data, error, count } = await query

      if (error) throw error

      const referrals = (data ?? []) as NHS111Referral[]

      // Count unread (received status) across all, not just filtered
      const { count: unread } = await client
        .from('ps_nhs111_referrals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'received')

      set({
        referrals,
        totalCount: count ?? referrals.length,
        unreadCount: unread ?? 0,
        loading: false,
      })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Fetch single referral detail
  // ----------------------------------------------------------------
  fetchReferral: async (referralId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .select('*')
        .eq('id', referralId)
        .single()

      if (error) throw error
      set({ activeReferral: data as NHS111Referral, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Accept referral
  // ----------------------------------------------------------------
  acceptReferral: async (referralId, userId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .update({
          status: 'accepted',
          actioned_at: new Date().toISOString(),
          actioned_by: userId,
        })
        .eq('id', referralId)
        .select()
        .single()

      if (error) throw error

      const updated = data as NHS111Referral
      set((s) => ({
        activeReferral: updated,
        referrals: s.referrals.map((r) => (r.id === referralId ? updated : r)),
        unreadCount: Math.max(0, s.unreadCount - 1),
        loading: false,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Start consultation
  // ----------------------------------------------------------------
  startConsultation: async (referralId, userId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .update({
          status: 'in_progress',
          actioned_at: new Date().toISOString(),
          actioned_by: userId,
        })
        .eq('id', referralId)
        .select()
        .single()

      if (error) throw error

      const updated = data as NHS111Referral
      set((s) => ({
        activeReferral: updated,
        referrals: s.referrals.map((r) => (r.id === referralId ? updated : r)),
        loading: false,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Complete referral
  // ----------------------------------------------------------------
  completeReferral: async (referralId, userId, opts) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          actioned_by: userId,
          linked_delivery_id: opts?.linkedDeliveryId ?? null,
          notes: opts?.notes ?? null,
        })
        .eq('id', referralId)
        .select()
        .single()

      if (error) throw error

      const updated = data as NHS111Referral
      set((s) => ({
        activeReferral: updated,
        referrals: s.referrals.map((r) => (r.id === referralId ? updated : r)),
        loading: false,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Reject referral
  // ----------------------------------------------------------------
  rejectReferral: async (referralId, userId, reason) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .update({
          status: 'rejected',
          actioned_at: new Date().toISOString(),
          actioned_by: userId,
          rejection_reason: reason,
        })
        .eq('id', referralId)
        .select()
        .single()

      if (error) throw error

      const updated = data as NHS111Referral
      set((s) => ({
        activeReferral: updated,
        referrals: s.referrals.map((r) => (r.id === referralId ? updated : r)),
        unreadCount: Math.max(0, s.unreadCount - 1),
        loading: false,
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  // ----------------------------------------------------------------
  // Add note
  // ----------------------------------------------------------------
  addNote: async (referralId, note) => {
    set({ error: null })
    try {
      const client = getUserClient()
      const { data, error } = await client
        .from('ps_nhs111_referrals')
        .update({ notes: note })
        .eq('id', referralId)
        .select()
        .single()

      if (error) throw error
      const updated = data as NHS111Referral
      set((s) => ({
        activeReferral: updated,
        referrals: s.referrals.map((r) => (r.id === referralId ? updated : r)),
      }))
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  // ----------------------------------------------------------------
  // Realtime subscription — new referrals and status changes
  // ----------------------------------------------------------------
  subscribeToReferrals: (orgId) => {
    const existing = get()._realtimeChannel
    if (existing) existing.unsubscribe()

    const client = getUserClient()
    const channel = client
      .channel(`nhs111_referrals:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ps_nhs111_referrals',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const referral = payload.new as NHS111Referral
          set((s) => ({
            referrals: [referral, ...s.referrals],
            totalCount: s.totalCount + 1,
            unreadCount: referral.status === 'received'
              ? s.unreadCount + 1
              : s.unreadCount,
          }))

          // Play alert sound for new referrals
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.type = 'sine'
            // Two-tone alert: beep-boop
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
            gain.gain.setValueAtTime(0.3, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.3)
          } catch {
            // Audio not available — ignore
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ps_nhs111_referrals',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const updated = payload.new as NHS111Referral
          set((s) => ({
            referrals: s.referrals.map((r) =>
              r.id === updated.id ? updated : r,
            ),
            activeReferral:
              s.activeReferral?.id === updated.id
                ? updated
                : s.activeReferral,
          }))
        },
      )
      .subscribe()

    set({ _realtimeChannel: channel })
  },

  unsubscribeFromReferrals: () => {
    const ch = get()._realtimeChannel
    if (ch) {
      ch.unsubscribe()
      set({ _realtimeChannel: null })
    }
  },

  clearError: () => set({ error: null }),
}))
