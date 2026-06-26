// ============================================
// ModuleHost — renders a module as a self-contained mini-app.
//
// Responsibilities:
//   - resolve the module + its visible tabs for the current user
//   - enforce gating (no access -> friendly "not available" state)
//   - render the active tab's screen (from the screen registry, else a
//     generated placeholder)
//   - drive the bottom ModuleTabBar, including locked web-only tabs which,
//     when tapped, explain where the feature lives instead of switching.
// ============================================

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useModuleContext } from '@/hooks/useModuleContext'
import { findModule, moduleTabs } from '@/modules/registry'
import { getTabComponent } from '@/modules/screens'
import { isTabLaunchable } from '@/modules/types'
import { TabPlaceholder } from '@/components/module/TabPlaceholder'
import {
  ModuleTabBar,
  type ModuleTabBarItem,
} from '@/components/module/ModuleTabBar'
import { palette, radius } from '@/theme/palette'

interface Props {
  moduleId: string
}

export function ModuleHost({ moduleId }: Props) {
  const router = useRouter()
  const ctx = useModuleContext()
  const module = findModule(moduleId)

  // Resolve visible tabs + mark which ones are locked (web-only) on this device.
  const items: ModuleTabBarItem[] = useMemo(() => {
    if (!module) return []
    return moduleTabs(module, ctx).map((t) => ({
      ...t,
      locked: !isTabLaunchable(module, t),
    }))
  }, [module, ctx])

  // Default to the first launchable tab so we never open onto a locked screen.
  const firstLaunchable = items.find((t) => !t.locked) ?? items[0]
  const [activeId, setActiveId] = useState<string | undefined>(
    firstLaunchable?.id,
  )
  const [lockedNotice, setLockedNotice] = useState<string | null>(null)

  // --- Guard: module missing or not permitted for this user. ---
  if (!module || !module.visible(ctx)) {
    return (
      <NotAvailable
        title="Not available"
        message="This module doesn’t exist or you don’t have access to it here."
        onBack={() => router.back()}
      />
    )
  }

  // --- Guard: visible on web only (no launchable tabs at all). ---
  if (items.length === 0 || items.every((t) => t.locked)) {
    return (
      <NotAvailable
        title={module.title}
        icon={module.icon}
        color={module.color}
        message={
          module.webHint ??
          'This module is managed in the PharmStation web app.'
        }
        onBack={() => router.back()}
      />
    )
  }

  const activeTab =
    items.find((t) => t.id === activeId && !t.locked) ?? firstLaunchable
  const TabComponent = activeTab
    ? getTabComponent(module.id, activeTab.id)
    : undefined

  const onSelect = (tab: ModuleTabBarItem) => {
    if (tab.locked) {
      setLockedNotice(
        tab.blurb
          ? `“${tab.title}” lives in the web app — ${tab.blurb.toLowerCase()}`
          : `“${tab.title}” is managed in the PharmStation web app.`,
      )
      return
    }
    setLockedNotice(null)
    setActiveId(tab.id)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <View style={[styles.headerIcon, { backgroundColor: module.color + '1A' }]}>
          <Ionicons
            name={module.icon as keyof typeof Ionicons.glyphMap}
            size={18}
            color={module.color}
          />
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {module.title}
        </Text>
      </View>

      {/* Active tab content */}
      <View style={styles.body}>
        {lockedNotice ? (
          <View style={styles.notice}>
            <Ionicons name="laptop-outline" size={16} color={palette.brandDark} />
            <Text style={styles.noticeText}>{lockedNotice}</Text>
          </View>
        ) : null}

        {activeTab && TabComponent ? (
          <TabComponent />
        ) : activeTab ? (
          <TabPlaceholder
            icon={activeTab.icon}
            title={activeTab.title}
            blurb={activeTab.blurb}
            color={module.color}
          />
        ) : null}
      </View>

      {/* Bottom tab bar */}
      <ModuleTabBar
        items={items}
        activeId={activeTab?.id ?? ''}
        accent={module.color}
        onSelect={onSelect}
      />
    </SafeAreaView>
  )
}

function NotAvailable({
  title,
  message,
  icon = 'cube-outline',
  color = palette.brand,
  onBack,
}: {
  title: string
  message: string
  icon?: string
  color?: string
  onBack: () => void
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.centered}>
        <View style={[styles.bigIcon, { backgroundColor: color + '1A' }]}>
          <Ionicons
            name={icon as keyof typeof Ionicons.glyphMap}
            size={30}
            color={color}
          />
        </View>
        <Text style={styles.centeredText}>{message}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  back: { padding: 4, marginLeft: -4 },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.text,
    flexShrink: 1,
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.brandTint,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: { flex: 1, fontSize: 13, color: palette.brandDark, lineHeight: 18 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  bigIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredText: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
})
