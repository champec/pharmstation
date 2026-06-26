import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { useAuthStore } from '@/stores/auth-store'
import { palette } from '@/theme/palette'

export default function UserLoginScreen() {
  const router = useRouter()
  const userLogin = useAuthStore((s) => s.userLogin)
  const busy = useAuthStore((s) => s.busy)

  const [email, setEmail] = useState('testuser@pharmstation.dev')
  const [password, setPassword] = useState('TestUser123!')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    setError(null)
    try {
      await userLogin(email, password)
      router.replace('/(app)/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand}>PharmStation</Text>
        <Text style={styles.title}>Sign in to your account</Text>
        <Text style={styles.subtitle}>
          This is your personal account. Sign in to manage your profile — connect
          a pharmacy afterwards to access work modules.
        </Text>
      </View>

      <View style={styles.form}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label="Sign in"
          onPress={onSubmit}
          loading={busy}
          disabled={!email || !password}
        />
      </View>

      <Text style={styles.footnote}>
        Don&apos;t have an account? Ask your pharmacy admin to invite you, or
        register on the web app.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 28, paddingTop: 32 },
  header: { gap: 8 },
  brand: { fontSize: 18, fontWeight: '800', color: palette.brandDark },
  title: { fontSize: 28, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: palette.textMuted },
  form: { gap: 16 },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  footnote: { fontSize: 13, lineHeight: 20, color: palette.textMuted },
})
