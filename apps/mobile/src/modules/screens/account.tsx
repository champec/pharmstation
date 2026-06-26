// Account — real tab screens (user-tier, always available).
import type { ComponentType } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { TabPlaceholder } from '@/components/module/TabPlaceholder'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function ProfileTab() {
  const router = useRouter()
  const userProfile = useAuthStore((s) => s.userProfile)
  const userLogout = useAuthStore((s) => s.userLogout)
  const busy = useAuthStore((s) => s.busy)

  const onSignOut = async () => {
    await userLogout()
    router.replace('/(auth)/user-login')
  }

  return (
    <View style={styles.content}>
      <View style={styles.card}>
        <Row label="Name" value={userProfile?.full_name ?? '—'} />
        <Row label="Email" value={userProfile?.email ?? '—'} />
        <Row label="Default role" value={userProfile?.default_role ?? '—'} />
        {userProfile?.gphc_number ? (
          <Row label="GPhC number" value={userProfile.gphc_number} />
        ) : null}
      </View>
      <Button
        label="Sign out"
        variant="danger"
        onPress={onSignOut}
        loading={busy}
      />
    </View>
  )
}

function PharmaciesTab() {
  const router = useRouter()
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)

  return (
    <View style={styles.content}>
      <View style={styles.card}>
        {isOrgConnected ? (
          <>
            <Row label="Connected to" value={organisation?.name ?? '—'} />
            <Row label="Your role" value={membership?.role ?? '—'} />
          </>
        ) : (
          <Text style={styles.muted}>No pharmacy connected.</Text>
        )}
      </View>
      <Button
        label={isOrgConnected ? 'Manage pharmacy' : 'Connect a pharmacy'}
        variant="secondary"
        onPress={() => router.push('/(app)/connect-pharmacy')}
      />
    </View>
  )
}

function SecurityTab() {
  return (
    <TabPlaceholder
      icon="shield-checkmark-outline"
      title="Security"
      blurb="Biometric lock, quick-login PIN and active sessions."
      color={palette.brand}
    />
  )
}

export const accountScreens: Record<string, ComponentType> = {
  profile: ProfileTab,
  pharmacies: PharmaciesTab,
  security: SecurityTab,
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 16, paddingTop: 4 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 14, color: palette.textMuted },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },
})
