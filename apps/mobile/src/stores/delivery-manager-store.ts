// ============================================
// Delivery manager store (mobile)
//
// The pharmacy side of deliveries on the phone: the board of rounds, one
// round's detail and actions, creating a round, drivers, and the
// redelivery queue. Writes are checked by the database (delivery_manage).
// ============================================

import { create } from 'zustand'

import { userClient } from '@/lib/supabase'
import { resolvePermissions, type Permissions, type UserRole } from '@/types/auth'
import type {
  DeliveryRound,
  DeliveryRoundStatus,
  DeliveryStop,
} from '@/types/deliveries'

const ROUND_SELECT = `
  *,
  patients:ps_delivery_round_patients(
    *,
    patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
    medications:ps_delivery_patient_medications(
      id,
      quantity,
      patient_medication:ps_patient_medications(id, drug_name, drug_form, drug_strength, dose)
    )
  )
`

export interface DriverOption {
  id: string
  name: string
}

export interface PatientResult {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  postcode: string | null
  address_line_1: string | null
}

export interface PatientMed {
  id: string
  drug_name: string
  drug_strength: string | null
  drug_form: string | null
  dose: string | null
  quantity: number | null
}

export interface NewStop {
  patient: PatientResult
  medications: Array<{ med: PatientMed; selected: boolean }>
  notes: string
}

export interface NewRoundInput {
  orgId: string
  title: string
  scheduledDate: string | null
  timeStart: string | null
  timeEnd: string | null
  notes: string
  driverId: string | null
  stops: NewStop[]
}

export type RedeliveryStop = DeliveryStop & {
  round: { id: string; title: string | null; scheduled_date: string | null } | null
}

export interface NotifyResult {
  sent: number
  failed: number
  noPhone: number
  optedOut: number
}

interface ManagerState {
  rounds: DeliveryRound[]
  activeRound: DeliveryRound | null
  drivers: DriverOption[]
  redeliveryQueue: RedeliveryStop[]
  loading: boolean
  saving: boolean
  error: string | null

  fetchRounds: (orgId: string) => Promise<void>
  fetchRound: (roundId: string) => Promise<void>
  fetchDrivers: (orgId: string) => Promise<void>
  createRound: (input: NewRoundInput) => Promise<string>
  updateRound: (roundId: string, updates: Partial<Pick<DeliveryRound,
    'status' | 'driver_id' | 'scheduled_date' | 'scheduled_time_start' | 'scheduled_time_end' | 'title' | 'notes'>>) => Promise<void>
  removeStop: (stopId: string) => Promise<void>
  deleteRound: (roundId: string) => Promise<void>
  notifyPatients: (round: DeliveryRound, orgId: string) => Promise<NotifyResult>
  searchPatients: (orgId: string, query: string) => Promise<PatientResult[]>
  fetchPatientMeds: (patientId: string) => Promise<PatientMed[]>
  fetchRedeliveryQueue: (orgId: string) => Promise<void>
  createRedeliveryRound: (stopIds: string[]) => Promise<string>
  resolveRedelivery: (stopId: string, status: 'returned' | 'cancelled') => Promise<void>
  clearError: () => void
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return 'Something went wrong.'
}

function sortStops(round: DeliveryRound): DeliveryRound {
  return {
    ...round,
    patients: [...(round.patients ?? [])].sort((a, b) => a.delivery_order - b.delivery_order),
  }
}

/** UK mobile/landline to +44 form, or null when it isn't a usable number. */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  let p = phone.replace(/[^\d+]/g, '')
  if (p.startsWith('00')) p = `+${p.slice(2)}`
  if (p.startsWith('0')) p = `+44${p.slice(1)}`
  if (!p.startsWith('+')) p = `+${p}`
  return p.length >= 11 ? p : null
}

export function formatTimeWindow(start: string | null, end: string | null) {
  const s = start?.slice(0, 5)
  const e = end?.slice(0, 5)
  if (s && e) return `between ${s} and ${e}`
  if (s) return `from ${s}`
  if (e) return `by ${e}`
  return ''
}

