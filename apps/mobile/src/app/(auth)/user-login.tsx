import { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
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
import { sendMfaRecoveryEmail } from '@/lib/supabase'
import { requestPasswordResetEmail } from '@/lib/account'
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
  const recoverMfaByEmail = useAuthStore((s) => s.recoverMfaByEmail)
  const userLogout = useAuthStore((s) => s.userLogout)
  const [code, setCode] = useState('')
  const [phoneCodes, setPhoneCodes] = useState(false)
  // Set once a recovery code has been emailed: the code box then takes that code.
  const [emailedTo, setEmailedTo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

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
        'Tap “Can’t get your code? Email me one instead” below to get back in, then set two-step sign-in up again.',
    )
  }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)

  const sendReset = async () => {
    setError(null)
    setResetBusy(true)
    try {
      await requestPasswordResetEmail(email)
      setResetSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send the email. Try again.')
    } finally {
      setResetBusy(false)
    }
  }
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

  // After a full sign-in (including the two-step code): with "Remember me"
  // on, keep the email and, when the phone has a fingerprint or face, turn
  // on quick sign-in (the phone confirms with its own prompt). Then go home.
  const finishSignIn = async () => {
    const p = pending.current
    pending.current = null
    if (p && remember) {
      await rememberEmail(p.email)
      if (!p.viaBio && bioLabel && bioEmail?.toLowerCase() !== p.email.trim().toLowerCase()) {
        if (await enableBiometricLogin(p.email, p.password)) setBioEmail(p.email.trim())
      }
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

  const emailMeACode = async () => {
    setError(null)
    setSending(true)
    try {
      const to = await sendMfaRecoveryEmail()
      setEmailedTo(to ?? 'your email')
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send the email. Try again.')
    } finally {
      setSending(false)
    }
  }

  const onVerify = async () => {
    setError(null)
    try {
      if (emailedTo) {
        await recoverMfaByEmail(code)
        await finishSignIn()
        Alert.alert(
          'Two-step sign-in is off',
          'You’re signed in. Turn two-step sign-in back on now in My Account > Security, and add a backup to Google or Microsoft Authenticator so this doesn’t happen again.',
        )
        return
      }
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
          <Text style={styles.title}>{emailedTo ? 'Check your email' : 'Enter your code'}</Text>
          <Text style={styles.subtitle}>
            {emailedTo
              ? `We’ve emailed a 6-digit code to ${emailedTo}. It lasts 10 minutes. Entering it turns off two-step sign-in so you can set it up again.`
              : 'This account has two-step sign-in, so every new sign-in needs a code as well as your password. If this phone holds your code, tap “Use the code on this phone”. Otherwise type the 6-digit code from your authenticator app.'}
          </Text>
        </View>
        <View style={styles.form}>
          <Field
            label={emailedTo ? 'Code from the email' : '6-digit code'}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {phoneCodes && !emailedTo ? (
            <Button label="Use the code on this phone" variant="secondary" onPress={useCodeFromPhone} loading={busy} />
          ) : null}
          <Button
            label="Verify"
            onPress={onVerify}
            loading={busy}
            disabled={code.replace(/\s/g, '').length !== 6}
          />
          <Pressable onPress={emailMeACode} disabled={sending} accessibilityRole="button">
            <Text style={styles.link}>
              {sending ? 'Sending…' : emailedTo ? 'Send a new email code' : 'Can’t get your code? Email me one instead'}
            </Text>
          </Pressable>
          {emailedTo ? (
            <Pressable onPress={() => { setEmailedTo(null); setCode(''); setError(null) }} accessibilityRole="button">
              <Text style={styles.link}>Use my authenticator code after all</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => userLogout()} accessibilityRole="button">
            <Text style={styles.link}>Use a different account</Text>
          </Pressable>
        </View>
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
          autoComplete="username"
          textContentType="username"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          placeholder="••••••••"
        />

        <View style={styles.rememberRow}>
          <Text style={styles.rememberText}>
            {bioLabel ? `Remember me (sign in with ${bioLabel} next time)` : 'Remember my email'}
          </Text>
          <Switch value={remember} onValueChange={setRemember} />
        </View>

        {resetOpen ? (
          <View style={styles.resetBox}>
            <Text style={styles.resetText}>
              {resetSent
                ? `If ${email.trim()} has a PharmStation account, we’ve emailed it a link to set a new password. Open it on any device, then sign in here.`
                : 'Enter your email above and we’ll send you a link to set a new password.'}
            </Text>
            {!resetSent ? (
              <Button label="Email me a reset link" variant="secondary" onPress={sendReset} loading={resetBusy} disabled={!email.trim()} />
            ) : null}
            <Pressable onPress={() => { setResetOpen(false); setResetSent(false) }} accessibilityRole="button">
              <Text style={styles.link}>{resetSent ? 'Done' : 'Cancel'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => { setError(null); setResetOpen(true) }} accessibilityRole="button">
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label="Sign in"
          onPress={onSubmit}
          loading={busy}
          disabled={!email || !password}
        />
      </View>

      <Button label="Create an account" variant="ghost" onPress={() => router.push('/(auth)/sign-up')} />
      <Text style={styles.footnote}>
        Invited by your pharmacy? Open the link in the invite email instead.
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 28, paddingTop: 32 },
  resetBox: { gap: 10, padding: 14, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  resetText: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
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
  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rememberText: { fontSize: 14, color: palette.text, flex: 1 },
})
