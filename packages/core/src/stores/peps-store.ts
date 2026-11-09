import { create } from 'zustand'
import type {
  PepsPrescriber,
  PepsOrg,
  PepsPrescription,
  PepsPrescriptionItem,
  PepsEvent,
  PepsSpineResult,
  PepsDmdResult,
  PepsLoggableEventType,
  Patient,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

// Shape passed in when writing a new prescription
export interface NewPrescriptionInput {
  // Kept for callers; the server uses the signed-in user's active prescriber record.
  prescriber?: PepsPrescriber
  origin_org_id: string | null
  patient_id: string | null
  patient_snapshot: PepsPrescription['patient_snapshot']
  prescribing_org_id: string | null
  prescribing_org_snapshot: PepsPrescription['prescribing_org_snapshot']
  prescription_type: PepsPrescription['prescription_type']
  animal_name: string | null
  animal_owner: string | null
  cascade_wording: string | null
  repeats: number
  signature_data?: string | null
  items: Array<Partial<PepsPrescriptionItem>>
  // Routing: null assigned_org_id => open spine; otherwise direct to a pharmacy
  assigned_org_id: string | null
  // Stored on the 'created' audit event (e.g. controlled-drug declaration)
  created_metadata?: Record<string, unknown>
}

export interface PepsState {
  // Prescriber identity (the logged-in user's prescriber registration)
  myPrescriber: PepsPrescriber | null
  prescriberLoaded: boolean

  // Queue / lists
  queue: PepsPrescription[]
  myPrescriptions: PepsPrescription[]
  activePrescription: PepsPrescription | null
  activeItems: PepsPrescriptionItem[]
  activeEvents: PepsEvent[]
  spineResults: PepsSpineResult[]

  loading: boolean
  error: string | null

  // Prescriber identity
  fetchMyPrescriber: () => Promise<PepsPrescriber | null>
  saveMyPrescriber: (input: Partial<PepsPrescriber>) => Promise<PepsPrescriber>

  // Directory lookups
  searchPrescribers: (query: string) => Promise<PepsPrescriber[]>
  searchPepsOrgs: (query: string, orgId: string | null) => Promise<PepsOrg[]>
  createPepsOrg: (org: Partial<PepsOrg>, orgId: string | null) => Promise<PepsOrg>
  searchPharmacies: (query: string) => Promise<Array<{ id: string; name: string; ods_code: string | null }>>
  searchDmd: (query: string) => Promise<PepsDmdResult[]>
  searchPatients: (orgId: string, query: string) => Promise<Patient[]>

  // Writing
  createPrescription: (input: NewPrescriptionInput) => Promise<PepsPrescription>

  // Queue / spine
  fetchQueue: (orgId: string) => Promise<void>
  fetchMyPrescriptions: () => Promise<void>
  fetchAvailableForOrg: (orgId: string) => Promise<PepsPrescription[]>
  downloadFromSpine: (orgId: string, ids?: string[]) => Promise<PepsPrescription[]>
  claimByReference: (orgId: string, ref: string, check: string) => Promise<PepsPrescription | null>
  spineSearch: (query: string) => Promise<PepsSpineResult[]>
  logEvent: (prescriptionId: string, eventType: PepsLoggableEventType, metadata?: Record<string, unknown>) => Promise<void>

  // Detail + actions
  fetchPrescription: (id: string) => Promise<void>
  dispense: (id: string, supplied?: Array<Record<string, unknown>>) => Promise<PepsPrescription>
  cancel: (id: string, reason: string) => Promise<PepsPrescription>
  release: (id: string) => Promise<PepsPrescription>
  transfer: (id: string, toOrgId: string) => Promise<PepsPrescription>

  clearError: () => void
}

export const usePepsStore = create<PepsState>((set, get) => ({
  myPrescriber: null,
  prescriberLoaded: false,
  queue: [],
  myPrescriptions: [],
  activePrescription: null,
  activeItems: [],
  activeEvents: [],
  spineResults: [],
  loading: false,
  error: null,

  // --- Prescriber identity ---

  fetchMyPrescriber: async () => {
    const { data: auth } = await getUserClient().auth.getUser()
    const uid = auth.user?.id
    if (!uid) {
      set({ prescriberLoaded: true })
      return null
    }
    const { data, error } = await getUserClient()
      .from('ps_peps_prescribers')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) {
      set({ error: error.message, prescriberLoaded: true })
      return null
    }
    const prescriber = (data as PepsPrescriber | null) ?? null
    set({ myPrescriber: prescriber, prescriberLoaded: true })
    return prescriber
  },

  saveMyPrescriber: async (input) => {
    const { data: auth } = await getUserClient().auth.getUser()
    const uid = auth.user?.id
    if (!uid) throw new Error('Not signed in')
    const existing = get().myPrescriber
    if (existing) {
      const { data, error } = await getUserClient()
        .from('ps_peps_prescribers')
        .update(input)
        .eq('id', existing.id)
        .select()
        .single()
      if (error) throw error
      const saved = data as PepsPrescriber
      set({ myPrescriber: saved })
      return saved
    }
    const { data, error } = await getUserClient()
      .from('ps_peps_prescribers')
      .insert({ ...input, user_id: uid })
      .select()
      .single()
    if (error) throw error
    const saved = data as PepsPrescriber
    set({ myPrescriber: saved })
    return saved
  },

  // --- Directory lookups ---

  searchPrescribers: async (query) => {
    const q = query.trim()
    if (q.length < 2) return []
    const { data, error } = await getUserClient()
      .from('ps_peps_prescribers')
      .select('*')
      .or(`full_name.ilike.%${q}%,registration_number.ilike.%${q}%`)
      .eq('status', 'active')
      .limit(8)
    if (error) throw error
    return (data ?? []) as PepsPrescriber[]
  },

  searchPepsOrgs: async (query, orgId) => {
    const q = query.trim()
    if (q.length < 2) return []
    // RLS already scopes: global orgs + this org's private ones.
    const { data, error } = await getUserClient()
      .from('ps_peps_orgs')
      .select('*')
      .or(`name.ilike.%${q}%,ods_code.ilike.%${q}%`)
      .order('is_global', { ascending: false })
      .limit(8)
    if (error) throw error
    return (data ?? []) as PepsOrg[]
  },

  createPepsOrg: async (org, orgId) => {
    const payload = {
      ...org,
      is_global: !!org.ods_code,
      created_by_org_id: orgId,
    }
    const { data, error } = await getUserClient()
      .from('ps_peps_orgs')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return data as PepsOrg
  },

  searchPharmacies: async (query) => {
    const q = query.trim()
    if (q.length < 2) return []
    const { data, error } = await getUserClient().rpc('ps_peps_pharmacy_search', { p_query: q })
    if (error) throw error
    return (data ?? []) as Array<{ id: string; name: string; ods_code: string | null }>
  },

  searchDmd: async (query) => {
    const q = query.trim()
    if (q.length < 2) return []
    const { data, error } = await getUserClient().rpc('ps_peps_dmd_search', { p_query: q })
    if (error) throw error
    return (data ?? []) as PepsDmdResult[]
  },

  searchPatients: async (orgId, query) => {
    const words = query.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    let qb = getUserClient().from('ps_patients').select('*').eq('organisation_id', orgId)
    if (words.length === 1) {
      const w = words[0]
      qb = qb.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,nhs_number.ilike.%${w}%`)
    } else {
      for (const w of words) qb = qb.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`)
    }
    const { data, error } = await qb.limit(10)
    if (error) throw error
    return (data ?? []) as Patient[]
  },

  // --- Writing ---

  createPrescription: async (input) => {
    set({ error: null })
    // One server call: prescription, items and audit events in one transaction.
    // The server makes the reference, takes the prescriber and signature from the
    // signed-in user's active prescriber record, and sets the expiry date.
    const { data, error } = await getUserClient().rpc('ps_peps_create_prescription', {
      p: {
        origin_org_id: input.origin_org_id,
        patient_id: input.patient_id,
        patient_snapshot: input.patient_snapshot,
        prescribing_org_id: input.prescribing_org_id,
        prescribing_org_snapshot: input.prescribing_org_snapshot,
        prescription_type: input.prescription_type,
        animal_name: input.animal_name,
        animal_owner: input.animal_owner,
        cascade_wording: input.cascade_wording,
        repeats: input.repeats,
        assigned_org_id: input.assigned_org_id,
        created_metadata: input.created_metadata ?? {},
        items: input.items.map((it) => ({
          dmd_code: it.dmd_code ?? null,
          dmd_type: it.dmd_type ?? 'free_text',
          drug_name: it.drug_name ?? '',
          strength: it.strength ?? null,
          form: it.form ?? null,
          quantity: it.quantity ?? '',
          dosage: it.dosage ?? null,
          notes: it.notes ?? null,
        })),
      },
    })
    if (error) throw error
    return (Array.isArray(data) ? data[0] : data) as PepsPrescription
  },

  // --- Queue / spine ---

  fetchQueue: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_peps_prescriptions')
        .select('*, items:ps_peps_prescription_items(*)')
        .eq('assigned_org_id', orgId)
        .order('prescription_date', { ascending: false })
      if (error) throw error
      set({ queue: (data ?? []) as PepsPrescription[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchMyPrescriptions: async () => {
    set({ loading: true, error: null })
    try {
      const { data: auth } = await getUserClient().auth.getUser()
      const uid = auth.user?.id
      if (!uid) {
        set({ myPrescriptions: [], loading: false })
        return
      }
      const { data, error } = await getUserClient()
        .from('ps_peps_prescriptions')
        .select('*, items:ps_peps_prescription_items(*), assigned_org:ps_organisations!ps_peps_prescriptions_assigned_org_id_fkey(id, name)')
        .eq('written_by', uid)
        .order('created_at', { ascending: false })
      if (error) throw error
      set({ myPrescriptions: (data ?? []) as PepsPrescription[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchAvailableForOrg: async (orgId) => {
    // Prescriptions sent directly to this pharmacy and not yet downloaded.
    // Open-spine prescriptions are not listable: claim them with claimByReference.
    const { data, error } = await getUserClient()
      .from('ps_peps_prescriptions')
      .select('*, items:ps_peps_prescription_items(*)')
      .eq('status', 'available')
      .eq('assigned_org_id', orgId)
      .order('prescription_date', { ascending: false })
    if (error) throw error
    return (data ?? []) as PepsPrescription[]
  },

  downloadFromSpine: async (orgId, ids) => {
    set({ error: null })
    const { data, error } = await getUserClient().rpc('ps_peps_download', {
      p_org_id: orgId,
      p_ids: ids ?? null,
    })
    if (error) throw error
    const downloaded = (data ?? []) as PepsPrescription[]
    await get().fetchQueue(orgId)
    return downloaded
  },

  claimByReference: async (orgId, ref, check) => {
    set({ error: null })
    const { data, error } = await getUserClient().rpc('ps_peps_claim', {
      p_org_id: orgId,
      p_ref: ref.trim(),
      p_check: check.trim(),
    })
    if (error) throw error
    const rx = (Array.isArray(data) ? data[0] : data) as PepsPrescription | null
    // The RPC returns an all-null row when nothing matched.
    if (!rx?.id) return null
    await get().fetchQueue(orgId)
    return rx
  },

  logEvent: async (prescriptionId, eventType, metadata = {}) => {
    const { error } = await getUserClient().rpc('ps_peps_log_event', {
      p_id: prescriptionId,
      p_event_type: eventType,
      p_metadata: metadata,
    })
    if (error) throw error
  },

  spineSearch: async (query) => {
    const { data, error } = await getUserClient().rpc('ps_peps_spine_search', { p_query: query })
    if (error) throw error
    const results = (data ?? []) as PepsSpineResult[]
    set({ spineResults: results })
    return results
  },

  // --- Detail + actions ---

  fetchPrescription: async (id) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_peps_prescriptions')
        .select('*, items:ps_peps_prescription_items(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      const rx = data as PepsPrescription
      const { data: events } = await getUserClient()
        .from('ps_peps_events')
        .select('*')
        .eq('prescription_id', id)
        .order('created_at', { ascending: true })
      set({
        activePrescription: rx,
        activeItems: (rx.items ?? []).sort((a, b) => a.line_order - b.line_order),
        activeEvents: (events ?? []) as PepsEvent[],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  dispense: async (id, supplied) => {
    const { data, error } = await getUserClient().rpc('ps_peps_dispense', {
      p_id: id,
      p_supplied: supplied && supplied.length > 0 ? supplied : null,
    })
    if (error) throw error
    const rx = (Array.isArray(data) ? data[0] : data) as PepsPrescription
    set((s) => ({ activePrescription: s.activePrescription?.id === id ? rx : s.activePrescription }))
    return rx
  },

  cancel: async (id, reason) => {
    const { data, error } = await getUserClient().rpc('ps_peps_cancel', { p_id: id, p_reason: reason })
    if (error) throw error
    const rx = (Array.isArray(data) ? data[0] : data) as PepsPrescription
    set((s) => ({ activePrescription: s.activePrescription?.id === id ? rx : s.activePrescription }))
    return rx
  },

  release: async (id) => {
    const { data, error } = await getUserClient().rpc('ps_peps_release', { p_id: id })
    if (error) throw error
    const rx = (Array.isArray(data) ? data[0] : data) as PepsPrescription
    set((s) => ({ activePrescription: s.activePrescription?.id === id ? rx : s.activePrescription }))
    return rx
  },

  transfer: async (id, toOrgId) => {
    const { data, error } = await getUserClient().rpc('ps_peps_transfer', {
      p_id: id,
      p_to_org_id: toOrgId,
    })
    if (error) throw error
    const rx = (Array.isArray(data) ? data[0] : data) as PepsPrescription
    set((s) => ({ activePrescription: s.activePrescription?.id === id ? rx : s.activePrescription }))
    return rx
  },

  clearError: () => set({ error: null }),
}))
