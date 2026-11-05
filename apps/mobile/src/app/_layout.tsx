import { useEffect, useRef } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { useAuthStore } from '@/stores/auth-store'
import { palette } from '@/theme/palette'
import { registerForPush, type PushPayload } from '@/lib/push'
import { useCommsStore } from '@/stores/comms-store'

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize)
  const initializing = useAuthStore((s) => s.initializing)

  useEffect(() => {
    initialize()
  }, [initialize])

  usePush(!initializing)

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {initializing ? (
          <View style={styles.splash}>
            <Text style={styles.logo}>PharmStation</Text>
            <ActivityIndicator color={palette.brand} />
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

// Register for pushes once signed in, and open the right screen when a
// notification is tapped (including when the tap launched the app).
function usePush(ready: boolean) {
  const router = useRouter()
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)
  const response = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (ready && isUserLoggedIn) void registerForPush()
  }, [ready, isUserLoggedIn])

  useEffect(() => {
    if (!ready || !isUserLoggedIn || !response) return
    const id = response.notification.request.identifier
    if (handled.current === id) return
    handled.current = id
    const data = (response.notification.request.content.data ?? {}) as PushPayload
    if (data.thread_id) useCommsStore.getState().setPendingOpen({ threadId: data.thread_id })
    else if (data.from_number) useCommsStore.getState().setPendingOpen({ phone: data.from_number })
    router.push({ pathname: '/module/[id]', params: { id: 'communications', tab: 'notifications' } })
  }, [ready, isUserLoggedIn, response, router])
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: palette.bg,
  },
  logo: { fontSize: 24, fontWeight: '800', color: palette.brandDark },
})
