// ============================================
// "Update available" banner.
//
// Over-the-air updates normally download quietly and only apply after the app
// is fully closed and reopened, which people miss. This checks for an update
// on launch and whenever the app comes back to the foreground, and shows a
// banner with an Update button that downloads it and restarts straight away.
// ============================================

import { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Updates from 'expo-updates'

import { palette } from '@/theme/palette'

const CHECK_EVERY_MS = 10 * 60 * 1000

export function UpdateBanner() {
  const insets = useSafeAreaInsets()
  const { isUpdateAvailable, isUpdatePending, isDownloading } = Updates.useUpdates()
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    let lastCheck = 0
    const check = () => {
      if (Date.now() - lastCheck < 30_000) return
      lastCheck = Date.now()
      Updates.checkForUpdateAsync().catch(() => {})
    }
    check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      sub.remove()
      clearInterval(timer)
    }
  }, [])

  // A newer update showed up after "Later": show the banner again.
  useEffect(() => {
    if (isUpdateAvailable) setDismissed(false)
  }, [isUpdateAvailable])

  if (__DEV__ || !Updates.isEnabled) return null
  if (dismissed || !(isUpdateAvailable || isUpdatePending)) return null

  const update = async () => {
    setError(null)
    try {
      if (!isUpdatePending) await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
    } catch {
      setError('Could not download the update. Check your connection and try again.')
    }
  }

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.card}>
        <Ionicons name="cloud-download-outline" size={22} color="#fff" />
        <View style={styles.text}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.sub}>
            {error ?? (isDownloading ? 'Downloading…' : 'A new version of PharmStation is ready. It takes a few seconds.')}
          </Text>
        </View>
        {isDownloading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.actions}>
            <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
              <Text style={styles.later}>Later</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => void update()}>
              <Text style={styles.btnText}>Update</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.brandDark,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { flex: 1 },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  later: { color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  btn: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  btnText: { color: palette.brandDark, fontWeight: '700' },
})
