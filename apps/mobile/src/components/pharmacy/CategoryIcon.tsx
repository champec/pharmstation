import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { CATEGORY_ICON } from '@/lib/logs'
import { palette, radius } from '@/theme/palette'

/** Small icon tile for a log's category. */
export function CategoryIcon({ category, size = 22 }: { category?: string | null; size?: number }) {
  const name = (CATEGORY_ICON[category ?? 'custom'] ?? CATEGORY_ICON.custom) as keyof typeof Ionicons.glyphMap
  return (
    <View style={styles.tile}>
      <Ionicons name={name} size={size} color={palette.brandDark} />
    </View>
  )
}

const styles = StyleSheet.create({
  tile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
