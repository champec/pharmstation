import { create } from 'zustand'
import type {
  PepsPrescriber,
  PepsOrg,
  PepsPrescription,
  PepsPrescriptionItem,
  PepsEvent,
  PepsSpineResult,
  PepsDmdResult,
  Patient,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

// Shape passed in when writing a new prescription
export interface NewPrescriptionInput {
  prescriber: PepsPrescriber
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
  signature_data: string | null
  items: Array<Partial<PepsPrescriptionItem>>
  // Routing: null assigned_org_id => open spine; otherwise direct to a pharmacy
  assigned_org_id: string | null
}

function generateRef(): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  const ts = Date.now().toString(36).slice(-4).toUpperCase()
  return `PX-${ts}-${rand}`
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
  spineSearch: (query: string) => Promise<PepsSpineResult[]>

  // Detail + actions
  fetchPrescription: (id: string) => Promise<void>
  dispense: (id: string) => Promise<PepsPrescription>
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
    const { data: auth } = await getUserClient().auth.getUser()
    const uid = auth.user?.id
    if (!uid) throw new Error('Not signed in')

    const ref = generateRef()
    const prescriberSnapshot = {
      full_name: input.prescriber.full_name,
      prescriber_type: input.prescriber.prescriber_type,
      registration_number: input.prescriber.registration_number,
      registration_body: input.prescriber.registration_body,
      address: input.prescriber.address,
    }

    const { data: rxData, error: rxError } = await getUserClient()
      .from('ps_peps_prescriptions')
      .insert({
        prescription_ref: ref,
        prescriber_id: input.prescriber.id,
        prescriber_snapshot: prescriberSnapshot,
        written_by: uid,
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
        signature_data: input.signature_data,
        status: 'available',
        assigned_org_id: input.assigned_org_id,
      })
      .select()
      .single()
    if (rxError) throw rxError
    const rx = rxData as PepsPrescription

    if (input.items.length > 0) {
      const itemsPayload = input.items.map((it, i) => ({
        prescription_id: rx.id,
        line_order: i,
        dmd_code: it.dmd_code ?? null,
        dmd_type: it.dmd_type ?? 'free_text',
        drug_name: it.drug_name ?? '',
        strength: it.strength ?? null,
        form: it.form ?? null,
        quantity: it.quantity ?? '',
        dosage: it.dosage ?? null,
        notes: it.notes ?? null,
      }))
      const { error: itemsError } = await getUserClient()
        .from('ps_peps_prescription_items')
        .insert(itemsPayload)
      if (itemsError) throw itemsError
    }

    // Audit event: created + routed
    await getUserClient().from('ps_peps_events').insert({
      prescription_id: rx.id,
      event_type: input.assigned_org_id ? 'directed' : 'sent_to_spine',
      to_org_id: input.assigned_org_id,
      actor_user_id: uid,
    })

    return rx
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
    // Prescriptions this pharmacy can fetch: open spine OR directed to them, not yet downloaded.
    const { data, error } = await getUserClient()
      .from('ps_peps_prescriptions')
      .select('*, items:ps_peps_prescription_items(*)')
      .eq('status', 'available')
      .or(`assigned_org_id.is.null,assigned_org_id.eq.${orgId}`)
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

  dispense: async (id) => {
    const { data, error } = await getUserClient().rpc('ps_peps_dispense', { p_id: id })
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
