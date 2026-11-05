import { useEffect, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { loadOtpAccounts } from '@/lib/authenticator'
import { FORGOT_PASSWORD_URL } from '@/lib/supabase'
import { totp } from '@/lib/totp'
import * as LocalAuthentication from 'expo-local-authentication'
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
  const [phoneCodes, setPhoneCodes] = useState(false)

  useEffect(() => {
    if (mfaPendingFactorId) loadOtpAccounts().then((a) => setPhoneCodes(a.length > 0))
  }, [mfaPendingFactorId])

  // Fill the code from the authenticator built into this app. The secret is
  // the one this account enrolled, so ask the phone's lock first.
  const fillFromPhone = async () => {
    setError(null)
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync()
      if (level !== LocalAuthentication.SecurityLevel.NONE) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Fill your sign-in code' })
        if (!res.success) return
      }
    } catch {
      // No lock available: carry on, as the Security tab does.
    }
    const accounts = await loadOtpAccounts()
    const typed = email.trim().toLowerCase()
    const match = accounts.find((a) => typed && a.label.toLowerCase() === typed) ?? accounts.find((a) => a.issuer === 'PharmStation') ?? accounts[0]
    if (match) setCode(totp(match.secret, Date.now(), match.digits, match.period))
  }

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
            Type the 6-digit code from your authenticator app, or fill it from this phone.
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
          {phoneCodes ? (
            <Button label="Fill from this phone" variant="secondary" onPress={fillFromPhone} />
          ) : null}
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
