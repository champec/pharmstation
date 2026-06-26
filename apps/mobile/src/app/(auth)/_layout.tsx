import { Redirect, Stack } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'

export default function AuthLayout() {
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)

  // Already signed in at the user layer -> jump into the app.
  if (isUserLoggedIn) {
    return <Redirect href="/(app)/home" />
  }

  return <Stack screenOptions={{ headerShown: false }} />
}
