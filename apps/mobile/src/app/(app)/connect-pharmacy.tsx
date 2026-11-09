import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { forgetPharmacy, loadSavedPharmacies, savePharmacy, type SavedPharmacy } from '@/lib/saved-pharmacies'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

export default function ConnectPharmacyScreen() {
  const router = useRouter()
  const connectOrg = useAuthStore((s) => s.connectOrg)
  const disconnectOrg = useAuthStore((s) => s.disconnectOrg)
  const busy = useAuthStore((s) => s.busy)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  const [saved, setSaved] = useState<SavedPharmacy[]>([])

  useEffect(() => {
    loadSavedPharmacies().then(setSaved)
  }, [])

  const connect = async (e: string, p: string, keep: boolean) => {
    setError(null)
    try {
      await connectOrg(e, p)
      const name = useAuthStore.getState().organisation?.name ?? e
      if (keep) await savePharmacy(e, p, name)
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect')
    }
  }

  const onConnect = () => connect(email, password, remember)

  const onForget = (p: SavedPharmacy) => {
    Alert.alert(`Forget ${p.name}?`, 'You’ll need the pharmacy login to connect again.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => setSaved(await forgetPharmacy(p.email)) },
    ])
  }

  const onDisconnect = async () => {
    await disconnectOrg()
    router.back()
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <Pressable
        onPress={() => router.back()}
        style={styles.close}
        accessibilityLabel="Close"
      >
        <Ionicons name="close" size={24} color={palette.textMuted} />
      </Pressable>

      {isOrgConnected ? (
        <View style={styles.connectedWrap}>
          <View style={styles.bigIcon}>
            <Ionicons name="business" size={28} color={palette.success} />
          </View>
          <Text style={styles.title}>{organisation?.name}</Text>
          <Text style={styles.subtitle}>
            Connected as {membership?.role}. You can switch pharmacies by
            disconnecting first.
          </Text>
          <Button
            label="Disconnect pharmacy"
            variant="danger"
            onPress={onDisconnect}
            loading={busy}
          />
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View style={styles.bigIcon}>
              <Ionicons name="business" size={28} color={palette.brand} />
            </View>
            <Text style={styles.title}>Connect a pharmacy</Text>
            <Text style={styles.subtitle}>
              Sign in with the pharmacy&apos;s organisation login. You must be an
              approved member to access its modules.
            </Text>
          </View>

          {saved.length > 0 ? (
            <View style={styles.form}>
              <Text style={styles.section}>Your pharmacies</Text>
              {saved.map((p) => (
                <Pressable
                  key={p.email}
                  style={styles.savedRow}
                  onPress={() => connect(p.email, p.password, true)}
                  onLongPress={() => onForget(p)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Connect to ${p.name}`}
                >
                  <Ionicons name="business-outline" size={22} color={palette.brand} />
                  <View style={styles.flex}>
                    <Text style={styles.savedName}>{p.name}</Text>
                    <Text style={styles.savedEmail}>{p.email}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
                </Pressable>
              ))}
              <Text style={styles.hint}>Tap to connect. Press and hold to forget.</Text>
              <Text style={styles.section}>Another pharmacy</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Field
              label="Pharmacy email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="username"
              textContentType="username"
              keyboardType="email-address"
              placeholder="pharmacy@example.com"
            />
            <Field
              label="Pharmacy password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              placeholder="••••••••"
            />

            <View style={styles.rememberRow}>
              <Text style={styles.rememberText}>Remember this pharmacy on this phone</Text>
              <Switch value={remember} onValueChange={setRemember} />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label="Connect"
              onPress={onConnect}
              loading={busy}
              disabled={!email || !password}
            />
          </View>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingTop: 8 },
  close: { alignSelf: 'flex-end', padding: 4 },
  header: { gap: 8, alignItems: 'flex-start' },
  connectedWrap: { gap: 16, alignItems: 'flex-start' },
  bigIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: palette.textMuted },
  form: { gap: 16 },
  error: { color: palette.danger, fontSize: 14, fontWeight: '600' },
  flex: { flex: 1 },
  section: { fontSize: 13, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
  },
  savedName: { fontSize: 16, fontWeight: '700', color: palette.text },
  savedEmail: { fontSize: 13, color: palette.textMuted },
  hint: { fontSize: 12, color: palette.textMuted },
  rememberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rememberText: { fontSize: 14, color: palette.text, flex: 1 },
})
