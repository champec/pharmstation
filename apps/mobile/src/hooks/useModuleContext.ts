// ============================================
// useModuleContext — builds the ModuleContext used for gating.
//
// Single source of truth so the home launcher and the ModuleHost evaluate
// `visible(ctx)` against exactly the same inputs.
// ============================================

import { useMemo } from 'react'

import { useAuthStore } from '@/stores/auth-store'
import type { ModuleContext } from '@/modules/types'
import { canManageSOPs } from '@/lib/sops'

export function useModuleContext(): ModuleContext {
  const userProfile = useAuthStore((s) => s.userProfile)
  const permissions = useAuthStore((s) => s.permissions)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)
  const isLocumUser = useAuthStore((s) => s.isLocumUser())
  const sopManager = useAuthStore((s) => canManageSOPs(s.membership))

  return useMemo(
    () => ({ userProfile, permissions, isOrgConnected, isLocumUser, canManageSOPs: sopManager }),
    [userProfile, permissions, isOrgConnected, isLocumUser, sopManager],
  )
}
