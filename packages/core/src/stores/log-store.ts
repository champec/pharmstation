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
  /** Current entries across every log of the pharmacy (for the Logs home page) */
  orgEntries: LogEntry[]
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
  fetchOrgEntries: (orgId: string, dateRange: { start: string; end: string }) => Promise<void>
  /** Save a new entry, or a new version of one (replacesId + editReason). Entries are never overwritten. */
  saveEntry: (input: SaveLogEntryInput) => Promise<LogEntry>
  /** Remove an entry from the log; it stays in the history with the reason */
  voidEntry: (entryId: string, reason: string) => Promise<void>
  /** Every version of an entry, oldest first */
  fetchEntryHistory: (rootId: string) => Promise<LogEntry[]>
  buildTemplate: (template: Partial<LogTemplate>, fields: Partial<LogField>[]) => Promise<LogTemplate>
  updateSubscription: (subscriptionId: string, updates: Partial<LogSubscription>) => Promise<void>
  deactivateSubscription: (subscriptionId: string) => Promise<void>
  clearError: () => void
}

export interface SaveLogEntryInput {
  subscriptionId: string
  entryDate?: string
  data: Record<string, unknown>
  replacesId?: string | null
  editReason?: string | null
}

const ENTRY_SELECT = '*, entered_by_profile:ps_user_profiles!entered_by_user_id(id, full_name)'

export const useLogStore = create<LogState>((set, get) => ({
  templates: [],
  subscriptions: [],
  entries: [],
  orgEntries: [],
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
        .select(ENTRY_SELECT)
        .eq('subscription_id', subscriptionId)
        .is('superseded_at', null)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })

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

  fetchOrgEntries: async (orgId, dateRange) => {
    try {
      const { data, error } = await getUserClient()
        .from('ps_log_entries')
        .select(ENTRY_SELECT)
        .eq('org_id', orgId)
        .is('superseded_at', null)
        .is('voided_at', null)
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ orgEntries: data as LogEntry[] })
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  subscribeToLibrary: async (orgId, templateId) => {
    // Re-adding a log that was removed earlier reactivates it (and its history).
    const { data, error } = await getUserClient()
      .from('ps_log_subscriptions')
      .upsert(
        { org_id: orgId, template_id: templateId, is_active: true },
        { onConflict: 'org_id,template_id' },
      )
      .select()
      .single()
    if (error) throw error
    const created = data as LogSubscription
    set((s) => ({ subscriptions: [...s.subscriptions.filter((x) => x.id !== created.id), created] }))
    return created
  },

  saveEntry: async ({ subscriptionId, entryDate, data, replacesId, editReason }) => {
    const client = getUserClient()
    const { data: saved, error } = await client.rpc('ps_log_save_entry', {
      p_subscription_id: subscriptionId,
      p_entry_date: entryDate ?? null,
      p_data: data,
      p_replaces_id: replacesId ?? null,
      p_edit_reason: editReason ?? null,
    })
    if (error) throw new Error(friendlyLogError(error.message))
    const row = saved as LogEntry
    const { data: full } = await client.from('ps_log_entries').select(ENTRY_SELECT).eq('id', row.id).single()
    const created = (full as LogEntry | null) ?? row
    set((s) => ({
      entries: [created, ...s.entries.filter((e) => e.id !== replacesId && e.id !== created.id)],
      orgEntries: [created, ...s.orgEntries.filter((e) => e.id !== replacesId && e.id !== created.id)],
    }))
    return created
  },

  voidEntry: async (entryId, reason) => {
    const { data, error } = await getUserClient().rpc('ps_log_void_entry', {
      p_entry_id: entryId,
      p_reason: reason,
    })
    if (error) throw new Error(friendlyLogError(error.message))
    const voided = data as LogEntry
    set((s) => ({
      entries: s.entries.map((e) => (e.id === entryId ? { ...e, ...voided, entered_by_profile: e.entered_by_profile } : e)),
      orgEntries: s.orgEntries.filter((e) => e.id !== entryId),
    }))
  },

  fetchEntryHistory: async (rootId) => {
    const { data, error } = await getUserClient()
      .from('ps_log_entries')
      .select(ENTRY_SELECT)
      .eq('root_id', rootId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data as LogEntry[]
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

/** Turns database messages into something a pharmacy team member can act on. */
export function friendlyLogError(message: string): string {
  if (message.startsWith('ALREADY_LOGGED')) return 'Someone has already logged this day. Refresh to see it, then edit it if needed.'
  if (message.startsWith('CONFLICT')) return 'Someone else changed this entry a moment ago. Refresh and try again.'
  return message
}
