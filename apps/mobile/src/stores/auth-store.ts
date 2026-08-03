// ============================================
// PharmStation mobile — Auth store (Zustand)
//
// Two-layer model (see src/lib/supabase.ts):
//   USER layer  : primary. Log in alone -> personal account only.
//   ORG layer   : additive. Connect a pharmacy on top of the user session.
//                 Org-scoped modules require BOTH sessions + an active
//                 membership, then are filtered by `permissions`.
// ============================================

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type {
  LocumProfile,
  Organisation,
  OrganisationMember,
  Permissions,
  UserProfile,
} from '@/types/auth'
import { resolvePermissions } from '@/types/auth'
import {
  fetchLocumProfile,
  fetchOrganisation,
  fetchOrgMembership,
  fetchUserProfile,
  getOrgSession,
  getUserSession,
  orgClient,
  orgSignIn,
  orgSignOut,
  userClient,
  userSignIn,
  userSignOut,
} from '@/lib/supabase'

export interface AuthState {
  // --- User layer (primary) ---
  userSession: Session | null
  userProfile: UserProfile | null
  locumProfile: LocumProfile | null
  isUserLoggedIn: boolean

  // --- Org layer (additive) ---
  orgSession: Session | null
  organisation: Organisation | null
  membership: OrganisationMember | null
  permissions: Permissions | null
  isOrgConnected: boolean

  // --- Lifecycle ---
  initializing: boolean
  busy: boolean
  error: string | null

  // --- Derived ---
  /** True once both sessions exist AND the user is an active member. */
  canAccessOrgModules: () => boolean
  /** True if this person is a locum-type user (cross-org, user-level). */
  isLocumUser: () => boolean

  // --- Actions ---
  initialize: () => Promise<void>
  userLogin: (email: string, password: string) => Promise<void>
  userLogout: () => Promise<void>
  connectOrg: (email: string, password: string) => Promise<void>
  disconnectOrg: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  userSession: null,
  userProfile: null,
  locumProfile: null,
  isUserLoggedIn: false,

  orgSession: null,
  organisation: null,
  membership: null,
  permissions: null,
  isOrgConnected: false,

  initializing: true,
  busy: false,
  error: null,

  canAccessOrgModules: () => {
    const s = get()
    return (
      s.isUserLoggedIn &&
      s.isOrgConnected &&
      s.membership?.status === 'active'
    )
  },

  isLocumUser: () => {
    return get().locumProfile !== null
  },

  // ------------------------------------------
  // Restore both sessions on app launch.
  // ------------------------------------------
  initialize: async () => {
    set({ initializing: true })

    // 1. User session
    try {
      const userSession = await getUserSession()
      if (userSession?.user) {
        const [userProfile, locumProfile] = await Promise.all([
          fetchUserProfile(userSession.user.id),
          fetchLocumProfile(userSession.user.id),
        ])
        set({ userSession, userProfile, locumProfile, isUserLoggedIn: true })
      }
    } catch {
      // No / invalid user session.
    }

    // 2. Org session (only meaningful with a user session)
    try {
      const orgSession = await getOrgSession()
      const { userSession } = get()
      if (orgSession?.user && userSession?.user) {
        const organisation = await fetchOrganisation(orgSession.user.id)
        const membership = await fetchOrgMembership(
          organisation.id,
          userSession.user.id,
        )
        set({
          orgSession,
          organisation,
          membership,
          permissions: membership
            ? resolvePermissions(membership.role, membership.permissions)
            : null,
          isOrgConnected: true,
        })
      } else if (orgSession) {
        // Org token without a user token is not useful — drop it.
        await orgSignOut()
      }
    } catch {
      // No / invalid org session.
    }

    // React to external sign-outs (e.g. token revoked).
    userClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({
          userSession: null,
          userProfile: null,
          locumProfile: null,
          isUserLoggedIn: false,
          // Org context is meaningless without a user.
          orgSession: null,
          organisation: null,
          membership: null,
          permissions: null,
          isOrgConnected: false,
        })
      }
    })

    orgClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({
          orgSession: null,
          organisation: null,
          membership: null,
          permissions: null,
          isOrgConnected: false,
        })
      }
    })

    set({ initializing: false })
  },

  // ------------------------------------------
  // User login (primary identity)
  // ------------------------------------------
  userLogin: async (email, password) => {
    set({ busy: true, error: null })
    try {
      const { data, error } = await userSignIn(email.trim(), password)
      if (error) throw error
      if (!data.user || !data.session) {
        throw new Error('Login returned no session. Please try again.')
      }

      let userProfile: UserProfile
      let locumProfile: LocumProfile | null
      try {
        ;[userProfile, locumProfile] = await Promise.all([
          fetchUserProfile(data.user.id),
          fetchLocumProfile(data.user.id),
        ])
      } catch {
        await userSignOut()
        throw new Error('No account profile found for this login.')
      }

      set({
        userSession: data.session,
        userProfile,
        locumProfile,
        isUserLoggedIn: true,
        busy: false,
      })
    } catch (err) {
      set({ busy: false, error: messageFrom(err) })
      throw err
    }
  },

  // ------------------------------------------
  // User logout — also tears down org context.
  // ------------------------------------------
  userLogout: async () => {
    set({ busy: true })
    try {
      await orgSignOut().catch(() => {})
      await userSignOut()
    } finally {
      set({
        userSession: null,
        userProfile: null,
        locumProfile: null,
        isUserLoggedIn: false,
        orgSession: null,
        organisation: null,
        membership: null,
        permissions: null,
        isOrgConnected: false,
        busy: false,
      })
    }
  },

  // ------------------------------------------
  // Connect a pharmacy (additive org login)
  // ------------------------------------------
  connectOrg: async (email, password) => {
    const { userSession } = get()
    if (!userSession?.user) {
      throw new Error('Log into your personal account first.')
    }

    set({ busy: true, error: null })
    try {
      const { data, error } = await orgSignIn(email.trim(), password)
      if (error) throw error
      if (!data.user || !data.session) {
        throw new Error('Pharmacy login returned no session.')
      }

      let organisation: Organisation
      try {
        organisation = await fetchOrganisation(data.user.id)
      } catch {
        await orgSignOut()
        throw new Error(
          'This login is not registered as a pharmacy organisation.',
        )
      }

      const membership = await fetchOrgMembership(
        organisation.id,
        userSession.user.id,
      )
      if (!membership) {
        await orgSignOut()
        throw new Error(
          'You are not an active member of this pharmacy. Ask the admin to approve you.',
        )
      }

      set({
        orgSession: data.session,
        organisation,
        membership,
        permissions: resolvePermissions(
          membership.role,
          membership.permissions,
        ),
        isOrgConnected: true,
        busy: false,
      })
    } catch (err) {
      set({ busy: false, error: messageFrom(err) })
      throw err
    }
  },

  // ------------------------------------------
  // Disconnect the pharmacy (keep user session)
  // ------------------------------------------
  disconnectOrg: async () => {
    set({ busy: true })
    try {
      await orgSignOut()
    } finally {
      set({
        orgSession: null,
        organisation: null,
        membership: null,
        permissions: null,
        isOrgConnected: false,
        busy: false,
      })
    }
  },

  clearError: () => set({ error: null }),
}))

function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}
