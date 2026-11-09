// ============================================
// Communications store — pharmacy network messages, patient SMS and the
// staff alert feed. Mirrors the web's network-store, messaging-store and
// alert-store (packages/core), reading the same tables with the same RLS
// through the personal (user) client.
// ============================================

import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'

export type NetworkLabel = 'prescription_query' | 'community_alert' | 'stock_query' | 'other'

export const NETWORK_LABELS: Record<NetworkLabel, { label: string; color: string; tint: string }> = {
  prescription_query: { label: 'Prescription query', color: '#1D4ED8', tint: '#DBEAFE' },
  community_alert: { label: 'Community alert', color: '#B91C1C', tint: '#FEE2E2' },
  stock_query: { label: 'Stock query', color: '#B45309', tint: '#FEF3C7' },
  other: { label: 'Other', color: '#475569', tint: '#F1F5F9' },
}

export const labelInfo = (label: string | null | undefined) =>
  NETWORK_LABELS[(label ?? 'other') as NetworkLabel] ?? NETWORK_LABELS.other

export interface NetworkMessage {
  id: string
  from_org_id: string
  to_org_id: string
  thread_id: string
  broadcast_id: string | null
  subject: string | null
  body: string
  label: string
  is_read: boolean
  request_sms_ping: boolean
  created_at: string
  from_org_name: string | null
  to_org_name: string | null
}

/** One row per network conversation, from this pharmacy's point of view. */
export interface NetworkThread {
  threadId: string
  otherOrgId: string
  otherOrgName: string
  subject: string | null
  label: string
  lastBody: string
  lastAt: string
  lastFromMe: boolean
  unread: number
}

export interface NetworkPharmacy {
  pharmacy_id: number
  ods_code: string | null
  organisation_name: string
  address1: string | null
  city: string | null
  postcode: string | null
  distance_km: number | null
  is_on_platform: boolean
  linked_org_id: string | null
  linked_org_name: string | null
  accepts_sms_pings?: boolean
}

/** The NHS pharmacy this org is linked to on the network. */
export interface NetworkLink {
  pharmacy_id: number
  linked_at: string
  /** False while our team checks a link whose postcode/ODS didn't match the NHS record. */
  is_verified: boolean
  pharmacy: { id: number; ods_code: string | null; organisation_name: string; address1: string | null; city: string | null; postcode: string | null } | null
}

export interface OdsPharmacy {
  id: number
  ods_code: string | null
  organisation_name: string
  address1: string | null
  city: string | null
  postcode: string | null
  /** Already linked by another PharmStation account. */
  taken: boolean
}

export interface NetworkContact {
  id: string
  label: string | null
  phone_number: string
  is_enabled: boolean
  pause_until: string | null
  notify_start: string
  notify_end: string
}

export interface NetworkSetup {
  verification: 'pending' | 'verified' | 'rejected' | null
  verificationNote: string | null
  link: NetworkLink | null
  networkEnabled: boolean
  smsPingsEnabled: boolean
  contacts: NetworkContact[]
}

/** UK mobile in any common format → "+447xxxxxxxxx", or null. */
export function normaliseUkMobile(raw: string): string | null {
  let n = raw.replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  else if (n.startsWith('00')) n = n.slice(2)
  else if (n.startsWith('0')) n = `44${n.slice(1)}`
  return /^447\d{9}$/.test(n) ? `+${n}` : null
}

const PING_STATUS_TEXT: Record<string, string> = {
  recipient_disabled: 'they have text alerts turned off',
  no_contacts_available: 'no numbers are available right now (quiet hours or paused)',
  rate_limited: 'you already alerted them in the last 15 minutes',
  failed: 'the text could not be delivered',
}

export interface SmsConversation {
  phone: string
  patientId: string | null
  patientName: string | null
  lastBody: string
  lastAt: string
  unread: number
}

export interface SmsThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  at: string
  status?: string | null
}

