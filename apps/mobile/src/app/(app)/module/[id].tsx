import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { useAuthStore } from '@/stores/auth-store'
import { findModule } from '@/modules/registry'
import { palette, radius } from '@/theme/palette'

export default function ModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  if (id === 'account') {
    return <AccountView />
  }
  return <ModulePlaceholder id={id} />
}

// ----------------------------------------------------------------------------
// Account (user-level) — always available.
// ----------------------------------------------------------------------------
function AccountView() {
  const router = useRouter()
  const userProfile = useAuthStore((s) => s.userProfile)
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)
  const userLogout = useAuthStore((s) => s.userLogout)
  const busy = useAuthStore((s) => s.busy)

  const onSignOut = async () => {
    await userLogout()
    router.replace('/(auth)/user-login')
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <Header title="My Account" onBack={() => router.back()} />

      <View style={styles.card}>
        <Row label="Name" value={userProfile?.full_name ?? '—'} />
        <Row label="Email" value={userProfile?.email ?? '—'} />
        <Row label="Default role" value={userProfile?.default_role ?? '—'} />
        {userProfile?.gphc_number ? (
          <Row label="GPhC number" value={userProfile.gphc_number} />
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>Pharmacy</Text>
      <View style={styles.card}>
        {isOrgConnected ? (
          <>
            <Row label="Connected to" value={organisation?.name ?? '—'} />
            <Row label="Your role" value={membership?.role ?? '—'} />
          </>
        ) : (
          <Text style={styles.muted}>No pharmacy connected.</Text>
        )}
        <Button
          label={isOrgConnected ? 'Manage pharmacy' : 'Connect a pharmacy'}
          variant="secondary"
          onPress={() => router.push('/(app)/connect-pharmacy')}
        />
      </View>

      <Button
        label="Sign out"
        variant="danger"
        onPress={onSignOut}
        loading={busy}
      />
    </Screen>
  )
}

// ----------------------------------------------------------------------------
// Generic module placeholder (scaffold).
// ----------------------------------------------------------------------------
function ModulePlaceholder({ id }: { id: string }) {
  const router = useRouter()
  const module = findModule(id)

  return (
    <Screen contentStyle={styles.placeholderContent}>
      <Header title={module?.title ?? 'Module'} onBack={() => router.back()} />
      <View style={styles.placeholderBody}>
        <View
          style={[
            styles.bigIcon,
            { backgroundColor: (module?.color ?? palette.brand) + '1A' },
          ]}
        >
          <Ionicons
            name={(module?.icon ?? 'cube-outline') as keyof typeof Ionicons.glyphMap}
            size={32}
            color={module?.color ?? palette.brand}
          />
        </View>
        <Text style={styles.placeholderTitle}>
          {module?.title ?? 'Unknown module'}
        </Text>
        <Text style={styles.muted}>
          {module?.description ??
            'This module does not exist or you do not have access.'}
        </Text>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Coming soon</Text>
        </View>
      </View>
    </Screen>
  )
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.headerRow}>
      <Pressable onPress={onBack} style={styles.back} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { padding: 4, marginLeft: -4 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: palette.text },

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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  muted: { fontSize: 14, lineHeight: 20, color: palette.textMuted },

  placeholderContent: { gap: 24 },
  placeholderBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  bigIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderTitle: { fontSize: 22, fontWeight: '800', color: palette.text },
  comingSoon: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.brandTint,
  },
  comingSoonText: { color: palette.brandDark, fontWeight: '700', fontSize: 13 },
})
