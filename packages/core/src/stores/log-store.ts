import { create } from 'zustand'
import type {
  LogTemplate,
  LogField,
  LogSubscription,
  LogEntry,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface LogState {
  // Data
  templates: LogTemplate[]
  subscriptions: LogSubscription[]
  entries: LogEntry[]
  activeTemplate: LogTemplate | null
  activeFields: LogField[]
  activeSubscription: LogSubscription | null
  loading: boolean
  error: string | null

  // Actions
  fetchLibrary: () => Promise<void>
  fetchSubscriptions: (orgId: string) => Promise<void>
  fetchTemplateDetail: (templateId: string) => Promise<void>
  fetchEntries: (subscriptionId: string, dateRange?: { start: string; end: string }) => Promise<void>
  subscribeToLibrary: (orgId: string, templateId: string) => Promise<LogSubscription>
  createEntry: (entry: Partial<LogEntry>) => Promise<LogEntry>
  updateEntry: (entryId: string, data: Record<string, unknown>) => Promise<void>
  buildTemplate: (template: Partial<LogTemplate>, fields: Partial<LogField>[]) => Promise<LogTemplate>
  updateSubscription: (subscriptionId: string, updates: Partial<LogSubscription>) => Promise<void>
  deactivateSubscription: (subscriptionId: string) => Promise<void>
  clearError: () => void
}

export const useLogStore = create<LogState>((set, get) => ({
  templates: [],
  subscriptions: [],
  entries: [],
  activeTemplate: null,
  activeFields: [],
  activeSubscription: null,
  loading: false,
  error: null,

  fetchLibrary: async () => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_log_templates')
        .select('*, fields:ps_log_fields(count)')
        .eq('is_library', true)
        .order('title')
      if (error) throw error
      set({ templates: data as LogTemplate[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchSubscriptions: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_log_subscriptions')
        .select('*, template:ps_log_templates(id, title, description, category, schedule_type, required_days)')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('subscribed_at')
      if (error) throw error
      set({ subscriptions: data as LogSubscription[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchTemplateDetail: async (templateId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [templateRes, fieldsRes] = await Promise.all([
        client.from('ps_log_templates').select('*').eq('id', templateId).single(),
        client.from('ps_log_fields').select('*').eq('template_id', templateId).order('display_order'),
      ])
      if (templateRes.error) throw templateRes.error
      if (fieldsRes.error) throw fieldsRes.error
      set({
        activeTemplate: templateRes.data as LogTemplate,
        activeFields: fieldsRes.data as LogField[],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchEntries: async (subscriptionId, dateRange) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_log_entries')
        .select('*, entered_by_profile:ps_user_profiles!entered_by_user_id(id, full_name)')
        .eq('subscription_id', subscriptionId)
        .order('entry_date', { ascending: false })

      if (dateRange) {
        query = query.gte('entry_date', dateRange.start).lte('entry_date', dateRange.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ entries: data as LogEntry[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  subscribeToLibrary: async (orgId, templateId) => {
    const { data, error } = await getUserClient()
      .from('ps_log_subscriptions')
      .insert({ org_id: orgId, template_id: templateId })
      .select()
      .single()
    if (error) throw error
    const created = data as LogSubscription
    set((s) => ({ subscriptions: [...s.subscriptions, created] }))
    return created
  },

  createEntry: async (entry) => {
    const { data, error } = await getUserClient()
      .from('ps_log_entries')
      .insert(entry)
      .select('*, entered_by_profile:ps_user_profiles!entered_by_user_id(id, full_name)')
      .single()
    if (error) throw error
    const created = data as LogEntry
    set((s) => ({ entries: [created, ...s.entries] }))
    return created
  },

  updateEntry: async (entryId, newData) => {
    const { error } = await getUserClient()
      .from('ps_log_entries')
      .update({ data: newData })
      .eq('id', entryId)
    if (error) throw error
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === entryId ? { ...e, data: newData } : e
      ),
    }))
  },

  buildTemplate: async (template, fields) => {
    const client = getUserClient()
    // Insert template first
    const { data: tmpl, error: tmplErr } = await client
      .from('ps_log_templates')
      .insert({ ...template, is_library: false })
      .select()
      .single()
    if (tmplErr) throw tmplErr

    // Insert fields
    if (fields.length > 0) {
      const rows = fields.map((f, i) => ({
        ...f,
        template_id: tmpl.id,
        display_order: i,
      }))
      const { error: fieldsErr } = await client.from('ps_log_fields').insert(rows)
      if (fieldsErr) throw fieldsErr
    }

    return tmpl as LogTemplate
  },

  updateSubscription: async (subscriptionId, updates) => {
    const { error } = await getUserClient()
      .from('ps_log_subscriptions')
      .update(updates)
      .eq('id', subscriptionId)
    if (error) throw error
    set((s) => ({
      subscriptions: s.subscriptions.map((sub) =>
        sub.id === subscriptionId ? { ...sub, ...updates } : sub
      ),
    }))
  },

  deactivateSubscription: async (subscriptionId) => {
    await get().updateSubscription(subscriptionId, { is_active: false })
    set((s) => ({
      subscriptions: s.subscriptions.filter((sub) => sub.id !== subscriptionId),
    }))
  },

  clearError: () => set({ error: null }),
}))
