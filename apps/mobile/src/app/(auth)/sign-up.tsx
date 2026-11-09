// Create a personal PharmStation account from the phone (locums, and staff
// whose pharmacy hasn't invited them yet). Pharmacies sign up on the website.
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { passwordProblem } from '@/lib/account'
import { userClient } from '@/lib/supabase'
import { palette, radius } from '@/theme/palette'

type Kind = 'locum' | 'staff'

function friendly(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (/already registered|already been registered|already exists/i.test(msg)) {
    return 'That email already has a PharmStation account. Sign in instead, or reset your password.'
  }
  if (/password/i.test(msg) && /(weak|short|least|pwned|leaked)/i.test(msg)) {
    return 'Choose a stronger password: at least 10 characters with letters and numbers, and not one that has appeared in a data breach.'
  }
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a few minutes and try again.'
  return msg
}

export default function SignUpScreen() {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('locum')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [gphc, setGphc] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!fullName.trim()) return setError('Enter your full name.')
    if (gphc && !/^\d{7}$/.test(gphc.trim())) return setError('A GPhC registration number is 7 digits.')
    const pw = passwordProblem(password)
    if (pw) return setError(pw)
    if (!agree) return setError('Please confirm you’ve read the privacy notice.')
    setBusy(true)
    try {
      const clean = email.trim().toLowerCase()
      const { data, error: signUpError } = await userClient.auth.signUp({
        email: clean,
        password,
        options: {
          emailRedirectTo: 'https://pharmstation.co.uk/me/login?confirmed=1',
          data: {
            account_type: 'user',
            full_name: fullName.trim(),
            gphc_number: gphc.trim() || null,
            default_role: kind === 'locum' ? 'locum' : 'dispenser',
          },
        },
      })
      if (signUpError) throw signUpError
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('That email already has a PharmStation account. Sign in instead, or reset your password.')
      }
      // Sign-in happens on the login screen once the email is confirmed.
      if (data.session) await userClient.auth.signOut({ scope: 'local' })
      setSentTo(clean)
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <View style={styles.header}>
          <BrandLogo size={36} wordmark="row" />
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We’ve sent a confirmation link to {sentTo}. Tap it, then come back and sign in with your email and password.
          </Text>
        </View>
        <Button label="Go to sign in" onPress={() => router.replace('/(auth)/user-login')} />
      </Screen>
    )
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <BrandLogo size={36} wordmark="row" />
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Your own PharmStation login. It stays with you when you move between pharmacies.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>I am</Text>
        {([
          ['locum', 'A locum', 'Find and book shifts, and keep your documents in one place.'],
          ['staff', 'Pharmacy staff', 'Your manager can then add you. If they sent an invite link, use that instead.'],
        ] as const).map(([k, title, text]) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[styles.option, kind === k && styles.optionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k }}
          >
            <Text style={styles.optionTitle}>{title}</Text>
            <Text style={styles.optionText}>{text}</Text>
          </Pressable>
        ))}

        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
        <Field
          label={kind === 'locum' ? 'GPhC registration number' : 'GPhC number (if you have one)'}
          value={gphc}
          onChangeText={(v) => setGphc(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={7}
        />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <Text style={styles.optionText}>At least 10 characters, with letters and numbers.</Text>

        <View style={styles.agreeRow}>
          <Text style={styles.agreeText}>
            I’ve read the{' '}
            <Text style={styles.inlineLink} onPress={() => Linking.openURL('https://pharmstation.co.uk/privacy')}>privacy notice</Text>
          </Text>
          <Switch value={agree} onValueChange={setAgree} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Create account" onPress={submit} loading={busy} disabled={!fullName || !email || !password} />
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.link}>I already have an account</Text>
        </Pressable>
      </View>

      <Text style={styles.footnote}>Signing up a pharmacy? Do that on pharmstation.co.uk.</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingTop: 32, paddingBottom: 32 },
  header: { gap: 8 },
  title: { fontSize: 28, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: palette.textMuted },
  form: { gap: 14 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  option: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, gap: 4, backgroundColor: palette.surface },
  optionOn: { borderColor: palette.brand, borderWidth: 2 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  optionText: { fontSize: 13, lineHeight: 19, color: palette.textMuted },
  agreeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  agreeText: { fontSize: 14, color: palette.text, flex: 1 },
  inlineLink: { color: palette.brandDark, fontWeight: '600', textDecorationLine: 'underline' },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  link: { color: palette.brandDark, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  footnote: { fontSize: 13, lineHeight: 20, color: palette.textMuted, textAlign: 'center' },
})
