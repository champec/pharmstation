// Pharmacy Management — tab screens. CD register, RP log and handover are
// built; the Team tab is web-only (locked by ModuleHost).
import type { ComponentType } from 'react'
import { cdRegisterScreen } from './cd-register'
import { HandoverScreen } from './handover'
import { RpLogScreen } from './rp-log'

export const pharmacyScreens: Record<string, ComponentType> = {
  'cd-register': cdRegisterScreen,
  'rp-log': RpLogScreen,
  handover: HandoverScreen,
}
