import { useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

import { Screen } from '@/components/ui/Screen'
import { useAuthStore } from '@/stores/auth-store'
import { useModuleContext } from '@/hooks/useModuleContext'
import {
  launchableModules,
  moduleRoute,
  webOnlyModules,
} from '@/modules/registry'
import type { MobileModule } from '@/modules/types'
import {
  orderModules,
  useModulePrefsStore,
} from '@/stores/module-prefs-store'
import { palette, radius } from '@/theme/palette'

export default function HomeScreen() {
  const router = useRouter()
  const userProfile = useAuthStore((s) => s.userProfile)
  const organisation = useAuthStore((s) => s.organisation)
  const membership = useAuthStore((s) => s.membership)
  const isOrgConnected = useAuthStore((s) => s.isOrgConnected)

  const ctx = useModuleContext()

  // Persisted home configuration (favourites + usage ordering).
  const favourites = useModulePrefsStore((s) => s.favourites)
  const usage = useModulePrefsStore((s) => s.usage)
  const hydrated = useModulePrefsStore((s) => s.hydrated)
  const hydrate = useModulePrefsStore((s) => s.hydrate)
  const toggleFavourite = useModulePrefsStore((s) => s.toggleFavourite)
  const recordOpen = useModulePrefsStore((s) => s.recordOpen)

  useEffect(() => {
    if (!hydrated) void hydrate()
  }, [hydrated, hydrate])

  // Launchable modules, ordered by pin then usage, split by tier.
  const ordered = useMemo(
    () => orderModules(launchableModules(ctx), favourites, usage),
    [ctx, favourites, usage],
  )
  const personalModules = ordered.filter((m) => m.tier === 'user')
  const orgModules = ordered.filter((m) => m.tier === 'org')
  const webModules = useMemo(() => webOnlyModules(ctx), [ctx])

  const firstName = userProfile?.first_name || userProfile?.full_name || 'there'

  const open = (m: MobileModule) => {
    recordOpen(m.id)
    router.push(moduleRoute(m.id) as never)
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <Text style={styles.hello}>Hello, {firstName}</Text>
          <Text style={styles.sub}>What would you like to do?</Text>
        </View>
        <Pressable
          accessibilityLabel="Account"
          onPress={() => router.push(moduleRoute('account') as never)}
          style={styles.avatar}
        >
          <Ionicons name="person" size={22} color={palette.brandDark} />
        </Pressable>
      </View>

      {/* Pharmacy connection status */}
      <OrgStatusCard
        connected={isOrgConnected}
        orgName={organisation?.name}
        role={membership?.role}
        onConnect={() => router.push('/(app)/connect-pharmacy')}
      />

      {/* Personal modules */}
      <Section title="Personal" hint="Long-press a card to pin it to the top">
        {personalModules.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            pinned={favourites.includes(m.id)}
            onPress={() => open(m)}
            onLongPress={() => toggleFavourite(m.id)}
          />
        ))}
      </Section>

      {/* Org modules */}
      {isOrgConnected ? (
        <Section title={organisation?.name ?? 'Pharmacy'}>
          {orgModules.length > 0 ? (
            orgModules.map((m) => (
              <ModuleCard
                key={m.id}
                module={m}
                pinned={favourites.includes(m.id)}
                onPress={() => open(m)}
                onLongPress={() => toggleFavourite(m.id)}
              />
            ))
          ) : (
            <Text style={styles.emptyHint}>
              You don&apos;t have access to any work modules at this pharmacy yet.
            </Text>
          )}
        </Section>
      ) : (
        <Text style={styles.emptyHint}>
          Connect a pharmacy to unlock deliveries, scanning and management
          modules.
        </Text>
      )}

      {/* Web-only modules — shown so the two clients visibly complete each other */}
      {webModules.length > 0 ? (
        <Section title="On the web">
          {webModules.map((m) => (
            <WebModuleCard key={m.id} module={m} />
          ))}
        </Section>
      ) : null}
    </Screen>
  )
}

function OrgStatusCard({
  connected,
  orgName,
  role,
  onConnect,
}: {
  connected: boolean
  orgName?: string
  role?: string
  onConnect: () => void
}) {
  if (connected) {
    return (
      <View style={[styles.orgCard, styles.orgCardConnected]}>
        <View style={styles.orgIcon}>
          <Ionicons name="business" size={20} color={palette.success} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.orgName} numberOfLines={1}>
            {orgName ?? 'Pharmacy'}
          </Text>
          <Text style={styles.orgMeta}>
            Connected{role ? ` · ${role}` : ''}
          </Text>
        </View>
        <View style={styles.dot} />
      </View>
    )
  }

  return (
    <Pressable onPress={onConnect} style={styles.orgCard}>
      <View style={[styles.orgIcon, styles.orgIconIdle]}>
        <Ionicons name="add" size={22} color={palette.brand} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.orgName}>Connect a pharmacy</Text>
        <Text style={styles.orgMeta}>Sign in to a pharmacy you work at</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
    </Pressable>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>{children}</View>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  )
}

function ModuleCard({
  module,
  pinned,
  onPress,
  onLongPress,
}: {
  module: MobileModule
  pinned: boolean
  onPress: () => void
  onLongPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, { backgroundColor: module.color + '1A' }]}>
          <Ionicons
            name={module.icon as keyof typeof Ionicons.glyphMap}
            size={24}
            color={module.color}
          />
        </View>
        {pinned ? (
          <Ionicons name="star" size={16} color={palette.warning} />
        ) : null}
      </View>
      <Text style={styles.cardTitle}>{module.title}</Text>
      <Text style={styles.cardDesc} numberOfLines={2}>
        {module.description}
      </Text>
    </Pressable>
  )
}

function WebModuleCard({ module }: { module: MobileModule }) {
  return (
    <View style={[styles.card, styles.webCard]}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, { backgroundColor: palette.border }]}>
          <Ionicons
            name={module.icon as keyof typeof Ionicons.glyphMap}
            size={24}
            color={palette.textMuted}
          />
        </View>
        <View style={styles.webBadge}>
          <Ionicons name="laptop-outline" size={12} color={palette.textMuted} />
          <Text style={styles.webBadgeText}>Web</Text>
        </View>
      </View>
      <Text style={styles.cardTitle}>{module.title}</Text>
      <Text style={styles.cardDesc} numberOfLines={2}>
        {module.webHint ?? module.description}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingTop: 12 },
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hello: { fontSize: 26, fontWeight: '800', color: palette.text },
  sub: { fontSize: 15, color: palette.textMuted, marginTop: 2 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },

  orgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  orgCardConnected: { borderColor: palette.success + '55' },
  orgIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.success + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgIconIdle: { backgroundColor: palette.brandTint },
  orgName: { fontSize: 16, fontWeight: '700', color: palette.text },
  orgMeta: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.success,
  },

  section: { gap: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: { fontSize: 12, color: palette.textMuted, fontStyle: 'italic' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%',
    flexGrow: 1,
    padding: 16,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 8,
  },
  webCard: { backgroundColor: palette.bg, borderStyle: 'dashed' },
  cardPressed: { opacity: 0.85 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  webBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  webBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textMuted,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  cardDesc: { fontSize: 13, lineHeight: 18, color: palette.textMuted },

  emptyHint: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.textMuted,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
  },
})
