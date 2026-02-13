// ============================================
// Register Store — Zustand
// Active ledger, draft state, lock version
// ============================================

import { create } from 'zustand'
import type { RegisterLedger, RegisterEntry } from '@pharmstation/types'

export interface RegisterState {
  // Active ledger
  activeLedger: RegisterLedger | null
  setActiveLedger: (ledger: RegisterLedger | null) => void

  // Entries for active ledger
  entries: RegisterEntry[]
  setEntries: (entries: RegisterEntry[]) => void
  entriesLoading: boolean
  setEntriesLoading: (loading: boolean) => void

  // Draft entry state
  isDraftActive: boolean
  setDraftActive: (active: boolean) => void

  // Last used values (for "From Previous" feature)
  lastUsedValues: Record<string, string>
  setLastUsedValue: (key: string, value: string) => void

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

  isDraftActive: false,
  setDraftActive: (active) => set({ isDraftActive: active }),

  lastUsedValues: JSON.parse(localStorage.getItem('ps-last-used-values') || '{}'),
  setLastUsedValue: (key, value) => {
    const updated = { ...get().lastUsedValues, [key]: value }
    localStorage.setItem('ps-last-used-values', JSON.stringify(updated))
    set({ lastUsedValues: updated })
  },

  reset: () =>
    set({
      activeLedger: null,
      entries: [],
      entriesLoading: false,
      isDraftActive: false,
    }),
}))
