import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
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

  const onConnect = async () => {
    setError(null)
    try {
      await connectOrg(email, password)
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect')
    }
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

          <View style={styles.form}>
            <Field
              label="Pharmacy email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="pharmacy@example.com"
            />
            <Field
              label="Pharmacy password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
            />

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
})
