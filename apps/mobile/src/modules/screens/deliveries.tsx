// Deliveries — tab screens. The driver route + history + map live on mobile;
// round setup is web-only (rendered as a locked tab by ModuleHost).
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

const COLOR = '#059669'

export const deliveriesScreens: Record<string, ComponentType> = {
  route: makeTab({
    icon: 'navigate-outline',
    title: 'My Route',
    blurb: 'Today’s ordered stops with tick-off and signature capture.',
    color: COLOR,
  }),
  history: makeTab({
    icon: 'receipt-outline',
    title: 'Delivery History',
    blurb: 'Completed deliveries and stored proof of delivery.',
    color: COLOR,
  }),
  map: makeTab({
    icon: 'map-outline',
    title: 'Route Map',
    blurb: 'See stops on a map and hand off to your native navigation app.',
    color: COLOR,
  }),
}
