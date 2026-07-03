// ============================================
// Locum Module Store — Zustand
// Locum is a ROLE on the user account, not an account type.
// This store rides the user-layer session (getUserClient) and holds the
// locum-specific profile row (ps_locum_profiles). RLS keys off auth.uid().
//
// isLoggedIn here simply means "a user-layer session exists" — the /locum/*
// route guards combine it with locumProfile to gate the portal.
// ============================================

import { create } from 'zustand'
import type { UserProfile, LocumProfile } from '@pharmstation/types'
import {
  getUserClient,
  userSignIn as _userSignIn,
  fetchLocumUserProfile,
  fetchLocumExtendedProfile,
} from '@pharmstation/supabase-client'
import { useAuthStore } from './auth-store'

export interface LocumAuthState {
  // Core user profile (ps_user_profiles) — mirror of the signed-in user
  userProfile: UserProfile | null
  // Extended locum profile (ps_locum_profiles) — null until the role is activated
  locumProfile: LocumProfile | null
  isLoggedIn: boolean
  loading: boolean

  // Actions
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

async function loadProfiles(userId: string) {
  const userProfile = await fetchLocumUserProfile(userId)
  const locumProfile = await fetchLocumExtendedProfile(userId)
  return { userProfile, locumProfile }
}

export const useLocumAuthStore = create<LocumAuthState>((set) => ({
  userProfile: null,
  locumProfile: null,
  isLoggedIn: false,
  loading: true,

  // ==========================================
  // Initialize — read the user-layer session, then stay in sync with the
  // auth store (staff logins/switches/logouts all flow through it).
  // ==========================================
  initialize: async () => {
    try {
      const { data: { session } } = await getUserClient().auth.getSession()
      if (session?.user) {
        const profiles = await loadProfiles(session.user.id)
        set({ ...profiles, isLoggedIn: true, loading: false })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }

    // Follow the user layer: login/switch loads profiles, logout clears
    useAuthStore.subscribe((state, prev) => {
      const uid = state.userSession?.user?.id
      const prevUid = prev.userSession?.user?.id
      if (uid && uid !== prevUid) {
        loadProfiles(uid)
          .then((profiles) => set({ ...profiles, isLoggedIn: true }))
          .catch(() => { /* profiles may not exist yet */ })
      } else if (!uid && prevUid) {
        set({ userProfile: null, locumProfile: null, isLoggedIn: false })
      }
    })
  },

  // ==========================================
  // Login — user-layer sign-in via the portal door.
  // Handles first-login profile recovery (email-confirmation flow), then
  // syncs the main auth store so the whole app knows who's signed in.
  // ==========================================
  login: async (email: string, password: string) => {
    set({ loading: true })
    try {
      const { data, error } = await _userSignIn(email, password)
      if (error) throw error
      if (!data.user) throw new Error('Login returned no session.')

      let userProfile = await fetchLocumUserProfile(data.user.id)

      // Profile row missing — happens when email confirmation was required and
      // the profiles weren't created yet. Recover from registration-time data.
      if (!userProfile) {
        const pending = localStorage.getItem('locum_pending_profile')
        if (pending) {
          try {
            const p = JSON.parse(pending)
            const fullName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.fullName || email
            await getUserClient().from('ps_user_profiles').insert({
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
        // Auth succeeded but no profile row at all — create a minimal one.
        try {
          await getUserClient().from('ps_user_profiles').insert({
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

      // Tell the main auth store the user layer changed (no membership required)
      await useAuthStore.getState().refreshUserLayer()

      set({ userProfile, locumProfile, isLoggedIn: true, loading: false })
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },

  // ==========================================
  // Logout — user-layer sign-out (org session, if any, survives)
  // ==========================================
  logout: async () => {
    await useAuthStore.getState().userLogout()
    set({ userProfile: null, locumProfile: null, isLoggedIn: false })
  },

  // ==========================================
  // Refresh — re-fetch profiles for the current session
  // ==========================================
  refreshProfile: async () => {
    try {
      const { data: { session } } = await getUserClient().auth.getSession()
      const uid = session?.user?.id
      if (!uid) return
      const profiles = await loadProfiles(uid)
      set({ ...profiles, isLoggedIn: true })
    } catch {
      // Silent — non-critical
    }
  },
}))
