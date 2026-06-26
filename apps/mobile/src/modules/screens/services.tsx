// Services — tab screens. History + bookings are mobile-capable; the form
// Library (service setup) is web-only (locked by ModuleHost).
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

const COLOR = '#9333EA'

export const servicesScreens: Record<string, ComponentType> = {
  history: makeTab({
    icon: 'list-outline',
    title: 'Service History',
    blurb: 'Delivered services and their outcomes.',
    color: COLOR,
  }),
  bookings: makeTab({
    icon: 'calendar-number-outline',
    title: 'Bookings',
    blurb: 'Upcoming service appointments for this pharmacy.',
    color: COLOR,
  }),
}
