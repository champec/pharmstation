import { create } from 'zustand'
import type { Service, ServiceLibraryItem, ServiceForm, ServiceFormField, ServiceDelivery, OutcomeType } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface CompleteDeliveryInput {
  orgId: string
  serviceId: string
  /** Idempotency key: reuse the same value when retrying the same delivery */
  clientRef: string
  patientId?: string | null
  formId?: string | null
  formData: Record<string, unknown>
  notes?: string
  outcome?: {
    outcome_type: OutcomeType
    referral_to?: string | null
    referral_reason?: string | null
    referral_urgency?: 'routine' | 'urgent' | 'emergency' | null
    advice_given?: string | null
  } | null
  medications?: Array<{
    drug_id: string | null
    drug_name: string
    drug_form?: string | null
    drug_strength?: string | null
    dose?: string | null
    quantity?: number | null
    unit?: string | null
    is_controlled_drug?: boolean
    sort_order?: number
  }>
  draftId?: string | null
}

export interface ServiceState {
  // Data
  services: Service[]
  libraryItems: ServiceLibraryItem[]
  activeService: Service | null
  activeForms: ServiceForm[]
  activeFields: ServiceFormField[]
  deliveries: ServiceDelivery[]
  loading: boolean
  error: string | null

  // Actions
  fetchServices: (orgId: string) => Promise<void>
  fetchLibrary: () => Promise<void>
  fetchServiceDetail: (serviceId: string) => Promise<void>
  fetchFormFields: (formId: string) => Promise<void>
  createService: (service: Partial<Service>) => Promise<Service>
  subscribeToLibraryService: (orgId: string, libraryItemId: string) => Promise<Service>
  updateService: (serviceId: string, updates: Partial<Service>) => Promise<void>
  /** Hide a service. Its delivery records are always kept. */
  archiveService: (serviceId: string) => Promise<void>
  createForm: (serviceId: string, name: string) => Promise<ServiceForm>
  saveFields: (formId: string, fields: Partial<ServiceFormField>[]) => Promise<void>
  /** Hide a form. Past records keep a snapshot of the form they used. */
  archiveForm: (formId: string) => Promise<void>
  // Deliveries
  fetchDeliveries: (orgId: string, serviceId?: string) => Promise<void>
  /** Save delivery + outcome + medicines in one transaction (idempotent on clientRef) */
  completeDelivery: (input: CompleteDeliveryInput) => Promise<ServiceDelivery>
  clearError: () => void
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  services: [],
  libraryItems: [],
  activeService: null,
  activeForms: [],
  activeFields: [],
  deliveries: [],
  loading: false,
  error: null,

