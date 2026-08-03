import type { ComponentType } from 'react'
import {
  DriverHistoryScreen,
  DriverMapScreen,
  DriverRouteScreen,
} from '@/components/deliveries/DriverDeliveries'

export const deliveriesScreens: Record<string, ComponentType> = {
  route: DriverRouteScreen,
  history: DriverHistoryScreen,
  map: DriverMapScreen,
}
