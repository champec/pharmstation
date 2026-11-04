// ============================================
// Auth Store — Zustand
// Manages dual org + user sessions
// ============================================

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type { Organisation, UserProfile, OrganisationMember, Permissions, LocumProfile } from '@pharmstation/types'
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
  fetchLocumExtendedProfile,
  getMfaStatus,
  claimLocumShiftAccess,
  verifyTotpCode,
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

  // Locum role — a role on the user account, not a separate account/session.
  // null when the current user hasn't activated the locum role.
  locumProfile: LocumProfile | null

  // Two-step sign-in. mfaPendingFactorId is set when the password was right
  // but the account still needs its authenticator code. mfaSetupRequired is
  // set for owners and managers who haven't added an authenticator app yet.
  mfaPendingFactorId: string | null
  mfaSetupRequired: boolean

  // Computed
  isFullyAuthenticated: boolean
  permissions: Permissions | null

  // Actions
  initialize: () => Promise<void>
  orgLogin: (email: string, password: string) => Promise<void>
  orgLogout: () => Promise<void>
  userLogin: (
    email: string,
    password: string,
    opts?: { requireOrgMembership?: boolean }
  ) => Promise<void>
  userLogout: () => Promise<void>
  /** Finish a sign-in that is waiting for an authenticator code. */
  verifyUserMfa: (code: string) => Promise<void>
  /** Give up on a sign-in that is waiting for an authenticator code. */
  cancelUserMfa: () => Promise<void>
  /** Re-check whether this account still has to add an authenticator app. */
  refreshMfaSetup: () => Promise<void>
  switchUser: () => Promise<void>
  /** Re-read the user-layer session + profile + membership from the client.
   *  Used by portal flows (locum/patient/personal) after they sign in. */
  refreshUserLayer: () => Promise<void>
  /** Re-read the locum role profile for the current user. Called after
   *  activating/updating the locum role — the /locum/* routes gate on this. */
  refreshLocumProfile: () => Promise<void>
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

  locumProfile: null,

  mfaPendingFactorId: null,
  mfaSetupRequired: false,

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
      let mfa: Awaited<ReturnType<typeof getMfaStatus>> | null = null
      if (userData.session) {
        try {
          mfa = await getMfaStatus()
        } catch {
          mfa = null
        }
      }
      if (userData.session && mfa?.needsCode) {
        // Password was entered but the authenticator code wasn't: the sign-in
        // pages ask for it before anything else loads.
        set({ mfaPendingFactorId: mfa.factorId })
      } else if (userData.session) {
        const profile = await fetchUserProfile(userData.session.user.id)
        const org = get().organisation
        let membership: OrganisationMember | null = null
        let permissions: Permissions | null = null

        if (org) {
          try {
            membership = await fetchOrgMembership(org.id, userData.session.user.id)
            if (membership) {
              permissions = resolvePermissions(
                membership.role,
                membership.permissions,
              )
            }
          } catch {
            // User not a member of this org
          }
        }

        let locumProfile: LocumProfile | null = null
        try {
          locumProfile = await fetchLocumExtendedProfile(userData.session.user.id)
        } catch {
          // Locum role not activated for this user
        }

        set({
          userSession: userData.session,
          activeUser: profile,
          membership,
          isUserLoggedIn: true,
          isFullyAuthenticated: !!org && !!membership,
          permissions,
          locumProfile,
          mfaSetupRequired: needsMfaSetup(membership, permissions, mfa?.hasFactor ?? false),
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
          locumProfile: null,
          mfaPendingFactorId: null,
          mfaSetupRequired: false,
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
      locumProfile: null,
      mfaPendingFactorId: null,
      mfaSetupRequired: false,
    })
  },

  // ============================================
  // User Login
  // Staff flow (default): org session present ⇒ membership REQUIRED.
  // Portal flows (locum/patient/personal) pass
  // { requireOrgMembership: false } — signing in is a user-layer
  // operation; roles decide what they can see afterwards.
  // ============================================
  userLogin: async (email: string, password: string, opts?: { requireOrgMembership?: boolean }) => {
    set({ userLoading: true })
    try {
      const { data, error } = await _userSignIn(email, password)
      if (error) {
        throw error
      }
      if (!data.user || !data.session) {
        throw new Error('Login returned no session. Please try again.')
      }

      // Accounts with two-step sign-in stop here until the code is entered.
      const mfa = await getMfaStatus()
      if (mfa.needsCode) {
        pendingLogin = { email, opts }
        set({ mfaPendingFactorId: mfa.factorId, userLoading: false })
        return
      }

      await finishUserLogin(email, opts, mfa.hasFactor)
    } catch (err) {
      set({ userLoading: false })
      throw err
    }
  },

  verifyUserMfa: async (code: string) => {
    const factorId = get().mfaPendingFactorId
    if (!factorId) throw new Error('Sign in again, then enter your code.')
    await verifyTotpCode(factorId, code)
    set({ userLoading: true, mfaPendingFactorId: null })
    try {
      const { data } = await getUserClient().auth.getUser()
      const email = pendingLogin?.email ?? data.user?.email ?? ''
      await finishUserLogin(email, pendingLogin?.opts, true)
      pendingLogin = null
    } catch (err) {
      set({ userLoading: false })
      throw err
    }
  },

  cancelUserMfa: async () => {
    pendingLogin = null
    await _userSignOut()
    set({ mfaPendingFactorId: null })
  },

  refreshMfaSetup: async () => {
    try {
      const mfa = await getMfaStatus()
      set({ mfaSetupRequired: needsMfaSetup(get().membership, get().permissions, mfa.hasFactor) })
    } catch {
      // Leave as-is
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
      locumProfile: null,
      mfaPendingFactorId: null,
      mfaSetupRequired: false,
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
      locumProfile: null,
      mfaPendingFactorId: null,
      mfaSetupRequired: false,
    })
  },

  // ============================================
  // Refresh user layer — re-read session/profile/membership from the
  // client. Portal flows (locum/patient/personal) call this after signing
  // in directly, so the whole app agrees on who's at the keyboard.
  // Never throws on missing membership — roles gate views, not sign-in.
  // ============================================
  refreshUserLayer: async () => {
    try {
      const { data } = await getUserClient().auth.getSession()
      const session = data.session
      if (!session?.user) {
        set({
          userSession: null,
          activeUser: null,
          membership: null,
          isUserLoggedIn: false,
          isFullyAuthenticated: false,
          permissions: null,
          locumProfile: null,
        })
        return
      }

      let profile = null
      try {
        profile = await fetchUserProfile(session.user.id)
      } catch {
        // Profile row may not exist yet (e.g. mid-registration) — stay signed in
      }

      const org = get().organisation
      let membership: OrganisationMember | null = null
      let permissions: Permissions | null = null
      if (org) {
        try {
          membership = await fetchOrgMembership(org.id, session.user.id)
          if (membership) {
            permissions = resolvePermissions(membership.role, membership.permissions)
          }
        } catch {
          membership = null
        }
      }

      set({
        userSession: session,
        activeUser: profile,
        membership,
        isUserLoggedIn: true,
        isFullyAuthenticated: !!org && !!membership,
        permissions,
        userLoading: false,
      })
    } catch {
      // Leave state as-is on unexpected failure
    }
  },

  // ============================================
  // Refresh locum role profile — call after activating/updating the
  // locum role. The /locum/* route guards read `locumProfile` to decide
  // between the activation form and the portal itself.
  // ============================================
  refreshLocumProfile: async () => {
    const uid = get().userSession?.user?.id
    if (!uid) {
      set({ locumProfile: null })
      return
    }
    try {
      const locumProfile = await fetchLocumExtendedProfile(uid)
      set({ locumProfile })
    } catch {
      set({ locumProfile: null })
    }
  },
}))

