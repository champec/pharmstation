// Scanning — tab screens (AI prescription / invoice capture).
import type { ComponentType } from 'react'
import { makeTab } from '@/components/module/TabPlaceholder'

const COLOR = '#D97706'

export const scanningScreens: Record<string, ComponentType> = {
  scan: makeTab({
    icon: 'camera-outline',
    title: 'Scan',
    blurb: 'Photograph a prescription or invoice to extract its data.',
    color: COLOR,
  }),
  queue: makeTab({
    icon: 'albums-outline',
    title: 'Scan Queue',
    blurb: 'Review and confirm AI-extracted entries before they are saved.',
    color: COLOR,
  }),
}