export interface AlertItem {
  id: string
  is_read: boolean
  created_at: string
  notification: {
    id: string
    org_id: string
    event_type: string
    title: string
    body: string | null
    link: string | null
    metadata: Record<string, unknown> | null
  }
}

interface CommsState {
  threads: NetworkThread[]
  networkLoading: boolean
  networkError: string | null
  networkUnread: number

  thread: NetworkMessage[]
  threadLoading: boolean

  searchResults: NetworkPharmacy[]
  searchLoading: boolean

  setup: NetworkSetup | null
  setupLoading: boolean
  odsResults: OdsPharmacy[]
  odsLoading: boolean

  sms: SmsConversation[]
  smsLoading: boolean
  smsError: string | null
  smsUnread: number
  smsThread: SmsThreadMessage[]
  smsThreadLoading: boolean

  alerts: AlertItem[]
  alertsLoading: boolean
  alertsError: string | null
  alertsUnread: number
  /** Conversation to open when the app was launched from a push. */
  pendingOpen: { threadId?: string; phone?: string } | null
  setPendingOpen: (v: { threadId?: string; phone?: string } | null) => void

  loadNetwork: () => Promise<void>
  openThread: (threadId: string) => Promise<void>
  sendNetworkMessage: (input: {
    toOrgIds: string[]
    body: string
    subject?: string | null
    label: NetworkLabel
    threadId?: string
    urgent?: boolean
  }) => Promise<string | null>
  searchPharmacies: (search: string) => Promise<void>

  loadSetup: () => Promise<void>
  searchOds: (query: string) => Promise<void>
  linkPharmacy: (pharmacyId: number) => Promise<void>
  unlinkPharmacy: () => Promise<void>
  /** "This is ours" for a pharmacy another account has linked. Returns the case reference. */
  disputeLink: (pharmacyId: number, message: string) => Promise<string>
  saveNetworkSettings: (patch: { network_enabled?: boolean; sms_pings_enabled?: boolean }) => Promise<void>
  addContact: (input: { phone: string; label: string | null; start: string; end: string }) => Promise<void>
  updateContact: (id: string, patch: Partial<Pick<NetworkContact, 'is_enabled' | 'pause_until'>>) => Promise<void>
  deleteContact: (id: string) => Promise<void>

  loadSms: () => Promise<void>
  openSmsThread: (phone: string) => Promise<void>
  sendSmsReply: (phone: string, patientId: string | null, body: string) => Promise<void>

  loadAlerts: () => Promise<void>
  markAlertRead: (id: string) => Promise<void>
  markAllAlertsRead: () => Promise<void>

  subscribe: () => void
  unsubscribe: () => void
}

function orgId() {
  return useAuthStore.getState().organisation?.id ?? null
}

function userId() {
  return useAuthStore.getState().userProfile?.id ?? null
}

/** RFC 4122 v4 id. Hermes has no crypto.randomUUID. */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function toThreads(messages: NetworkMessage[], myOrgId: string): NetworkThread[] {
  const byThread = new Map<string, NetworkMessage[]>()
  for (const m of messages) {
    const list = byThread.get(m.thread_id) ?? []
    list.push(m)
    byThread.set(m.thread_id, list)
  }
  const threads: NetworkThread[] = []
  for (const [threadId, list] of byThread) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const first = list[0]
    const last = list[list.length - 1]
    const lastFromMe = last.from_org_id === myOrgId
    const otherOrgId = first.from_org_id === myOrgId ? first.to_org_id : first.from_org_id
    const otherOrgName = (first.from_org_id === myOrgId ? first.to_org_name : first.from_org_name) || 'Unknown pharmacy'
    threads.push({
      threadId,
      otherOrgId,
      otherOrgName,
      subject: first.subject,
      label: first.label,
      lastBody: last.body,
      lastAt: last.created_at,
      lastFromMe,
      unread: list.filter((m) => m.to_org_id === myOrgId && !m.is_read).length,
    })
  }
  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