// ============================================
// Shared tail of a staff/personal sign-in, run once the password (and the
// authenticator code, if the account has one) are both done.
// ============================================
let pendingLogin: { email: string; opts?: { requireOrgMembership?: boolean } } | null = null

/** Permissions the database only honours after two-step sign-in
 *  (see supabase/migrations/20261104124500_two_step_sign_in.sql). */
const MFA_PERMISSIONS = ['manage_users', 'org_settings', 'billing', 'approve_locums', 'view_audit'] as const

/** Owners, managers and anyone with a sensitive permission must add an
 *  authenticator app before using the pharmacy. */
function needsMfaSetup(
  membership: OrganisationMember | null,
  permissions: Permissions | null,
  hasFactor: boolean,
): boolean {
  if (hasFactor || !membership) return false
  if (membership.role === 'owner' || membership.role === 'manager') return true
  return MFA_PERMISSIONS.some((key) => permissions?.[key] === true)
}

async function finishUserLogin(
  email: string,
  opts: { requireOrgMembership?: boolean } | undefined,
  hasFactor: boolean,
) {
  const { getState: get, setState: set } = useAuthStore
  const requireOrgMembership = opts?.requireOrgMembership ?? true
  const { data: sessionData } = await getUserClient().auth.getSession()
  const session = sessionData.session
  if (!session) throw new Error('Login returned no session. Please try again.')
  const userId = session.user.id
  const data = { session }

  let profile
  try {
    profile = await fetchUserProfile(userId)
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
      membership = await fetchOrgMembership(org.id, userId)
      if (membership) {
        permissions = resolvePermissions(membership.role, membership.permissions)
      }
    } catch {
      // A booked locum gets access for their shift without being staff.
      if (await claimLocumShiftAccess(org.id)) {
        try {
          membership = await fetchOrgMembership(org.id, userId)
          if (membership) permissions = resolvePermissions(membership.role, membership.permissions)
        } catch {
          membership = null
        }
      }
    }
    if (!membership) {
      if (requireOrgMembership) {
        await getUserClient().auth.signOut()
        throw new Error('You are not on the staff list for this pharmacy, and you have no approved locum shift here right now. Contact the pharmacy manager.')
      }
      // Portal login on an org terminal by a non-member: allowed,
      // but no membership ⇒ no org permissions.
      membership = null
    }
  }

  // Save email to recent staff list — only for actual staff at this org
  if (membership) {
    const savedStaff = JSON.parse(localStorage.getItem('ps-saved-staff') || '[]') as string[]
    if (!savedStaff.includes(email)) {
      savedStaff.unshift(email)
      localStorage.setItem('ps-saved-staff', JSON.stringify(savedStaff.slice(0, 10)))
    }
  }

  let locumProfile: LocumProfile | null = null
  try {
    locumProfile = await fetchLocumExtendedProfile(userId)
  } catch {
    // Locum role not activated for this user
  }

  set({
    userSession: data.session,
    activeUser: profile,
    membership,
    isUserLoggedIn: true,
    isFullyAuthenticated: !!org && !!membership,
    permissions,
    locumProfile,
    userLoading: false,
    mfaSetupRequired: needsMfaSetup(membership, permissions, hasFactor),
  })
}
