import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { FORGOT_PASSWORD_URL } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette } from '@/theme/palette'

export default function UserLoginScreen() {
  const router = useRouter()
  const userLogin = useAuthStore((s) => s.userLogin)
  const busy = useAuthStore((s) => s.busy)
  const mfaPendingFactorId = useAuthStore((s) => s.mfaPendingFactorId)
  const verifyMfa = useAuthStore((s) => s.verifyMfa)
  const userLogout = useAuthStore((s) => s.userLogout)
  const [code, setCode] = useState('')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    setError(null)
    try {
      await userLogin(email, password)
      if (useAuthStore.getState().isUserLoggedIn) router.replace('/(app)/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  const onVerify = async () => {
    setError(null)
    try {
      await verifyMfa(code)
      router.replace('/(app)/home')
    } catch (err) {
      setCode('')
      setError(err instanceof Error ? err.message : 'That code didn’t work')
    }
  }

  if (mfaPendingFactorId) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>PharmStation</Text>
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.subtitle}>
            Open your authenticator app and type the 6-digit code for PharmStation.
          </Text>
        </View>
        <View style={styles.form}>
          <Field
            label="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label="Verify"
            onPress={onVerify}
            loading={busy}
            disabled={code.replace(/\s/g, '').length !== 6}
          />
          <Pressable onPress={() => userLogout()} accessibilityRole="button">
            <Text style={styles.link}>Use a different account</Text>
          </Pressable>
        </View>
        <Text style={styles.footnote}>
          Lost your phone? Ask the pharmacy owner to reset your two-step sign-in.
        </Text>
      </Screen>
    )
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

        <Pressable onPress={() => Linking.openURL(FORGOT_PASSWORD_URL)} accessibilityRole="link">
          <Text style={styles.link}>Forgot password?</Text>
        </Pressable>

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
  link: { color: palette.brandDark, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  footnote: { fontSize: 13, lineHeight: 20, color: palette.textMuted },
})
