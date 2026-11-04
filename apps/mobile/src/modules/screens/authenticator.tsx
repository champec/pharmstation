// ============================================
// Account > Security: the built-in authenticator.
//
// The PharmStation app can hold two-step sign-in codes itself, so staff don't
// need Google or Microsoft Authenticator (those still work too). Codes can be
// added by:
//   - "Set up on this phone": turns on two-step sign-in for the signed-in
//     account and keeps the secret here, with no QR code needed;
//   - scanning the QR code the website shows during setup;
//   - typing the setup key by hand.
// Secrets stay in the Keychain / Keystore. When the phone has Face ID,
// a fingerprint or a passcode set up, viewing codes asks for it first.
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera'
import * as LocalAuthentication from 'expo-local-authentication'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { addOtpAccount, loadOtpAccounts, removeOtpAccount } from '@/lib/authenticator'
import { hasVerifiedTotp, startPhoneTotpEnrollment, verifyTotpCode } from '@/lib/supabase'
import { parseOtpauth, totp, type OtpAccount } from '@/lib/totp'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

type Mode = 'list' | 'scan' | 'manual'

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Ask for Face ID / fingerprint / passcode when the phone has one set up. */
async function deviceUnlock(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    if ((!hardware || !enrolled) && level === LocalAuthentication.SecurityLevel.NONE) return true
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Show your sign-in codes' })
    return res.success
  } catch {
    return true
  }
}

