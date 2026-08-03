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
import { communicationsScreens } from '@/modules/screens/communications'
import { deliveriesScreens } from '@/modules/screens/deliveries'
import { locumScreens } from '@/modules/screens/locum'
import { pharmacyScreens } from '@/modules/screens/pharmacy'
import { productScannerScreens } from '@/modules/screens/product-scanner'
import { scanningScreens } from '@/modules/screens/scanning'
import { servicesScreens } from '@/modules/screens/services'

export type ModuleScreens = Record<string, ComponentType>

export const MODULE_SCREENS: Record<string, ModuleScreens> = {
  account: accountScreens,
  locum: locumScreens,
  deliveries: deliveriesScreens,
  scanning: scanningScreens,
  'product-scanner': productScannerScreens,
  pharmacy: pharmacyScreens,
  communications: communicationsScreens,
  services: servicesScreens,
}

export function getTabComponent(
  moduleId: string,
  tabId: string,
): ComponentType | undefined {
  return MODULE_SCREENS[moduleId]?.[tabId]
}
