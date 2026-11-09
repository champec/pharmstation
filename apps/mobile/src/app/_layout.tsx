import { useEffect, useRef } from 'react'
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { useAuthStore } from '@/stores/auth-store'
import { registerForPush, type PushPayload } from '@/lib/push'
import { useCommsStore } from '@/stores/comms-store'
import { StartupNotices } from '@/components/StartupNotices'
import { BRAND_BLUE, BrandLogo } from '@/components/BrandLogo'

// Keep the native splash up until we know whether someone is signed in.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize)
  const initializing = useAuthStore((s) => s.initializing)

  useEffect(() => {
    initialize()
  }, [initialize])

  usePush(!initializing)

  useEffect(() => {
    if (!initializing) SplashScreen.hideAsync().catch(() => {})
  }, [initializing])

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style={initializing ? 'light' : 'dark'} />
        {initializing ? (
          <View style={styles.splash}>
            <BrandLogo variant="mark" size={120} wordmark="stack" />
            <ActivityIndicator color="#fff" style={styles.spinner} />
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        )}
        {initializing ? null : <StartupNotices />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

// Register for pushes once signed in, and open the right screen when a
// notification is tapped (including when the tap launched the app).
function usePush(ready: boolean) {
  const router = useRouter()
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (ready && isUserLoggedIn) void registerForPush()
  }, [ready, isUserLoggedIn])

  useEffect(() => {
    if (!ready || !isUserLoggedIn || Platform.OS === 'web') return
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return
      const id = response.notification.request.identifier
      if (handled.current === id) return
      handled.current = id
      const data = (response.notification.request.content.data ?? {}) as PushPayload
      // Locum pushes (from locum-notify) open the locum module.
      if (data.type === 'locum_booking' || data.type === 'locum_shift') {
        router.push({ pathname: '/module/[id]', params: { id: 'locum', tab: data.type === 'locum_shift' ? 'find' : 'bookings' } })
        return
      }
      // Pharmacy locum alerts open Locum Cover.
      if (data.event_type === 'locum') {
        router.push({ pathname: '/module/[id]', params: { id: 'locum-cover', tab: 'shifts' } })
        return
      }
      // Shop order alerts open the shop's order list.
      if (data.event_type === 'shop_order') {
        router.push({ pathname: '/module/[id]', params: { id: 'shop', tab: 'orders' } })
        return
      }
      if (data.thread_id) useCommsStore.getState().setPendingOpen({ threadId: data.thread_id })
      else if (data.from_number) useCommsStore.getState().setPendingOpen({ phone: data.from_number })
      router.push({ pathname: '/module/[id]', params: { id: 'communications', tab: 'notifications' } })
    }
    // The tap that launched the app, then any taps while it's running.
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(open)
    return () => sub.remove()
  }, [ready, isUserLoggedIn, router])
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND_BLUE,
  },
  spinner: { marginTop: 28 },
})
