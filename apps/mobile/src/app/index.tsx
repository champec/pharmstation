import { Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'

// Entry point: route by auth state.
export default function Index() {
  const isUserLoggedIn = useAuthStore((s) => s.isUserLoggedIn)
  return (
    <Redirect href={isUserLoggedIn ? '/(app)/home' : '/(auth)/user-login'} />
  )
}
