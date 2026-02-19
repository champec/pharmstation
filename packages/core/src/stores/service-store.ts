import { create } from 'zustand'
import type { Service, ServiceLibraryItem, ServiceForm, ServiceFormField, ServiceDelivery } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

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
  deleteService: (serviceId: string) => Promise<void>
  createForm: (serviceId: string, name: string) => Promise<ServiceForm>
  saveFields: (formId: string, fields: Partial<ServiceFormField>[]) => Promise<void>
  deleteForm: (formId: string) => Promise<void>
  // Deliveries
  fetchDeliveries: (orgId: string, serviceId?: string) => Promise<void>
  createDelivery: (delivery: Partial<ServiceDelivery>) => Promise<ServiceDelivery>
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
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [serviceRes, formsRes] = await Promise.all([
        client.from('ps_services').select('*').eq('id', serviceId).single(),
        client.from('ps_service_forms').select('*').eq('service_id', serviceId).order('created_at'),
      ])
      if (serviceRes.error) throw serviceRes.error
      if (formsRes.error) throw formsRes.error
      set({
        activeService: serviceRes.data as Service,
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
    return get().createService({
      org_id: orgId,
      library_service_id: libraryItemId,
      name: lib.name,
      description: lib.description,
    })
  },

  updateService: async (serviceId, updates) => {
    const { error } = await getUserClient()
      .from('ps_services')
      .update(updates)
      .eq('id', serviceId)
    if (error) throw error
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

  deleteService: async (serviceId) => {
    const { error } = await getUserClient()
      .from('ps_services')
      .delete()
      .eq('id', serviceId)
    if (error) throw error
    set((s) => ({
      services: s.services.filter((svc) => svc.id !== serviceId),
    }))
  },

  createForm: async (serviceId, name) => {
    const { data, error } = await getUserClient()
      .from('ps_service_forms')
      .insert({ service_id: serviceId, name })
      .select()
      .single()
    if (error) throw error
    const created = data as ServiceForm
    set((s) => ({ activeForms: [...s.activeForms, created] }))
    return created
  },

  saveFields: async (formId, fields) => {
    const client = getUserClient()
    // Delete existing fields for this form
    await client.from('ps_service_form_fields').delete().eq('form_id', formId)
    // Insert all fields with correct display_order
    const rows = fields.map((f, i) => ({
      ...f,
      form_id: formId,
      display_order: i,
    }))
    if (rows.length > 0) {
      const { error } = await client.from('ps_service_form_fields').insert(rows)
      if (error) throw error
    }
    // Refresh
    await get().fetchFormFields(formId)
  },

  deleteForm: async (formId) => {
    const { error } = await getUserClient()
      .from('ps_service_forms')
      .delete()
      .eq('id', formId)
    if (error) throw error
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

  createDelivery: async (delivery) => {
    const { data, error } = await getUserClient()
      .from('ps_service_deliveries')
      .insert(delivery)
      .select()
      .single()
    if (error) throw error
    const created = data as ServiceDelivery
    set((s) => ({ deliveries: [created, ...s.deliveries] }))
    return created
  },

  clearError: () => set({ error: null }),
}))

