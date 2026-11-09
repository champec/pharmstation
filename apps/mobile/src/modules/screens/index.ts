// ============================================
// Module screen registry
//
// Maps `moduleId -> tabId -> component`. The ModuleHost looks up the active
// tab's component here. Modules with no entry (or tabs with no component)
// fall back to a generated placeholder, so the app never crashes on a
// not-yet-built screen.
// ============================================

import type { ComponentType } from 'react'

import { accountScreens } from '@/modules/screens/account'
import { billingScreens } from '@/modules/screens/billing'
import { careHomesScreens } from '@/modules/screens/care-homes'
import { communicationsScreens } from '@/modules/screens/communications'
import { deliveriesScreens } from '@/modules/screens/deliveries'
import { genieScreens } from '@/modules/screens/genie'
import { locumScreens } from '@/modules/screens/locum'
import { pepsScreens } from '@/modules/screens/peps'
import { locumCoverScreens } from '@/modules/screens/locum-cover'
import { pharmacyScreens } from '@/modules/screens/pharmacy'
import { productScannerScreens } from '@/modules/screens/product-scanner'
import { scanningScreens } from '@/modules/screens/scanning'
import { servicesScreens } from '@/modules/screens/services'
import { shopScreens } from '@/modules/screens/shop'
import { sopScreens } from '@/modules/screens/sops'
import { videoScreens } from '@/modules/screens/video'

export type ModuleScreens = Record<string, ComponentType>

export const MODULE_SCREENS: Record<string, ModuleScreens> = {
  account: accountScreens,
  locum: locumScreens,
  'locum-cover': locumCoverScreens,
  deliveries: deliveriesScreens,
  scanning: scanningScreens,
  'product-scanner': productScannerScreens,
  pharmacy: pharmacyScreens,
  communications: communicationsScreens,
  services: servicesScreens,
  shop: shopScreens,
  sops: sopScreens,
  genie: genieScreens,
  billing: billingScreens,
  peps: pepsScreens,
  'care-homes': careHomesScreens,
  video: videoScreens,
}

export function getTabComponent(
  moduleId: string,
  tabId: string,
): ComponentType | undefined {
  return MODULE_SCREENS[moduleId]?.[tabId]
}
