import { create } from 'zustand'
import type { StickyNote, NewStickyNote, StickyPriority } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface StickyNoteState {
  notes: StickyNote[]
  loading: boolean
  error: string | null

  // Actions
  fetchNotes: (orgId: string) => Promise<void>
  createNote: (note: NewStickyNote) => Promise<StickyNote>
  updateContent: (id: string, content: string) => Promise<void>
  updatePosition: (id: string, pos_x: number, pos_y: number) => Promise<void>
  updatePriority: (id: string, priority: StickyPriority) => Promise<void>
  updateAssignment: (id: string, assignedTo: string | null) => Promise<void>
  updateTargetDate: (id: string, targetDate: string | null) => Promise<void>
  toggleCompleted: (id: string, current: boolean) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  // Optimistic helpers
  setPositionLocal: (id: string, pos_x: number, pos_y: number) => void
  clearError: () => void
}

export const useStickyNoteStore = create<StickyNoteState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,

  fetchNotes: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_sticky_notes')
        .select('*, author:ps_user_profiles!author_id(id, full_name, avatar_url), assignee:ps_user_profiles!assigned_to(id, full_name, avatar_url)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true })
      if (error) throw error
      set({ notes: data as StickyNote[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createNote: async (note) => {
    const { data, error } = await getUserClient()
      .from('ps_sticky_notes')
      .insert(note)
      .select('*, author:ps_user_profiles!author_id(id, full_name, avatar_url), assignee:ps_user_profiles!assigned_to(id, full_name, avatar_url)')
      .single()
    if (error) throw error
    const created = data as StickyNote
    set((s) => ({ notes: [...s.notes, created] }))
    return created
  },

  updateContent: async (id, content) => {
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, content } : n) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ content })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  updatePosition: async (id, pos_x, pos_y) => {
    // Position is updated live via setPositionLocal; this persists to DB
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ pos_x, pos_y })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  updatePriority: async (id, priority) => {
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, priority } : n) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ priority })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  updateAssignment: async (id, assignedTo) => {
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, assigned_to: assignedTo } : n) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ assigned_to: assignedTo })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  updateTargetDate: async (id, targetDate) => {
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, target_date: targetDate } : n) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ target_date: targetDate })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  toggleCompleted: async (id, current) => {
    const is_completed = !current
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, is_completed } : n) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .update({ is_completed })
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  deleteNote: async (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    const { error } = await getUserClient()
      .from('ps_sticky_notes')
      .delete()
      .eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  setPositionLocal: (id, pos_x, pos_y) => {
    set((s) => ({ notes: s.notes.map((n) => n.id === id ? { ...n, pos_x, pos_y } : n) }))
  },

  clearError: () => set({ error: null }),
}))
