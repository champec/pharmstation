// ============================================
// Genie button + sheet for module headers.
// Opens Genie over the current module so staff can ask about (or act on) what
// they are looking at without leaving it. Genie is told which screen it is.
// ============================================

import { useState } from 'react'
import { Modal, Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import { GenieChat } from '@/modules/screens/genie'
import type { GeniePageContext } from '@/stores/genie-store'
import { palette, radius } from '@/theme/palette'

export function GenieHeaderButton({ context }: { context: GeniePageContext }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Ask Genie about this screen"
        hitSlop={6}
      >
        <Ionicons name="sparkles" size={18} color={palette.brand} />
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.sheet} edges={['top', 'left', 'right', 'bottom']}>
          <GenieChat context={context} onClose={() => setOpen(false)} keyboardOffset={10} />
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandTint,
  },
  pressed: { opacity: 0.7 },
  sheet: { flex: 1, backgroundColor: palette.bg },
})
