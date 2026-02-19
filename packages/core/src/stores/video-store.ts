import { create } from 'zustand'
import type { VideoConsultation } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface VideoState {
  consultations: VideoConsultation[]
  activeConsultation: VideoConsultation | null
  loading: boolean
  error: string | null

  fetchConsultations: (orgId: string, filter?: 'upcoming' | 'active' | 'past') => Promise<void>
  fetchConsultation: (consultationId: string) => Promise<void>
  createConsultation: (params: {
    org_id: string
    patient_name: string
    patient_phone?: string
    patient_id?: string
    appointment_id?: string
    scheduled_for: string
  }) => Promise<{ consultation: VideoConsultation; patient_link: string }>
  endConsultation: (consultationId: string) => Promise<void>
  cancelConsultation: (consultationId: string) => Promise<void>
  getStaffToken: (consultationId: string) => Promise<string>
  clearError: () => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  consultations: [],
  activeConsultation: null,
  loading: false,
  error: null,

  fetchConsultations: async (orgId, filter = 'upcoming') => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_video_consultations')
        .select('*')
        .eq('org_id', orgId)

      if (filter === 'upcoming') {
        query = query.in('status', ['scheduled']).order('scheduled_for', { ascending: true })
      } else if (filter === 'active') {
        query = query.eq('status', 'active').order('scheduled_for', { ascending: true })
      } else {
        // past: completed + cancelled, last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        query = query
          .in('status', ['completed', 'cancelled'])
          .gte('created_at', thirtyDaysAgo.toISOString())
          .order('scheduled_for', { ascending: false })
      }

      const { data, error } = await query
      if (error) throw error
      set({ consultations: (data ?? []) as VideoConsultation[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchConsultation: async (consultationId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_video_consultations')
        .select('*')
        .eq('id', consultationId)
        .single()
      if (error) throw error
      set({ activeConsultation: data as VideoConsultation, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createConsultation: async (params) => {
    const client = getUserClient()
    const { data: { session } } = await client.auth.getSession()

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-video`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'create_room', ...params }),
      }
    )

    const result = await res.json()
    if (result.error) throw new Error(result.error)

    // Add to local state
    set((s) => ({
      consultations: [result.consultation, ...s.consultations],
    }))

    return result
  },

  endConsultation: async (consultationId) => {
    const client = getUserClient()
    const { data: { session } } = await client.auth.getSession()

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-video`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'end_consultation', consultation_id: consultationId }),
      }
    )

    const result = await res.json()
    if (result.error) throw new Error(result.error)

    set((s) => ({
      consultations: s.consultations.map((c) =>
        c.id === consultationId ? { ...c, status: 'completed' as const, ended_at: new Date().toISOString() } : c
      ),
      activeConsultation:
        s.activeConsultation?.id === consultationId
          ? { ...s.activeConsultation, status: 'completed' as const, ended_at: new Date().toISOString() }
          : s.activeConsultation,
    }))
  },

  cancelConsultation: async (consultationId) => {
    const { error } = await getUserClient()
      .from('ps_video_consultations')
      .update({ status: 'cancelled' })
      .eq('id', consultationId)
    if (error) throw error

    set((s) => ({
      consultations: s.consultations.map((c) =>
        c.id === consultationId ? { ...c, status: 'cancelled' as const } : c
      ),
    }))
  },

  getStaffToken: async (consultationId) => {
    const client = getUserClient()
    const { data: { session } } = await client.auth.getSession()

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-video`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'get_staff_token', consultation_id: consultationId }),
      }
    )

    const result = await res.json()
    if (result.error) throw new Error(result.error)
    return result.org_token
  },

  clearError: () => set({ error: null }),
}))
