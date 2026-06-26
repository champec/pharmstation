// Communications — tab screens (messaging + notifications). Both platforms.
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

const COLOR = '#0EA5E9'

export const communicationsScreens: Record<string, ComponentType> = {
  messages: makeTab({
    icon: 'chatbox-ellipses-outline',
    title: 'Messages',
    blurb: 'Pharmacy-to-pharmacy and internal team messaging.',
    color: COLOR,
  }),
  notifications: makeTab({
    icon: 'notifications-outline',
    title: 'Alerts',
    blurb: 'Push notifications and pharmacy-wide alerts.',
    color: COLOR,
  }),
}
