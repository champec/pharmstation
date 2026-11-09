import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { palette, radius } from '@/theme/palette'

interface FieldProps extends TextInputProps {
  label: string
}

/** Labelled text input. Password fields (secureTextEntry) get a show/hide
 *  eye button so people can check what they typed. */
export function Field({ label, style, secureTextEntry, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const isPassword = !!secureTextEntry
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          style={[styles.input, isPassword && styles.inputWithToggle, focused && styles.inputFocused, style]}
          placeholderTextColor={palette.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={isPassword && !revealed}
          {...rest}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            style={styles.toggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={22} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: palette.text,
    backgroundColor: palette.surface,
  },
  inputWithToggle: { paddingRight: 48 },
  inputFocused: { borderColor: palette.brand },
  toggle: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
})
