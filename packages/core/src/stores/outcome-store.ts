import { create } from 'zustand'
import type { DeliveryOutcome, OutcomeMedication, OutcomeType } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface OutcomeState {
  outcomes: DeliveryOutcome[]
  loading: boolean
  saving: boolean
  error: string | null

  fetchOutcomes: (deliveryId: string) => Promise<void>
  saveOutcome: (outcome: {
    delivery_id: string
    org_id: string
    outcome_type: OutcomeType
    referral_to?: string | null
    referral_reason?: string | null
    referral_urgency?: 'routine' | 'urgent' | 'emergency' | null
    advice_given?: string | null
    created_by?: string | null
    medications?: Array<{
      drug_id: string | null
      drug_name: string
      drug_form?: string | null
      drug_strength?: string | null
      dose?: string | null
      quantity?: number | null
      unit?: string | null
      directions?: string | null
      supply_type?: 'dispensed' | 'owed' | 'not_supplied' | null
      is_controlled_drug?: boolean
      sort_order?: number
    }>
  }) => Promise<DeliveryOutcome>
  deleteOutcome: (outcomeId: string) => Promise<void>
  clearOutcomes: () => void
  clearError: () => void
}

export const useOutcomeStore = create<OutcomeState>((set, get) => ({
  outcomes: [],
  loading: false,
  saving: false,
  error: null,

  fetchOutcomes: async (deliveryId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_delivery_outcomes')
        .select('*, medications:ps_delivery_outcome_medications(*)')
        .eq('delivery_id', deliveryId)
        .order('created_at')
      if (error) throw error
      set({ outcomes: (data ?? []) as DeliveryOutcome[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  saveOutcome: async ({ medications, ...outcomeData }) => {
    set({ saving: true, error: null })
    try {
      const client = getUserClient()

      // 1. Insert the outcome record
      const { data: outcome, error: outcomeErr } = await client
        .from('ps_delivery_outcomes')
        .insert(outcomeData)
        .select()
        .single()
      if (outcomeErr) throw outcomeErr

      const created = outcome as DeliveryOutcome

      // 2. Insert medications if any
      if (medications && medications.length > 0) {
        const medRows = medications.map((m, i) => ({
          outcome_id: created.id,
          drug_id: m.drug_id,
          drug_name: m.drug_name,
          drug_form: m.drug_form ?? null,
          drug_strength: m.drug_strength ?? null,
          dose: m.dose ?? null,
          quantity: m.quantity ?? null,
          unit: m.unit ?? null,
          directions: m.directions ?? null,
          supply_type: m.supply_type ?? null,
          is_controlled_drug: m.is_controlled_drug ?? false,
          sort_order: m.sort_order ?? i,
        }))

        const { data: meds, error: medsErr } = await client
          .from('ps_delivery_outcome_medications')
          .insert(medRows)
          .select()
        if (medsErr) throw medsErr

        created.medications = (meds ?? []) as OutcomeMedication[]
      } else {
        created.medications = []
      }

      set((s) => ({
        outcomes: [...s.outcomes, created],
        saving: false,
      }))

      return created
    } catch (e: any) {
      set({ error: e.message, saving: false })
      throw e
    }
  },

  deleteOutcome: async (outcomeId) => {
    try {
      // Cascade will delete medications
      const { error } = await getUserClient()
        .from('ps_delivery_outcomes')
        .delete()
        .eq('id', outcomeId)
      if (error) throw error
      set((s) => ({
        outcomes: s.outcomes.filter((o) => o.id !== outcomeId),
      }))
    } catch (e: any) {
      set({ error: e.message })
    }
  },

  clearOutcomes: () => set({ outcomes: [], error: null }),
  clearError: () => set({ error: null }),
}))
