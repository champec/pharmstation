// Locum Shifts — tab screens. Replace placeholders with real screens.
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

export const locumScreens: Record<string, ComponentType> = {
  find: makeTab({
    icon: 'search-outline',
    title: 'Find Shifts',
    blurb: 'Browse open shifts near you and apply in a tap.',
    color: '#7C3AED',
  }),
  bookings: makeTab({
    icon: 'calendar-outline',
    title: 'My Bookings',
    blurb: 'Your upcoming and past confirmed shifts.',
    color: '#7C3AED',
  }),
  timesheets: makeTab({
    icon: 'time-outline',
    title: 'Timesheets',
    blurb: 'Track hours, raise invoices and follow payments.',
    color: '#7C3AED',
  }),
}
