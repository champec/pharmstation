import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from 'react-native'
import { palette, radius } from '@/theme/palette'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string
  variant?: Variant
  loading?: boolean
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variantStyles[variant].container,
        isDisabled && styles.disabled,
        state.pressed && !isDisabled && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].text.color} />
      ) : (
        <Text style={[styles.label, variantStyles[variant].text]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: { fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
})

const variantStyles: Record<
  Variant,
  { container: object; text: { color: string } }
> = {
  primary: {
    container: { backgroundColor: palette.brand },
    text: { color: palette.textInverse },
  },
  secondary: {
    container: {
      backgroundColor: palette.brandTint,
    },
    text: { color: palette.brandDark },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: palette.brand },
  },
  danger: {
    container: { backgroundColor: palette.dangerTint },
    text: { color: palette.danger },
  },
}
