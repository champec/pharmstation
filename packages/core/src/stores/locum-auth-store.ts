// ============================================
// Locum Auth Store — Zustand
// Separate from main auth store — locums don't
// require org context. Uses ps-locum-session
// storage key to avoid conflict with staff client.
// ============================================

import { create } from 'zustand'
import type { UserProfile, LocumProfile } from '@pharmstation/types'
import {
  getLocumClient,
  locumSignIn as _locumSignIn,
  locumSignOut as _locumSignOut,
  fetchLocumUserProfile,
  fetchLocumExtendedProfile,
} from '@pharmstation/supabase-client'

export interface LocumAuthState {
  // Core user profile (ps_user_profiles)
  userProfile: UserProfile | null
  // Extended locum profile (ps_locum_profiles) — null if not yet completed onboarding
  locumProfile: LocumProfile | null
  isLoggedIn: boolean
  loading: boolean

  // Actions
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const useLocumAuthStore = create<LocumAuthState>((set, get) => ({
  userProfile: null,
  locumProfile: null,
  isLoggedIn: false,
  loading: true,

  // ==========================================
  // Initialize — restore session from storage
  // ==========================================
  initialize: async () => {
    try {
      const { data: { session } } = await getLocumClient().auth.getSession()
      if (session?.user) {
        const userProfile = await fetchLocumUserProfile(session.user.id)
        const locumProfile = await fetchLocumExtendedProfile(session.user.id)
        set({ userProfile, locumProfile, isLoggedIn: true, loading: false })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }

    // Listen for sign-out
    getLocumClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({ userProfile: null, locumProfile: null, isLoggedIn: false })
      }
    })
  },

  // ==========================================
  // Login
  // ==========================================
  login: async (email: string, password: string) => {
    set({ loading: true })
    try {
      const data = await _locumSignIn(email, password)
      if (!data.user) throw new Error('Login returned no session.')

      let userProfile = await fetchLocumUserProfile(data.user.id)

      // Profile row missing — happens when email confirmation was required and the
      // user confirmed their email but the profiles weren't created yet.
      // Try to recover from localStorage data stored at registration time.
      if (!userProfile) {
        const pending = localStorage.getItem('locum_pending_profile')
        if (pending) {
          try {
            const p = JSON.parse(pending)
            const client = (await import('@pharmstation/supabase-client')).getLocumClient()
            const fullName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.fullName || email
            await client.from('ps_user_profiles').insert({
              id: data.user.id,
              email: p.email ?? email,
              full_name: fullName,
              first_name: p.firstName ?? null,
              last_name: p.lastName ?? null,
              default_role: 'locum',
            })
            localStorage.removeItem('locum_pending_profile')
            userProfile = await fetchLocumUserProfile(data.user.id)
          } catch {
            // Insert may fail if row was partially created — try fetching again
            userProfile = await fetchLocumUserProfile(data.user.id)
          }
        }
      }

      if (!userProfile) {
        // Auth succeeded but no profile row at all — this shouldn't normally happen,
        // but if it does we create a minimal profile from the auth user's email.
        try {
          const client = (await import('@pharmstation/supabase-client')).getLocumClient()
          await client.from('ps_user_profiles').insert({
            id: data.user.id,
            email: data.user.email ?? email,
            full_name: data.user.email ?? email,
            default_role: 'locum',
          })
          userProfile = await fetchLocumUserProfile(data.user.id)
        } catch {
          throw new Error('Could not load your account profile. Please contact support.')
        }
      }

      // Load locum-specific profile (may be null if not yet completed)
      const locumProfile = await fetchLocumExtendedProfile(data.user.id)

      set({ userProfile, locumProfile, isLoggedIn: true, loading: false })
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },

  // ==========================================
  // Logout
  // ==========================================
  logout: async () => {
    await _locumSignOut()
    set({ userProfile: null, locumProfile: null, isLoggedIn: false })
  },

  // ==========================================
  // Refresh — re-fetch after profile updates
  // ==========================================
  refreshProfile: async () => {
    const { userProfile } = get()
    if (!userProfile) return
    try {
      const locumProfile = await fetchLocumExtendedProfile(userProfile.id)
      set({ locumProfile })
    } catch {
      // Silent — non-critical
    }
  },
}))
