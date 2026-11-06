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
  claimLocumShiftAccess,
  getMfaStatus,
  verifyTotpCode,
  getOrgSession,
  getUserSession,
  orgClient,
  orgSignIn,
  orgSignOut,
  userClient,
  userSignIn,
  userSignOut,
} from '@/lib/supabase'
import { unregisterPush } from '@/lib/push'

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

  /** Set when the password was right but the account still needs its
   *  authenticator code (two-step sign-in). */
  mfaPendingFactorId: string | null

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
  /** Finish a sign-in that's waiting for an authenticator code. */
  verifyMfa: (code: string) => Promise<void>
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

  mfaPendingFactorId: null,

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
      const mfa = userSession?.user ? await getMfaStatus().catch(() => null) : null
      if (userSession?.user && mfa?.needsCode) {
        set({ mfaPendingFactorId: mfa.factorId })
      } else if (userSession?.user) {
        const [userProfile, locumProfile] = await Promise.all([
          fetchUserProfile(userSession.user.id),
          fetchLocumProfile(userSession.user.id),
        ])
        set({ userSession, userProfile, locumProfile, isUserLoggedIn: true })
      }
    } catch {
      // No / invalid user session.
    }

    // 2. Org session (only meaningful with a user session). While the
    // two-step code is still to be entered, keep the pharmacy connection
    // and restore it once the code is accepted (verifyMfa).
    if (!get().mfaPendingFactorId) await restoreOrgLayer()

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

      const mfa = await getMfaStatus()
      if (mfa.needsCode) {
        set({ mfaPendingFactorId: mfa.factorId, busy: false })
        return
      }
      await loadUserLayer()
    } catch (err) {
      set({ busy: false, error: messageFrom(err) })
      throw err
    }
  },

  verifyMfa: async (code) => {
    const factorId = get().mfaPendingFactorId
    if (!factorId) throw new Error('Sign in again, then enter your code.')
    set({ busy: true, error: null })
    try {
      await verifyTotpCode(factorId, code)
      set({ mfaPendingFactorId: null })
      await loadUserLayer()
      await restoreOrgLayer()
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
      await unregisterPush()
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
        mfaPendingFactorId: null,
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

      let membership = await fetchOrgMembership(
        organisation.id,
        userSession.user.id,
      )
      // A booked locum gets access for their shift without being staff.
      if (!membership && (await claimLocumShiftAccess(organisation.id))) {
        membership = await fetchOrgMembership(organisation.id, userSession.user.id)
      }
      if (!membership) {
        await orgSignOut()
        throw new Error(
          'You are not on the staff list for this pharmacy, and you have no approved locum shift here right now. Ask the pharmacy manager.',
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

/** Load the profile once the password (and code, if any) are done. */
/** Reconnect the pharmacy saved on this phone, if any. */
async function restoreOrgLayer() {
  const set = useAuthStore.setState
  try {
    const orgSession = await getOrgSession()
    const { userSession } = useAuthStore.getState()
    if (orgSession?.user && userSession?.user) {
      const organisation = await fetchOrganisation(orgSession.user.id)
      const membership = await fetchOrgMembership(organisation.id, userSession.user.id)
      set({
        orgSession,
        organisation,
        membership,
        permissions: membership ? resolvePermissions(membership.role, membership.permissions) : null,
        isOrgConnected: true,
      })
    } else if (orgSession) {
      // Org token without a user token is not useful — drop it.
      await orgSignOut()
    }
  } catch {
    // No / invalid org session.
  }
}

async function loadUserLayer() {
  const set = useAuthStore.setState
  const session = await getUserSession()
  if (!session?.user) throw new Error('Login returned no session. Please try again.')
  let userProfile: UserProfile
  let locumProfile: LocumProfile | null
  try {
    ;[userProfile, locumProfile] = await Promise.all([
      fetchUserProfile(session.user.id),
      fetchLocumProfile(session.user.id),
    ])
  } catch {
    await userSignOut()
    throw new Error('No account profile found for this login.')
  }

  set({
    userSession: session,
    userProfile,
    locumProfile,
    isUserLoggedIn: true,
    busy: false,
  })
}

function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}
