// ============================================
// PharmStation mobile — Module registry
//
// One declarative place describing every module, its tabs, who can see it,
// and which platform it lives on. The home launcher renders the launchable
// modules (mobile/both) and surfaces web-only ones as informational cards.
//
// To add a module: add an entry here + a screen map in src/modules/screens.
// The gating, navigation and tab chrome are handled by the shared ModuleHost.
// ============================================

import type { Permissions } from '@/types/auth'
import {
  isLaunchable,
  resolveTabs,
  type MobileModule,
  type ModuleContext,
  type ModuleTab,
} from '@/modules/types'

const has = (p: Permissions | null, key: keyof Permissions) => p?.[key] === true
const canManageDeliveries = (ctx: ModuleContext) =>
  has(ctx.permissions, 'delivery_manage')
const canDrive = (ctx: ModuleContext) => has(ctx.permissions, 'delivery_drive')

export const MODULES: MobileModule[] = [
  // ---------- USER TIER (personal account, no pharmacy required) ----------
  {
    id: 'account',
    title: 'My Account',
    description: 'Your profile, pharmacies and security',
    icon: 'person-circle-outline',
    color: '#208AEF',
    tier: 'user',
    platform: 'both',
    visible: () => true,
    tabs: [
      { id: 'profile', title: 'Profile', icon: 'person-outline' },
      { id: 'pharmacies', title: 'Pharmacies', icon: 'business-outline' },
      {
        id: 'security',
        title: 'Security',
        icon: 'shield-checkmark-outline',
        blurb: 'Biometric lock, PIN and active sessions',
      },
    ],
  },
  {
    id: 'locum',
    title: 'Locum Shifts',
    description: 'Find shifts and manage your bookings',
    icon: 'briefcase-outline',
    color: '#7C3AED',
    tier: 'user',
    platform: 'both',
    // Cross-org, user-level: visible to locum-type users.
    visible: (ctx) => ctx.isLocumUser,
    tabs: [
      {
        id: 'find',
        title: 'Find',
        icon: 'search-outline',
        blurb: 'Browse open shifts near you',
      },
      {
        id: 'bookings',
        title: 'Bookings',
        icon: 'calendar-outline',
        blurb: 'Your upcoming and past shifts',
      },
      {
        id: 'timesheets',
        title: 'Timesheets',
        icon: 'time-outline',
        blurb: 'Hours, invoices and payments',
      },
    ],
  },

  // ---------- ORG TIER (require active pharmacy + permission) ----------
  {
    id: 'deliveries',
    title: 'Deliveries',
    description: 'Driver rounds, proof of delivery and history',
    icon: 'car-outline',
    color: '#059669',
    tier: 'org',
    // Driving is mobile-first; round setup happens on the web.
    platform: 'mobile',
    visible: (ctx) =>
      ctx.isOrgConnected && (canDrive(ctx) || canManageDeliveries(ctx)),
    tabs: [
      {
        id: 'route',
        title: 'My Route',
        icon: 'navigate-outline',
        visible: (ctx) => canDrive(ctx) || canManageDeliveries(ctx),
        blurb: 'Today’s stops, tick-off and signature capture',
      },
      {
        id: 'history',
        title: 'History',
        icon: 'receipt-outline',
        blurb: 'Completed deliveries and proof of delivery',
      },
      {
        id: 'map',
        title: 'Map',
        icon: 'map-outline',
        blurb: 'See stops on a map and open native navigation',
      },
      {
        id: 'setup',
        title: 'Setup',
        icon: 'options-outline',
        platform: 'web',
        visible: (ctx) => canManageDeliveries(ctx),
        blurb: 'Create rounds and assign drivers',
      },
    ],
  },
  {
    id: 'scanning',
    title: 'Scanning',
    description: 'Capture prescriptions and invoices with AI',
    icon: 'scan-outline',
    color: '#D97706',
    tier: 'org',
    platform: 'mobile',
    visible: (ctx) => ctx.isOrgConnected && has(ctx.permissions, 'ai_scan_use'),
    tabs: [
      {
        id: 'scan',
        title: 'Scan',
        icon: 'camera-outline',
        blurb: 'Photograph a script or invoice to extract data',
      },
      {
        id: 'queue',
        title: 'Queue',
        icon: 'albums-outline',
        blurb: 'Review and confirm AI-extracted entries',
      },
    ],
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy Management',
    description: 'Registers, handover and team tasks',
    icon: 'business-outline',
    color: '#DC2626',
    tier: 'org',
    platform: 'both',
    visible: (ctx) => ctx.isOrgConnected,
    tabs: [
      {
        id: 'cd-register',
        title: 'CD Register',
        icon: 'lock-closed-outline',
        visible: (ctx) => has(ctx.permissions, 'cd_register_read'),
        blurb: 'View and search controlled drug entries',
      },
      {
        id: 'rp-log',
        title: 'RP Log',
        icon: 'clipboard-outline',
        visible: (ctx) => has(ctx.permissions, 'rp_log_view'),
        blurb: 'Responsible pharmacist sign-in record',
      },
      {
        id: 'handover',
        title: 'Handover',
        icon: 'reader-outline',
        visible: (ctx) => has(ctx.permissions, 'handover_all'),
        blurb: 'Shift handover notes and tasks',
      },
      {
        id: 'team',
        title: 'Team',
        icon: 'people-outline',
        platform: 'web',
        visible: (ctx) =>
          has(ctx.permissions, 'manage_users') ||
          has(ctx.permissions, 'org_settings'),
        blurb: 'Manage staff, roles and permissions',
      },
    ],
  },
  {
    id: 'communications',
    title: 'Communications',
    description: 'Messages and pharmacy notifications',
    icon: 'chatbubbles-outline',
    color: '#0EA5E9',
    tier: 'org',
    platform: 'both',
    visible: (ctx) => ctx.isOrgConnected,
    tabs: [
      {
        id: 'messages',
        title: 'Messages',
        icon: 'chatbox-ellipses-outline',
        blurb: 'Pharmacy-to-pharmacy and team messaging',
      },
      {
        id: 'notifications',
        title: 'Alerts',
        icon: 'notifications-outline',
        blurb: 'Push notifications and pharmacy alerts',
      },
    ],
  },
  {
    id: 'services',
    title: 'Services',
    description: 'Service history and your bookings',
    icon: 'medkit-outline',
    color: '#9333EA',
    tier: 'org',
    platform: 'both',
    visible: (ctx) => ctx.isOrgConnected,
    tabs: [
      {
        id: 'history',
        title: 'History',
        icon: 'list-outline',
        blurb: 'Delivered services and outcomes',
      },
      {
        id: 'bookings',
        title: 'Bookings',
        icon: 'calendar-number-outline',
        blurb: 'Upcoming appointments for this pharmacy',
      },
      {
        id: 'library',
        title: 'Library',
        icon: 'construct-outline',
        platform: 'web',
        blurb: 'Build service forms and delivery flows',
      },
    ],
  },

  // ---------- WEB-ONLY (surfaced as informational cards) ----------
  {
    id: 'video',
    title: 'Video Consultations',
    description: 'Run patient video consultations',
    icon: 'videocam-outline',
    color: '#475569',
    tier: 'org',
    platform: 'web',
    visible: (ctx) => ctx.isOrgConnected,
    webHint: 'Video consultations run in the web app on a desktop browser.',
    tabs: [],
  },
]

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------

/** All modules visible to this person (any platform). */
export function visibleModules(ctx: ModuleContext): MobileModule[] {
  return MODULES.filter((m) => m.visible(ctx))
}

/** Modules this device can actually open (mobile/both) and the user can see. */
export function launchableModules(ctx: ModuleContext): MobileModule[] {
  return MODULES.filter((m) => m.visible(ctx) && isLaunchable(m))
}

/** Visible modules that live on the web — shown as "open on web" cards. */
export function webOnlyModules(ctx: ModuleContext): MobileModule[] {
  return MODULES.filter((m) => m.visible(ctx) && m.platform === 'web')
}

export function findModule(id: string): MobileModule | undefined {
  return MODULES.find((m) => m.id === id)
}

/** Tabs of a module that pass their visibility predicate (locked ones included). */
export function moduleTabs(m: MobileModule, ctx: ModuleContext): ModuleTab[] {
  return resolveTabs(m, ctx)
}

/** Canonical route for a module's mini-app. */
export function moduleRoute(id: string): string {
  return `/(app)/module/${id}`
}
