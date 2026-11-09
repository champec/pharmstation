import type { ComponentType } from 'react'
import {
  DriverHistoryScreen,
  DriverMapScreen,
  DriverRouteScreen,
} from '@/components/deliveries/DriverDeliveries'
import {
  DeliveryBoardScreen,
  RedeliveryQueueScreen,
} from '@/components/deliveries/ManagerDeliveries'

export const deliveriesScreens: Record<string, ComponentType> = {
  route: DriverRouteScreen,
  history: DriverHistoryScreen,
  map: DriverMapScreen,
  rounds: DeliveryBoardScreen,
  redelivery: RedeliveryQueueScreen,
}
