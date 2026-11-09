// Pharmacy Management — tab screens. RP log and handover are built; the CD
// register tab is still a placeholder and the Team tab is web-only (locked by
// ModuleHost).
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'
import { HandoverScreen } from './handover'
import { LogsScreen } from './logs'
import { RpLogScreen } from './rp-log'

const COLOR = '#DC2626'

export const pharmacyScreens: Record<string, ComponentType> = {
  'cd-register': makeTab({
    icon: 'lock-closed-outline',
    title: 'CD Register',
    blurb: 'View and search controlled drug entries on the move.',
    color: COLOR,
  }),
  'rp-log': RpLogScreen,
  handover: HandoverScreen,
  logs: LogsScreen,
}
