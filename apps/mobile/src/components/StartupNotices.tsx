// ============================================
// Startup notices: required updates and app-wide announcements.
//
// Runs once, when the app is freshly opened (not when it comes back from the
// background):
//   1. Asks the update server whether a newer over-the-air update exists. If
//      so, a full-screen notice that can't be skipped downloads it and
//      restarts the app, so nobody has to close and reopen it to get fixes.
//   2. Otherwise shows any live announcements from ps_app_announcements
//      (posted by PharmStation admins on the web), one at a time.
//      Dismissible ones are shown once per phone; non-dismissible ones stay
//      up for as long as they are live (outages only).
// ============================================

import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'

import { userClient } from '@/lib/supabase'
import { palette, radius } from '@/theme/palette'

type Announcement = {
  id: string
  title: string
  body: string
  link_url: string | null
  link_label: string | null
  dismissible: boolean
}

const SEEN_KEY = 'ps-seen-announcements'
const CHECK_TIMEOUT_MS = 8000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

async function readSeen(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function StartupNotices() {
  const { isUpdatePending, downloadProgress } = Updates.useUpdates()
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [queue, setQueue] = useState<Announcement[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!__DEV__ && Updates.isEnabled) {
        const result = await withTimeout(Updates.checkForUpdateAsync().catch(() => null), CHECK_TIMEOUT_MS)
        if (cancelled) return
        if (result?.isAvailable) {
          setNeedsUpdate(true)
          return
        }
      }
      const { data } = await userClient
        .from('ps_app_announcements')
        .select('id, title, body, link_url, link_label, dismissible')
        .in('audience', ['mobile', 'all'])
        .order('starts_at', { ascending: false })
        .limit(5)
      if (cancelled || !data?.length) return
      const seen = await readSeen()
      setQueue((data as Announcement[]).filter((a) => !a.dismissible || !seen.includes(a.id)))
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const runUpdate = async () => {
    setUpdating(true)
    setUpdateError(null)
    try {
      if (!isUpdatePending) await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
    } catch {
      setUpdating(false)
      setUpdateError('The download didn’t finish. Check your signal or Wi-Fi and try again.')
    }
  }

  const dismiss = async (a: Announcement) => {
    setQueue((q) => q.filter((x) => x.id !== a.id))
    const seen = await readSeen()
    try {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([a.id, ...seen].slice(0, 50)))
    } catch {
      // Worst case it shows again next launch.
    }
  }

  if (needsUpdate) {
    const pct = typeof downloadProgress === 'number' && downloadProgress > 0 ? Math.round(downloadProgress * 100) : null
    return (
      <Modal visible animationType="fade" transparent onRequestClose={() => {}} statusBarTranslucent>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="cloud-download-outline" size={30} color={palette.brand} />
            </View>
            <Text style={styles.title}>Update available</Text>
            <Text style={styles.body}>
              A new version of PharmStation is ready with the latest fixes and features. It only takes a few seconds, then the app restarts.
            </Text>
            {updateError ? <Text style={styles.error}>{updateError}</Text> : null}
            <Pressable style={[styles.primary, updating && styles.disabled]} disabled={updating} onPress={() => void runUpdate()}>
              {updating ? (
                <View style={styles.row}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.primaryText}>{pct !== null ? `Downloading ${pct}%` : 'Downloading…'}</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>{updateError ? 'Try again' : 'Update now'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    )
  }

  const current = queue[0]
  if (!current) return null

  return (
    <Modal visible animationType="fade" transparent onRequestClose={() => { if (current.dismissible) void dismiss(current) }} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="megaphone-outline" size={28} color={palette.brand} />
          </View>
          <Text style={styles.title}>{current.title}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.body}>{current.body}</Text>
          </ScrollView>
          {current.link_url ? (
            <Pressable
              style={current.dismissible ? styles.secondary : styles.primary}
              onPress={() => void Linking.openURL(current.link_url!)}
            >
              <Text style={current.dismissible ? styles.secondaryText : styles.primaryText}>{current.link_label || 'Find out more'}</Text>
            </Pressable>
          ) : null}
          {current.dismissible ? (
            <Pressable style={styles.primary} onPress={() => void dismiss(current)}>
              <Text style={styles.primaryText}>Got it</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: 24,
    alignItems: 'stretch',
    gap: 12,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', color: palette.text, textAlign: 'center' },
  scroll: { maxHeight: 320 },
  scrollContent: { paddingBottom: 4 },
  body: { fontSize: 15, lineHeight: 22, color: palette.textMuted, textAlign: 'center' },
  error: { fontSize: 13, color: palette.danger, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primary: { backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { color: palette.brandDark, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.85 },
})
