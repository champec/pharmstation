// ============================================
// Register Store — Zustand
// Active ledger, draft state, lock version
// Subscribed registers per org
// ============================================

import { create } from 'zustand'
import type { RegisterLedger, RegisterEntry, SubscribedRegister } from '@pharmstation/types'

export interface RegisterState {
  // Active ledger
  activeLedger: RegisterLedger | null
  setActiveLedger: (ledger: RegisterLedger | null) => void

  // Entries for active ledger
  entries: RegisterEntry[]
  setEntries: (entries: RegisterEntry[]) => void
  entriesLoading: boolean
  setEntriesLoading: (loading: boolean) => void

  // Subscribed registers for the org
  subscribedRegisters: SubscribedRegister[]
  setSubscribedRegisters: (registers: SubscribedRegister[]) => void
  subscribedLoading: boolean
  setSubscribedLoading: (loading: boolean) => void

  // Draft entry state
  isDraftActive: boolean
  setDraftActive: (active: boolean) => void

  // Last used values (for "From Previous" feature)
  lastUsedValues: Record<string, string>
  setLastUsedValue: (key: string, value: string) => void

  // Last invoice from localStorage (reusable across registers)
  lastInvoice: string
  setLastInvoice: (invoice: string) => void

  // Clear
  reset: () => void
}

export const useRegisterStore = create<RegisterState>((set, get) => ({
  activeLedger: null,
  setActiveLedger: (ledger) => set({ activeLedger: ledger }),

  entries: [],
  setEntries: (entries) => set({ entries }),
  entriesLoading: false,
  setEntriesLoading: (loading) => set({ entriesLoading: loading }),

  subscribedRegisters: [],
  setSubscribedRegisters: (registers) => set({ subscribedRegisters: registers }),
  subscribedLoading: false,
  setSubscribedLoading: (loading) => set({ subscribedLoading: loading }),

  isDraftActive: false,
  setDraftActive: (active) => set({ isDraftActive: active }),

  lastUsedValues: JSON.parse(localStorage.getItem('ps-last-used-values') || '{}'),
  setLastUsedValue: (key, value) => {
    const updated = { ...get().lastUsedValues, [key]: value }
    localStorage.setItem('ps-last-used-values', JSON.stringify(updated))
    set({ lastUsedValues: updated })
  },

  lastInvoice: localStorage.getItem('ps-last-invoice') || '',
  setLastInvoice: (invoice) => {
    localStorage.setItem('ps-last-invoice', invoice)
    set({ lastInvoice: invoice })
  },

  reset: () =>
    set({
      activeLedger: null,
      entries: [],
      entriesLoading: false,
      isDraftActive: false,
    }),
}))
