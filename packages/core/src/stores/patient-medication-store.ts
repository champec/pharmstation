import { create } from 'zustand'
import type { PatientMedication, BnfDrugSearchResult } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface PatientMedicationState {
  medications: PatientMedication[]
  drugSearchResults: BnfDrugSearchResult[]
  loading: boolean
  searching: boolean
  error: string | null

  fetchMedications: (patientId: string) => Promise<void>
  addMedication: (data: {
    organisation_id: string
    patient_id: string
    drug_id: string
    drug_name: string
    drug_form?: string
    drug_strength?: string
    dose?: string
    quantity?: number
    notes?: string
  }) => Promise<PatientMedication>
  updateMedication: (id: string, updates: Partial<PatientMedication>) => Promise<void>
  removeMedication: (id: string) => Promise<void>
  toggleActive: (id: string) => Promise<void>
  searchDrugs: (query: string) => Promise<BnfDrugSearchResult[]>
  clearSearch: () => void
  clearError: () => void
}

export const usePatientMedicationStore = create<PatientMedicationState>((set, get) => ({
  medications: [],
  drugSearchResults: [],
  loading: false,
  searching: false,
  error: null,

  fetchMedications: async (patientId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_patient_medications')
        .select('*')
        .eq('patient_id', patientId)
        .order('drug_name')
      if (error) throw error
      set({ medications: (data ?? []) as PatientMedication[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  addMedication: async (data) => {
    const { data: created, error } = await getUserClient()
      .from('ps_patient_medications')
      .insert(data)
      .select()
      .single()
    if (error) throw error
    const med = created as PatientMedication
    set((s) => ({ medications: [...s.medications, med] }))
    return med
  },

  updateMedication: async (id, updates) => {
    const { error } = await getUserClient()
      .from('ps_patient_medications')
      .update(updates)
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      medications: s.medications.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    }))
  },

  removeMedication: async (id) => {
    const { error } = await getUserClient()
      .from('ps_patient_medications')
      .delete()
      .eq('id', id)
    if (error) throw error
    set((s) => ({ medications: s.medications.filter((m) => m.id !== id) }))
  },

  toggleActive: async (id) => {
    const med = get().medications.find((m) => m.id === id)
    if (!med) return
    const newActive = !med.is_active
    const { error } = await getUserClient()
      .from('ps_patient_medications')
      .update({ is_active: newActive })
      .eq('id', id)
    if (error) throw error
    set((s) => ({
      medications: s.medications.map((m) =>
        m.id === id ? { ...m, is_active: newActive } : m
      ),
    }))
  },

  searchDrugs: async (query) => {
    if (query.length < 2) {
      set({ drugSearchResults: [] })
      return []
    }
    set({ searching: true })
    try {
      const { data, error } = await getUserClient()
        .from('bnf_medicinal_forms')
        .select('id, drug_id, name, form, brand_name, manufacturer, activeIngredients, controlledDrugSchedule, drug:bnf_drugs(name)')
        .ilike('name', `%${query}%`)
        .limit(30)
      if (error) throw error

      const results: BnfDrugSearchResult[] = (data ?? []).map((row: any) => ({
        id: row.id,
        drug_id: row.drug_id,
        name: row.name,
        form: row.form,
        brand_name: row.brand_name,
        manufacturer: row.manufacturer,
        activeIngredients: row.activeIngredients,
        controlledDrugSchedule: row.controlledDrugSchedule,
        drug_name: row.drug?.name ?? null,
      }))

      set({ drugSearchResults: results, searching: false })
      return results
    } catch (e: any) {
      set({ searching: false })
      return []
    }
  },

  clearSearch: () => set({ drugSearchResults: [] }),
  clearError: () => set({ error: null }),
}))
