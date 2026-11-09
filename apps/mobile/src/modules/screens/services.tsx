// Services — tab screens. History and Bookings work on mobile; the form
// Library (service setup) is web-only (locked by ModuleHost).
import type { ComponentType } from 'react'
import { BookingsScreen } from './bookings'
import { ServicesHistoryTab } from './service-deliver'

export const servicesScreens: Record<string, ComponentType> = {
  history: ServicesHistoryTab,
  bookings: BookingsScreen,
}
