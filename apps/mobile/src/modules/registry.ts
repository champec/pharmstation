// ============================================
// PharmStation mobile — Module registry
//
// One place to declare every mobile module and the rules for who can see it.
// The home launcher renders only the modules whose `visible(ctx)` returns true.
//
// Two gating dimensions:
//   - tier: 'user'  -> available on the personal account (no pharmacy needed)
//           'org'   -> requires an active pharmacy connection + permission
//   - visible(ctx)  -> fine-grained check (role / permission / user type)
// ============================================

import type { Permissions, UserProfile } from '@/types/auth'

export type ModuleTier = 'user' | 'org'

export interface ModuleContext {
  userProfile: UserProfile | null
  permissions: Permissions | null
  isOrgConnected: boolean
  isLocumUser: boolean
}

export interface MobileModule {
  id: string
  title: string
  description: string
  /** Ionicons name (from @expo/vector-icons). */
  icon: string
  /** Accent colour for the card. */
  color: string
  tier: ModuleTier
  /** Route to open. For the scaffold these point at a placeholder screen. */
  route: string
  visible: (ctx: ModuleContext) => boolean
}

const has = (p: Permissions | null, key: keyof Permissions) => p?.[key] === true

export const MODULES: MobileModule[] = [
  // ---------- USER-TIER (personal account, no pharmacy required) ----------
  {
    id: 'account',
    title: 'My Account',
    description: 'Manage your personal profile and credentials',
    icon: 'person-circle-outline',
    color: '#208AEF',
    tier: 'user',
    route: '/module/account',
    visible: () => true,
  },
  {
    id: 'locum',
    title: 'Locum Shifts',
    description: 'Find shifts and manage your bookings',
    icon: 'briefcase-outline',
    color: '#7C3AED',
    tier: 'user',
    route: '/module/locum',
    // Cross-org and user-level: visible to locum-type users.
    visible: (ctx) => ctx.isLocumUser,
  },

  // ---------- ORG-TIER (require active pharmacy + permission) ----------
  {
    id: 'deliveries',
    title: 'Deliveries',
    description: 'Driver rounds, navigation and proof of delivery',
    icon: 'car-outline',
    color: '#059669',
    tier: 'org',
    route: '/module/deliveries',
    visible: (ctx) =>
      ctx.isOrgConnected &&
      (has(ctx.permissions, 'delivery_drive') ||
        has(ctx.permissions, 'delivery_manage')),
  },
  {
    id: 'scanning',
    title: 'Scanning',
    description: 'Scan prescriptions and invoices with AI',
    icon: 'scan-outline',
    color: '#D97706',
    tier: 'org',
    route: '/module/scanning',
    visible: (ctx) => ctx.isOrgConnected && has(ctx.permissions, 'ai_scan_use'),
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy Management',
    description: 'Multi-site oversight and team management',
    icon: 'business-outline',
    color: '#DC2626',
    tier: 'org',
    route: '/module/pharmacy',
    visible: (ctx) =>
      ctx.isOrgConnected &&
      (has(ctx.permissions, 'manage_users') ||
        has(ctx.permissions, 'org_settings')),
  },
]

export function visibleModules(ctx: ModuleContext): MobileModule[] {
  return MODULES.filter((m) => m.visible(ctx))
}

export function findModule(id: string): MobileModule | undefined {
  return MODULES.find((m) => m.id === id)
}
