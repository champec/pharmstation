// ============================================
// TabPlaceholder — scaffold content for a not-yet-built module tab.
//
// `makeTab(...)` returns a ready component so each module's screen file is a
// thin declaration. Replace these with real screens as features land — the
// ModuleHost, gating and navigation never need to change.
// ============================================

import type { ComponentType } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { palette, radius } from '@/theme/palette'

export interface TabPlaceholderProps {
  icon: string
  title: string
  blurb?: string
  color?: string
}

export function TabPlaceholder({
  icon,
  title,
  blurb,
  color = palette.brand,
}: TabPlaceholderProps) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: color + '1A' }]}>
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={30}
          color={color}
        />
      </View>
      <Text style={styles.title}>{title}</Text>
      {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Coming soon</Text>
      </View>
    </View>
  )
}

/** Build a placeholder tab component from static options. */
export function makeTab(opts: TabPlaceholderProps): ComponentType {
  const Tab = () => <TabPlaceholder {...opts} />
  Tab.displayName = `Tab(${opts.title})`
  return Tab
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  blurb: {
    fontSize: 14,
    lineHeight: 20,
    color: palette.textMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.brandTint,
  },
  badgeText: { color: palette.brandDark, fontWeight: '700', fontSize: 13 },
})
