import { useState } from 'react'
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { palette, radius } from '@/theme/palette'

interface FieldProps extends TextInputProps {
  label: string
}

export function Field({ label, style, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, style]}
        placeholderTextColor={palette.textMuted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
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
  inputFocused: { borderColor: palette.brand },
})
