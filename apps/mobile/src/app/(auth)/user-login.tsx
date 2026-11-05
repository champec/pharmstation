import { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { BrandLogo } from '@/components/BrandLogo'
import { candidatesFor, keepOnly, loadOtpAccounts } from '@/lib/authenticator'
import {
  biometricEmail,
  biometricLabel,
  disableBiometricLogin,
  enableBiometricLogin,
  readBiometricLogin,
  rememberEmail,
  rememberedEmail,
} from '@/lib/biometric-login'
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

  // Sign in with the authenticator built into this app: unlock with the
  // phone's lock, then try this phone's saved codes for the account (newest
  // first) until one is accepted, so a stale entry from an earlier setup
  // can't block sign-in.
  const useCodeFromPhone = async () => {
    setError(null)
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync()
      if (level !== LocalAuthentication.SecurityLevel.NONE) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Use your sign-in code' })
        if (!res.success) return
      }
    } catch {
      // No lock available: carry on, as the Security tab does.
    }
    const signedInAs = useAuthStore.getState().userSession?.user?.email ?? email
    const candidates = candidatesFor(await loadOtpAccounts(), signedInAs).slice(0, 4)
    for (const a of candidates) {
      try {
        await verifyMfa(totp(a.secret, Date.now(), a.digits, a.period))
        await keepOnly(a)
        await finishSignIn()
        return
      } catch {
        // Try the next saved code.
      }
    }
    useAuthStore.setState({ error: null })
    setError(
      'The code saved on this phone doesn’t match this account any more, probably because two-step sign-in was set up again since. ' +
        'Use the code from the app you set it up with most recently, or ask the pharmacy owner to reset your two-step sign-in, then set it up again.',
    )
  }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [bioLabel, setBioLabel] = useState<string | null>(null)
  const [bioEmail, setBioEmail] = useState<string | null>(null)
  // The login being signed in with, so we can offer quick sign-in once it
  // has fully succeeded (including the two-step code).
  const pending = useRef<{ email: string; password: string; viaBio: boolean } | null>(null)
  const autoPrompted = useRef(false)

  useEffect(() => {
    ;(async () => {
      const [last, label, enabledFor] = await Promise.all([rememberedEmail(), biometricLabel(), biometricEmail()])
      if (last) setEmail((e) => e || last)
      setBioLabel(label)
      setBioEmail(label ? enabledFor : null)
      // Open the fingerprint/face prompt straight away when it's set up.
      if (label && enabledFor && !autoPrompted.current && !useAuthStore.getState().mfaPendingFactorId) {
        autoPrompted.current = true
        void signInWithBiometrics()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Offer quick sign-in after a successful password sign-in, then go home.
  const finishSignIn = async () => {
    const p = pending.current
    pending.current = null
    if (p) await rememberEmail(p.email)
    if (p && !p.viaBio && bioLabel && bioEmail?.toLowerCase() !== p.email.trim().toLowerCase()) {
      const turnOn = await new Promise<boolean>((resolve) =>
        Alert.alert(
          `Sign in with ${bioLabel} next time?`,
          `Your login is kept in this phone's secure storage and only unlocked by your ${bioLabel}.`,
          [
            { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Turn on', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      )
      if (turnOn && (await enableBiometricLogin(p.email, p.password))) setBioEmail(p.email.trim())
    }
    router.replace('/(app)/home')
  }

  const signInWithBiometrics = async () => {
    setError(null)
    const saved = await readBiometricLogin()
    if (!saved) return
    setEmail(saved.email)
    pending.current = { ...saved, viaBio: true }
    try {
      await userLogin(saved.email, saved.password)
      if (useAuthStore.getState().isUserLoggedIn) await finishSignIn()
    } catch (err) {
      pending.current = null
      const msg = err instanceof Error ? err.message : 'Login failed'
      if (/invalid login|invalid credentials/i.test(msg)) {
        // Password was changed since quick sign-in was set up.
        await disableBiometricLogin()
        setBioEmail(null)
        setError('Your password has changed. Sign in with your password once to turn quick sign-in back on.')
      } else {
        setError(msg)
      }
    }
  }

  const turnOffBiometrics = async () => {
    await disableBiometricLogin()
    setBioEmail(null)
  }

  const onSubmit = async () => {
    setError(null)
    pending.current = { email, password, viaBio: false }
    try {
      await userLogin(email, password)
      if (useAuthStore.getState().isUserLoggedIn) await finishSignIn()
    } catch (err) {
      pending.current = null
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  const onVerify = async () => {
    setError(null)
    try {
      await verifyMfa(code)
      await finishSignIn()
    } catch (err) {
      setCode('')
      setError(err instanceof Error ? err.message : 'That code didn’t work')
    }
  }

  if (mfaPendingFactorId) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <View style={styles.header}>
          <BrandLogo size={36} wordmark="row" />
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.subtitle}>
            This account has two-step sign-in, so every new sign-in needs a code as well as your password. If this phone holds your code, tap “Use the code on this phone”. Otherwise type the 6-digit code from your authenticator app.
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
            <Button label="Use the code on this phone" variant="secondary" onPress={useCodeFromPhone} loading={busy} />
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
        <BrandLogo size={36} wordmark="row" />
        <Text style={styles.title}>Sign in to your account</Text>
        <Text style={styles.subtitle}>
          This is your personal account. Sign in to manage your profile — connect
          a pharmacy afterwards to access work modules.
        </Text>
      </View>

      <View style={styles.form}>
        {bioLabel && bioEmail ? (
          <View style={styles.bio}>
            <Button label={`Sign in with ${bioLabel}`} onPress={() => void signInWithBiometrics()} loading={busy} />
            <Text style={styles.bioHint}>
              {bioEmail} ·{' '}
              <Text style={styles.link} onPress={() => void turnOffBiometrics()}>Turn off</Text>
            </Text>
            <Text style={styles.or}>or use your password</Text>
          </View>
        ) : null}
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
  title: { fontSize: 28, fontWeight: '800', color: palette.text },
  bio: { gap: 10 },
  bioHint: { fontSize: 13, color: palette.textMuted, textAlign: 'center' },
  or: { fontSize: 13, color: palette.textMuted, textAlign: 'center', marginTop: 4 },
  subtitle: { fontSize: 15, lineHeight: 22, color: palette.textMuted },
  form: { gap: 16 },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  link: { color: palette.brandDark, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  footnote: { fontSize: 13, lineHeight: 20, color: palette.textMuted },
})
