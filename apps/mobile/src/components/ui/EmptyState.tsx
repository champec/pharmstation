import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { palette } from '@/theme/palette'

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  /** One or two sentences: what will appear here and how to get started. */
  text?: string
  /** Module accent for the icon. Defaults to the brand blue. */
  color?: string
  /** Optional button(s) under the text. */
  action?: ReactNode
}

/**
 * The one empty state used across the app: icon in a soft circle, bold title,
 * muted explanation, optional action. Mirrors the web EmptyState
 * (see /mnt/project-files/design/design-rules.md).
 */
export function EmptyState({ icon, title, text, color = palette.brand, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={26} color={color} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 6 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '700', color: palette.text, textAlign: 'center' },
  text: { fontSize: 14, lineHeight: 20, color: palette.textMuted, textAlign: 'center', maxWidth: 300 },
  action: { marginTop: 12, alignSelf: 'stretch', alignItems: 'center' },
})
