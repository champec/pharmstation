import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { palette, radius } from '@/theme/palette'

export interface SignaturePadRef {
  clear: () => void
  getData: () => string | null
}

export const SignaturePad = forwardRef<SignaturePadRef>(function SignaturePad(
  _props,
  ref,
) {
  const [paths, setPaths] = useState<string[]>([])
  const activePath = useRef('')

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent
        activePath.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`
        setPaths((current) => [...current, activePath.current])
      },
      onPanResponderMove: (event) => {
        const { locationX, locationY } = event.nativeEvent
        activePath.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`
        setPaths((current) => [
          ...current.slice(0, -1),
          activePath.current,
        ])
      },
    }),
  ).current

  useImperativeHandle(ref, () => ({
    clear: () => setPaths([]),
    getData: () =>
      paths.length > 0
        ? `data:application/json,${encodeURIComponent(JSON.stringify(paths))}`
        : null,
  }))

  return (
    <View style={styles.pad} {...responder.panHandlers}>
      <Svg width="100%" height="100%" viewBox="0 0 340 180">
        {paths.map((path, index) => (
          <Path
            key={`${index}-${path.length}`}
            d={path}
            fill="none"
            stroke={palette.text}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  )
})

const styles = StyleSheet.create({
  pad: {
    height: 180,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
})