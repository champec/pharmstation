// ============================================
// UI Store — Zustand
// Side nav state, right panel, breadcrumbs
// ============================================

import { create } from 'zustand'

export type SideNavMode = 'expanded' | 'icons' | 'hidden'

export interface UIState {
  // Side nav
  sideNavMode: SideNavMode
  setSideNavMode: (mode: SideNavMode) => void
  toggleSideNav: () => void

  // Right panel
  rightPanelOpen: boolean
  rightPanelContent: string | null
  openRightPanel: (content: string) => void
  closeRightPanel: () => void

  // Global loading
  globalLoading: boolean
  setGlobalLoading: (loading: boolean) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  // Side nav
  sideNavMode: 'expanded',
  setSideNavMode: (mode) => set({ sideNavMode: mode }),
  toggleSideNav: () => {
    const current = get().sideNavMode
    const next: SideNavMode =
      current === 'expanded' ? 'icons' : current === 'icons' ? 'hidden' : 'expanded'
    set({ sideNavMode: next })
  },

  // Right panel
  rightPanelOpen: false,
  rightPanelContent: null,
  openRightPanel: (content) => set({ rightPanelOpen: true, rightPanelContent: content }),
  closeRightPanel: () => set({ rightPanelOpen: false, rightPanelContent: null }),

  // Global loading
  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),
}))
