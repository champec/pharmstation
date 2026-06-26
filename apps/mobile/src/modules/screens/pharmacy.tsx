// Pharmacy Management — tab screens. CD register / RP log / handover are
// mobile-capable; the Team tab is web-only (locked by ModuleHost).
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

const COLOR = '#DC2626'

export const pharmacyScreens: Record<string, ComponentType> = {
  'cd-register': makeTab({
    icon: 'lock-closed-outline',
    title: 'CD Register',
    blurb: 'View and search controlled drug entries on the move.',
    color: COLOR,
  }),
  'rp-log': makeTab({
    icon: 'clipboard-outline',
    title: 'RP Log',
    blurb: 'Responsible pharmacist sign-in record.',
    color: COLOR,
  }),
  handover: makeTab({
    icon: 'reader-outline',
    title: 'Handover',
    blurb: 'Shift handover notes and outstanding tasks.',
    color: COLOR,
  }),
}