  fetchServices: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_services')
        .select('*')
        .eq('org_id', orgId)
        .is('archived_at', null)
        .order('name')
      if (error) throw error
      set({ services: data as Service[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchLibrary: async () => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_service_library')
        .select('*')
        .eq('is_active', true)
        .order('category')
      if (error) throw error
      set({ libraryItems: data as ServiceLibraryItem[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchServiceDetail: async (serviceId) => {
    set({ loading: true, error: null, activeService: null, activeForms: [], activeFields: [] })
    try {
      const client = getUserClient()
      const serviceRes = await client.from('ps_services').select('*').eq('id', serviceId).single()
      if (serviceRes.error) throw serviceRes.error
      const service = serviceRes.data as Service

      // Custom forms belong to the org service; canonical forms belong to the
      // subscribed library template. Keep those ownership paths explicit.
      const ownerFilter = service.library_service_id
        ? `org_service_id.eq.${serviceId},service_id.eq.${service.library_service_id}`
        : `org_service_id.eq.${serviceId}`
      const formsRes = await client
        .from('ps_service_forms')
        .select('*')
        .or(ownerFilter)
        .is('archived_at', null)
        .order('created_at')
      if (formsRes.error) throw formsRes.error

      set({
        activeService: service,
        activeForms: formsRes.data as ServiceForm[],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchFormFields: async (formId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_service_form_fields')
        .select('*')
        .eq('form_id', formId)
        .order('display_order')
      if (error) throw error
      set({ activeFields: data as ServiceFormField[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createService: async (service) => {
    const { data, error } = await getUserClient()
      .from('ps_services')
      .insert(service)
      .select()
      .single()
    if (error) throw error
    const created = data as Service
    set((s) => ({ services: [...s.services, created] }))
    return created
  },

  subscribeToLibraryService: async (orgId, libraryItemId) => {
    const lib = get().libraryItems.find((l) => l.id === libraryItemId)
    if (!lib) throw new Error('Library item not found')
    // Re-adding a service that was removed brings back the archived one, so
    // its history stays under a single service.
    const client = getUserClient()
    const { data: archived, error: archivedErr } = await client
      .from('ps_services')
      .select('*')
      .eq('org_id', orgId)
      .eq('library_service_id', libraryItemId)
      .not('archived_at', 'is', null)
      .limit(1)
      .maybeSingle()
    if (archivedErr) throw archivedErr
    if (archived) {
      const { data: restored, error } = await client
        .from('ps_services')
        .update({ archived_at: null, is_active: true })
        .eq('id', (archived as Service).id)
        .select()
        .single()
      if (error) throw error
      const svc = restored as Service
      set((s) => ({ services: [...s.services, svc] }))
      return svc
    }
    return get().createService({
      org_id: orgId,
      library_service_id: libraryItemId,
      name: lib.name,
      description: lib.description,
      is_nhs_service: lib.is_nhs_service ?? false,
    })
  },

  updateService: async (serviceId, updates) => {
    const { data, error } = await getUserClient()
      .from('ps_services')
      .update(updates)
      .eq('id', serviceId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('You do not have permission to change this service.')
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === serviceId ? { ...svc, ...updates } : svc
      ),
      activeService:
        s.activeService?.id === serviceId
          ? { ...s.activeService, ...updates }
          : s.activeService,
    }))
  },

  archiveService: async (serviceId) => {
    const { data, error } = await getUserClient()
      .from('ps_services')
      .update({ archived_at: new Date().toISOString(), is_active: false, is_public: false })
      .eq('id', serviceId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('You do not have permission to remove this service.')
    set((s) => ({
      services: s.services.filter((svc) => svc.id !== serviceId),
    }))
  },

  createForm: async (serviceId, name) => {
    try {
      const activeService = get().activeService
      if (activeService?.id === serviceId && activeService.is_nhs_service) {
        throw new Error('Standard NHS service forms cannot be edited. Create a custom service to build your own form.')
      }
      const { data, error } = await getUserClient()
        .from('ps_service_forms')
        .insert({ org_service_id: serviceId, service_id: null, name })
        .select()
        .single()
      if (error) throw error
      const created = data as ServiceForm
      set((s) => ({ activeForms: [...s.activeForms, created], error: null }))
      return created
    } catch (e: any) {
      set({ error: e.message })
      throw e
    }
  },

  saveFields: async (formId, fields) => {
    // One transaction on the server: replaces the fields in order and bumps
    // the form version. Past records keep a snapshot of the old version.
    const payload = fields.map((f) => ({
      label: f.label,
      field_key: f.field_key,
      field_type: f.field_type,
      options: f.options ?? null,
      is_required: f.is_required ?? false,
    }))
    const { error } = await getUserClient().rpc('ps_save_service_form_fields', {
      p_form_id: formId,
      p_fields: payload,
    })
    if (error) throw error
    // Refresh
    await get().fetchFormFields(formId)
  },

  archiveForm: async (formId) => {
    const { data, error } = await getUserClient()
      .from('ps_service_forms')
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq('id', formId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('You do not have permission to remove this form.')
    set((s) => ({
      activeForms: s.activeForms.filter((f) => f.id !== formId),
    }))
  },

  fetchDeliveries: async (orgId, serviceId) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_service_deliveries')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (serviceId) query = query.eq('service_id', serviceId)
      const { data, error } = await query
      if (error) throw error
      set({ deliveries: data as ServiceDelivery[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  completeDelivery: async (input) => {
    const { data, error } = await getUserClient().rpc('ps_complete_service_delivery', {
      p_org_id: input.orgId,
      p_service_id: input.serviceId,
      p_client_ref: input.clientRef,
      p_patient_id: input.patientId || null,
      p_form_id: input.formId || null,
      p_form_data: input.formData ?? {},
      p_notes: input.notes ?? '',
      p_outcome: input.outcome ?? null,
      p_medications: input.medications ?? [],
      p_draft_id: input.draftId || null,
    })
    if (error) throw error
    const created = data as ServiceDelivery
    set((s) => ({
      deliveries: [created, ...s.deliveries.filter((d) => d.id !== created.id)],
    }))
    return created
  },

  clearError: () => set({ error: null }),
}))