let channel: RealtimeChannel | null = null
let smsThreadPhone: string | null = null

export const useCommsStore = create<CommsState>((set, get) => ({
  threads: [],
  networkLoading: false,
  networkError: null,
  networkUnread: 0,
  thread: [],
  threadLoading: false,
  searchResults: [],
  searchLoading: false,
  setup: null,
  setupLoading: false,
  odsResults: [],
  odsLoading: false,
  sms: [],
  smsLoading: false,
  smsError: null,
  smsUnread: 0,
  smsThread: [],
  smsThreadLoading: false,
  alerts: [],
  alertsLoading: false,
  alertsError: null,
  alertsUnread: 0,
  pendingOpen: null,
  setPendingOpen: (v) => set({ pendingOpen: v }),

  // ---------------------------------------------------------------- network
  loadNetwork: async () => {
    const org = orgId()
    if (!org) return
    set({ networkLoading: true, networkError: null })
    const { data, error } = await userClient
      .from('ps_network_messages')
      .select('id, from_org_id, to_org_id, thread_id, broadcast_id, subject, body, label, is_read, request_sms_ping, created_at, from_org_name, to_org_name')
      .or(`from_org_id.eq.${org},to_org_id.eq.${org}`)
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) {
      set({ networkLoading: false, networkError: error.message })
      return
    }
    const threads = toThreads((data ?? []) as NetworkMessage[], org)
    set({
      threads,
      networkLoading: false,
      networkUnread: threads.reduce((sum, t) => sum + t.unread, 0),
    })
  },

  openThread: async (threadId) => {
    const org = orgId()
    if (!org) return
    if (get().thread[0]?.thread_id !== threadId) set({ thread: [] })
    set({ threadLoading: true })
    const { data, error } = await userClient
      .from('ps_network_messages')
      .select('id, from_org_id, to_org_id, thread_id, broadcast_id, subject, body, label, is_read, request_sms_ping, created_at, from_org_name, to_org_name')
      .eq('thread_id', threadId)
      .or(`from_org_id.eq.${org},to_org_id.eq.${org}`)
      .order('created_at', { ascending: true })
    if (error) {
      set({ threadLoading: false, networkError: error.message })
      return
    }
    set({ thread: (data ?? []) as NetworkMessage[], threadLoading: false })
    const unread = ((data ?? []) as NetworkMessage[]).filter((m) => m.to_org_id === org && !m.is_read)
    if (unread.length) {
      await userClient
        .from('ps_network_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('to_org_id', org)
        .eq('is_read', false)
      set((s) => {
        const threads = s.threads.map((t) => (t.threadId === threadId ? { ...t, unread: 0 } : t))
        return {
          threads,
          thread: s.thread.map((m) => (m.to_org_id === org ? { ...m, is_read: true } : m)),
          networkUnread: threads.reduce((sum, t) => sum + t.unread, 0),
        }
      })
    }
  },

  sendNetworkMessage: async ({ toOrgIds, body, subject = null, label, threadId, urgent = false }) => {
    const org = orgId()
    if (!org) throw new Error('Connect a pharmacy first.')
    const broadcastId = toOrgIds.length > 1 ? uuid() : null
    const rows = toOrgIds.map((to) => {
      const id = uuid()
      return {
        id,
        from_org_id: org,
        to_org_id: to,
        thread_id: threadId ?? id,
        broadcast_id: broadcastId,
        subject: subject || null,
        body,
        label,
        request_sms_ping: urgent,
      }
    })
    const { data, error } = await userClient.from('ps_network_messages').insert(rows).select('id, from_org_id, to_org_id, thread_id, broadcast_id, subject, body, label, is_read, request_sms_ping, created_at, from_org_name, to_org_name')
    if (error) {
      if (error.code === '42501') throw new Error('This pharmacy is not accepting network messages, or your pharmacy is not verified yet.')
      throw new Error(error.message)
    }
    const inserted = (data ?? []) as NetworkMessage[]
    if (threadId && get().thread[0]?.thread_id === threadId) {
      set((s) => ({ thread: [...s.thread, ...inserted] }))
    }
    let pingNote: string | null = null
    if (urgent && inserted.length) {
      const { data: ping, error: pingError } = await userClient.functions.invoke('sms-works', {
        body: { action: 'network_ping', org_id: org, message_ids: inserted.map((m) => m.id) },
      })
      const err = pingError?.message ?? (ping as { error?: string } | null)?.error
      if (err) {
        pingNote = `Your message was delivered, but the text alert failed: ${err}`
      } else {
        const summary = ping as { sent: number; total: number; results: { status: string }[] }
        if (summary.total === 1) {
          const status = summary.results[0]?.status
          pingNote = status === 'sent'
            ? 'Message sent, and their phone has been texted.'
            : `Message sent. No text alert: ${PING_STATUS_TEXT[status] ?? status}. They will still see it in PharmStation.`
        } else {
          pingNote = `Message sent to ${summary.total} pharmacies. ${summary.sent} of them were also texted; the rest have alerts off, are in quiet hours, or were alerted by you recently.`
        }
      }
    }
    void get().loadNetwork()
    return pingNote
  },

  searchPharmacies: async (search) => {
    const org = orgId()
    if (!org) return
    set({ searchLoading: true })
    const { data, error } = await userClient.rpc('ps_network_search', {
      p_org_id: org,
      p_search: search,
      p_radius_km: search.trim() ? 500 : 15,
      p_only_platform: true,
      p_limit: 40,
    })
    set({
      searchLoading: false,
      searchResults: error ? [] : ((data ?? []) as NetworkPharmacy[]).filter((p) => p.linked_org_id && p.linked_org_id !== org),
      networkError: error ? error.message : get().networkError,
    })
  },

  // ---------------------------------------------------------------- network setup
  loadSetup: async () => {
    const org = orgId()
    if (!org) return
    set({ setupLoading: true })
    const [orgRes, linkRes, settingsRes, contactsRes] = await Promise.all([
      userClient.from('ps_organisations').select('verification_status, verification_note').eq('id', org).maybeSingle(),
      userClient.from('ps_org_pharmacy_link')
        .select('pharmacy_id, linked_at, is_verified, pharmacy:pharmacy_id(id, ods_code, organisation_name, address1, city, postcode)')
        .eq('org_id', org).maybeSingle(),
      userClient.from('ps_network_settings').select('network_enabled, sms_pings_enabled').eq('org_id', org).maybeSingle(),
      userClient.from('ps_network_sms_contacts')
        .select('id, label, phone_number, is_enabled, pause_until, notify_start, notify_end')
        .eq('org_id', org).order('created_at', { ascending: true }),
    ])
    const link = linkRes.data as unknown as (Omit<NetworkLink, 'pharmacy'> & { pharmacy: NetworkLink['pharmacy'] | NetworkLink['pharmacy'][] }) | null
    set({
      setupLoading: false,
      setup: {
        verification: (orgRes.data?.verification_status as NetworkSetup['verification']) ?? null,
        verificationNote: (orgRes.data?.verification_note as string | null) ?? null,
        link: link ? { ...link, pharmacy: Array.isArray(link.pharmacy) ? link.pharmacy[0] ?? null : link.pharmacy } : null,
        networkEnabled: settingsRes.data?.network_enabled ?? true,
        smsPingsEnabled: settingsRes.data?.sms_pings_enabled ?? false,
        contacts: (contactsRes.data ?? []) as NetworkContact[],
      },
    })
  },

  searchOds: async (query) => {
    const q = query.trim().replace(/[,()%]/g, ' ')
    if (q.length < 2) { set({ odsResults: [] }); return }
    set({ odsLoading: true })
    const { data, error } = await userClient
      .from('pharmacies')
      .select('id, ods_code, organisation_name, address1, city, postcode')
      .or(`organisation_name.ilike.%${q}%,postcode.ilike.%${q}%,ods_code.ilike.%${q}%`)
      .order('organisation_name')
      .limit(25)
    if (error) { set({ odsLoading: false, odsResults: [] }); return }
    const rows = (data ?? []) as Omit<OdsPharmacy, 'taken'>[]
    let taken = new Set<number>()
    if (rows.length) {
      const { data: links } = await userClient
        .from('ps_org_pharmacy_link').select('pharmacy_id, org_id')
        .in('pharmacy_id', rows.map((r) => r.id))
      taken = new Set((links ?? []).filter((l) => l.org_id !== orgId()).map((l) => l.pharmacy_id as number))
    }
    set({ odsLoading: false, odsResults: rows.map((r) => ({ ...r, taken: taken.has(r.id) })) })
  },

  linkPharmacy: async (pharmacyId) => {
    const org = orgId()
    if (!org) throw new Error('Connect a pharmacy first.')
    const { error } = await userClient
      .from('ps_org_pharmacy_link')
      .upsert({ org_id: org, pharmacy_id: pharmacyId }, { onConflict: 'org_id' })
    if (error) {
      if (error.code === '23505') throw new Error('Another PharmStation account has already linked this pharmacy. If it is yours, contact hello@pharmstation.co.uk.')
      if (error.code === '42501') throw new Error('Only owners and managers can change the linked pharmacy, and your pharmacy must be verified first.')
      throw new Error(error.message)
    }
    await get().loadSetup()
  },

  disputeLink: async (pharmacyId, message) => {
    const org = orgId()
    if (!org) throw new Error('Connect a pharmacy first.')
    const { data, error } = await userClient.rpc('ps_network_dispute_link', {
      p_org_id: org, p_pharmacy_id: pharmacyId, p_message: message,
    })
    if (error) throw new Error(error.message)
    return data as string
  },

  unlinkPharmacy: async () => {
    const org = orgId()
    if (!org) return
    const { data, error } = await userClient.from('ps_org_pharmacy_link').delete().eq('org_id', org).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Only owners and managers can unlink the pharmacy.')
    await get().loadSetup()
  },

  saveNetworkSettings: async (patch) => {
    const org = orgId()
    const cur = get().setup
    if (!org || !cur) return
    const next = {
      network_enabled: patch.network_enabled ?? cur.networkEnabled,
      sms_pings_enabled: patch.sms_pings_enabled ?? cur.smsPingsEnabled,
    }
    set({ setup: { ...cur, networkEnabled: next.network_enabled, smsPingsEnabled: next.sms_pings_enabled } })
    const { error } = await userClient
      .from('ps_network_settings')
      .upsert({ org_id: org, ...next, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
    if (error) {
      set({ setup: cur })
      throw new Error(error.message)
    }
  },

  addContact: async ({ phone, label, start, end }) => {
    const org = orgId()
    const cur = get().setup
    if (!org || !cur) return
    const normalised = normaliseUkMobile(phone)
    if (!normalised) throw new Error('Enter a UK mobile number, for example 07700 900123. Text alerts cannot go to landlines.')
    if (cur.contacts.some((c) => normaliseUkMobile(c.phone_number) === normalised)) throw new Error('That number is already on the list.')
    const { data, error } = await userClient
      .from('ps_network_sms_contacts')
      .insert({ org_id: org, phone_number: normalised, label, is_enabled: true, pause_until: null, notify_start: start, notify_end: end })
      .select('id, label, phone_number, is_enabled, pause_until, notify_start, notify_end')
      .single()
    if (error) throw new Error(error.message)
    set({ setup: { ...cur, contacts: [...cur.contacts, data as NetworkContact] } })
  },

  updateContact: async (id, patch) => {
    const cur = get().setup
    if (!cur) return
    const { data, error } = await userClient
      .from('ps_network_sms_contacts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, label, phone_number, is_enabled, pause_until, notify_start, notify_end')
      .single()
    if (error) throw new Error(error.message)
    set({ setup: { ...cur, contacts: cur.contacts.map((c) => (c.id === id ? (data as NetworkContact) : c)) } })
  },

  deleteContact: async (id) => {
    const cur = get().setup
    if (!cur) return
    const { error } = await userClient.from('ps_network_sms_contacts').delete().eq('id', id)
    if (error) throw new Error(error.message)
    set({ setup: { ...cur, contacts: cur.contacts.filter((c) => c.id !== id) } })
  },

  // ---------------------------------------------------------------- SMS
  loadSms: async () => {
    const org = orgId()
    if (!org) return
    set({ smsLoading: true, smsError: null })
    const { data, error } = await userClient
      .from('ps_sms_inbound')
      .select('id, normalized_from_number, from_number, content, received_at, is_read, patient_id, patient:ps_patients(first_name, last_name)')
      .eq('org_id', org)
      .eq('disposition', 'inbox')
      .order('received_at', { ascending: false })
      .limit(200)
    if (error) {
      set({ smsLoading: false, smsError: error.message })
      return
    }
    type Row = {
      normalized_from_number: string | null
      from_number: string
      content: string
      received_at: string
      is_read: boolean
      patient_id: string | null
      patient: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
    }
    const byPhone = new Map<string, SmsConversation>()
    for (const row of (data ?? []) as Row[]) {
      const phone = row.normalized_from_number || row.from_number
      const patient = Array.isArray(row.patient) ? row.patient[0] : row.patient
      const name = patient ? [patient.first_name, patient.last_name].filter(Boolean).join(' ') || null : null
      const existing = byPhone.get(phone)
      if (!existing) {
        byPhone.set(phone, {
          phone,
          patientId: row.patient_id,
          patientName: name,
          lastBody: row.content,
          lastAt: row.received_at,
          unread: row.is_read ? 0 : 1,
        })
      } else {
        if (!row.is_read) existing.unread += 1
        if (!existing.patientName && name) existing.patientName = name
        if (!existing.patientId && row.patient_id) existing.patientId = row.patient_id
      }
    }
    const sms = [...byPhone.values()]
    set({ sms, smsLoading: false, smsUnread: sms.reduce((sum, c) => sum + c.unread, 0) })
  },

  openSmsThread: async (phone) => {
    const org = orgId()
    if (!org) return
    if (smsThreadPhone !== phone) set({ smsThread: [] })
    smsThreadPhone = phone
    set({ smsThreadLoading: true })
    const [inbound, outbound] = await Promise.all([
      userClient.from('ps_sms_inbound').select('id, content, received_at')
        .eq('org_id', org).eq('normalized_from_number', phone).order('received_at', { ascending: true }),
      userClient.from('ps_messages').select('id, body, created_at, status')
        .eq('org_id', org).eq('channel', 'sms').eq('recipient_phone_normalized', phone).order('created_at', { ascending: true }),
    ])
    if (inbound.error || outbound.error) {
      set({ smsThreadLoading: false, smsError: inbound.error?.message ?? outbound.error?.message ?? 'Could not load conversation' })
      return
    }
    const thread: SmsThreadMessage[] = [
      ...(inbound.data ?? []).map((r: { id: string; content: string; received_at: string }) => ({ id: r.id, direction: 'inbound' as const, body: r.content, at: r.received_at })),
      ...(outbound.data ?? []).map((r: { id: string; body: string | null; created_at: string; status: string | null }) => ({ id: r.id, direction: 'outbound' as const, body: r.body ?? '', at: r.created_at, status: r.status })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    set({ smsThread: thread, smsThreadLoading: false })

    const conv = get().sms.find((c) => c.phone === phone)
    if (!conv || conv.unread > 0) {
      await userClient.from('ps_sms_inbound').update({ is_read: true })
        .eq('org_id', org).eq('normalized_from_number', phone).eq('disposition', 'inbox').eq('is_read', false)
      set((s) => {
        const sms = s.sms.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c))
        return { sms, smsUnread: sms.reduce((sum, c) => sum + c.unread, 0) }
      })
    }
  },

  sendSmsReply: async (phone, patientId, body) => {
    const org = orgId()
    if (!org) throw new Error('Connect a pharmacy first.')
    const { data, error } = await userClient.functions.invoke('sms-works', {
      body: {
        action: 'send_sms',
        org_id: org,
        phone_number: phone,
        patient_id: patientId,
        body,
        feature: 'patient_message',
        reference: `patient_message:${phone}`,
        use_reply_number: true,
      },
    })
    if (error) {
      let message = error.message
      try {
        const ctx = (error as { context?: Response }).context
        const parsed = ctx ? await ctx.json() : null
        if (parsed?.error) message = String(parsed.error)
      } catch { /* keep generic message */ }
      throw new Error(message)
    }
    const result = data as { id?: string; body?: string; created_at?: string; status?: string; error?: string } | null
    if (result?.error) throw new Error(result.error)
    set((s) => ({
      smsThread: [...s.smsThread, {
        id: result?.id ?? uuid(),
        direction: 'outbound',
        body: result?.body ?? body,
        at: result?.created_at ?? new Date().toISOString(),
        status: result?.status ?? 'sent',
      }],
    }))
  },

  // ---------------------------------------------------------------- alerts
  loadAlerts: async () => {
    const org = orgId()
    const user = userId()
    if (!org || !user) return
    set({ alertsLoading: true, alertsError: null })
    const { data, error } = await userClient
      .from('ps_notification_receipts')
      .select('id, is_read, created_at, notification:ps_notifications!inner(id, org_id, event_type, title, body, link, metadata)')
      .eq('user_id', user)
      .eq('notification.org_id', org)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      set({ alertsLoading: false, alertsError: error.message })
      return
    }
    const alerts = ((data ?? []) as unknown as AlertItem[]).map((a) => ({
      ...a,
      notification: Array.isArray(a.notification) ? a.notification[0] : a.notification,
    }))
    set({ alerts, alertsLoading: false, alertsUnread: alerts.filter((a) => !a.is_read).length })
  },

  markAlertRead: async (id) => {
    const target = get().alerts.find((a) => a.id === id)
    if (!target || target.is_read) return
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, is_read: true } : a)),
      alertsUnread: Math.max(0, s.alertsUnread - 1),
    }))
    await userClient.from('ps_notification_receipts').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id)
  },

  markAllAlertsRead: async () => {
    const ids = get().alerts.filter((a) => !a.is_read).map((a) => a.id)
    if (!ids.length) return
    set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, is_read: true })), alertsUnread: 0 }))
    await userClient.from('ps_notification_receipts').update({ is_read: true, read_at: new Date().toISOString() }).in('id', ids)
  },

  // ---------------------------------------------------------------- realtime
  subscribe: () => {
    const org = orgId()
    const user = userId()
    if (!org || !user || channel) return
    channel = userClient
      .channel(`mobile-comms-${org}-${user}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ps_network_messages', filter: `to_org_id=eq.${org}` }, (payload) => {
        void get().loadNetwork()
        const msg = payload.new as NetworkMessage
        if (get().thread[0]?.thread_id === msg.thread_id) void get().openThread(msg.thread_id)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ps_sms_inbound', filter: `org_id=eq.${org}` }, (payload) => {
        void get().loadSms()
        const row = payload.new as { normalized_from_number?: string | null }
        const open = get().smsThread
        if (row.normalized_from_number && open.length && smsThreadPhone === row.normalized_from_number) {
          void get().openSmsThread(row.normalized_from_number)
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ps_notification_receipts', filter: `user_id=eq.${user}` }, () => {
        void get().loadAlerts()
      })
      .subscribe()
  },

  unsubscribe: () => {
    if (channel) void userClient.removeChannel(channel)
    channel = null
  },
}))
