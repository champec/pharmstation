// PharmStation logo: the same "P" mark as the website favicon.
import { StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

export const BRAND_BLUE = '#257BB4'
export const BRAND_CYAN = '#04B0FF'
const P_PATH =
  'M20 50V14h14.5c8 0 13.5 5 13.5 12.2S42.5 38.4 34.5 38.4H28V50h-8zm8-18.6h6c3.6 0 6-2 6-5.2S37.6 21 34 21h-6v10.4z'

interface Props {
  size?: number
  /** "tile" = blue rounded square (light backgrounds); "mark" = white P only (on brand blue). */
  variant?: 'tile' | 'mark'
  /** Show the PharmStation wordmark next to (row) or under (stack) the logo. */
  wordmark?: 'row' | 'stack'
  color?: string
}

export function BrandLogo({ size = 40, variant = 'tile', wordmark, color }: Props) {
  const icon = (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {variant === 'tile' ? <Rect width={64} height={64} rx={14} fill={BRAND_BLUE} /> : null}
      <Path d={P_PATH} fill="#fff" />
      <Circle cx={48} cy={48} r={6} fill={BRAND_CYAN} />
    </Svg>
  )
  if (!wordmark) return icon
  const textColor = color ?? (variant === 'mark' ? '#fff' : BRAND_BLUE)
  return (
    <View style={wordmark === 'row' ? styles.row : styles.stack}>
      {icon}
      <Text
        style={[
          styles.word,
          { color: textColor, fontSize: wordmark === 'row' ? Math.round(size * 0.5) : Math.round(size * 0.28) },
        ]}
      >
        PharmStation
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stack: { alignItems: 'center', gap: 14 },
  word: { fontWeight: '800', letterSpacing: -0.3 },
})