export function SecurityTab() {
  const userProfile = useAuthStore((s) => s.userProfile)
  const [unlocked, setUnlocked] = useState(false)
  const [accounts, setAccounts] = useState<OtpAccount[] | null>(null)
  const [accountHasTotp, setAccountHasTotp] = useState<boolean | null>(null)
  const [mode, setMode] = useState<Mode>('list')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualLabel, setManualLabel] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [permission, requestPermission] = useCameraPermissions()
  const now = useNow()
  const scanned = useRef(false)

  const unlock = useCallback(async () => {
    if (await deviceUnlock()) {
      setUnlocked(true)
      setAccounts(await loadOtpAccounts())
    }
  }, [])

  useEffect(() => {
    void unlock()
    hasVerifiedTotp().then(setAccountHasTotp).catch(() => setAccountHasTotp(null))
  }, [unlock])

  const setUpOnThisPhone = async () => {
    setBusy(true)
    setError(null)
    try {
      const { factorId, secret } = await startPhoneTotpEnrollment()
      let next = await addOtpAccount({
        issuer: 'PharmStation',
        label: userProfile?.email ?? 'My account',
        secret,
        digits: 6,
        period: 30,
        factorId,
      })
      try {
        await verifyTotpCode(factorId, totp(secret))
      } catch (err) {
        // Don't keep a code for a setup that didn't finish.
        const stale = next.find((a) => a.factorId === factorId)
        if (stale) next = await removeOtpAccount(stale.id)
        setAccounts(next)
        throw err
      }
      setAccounts(next)
      setAccountHasTotp(true)
      Alert.alert('Two-step sign-in is on', 'When PharmStation asks for a code, open My Account > Security on this phone.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t turn on two-step sign-in.')
    } finally {
      setBusy(false)
    }
  }

  const startScan = async () => {
    setError(null)
    const p = permission?.granted ? permission : await requestPermission()
    if (!p.granted) {
      setError('Allow camera access in your phone’s settings to scan the code, or type the setup key instead.')
      return
    }
    scanned.current = false
    setMode('scan')
  }

  const save = async (account: Omit<OtpAccount, 'id' | 'addedAt'>) => {
    setAccounts(await addOtpAccount(account))
    setMode('list')
    setManualKey('')
    setManualLabel('')
    Alert.alert('Code added', 'Type the code shown here into the website to finish turning on two-step sign-in.')
  }

  const onScanned = ({ data }: BarcodeScanningResult) => {
    // The camera reports the same code many times a second; take the first.
    if (scanned.current) return
    scanned.current = true
    try {
      void save(parseOtpauth(data))
    } catch (err) {
      setMode('list')
      setError(err instanceof Error ? err.message : 'That QR code couldn’t be read.')
    }
  }

  const saveManual = async () => {
    setError(null)
    try {
      const secret = manualKey.replace(/\s/g, '').toUpperCase()
      totp(secret) // validates the key
      await save({ issuer: 'PharmStation', label: manualLabel.trim() || 'My account', secret, digits: 6, period: 30 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That setup key isn’t valid.')
    }
  }

  const confirmRemove = (a: OtpAccount) => {
    Alert.alert(
      'Remove this code?',
      'If two-step sign-in is still on for this account, you won’t be able to sign in without another authenticator. A pharmacy owner can reset it for you.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => setAccounts(await removeOtpAccount(a.id)) },
      ],
    )
  }

  if (mode === 'scan') {
    return (
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={onScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={styles.scanFrame} />
        <Pressable style={styles.close} onPress={() => setMode('list')} accessibilityLabel="Close camera">
          <Ionicons name="close" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.cameraHint}>Point at the QR code on the PharmStation website</Text>
      </View>
    )
  }

  if (!unlocked) {
    return (
      <View style={styles.content}>
        <View style={styles.card}>
          <Ionicons name="lock-closed-outline" size={28} color={palette.brand} />
          <Text style={styles.title}>Your sign-in codes are locked</Text>
          <Text style={styles.muted}>Unlock with Face ID, your fingerprint or your phone passcode to see them.</Text>
          <Button label="Unlock" onPress={unlock} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Two-step sign-in</Text>
        {accountHasTotp ? (
          <Text style={styles.muted}>
            On for {userProfile?.email ?? 'your account'}. When PharmStation asks for a code, use one below or your
            other authenticator app.
          </Text>
        ) : (
          <>
            <Text style={styles.muted}>
              Use this phone for your sign-in codes. Owners and managers need two-step sign-in, and it protects patient
              records if your password is ever guessed.
            </Text>
            <Button label="Set up on this phone" onPress={setUpOnThisPhone} loading={busy} />
          </>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Codes on this phone</Text>
      {accounts === null ? (
        <ActivityIndicator color={palette.brand} />
      ) : accounts.length === 0 ? (
        <Text style={styles.muted}>None yet. Set up two-step sign-in above, or scan the QR code the website shows.</Text>
      ) : (
        accounts.map((a) => <CodeCard key={a.id} account={a} now={now} onLongPress={() => confirmRemove(a)} />)
      )}
      {accounts && accounts.length > 0 ? (
        <Text style={styles.hint}>Press and hold a code to remove it.</Text>
      ) : null}

      {mode === 'manual' ? (
        <View style={styles.card}>
          <Field label="Name (optional)" value={manualLabel} onChangeText={setManualLabel} placeholder="e.g. Work account" />
          <Field
            label="Setup key"
            value={manualKey}
            onChangeText={setManualKey}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="The long code under the QR code"
          />
          <Button label="Add code" onPress={saveManual} disabled={!manualKey.trim()} />
          <Button label="Cancel" variant="ghost" onPress={() => setMode('list')} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Scan a QR code" variant="secondary" onPress={startScan} />
          <Button label="Type a setup key" variant="ghost" onPress={() => { setError(null); setMode('manual') }} />
        </View>
      )}
    </ScrollView>
  )
}

function CodeCard({ account, now, onLongPress }: { account: OtpAccount; now: number; onLongPress: () => void }) {
  let code = '------'
  try {
    code = totp(account.secret, now, account.digits, account.period)
  } catch {
    // A broken secret shows dashes rather than crashing the screen.
  }
  const secondsLeft = account.period - (Math.floor(now / 1000) % account.period)
  const spaced = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
  return (
    <Pressable onLongPress={onLongPress} style={styles.codeCard} accessibilityLabel={`${account.issuer} code ${code.split('').join(' ')}`}>
      <View style={styles.flex}>
        <Text style={styles.codeIssuer}>{account.issuer}</Text>
        <Text style={styles.codeLabel} numberOfLines={1}>{account.label}</Text>
        <Text style={[styles.code, secondsLeft <= 5 && styles.codeEnding]}>{spaced}</Text>
      </View>
      <View style={styles.timer}>
        <Text style={styles.timerText}>{secondsLeft}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingTop: 4, paddingBottom: 24 },
  flex: { flex: 1 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: palette.text },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
  hint: { fontSize: 12, color: palette.textMuted, textAlign: 'center' },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  section: { fontSize: 13, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  actions: { gap: 10 },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  codeIssuer: { fontSize: 13, fontWeight: '700', color: palette.brandDark },
  codeLabel: { fontSize: 13, color: palette.textMuted },
  code: { fontSize: 34, fontWeight: '800', letterSpacing: 2, color: palette.text, fontVariant: ['tabular-nums'], marginTop: 4 },
  codeEnding: { color: palette.danger },
  timer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerText: { fontSize: 14, fontWeight: '700', color: palette.brandDark },
  cameraWrap: { flex: 1, minHeight: 420, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  scanFrame: {
    position: 'absolute',
    top: '22%',
    left: '15%',
    right: '15%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: radius.lg,
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    padding: 8,
  },
  cameraHint: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
})
