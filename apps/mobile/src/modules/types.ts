// ============================================
// PharmStation mobile — Module system types
//
// A "module" is a self-contained mini-app launched from the home screen.
// Each module owns a set of tabs (its own bottom-tab navigator) and declares
// the rules for who can see it and on which platform it lives.
//
// Three gating dimensions:
//   - tier      : 'user' (personal account) | 'org' (needs a pharmacy + perms)
//   - platform  : where the feature actually runs. The mobile app only *launches*
//                 'mobile' | 'both' modules, but it still surfaces 'web' ones as
//                 informational cards so the two clients visibly complete each
//                 other (e.g. delivery *setup* is web, delivery *driving* is here).
//   - visible() : fine-grained predicate (role / permission / user type), applied
//                 to both modules and individual tabs.
// ============================================

import type { Permissions, UserProfile } from '@/types/auth'

export type ModuleTier = 'user' | 'org'

/** Where a module or tab actually runs. */
export type ModulePlatform = 'mobile' | 'web' | 'both'

/** Everything a visibility rule is allowed to look at. */
export interface ModuleContext {
  userProfile: UserProfile | null
  permissions: Permissions | null
  isOrgConnected: boolean
  isLocumUser: boolean
}

export type VisibilityRule = (ctx: ModuleContext) => boolean

/** A single tab within a module's mini-app navigator. */
export interface ModuleTab {
  id: string
  title: string
  /** Ionicons glyph name. */
  icon: string
  /**
   * Platform this tab runs on. Defaults to the parent module's platform.
   * 'web' tabs render in the bar but are locked with an "open on web" hint,
   * so a module can mix mobile + web surfaces (e.g. Services: history vs setup).
   */
  platform?: ModulePlatform
  /** Optional finer gate. Defaults to always-visible within the module. */
  visible?: VisibilityRule
  /** Short line shown in the scaffold placeholder. */
  blurb?: string
}

/** A module = a launchable mini-app. */
export interface MobileModule {
  id: string
  title: string
  description: string
  /** Ionicons glyph name. */
  icon: string
  /** Accent colour for the card + module chrome. */
  color: string
  tier: ModuleTier
  platform: ModulePlatform
  /** Tabs that make up the module's navigator (first visible one is the entry). */
  tabs: ModuleTab[]
  /** Visibility for the module as a whole. */
  visible: VisibilityRule
  /** For 'web' modules: where on the web app this lives (shown in the hint). */
  webHint?: string
}

/** Default a value when undefined. */
const isOn = (platform: ModulePlatform | undefined, fallback: ModulePlatform) =>
  platform ?? fallback

/** A module the mobile app can actually open. */
export function isLaunchable(m: MobileModule): boolean {
  return m.platform === 'mobile' || m.platform === 'both'
}

/** Tabs whose `visible` predicate passes (platform-agnostic — locked ones still show). */
export function resolveTabs(m: MobileModule, ctx: ModuleContext): ModuleTab[] {
  return m.tabs.filter((t) => (t.visible ? t.visible(ctx) : true))
}

/** Whether a resolved tab can be interacted with on this device. */
export function isTabLaunchable(
  m: MobileModule,
  t: ModuleTab,
): boolean {
  const p = isOn(t.platform, m.platform)
  return p === 'mobile' || p === 'both'
}
