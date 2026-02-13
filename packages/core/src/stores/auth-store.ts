// ============================================
// Auth Store — Zustand
// Manages dual org + user sessions
// ============================================

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type { Organisation, UserProfile, OrganisationMember, Permissions } from '@pharmstation/types'
import { resolvePermissions } from '@pharmstation/types'
import {
  getOrgClient,
  getUserClient,
  orgSignIn as _orgSignIn,
  orgSignOut as _orgSignOut,
  userSignIn as _userSignIn,
  userSignOut as _userSignOut,
  fetchOrganisation,
  fetchUserProfile,
  fetchOrgMembership,
} from '@pharmstation/supabase-client'

export interface AuthState {
  // Org layer
  orgSession: Session | null
  organisation: Organisation | null
  isOrgLoggedIn: boolean
  orgLoading: boolean

  // User layer
  userSession: Session | null
  activeUser: UserProfile | null
  membership: OrganisationMember | null
  isUserLoggedIn: boolean
  userLoading: boolean

  // Computed
  isFullyAuthenticated: boolean
  permissions: Permissions | null

  // Actions
  initialize: () => Promise<void>
  orgLogin: (email: string, password: string) => Promise<void>
  orgLogout: () => Promise<void>
  userLogin: (email: string, password: string) => Promise<void>
  userLogout: () => Promise<void>
  switchUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  orgSession: null,
  organisation: null,
  isOrgLoggedIn: false,
  orgLoading: true,

  userSession: null,
  activeUser: null,
  membership: null,
  isUserLoggedIn: false,
  userLoading: true,

  isFullyAuthenticated: false,
  permissions: null,

  // ============================================
  // Initialize — restore sessions from storage
  // ============================================
  initialize: async () => {
    try {
      // Check org session
      const { data: orgData } = await getOrgClient().auth.getSession()
      if (orgData.session) {
        const org = await fetchOrganisation(orgData.session.user.id)
        set({
          orgSession: orgData.session,
          organisation: org,
          isOrgLoggedIn: true,
        })
      }
    } catch {
      // No org session or fetch failed
    } finally {
      set({ orgLoading: false })
    }

    try {
      // Check user session
      const { data: userData } = await getUserClient().auth.getSession()
      if (userData.session) {
        const profile = await fetchUserProfile(userData.session.user.id)
        const org = get().organisation
        let membership: OrganisationMember | null = null
        let permissions: Permissions | null = null

        if (org) {
          try {
            membership = await fetchOrgMembership(org.id, userData.session.user.id)
            permissions = resolvePermissions(
              membership.role,
              membership.permissions,
            )
          } catch {
            // User not a member of this org
          }
        }

        set({
          userSession: userData.session,
          activeUser: profile,
          membership,
          isUserLoggedIn: true,
          isFullyAuthenticated: !!org && !!membership,
          permissions,
        })
      }
    } catch {
      // No user session
    } finally {
      set({ userLoading: false })
    }

    // Listen to auth state changes
    // Only handle SIGNED_OUT and TOKEN_REFRESHED here.
    // SIGNED_IN is handled by orgLogin/userLogin to avoid race conditions
    // (the listener fires before fetchOrganisation/fetchUserProfile complete,
    //  causing premature redirects)
    getOrgClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({
          orgSession: null,
          organisation: null,
          isOrgLoggedIn: false,
          isFullyAuthenticated: false,
        })
      }
    })

    getUserClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({
          userSession: null,
          activeUser: null,
          membership: null,
          isUserLoggedIn: false,
          isFullyAuthenticated: false,
          permissions: null,
        })
      }
    })
  },

  // ============================================
  // Org Login
  // ============================================
  orgLogin: async (email: string, password: string) => {
    set({ orgLoading: true })
    try {
      const { data, error } = await _orgSignIn(email, password)
      if (error) {
        throw error
      }
      if (!data.user || !data.session) {
        throw new Error('Login returned no session. Please try again.')
      }

      let org
      try {
        org = await fetchOrganisation(data.user.id)
      } catch (fetchErr) {
        // Sign out since we can't load the org
        await getOrgClient().auth.signOut()
        throw new Error(
          fetchErr instanceof Error
            ? `Failed to load pharmacy: ${fetchErr.message}`
            : 'Failed to load pharmacy data. Check this account is registered as an organisation.'
        )
      }

      set({
        orgSession: data.session,
        organisation: org,
        isOrgLoggedIn: true,
        orgLoading: false,
      })
    } catch (err) {
      set({ orgLoading: false })
      throw err
    }
  },

  // ============================================
  // Org Logout — clears everything
  // ============================================
  orgLogout: async () => {
    await _orgSignOut()
    set({
      orgSession: null,
      organisation: null,
      isOrgLoggedIn: false,
      userSession: null,
      activeUser: null,
      membership: null,
      isUserLoggedIn: false,
      isFullyAuthenticated: false,
      permissions: null,
    })
  },

  // ============================================
  // User Login
  // ============================================
  userLogin: async (email: string, password: string) => {
    set({ userLoading: true })
    try {
      const { data, error } = await _userSignIn(email, password)
      if (error) {
        throw error
      }
      if (!data.user || !data.session) {
        throw new Error('Login returned no session. Please try again.')
      }

      let profile
      try {
        profile = await fetchUserProfile(data.user.id)
      } catch (fetchErr) {
        await getUserClient().auth.signOut()
        throw new Error(
          fetchErr instanceof Error
            ? `Failed to load profile: ${fetchErr.message}`
            : 'No staff profile found for this account.'
        )
      }

      const org = get().organisation
      let membership: OrganisationMember | null = null
      let permissions: Permissions | null = null

      if (org) {
        try {
          membership = await fetchOrgMembership(org.id, data.user.id)
          permissions = resolvePermissions(membership.role, membership.permissions)
        } catch {
          await getUserClient().auth.signOut()
          throw new Error('You are not a member of this pharmacy. Contact your manager.')
        }
      }

      // Save email to recent staff list in localStorage
      const savedStaff = JSON.parse(localStorage.getItem('ps-saved-staff') || '[]') as string[]
      if (!savedStaff.includes(email)) {
        savedStaff.unshift(email)
        localStorage.setItem('ps-saved-staff', JSON.stringify(savedStaff.slice(0, 10)))
      }

      set({
        userSession: data.session,
        activeUser: profile,
        membership,
        isUserLoggedIn: true,
        isFullyAuthenticated: !!org && !!membership,
        permissions,
        userLoading: false,
      })
    } catch (err) {
      set({ userLoading: false })
      throw err
    }
  },

  // ============================================
  // User Logout (org stays)
  // ============================================
  userLogout: async () => {
    await _userSignOut()
    set({
      userSession: null,
      activeUser: null,
      membership: null,
      isUserLoggedIn: false,
      isFullyAuthenticated: false,
      permissions: null,
    })
  },

  // ============================================
  // Switch User — same as logout, shows picker
  // ============================================
  switchUser: async () => {
    await _userSignOut()
    set({
      userSession: null,
      activeUser: null,
      membership: null,
      isUserLoggedIn: false,
      isFullyAuthenticated: false,
      permissions: null,
    })
  },
}))