function reminderText(firstName: string | null, date: string | null, start: string | null, end: string | null) {
  const day = date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'soon'
  const window = formatTimeWindow(start, end)
  return `Hi ${firstName || 'there'}, your medicines will be delivered ${date ? `on ${day}` : day}${window ? ` ${window}` : ''}. Reply STOP to opt out.`
}

/** Strip characters that would break a PostgREST or() filter. */
function safeTerm(term: string) {
  return term.replace(/[,()%*\\]/g, ' ').trim()
}

export const useDeliveryManagerStore = create<ManagerState>((set, get) => ({
  rounds: [],
  activeRound: null,
  drivers: [],
  redeliveryQueue: [],
  loading: false,
  saving: false,
  error: null,

  fetchRounds: async (orgId) => {
    set({ loading: true, error: null })
    try {
      // Everything still open, plus rounds finished in the last 14 days.
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('organisation_id', orgId)
        .or(`status.in.(draft,scheduled,in_progress),completed_at.gte.${since}`)
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .limit(200)
      if (error) throw error
      set({ rounds: ((data ?? []) as DeliveryRound[]).map(sortStops), loading: false })
    } catch (e) {
      set({ error: message(e), loading: false })
    }
  },

  fetchRound: async (roundId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .select(ROUND_SELECT)
        .eq('id', roundId)
        .single()
      if (error) throw error
      const round = sortStops(data as DeliveryRound)
      set((s) => ({
        activeRound: round,
        rounds: s.rounds.map((r) => (r.id === round.id ? round : r)),
        loading: false,
      }))
    } catch (e) {
      set({ error: message(e), loading: false })
    }
  },

  fetchDrivers: async (orgId) => {
    try {
      const { data, error } = await userClient
        .from('ps_organisation_members')
        .select('id, role, permissions, user_profile:ps_user_profiles!user_id(full_name)')
        .eq('organisation_id', orgId)
        .eq('status', 'active')
      if (error) throw error
      const drivers = ((data ?? []) as unknown as Array<{
        id: string
        role: UserRole
        permissions: Permissions | null
        user_profile: { full_name: string | null } | Array<{ full_name: string | null }> | null
      }>)
        .filter((m) => resolvePermissions(m.role, m.permissions ?? {}).delivery_drive)
        .map((m) => {
          const profile = Array.isArray(m.user_profile) ? m.user_profile[0] : m.user_profile
          return { id: m.id, name: profile?.full_name || 'Name not recorded' }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      set({ drivers })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  createRound: async (input) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient.rpc('ps_delivery_create_round', {
        p_org_id: input.orgId,
        p_title: input.title,
        p_scheduled_date: input.scheduledDate,
        p_time_start: input.timeStart,
        p_time_end: input.timeEnd,
        p_notes: input.notes,
        p_driver_id: input.driverId,
        p_stops: input.stops.map((stop) => ({
          patient_id: stop.patient.id,
          notes: stop.notes,
          medications: stop.medications
            .filter((m) => m.selected)
            .map((m) => ({ patient_medication_id: m.med.id, quantity: m.med.quantity })),
        })),
      })
      if (error) throw error
      set({ saving: false })
      void get().fetchRounds(input.orgId)
      return data as string
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  updateRound: async (roundId, updates) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .update(updates)
        .eq('id', roundId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You do not have permission to change this delivery.')
      set({ saving: false })
      await get().fetchRound(roundId)
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  removeStop: async (stopId) => {
    const round = get().activeRound
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_round_patients')
        .delete()
        .eq('id', stopId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('A patient can only be removed while the round is a draft or scheduled.')
      set({ saving: false })
      if (round) await get().fetchRound(round.id)
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  deleteRound: async (roundId) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_rounds')
        .delete()
        .eq('id', roundId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Only draft or cancelled rounds can be deleted.')
      set((s) => ({
        saving: false,
        rounds: s.rounds.filter((r) => r.id !== roundId),
        activeRound: s.activeRound?.id === roundId ? null : s.activeRound,
      }))
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  notifyPatients: async (round, orgId) => {
    set({ saving: true, error: null })
    try {
      const [{ data: optOutRows, error: optErr }, { data: org }] = await Promise.all([
        userClient.from('ps_sms_opt_outs').select('phone_normalized').eq('org_id', orgId),
        userClient.from('ps_organisations').select('messaging_provider, nhs_channels_enabled').eq('id', orgId).maybeSingle(),
      ])
      // Fail closed: if we can't check who opted out, send nothing.
      if (optErr) throw new Error(`Could not check SMS opt-outs: ${optErr.message}`)
      const optOuts = new Set((optOutRows ?? []).map((o: { phone_normalized: string }) => o.phone_normalized))
      const fn = org?.messaging_provider === 'nhs_notify' && org?.nhs_channels_enabled ? 'nhs-notify' : 'sms-works'

      const result: NotifyResult = { sent: 0, failed: 0, noPhone: 0, optedOut: 0 }
      const texted = new Set<string>()
      for (const stop of round.patients) {
        if (stop.status !== 'pending') continue
        const phone = normalisePhone(stop.patient?.phone)
        if (!phone) { result.noPhone++; continue }
        if (optOuts.has(phone)) { result.optedOut++; continue }
        if (texted.has(phone)) continue
        texted.add(phone)
        const { data, error } = await userClient.functions.invoke(fn, {
          body: {
            action: 'notify',
            org_id: orgId,
            channel: 'sms',
            to: stop.patient?.phone,
            patient_id: stop.patient?.id,
            body: reminderText(stop.patient?.first_name ?? null, round.scheduled_date, round.scheduled_time_start, round.scheduled_time_end),
            feature: 'delivery',
            reference: `delivery_round_${round.id}`,
          },
        })
        if (error || (data && (data as { error?: string }).error)) result.failed++
        else result.sent++
      }
      set({ saving: false })
      return result
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  searchPatients: async (orgId, query) => {
    const words = safeTerm(query).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    let qb = userClient
      .from('ps_patients')
      .select('id, first_name, last_name, date_of_birth, postcode, address_line_1')
      .eq('organisation_id', orgId)
    if (words.length === 1) {
      const w = words[0]
      qb = qb.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,nhs_number.ilike.%${w}%,phone.ilike.%${w}%,postcode.ilike.%${w}%`)
    } else {
      for (const w of words) qb = qb.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`)
    }
    const { data, error } = await qb.order('last_name').limit(20)
    if (error) throw error
    return (data ?? []) as PatientResult[]
  },

  fetchPatientMeds: async (patientId) => {
    const { data, error } = await userClient
      .from('ps_patient_medications')
      .select('id, drug_name, drug_strength, drug_form, dose, quantity, is_active')
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .order('drug_name')
    if (error) throw error
    return (data ?? []) as PatientMed[]
  },

  fetchRedeliveryQueue: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_round_patients')
        .select(`
          *,
          patient:ps_patients(id, first_name, last_name, phone, address_line_1, address_line_2, city, postcode),
          medications:ps_delivery_patient_medications(id, quantity, patient_medication:ps_patient_medications(id, drug_name, drug_form, drug_strength, dose)),
          round:ps_delivery_rounds(id, title, scheduled_date)
        `)
        .eq('organisation_id', orgId)
        .in('status', ['failed', 'pending_redelivery', 'skipped'])
        .order('updated_at', { ascending: false })
      if (error) throw error
      set({ redeliveryQueue: (data ?? []) as RedeliveryStop[], loading: false })
    } catch (e) {
      set({ error: message(e), loading: false })
    }
  },

  createRedeliveryRound: async (stopIds) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient.rpc('ps_delivery_move_stops', {
        p_stop_ids: stopIds,
        p_target_round_id: null,
      })
      if (error) throw error
      set((s) => ({
        saving: false,
        redeliveryQueue: s.redeliveryQueue.filter((stop) => !stopIds.includes(stop.id)),
      }))
      return data as string
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  resolveRedelivery: async (stopId, status) => {
    set({ saving: true, error: null })
    try {
      const { data, error } = await userClient
        .from('ps_delivery_round_patients')
        .update({ status })
        .eq('id', stopId)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('This stop could not be updated.')
      set((s) => ({
        saving: false,
        redeliveryQueue: s.redeliveryQueue.filter((stop) => stop.id !== stopId),
      }))
    } catch (e) {
      set({ saving: false, error: message(e) })
      throw e
    }
  },

  clearError: () => set({ error: null }),
}))

export const ROUND_STATUS_LABEL: Record<DeliveryRoundStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
