// Pharmacy Management — tab screens. CD register, RP log and handover are
// built. Team covers staff, invites and sign-in activity; fine-grained
// permissions stay on the website.
import type { ComponentType } from 'react'
import { cdRegisterScreen } from './cd-register'
import { HandoverScreen } from './handover'
import { RpLogScreen } from './rp-log'
import { TeamScreen } from './team'

export const pharmacyScreens: Record<string, ComponentType> = {
  'cd-register': cdRegisterScreen,
  'rp-log': RpLogScreen,
  handover: HandoverScreen,
  team: TeamScreen,
}
