// Pharmacy Management — tab screens. CD register, RP log, handover and logs are
// built. Team covers staff, invites and sign-in activity; fine-grained
// permissions stay on the website.
import type { ComponentType } from 'react'
import { cdRegisterScreen } from './cd-register'
import { HandoverScreen } from './handover'
import { LogsScreen } from './logs'
import { OversightScreen } from './oversight'
import { RpLogScreen } from './rp-log'
import { TeamScreen } from './team'

export const pharmacyScreens: Record<string, ComponentType> = {
  oversight: OversightScreen,
  'cd-register': cdRegisterScreen,
  'rp-log': RpLogScreen,
  handover: HandoverScreen,
  logs: LogsScreen,
  team: TeamScreen,
}
