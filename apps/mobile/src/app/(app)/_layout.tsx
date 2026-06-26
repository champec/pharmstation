import { Redirect, Stack } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'
import { palette } from '@/theme/palette'

export default function AppLayout() {
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)

  // The whole app group requires (at least) a personal account session.
  if (!isUserLoggedIn) {
    return <Redirect href="/(auth)/user-login" />
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.bg },
      }}
    >
      <Stack.Screen name="home" />
      <Stack.Screen
        name="connect-pharmacy"
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="module/[id]" />
    </Stack>
  )
}
