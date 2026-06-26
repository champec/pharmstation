// ============================================
// ModuleTabBar — the bottom navigator for a module mini-app.
//
// Renders one item per resolved tab. Web-only tabs render with a small lock
// badge and reduced emphasis; tapping one still fires onSelect so the host can
// explain where the feature lives.
// ============================================

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { palette } from '@/theme/palette'
import type { ModuleTab } from '@/modules/types'

export interface ModuleTabBarItem extends ModuleTab {
  /** True when this tab cannot run on mobile (web-only). */
  locked: boolean
}

interface Props {
  items: ModuleTabBarItem[]
  activeId: string
  accent: string
  onSelect: (tab: ModuleTabBarItem) => void
}

export function ModuleTabBar({ items, activeId, accent, onSelect }: Props) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((tab) => {
        const active = tab.id === activeId && !tab.locked
        const color = tab.locked
          ? palette.textMuted
          : active
            ? accent
            : palette.textMuted
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab)}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.title}
          >
            <View>
              <Ionicons
                name={tab.icon as keyof typeof Ionicons.glyphMap}
                size={22}
                color={color}
                style={tab.locked && styles.locked}
              />
              {tab.locked ? (
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={9} color={palette.textInverse} />
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[styles.label, { color }, active && styles.labelActive]}
            >
              {tab.title}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  locked: { opacity: 0.5 },
  lockBadge: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '600', maxWidth: 72 },
  labelActive: { fontWeight: '800' },
})
