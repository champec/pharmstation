// ============================================
// Push notifications (Expo push service → FCM on Android, APNs on iOS).
//
// After sign-in we ask for permission, get this device's Expo push token
// and register it with the `mobile-push-devices` edge function, which stores
// it in ps_mobile_push_tokens. `notifications-dispatch` then sends a push to
// every enabled token for staff alerts whose org has the "Mobile app"
// channel switched on (Settings → Alerts on the web).
// ============================================

import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as Updates from 'expo-updates'
import Constants from 'expo-constants'

import { userClient } from '@/lib/supabase'

let registeredToken: string | null = null

// Show alerts as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

function appVariant(): 'development' | 'preview' | 'production' {
  if (__DEV__) return 'development'
  return Updates.channel === 'production' ? 'production' : 'preview'
}

/** Ask for permission and register this phone for pushes. Safe to call on
 *  every launch: it does nothing on simulators, web, or if the person said no. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Pharmacy alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    const { error } = await userClient.functions.invoke('mobile-push-devices', {
      body: {
        action: 'register',
        expo_push_token: token,
        platform: Platform.OS,
        app_variant: appVariant(),
        device_name: Device.deviceName ?? Device.modelName ?? null,
      },
    })
    if (error) throw error
    registeredToken = token
  } catch (e) {
    console.warn('Push registration failed', e)
  }
}

/** Stop pushes to this phone. Call before signing out (needs the session). */
export async function unregisterPush(): Promise<void> {
  const token = registeredToken
  registeredToken = null
  if (!token) return
  try {
    await userClient.functions.invoke('mobile-push-devices', {
      body: { action: 'unregister', expo_push_token: token },
    })
  } catch (e) {
    console.warn('Push unregister failed', e)
  }
}

export type PushPayload = {
  notification_id?: string
  event_type?: string
  thread_id?: string
  from_number?: string
  /** Locum pushes: 'locum_booking' | 'locum_shift'. */
  type?: string
  booking_id?: string
  shift_id?: string
}
