// Locum Shifts → SOPs: the SOPs each pharmacy you have a booking with asks
// locums to read and sign before a shift. Files open in the in-app browser.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, SectionList, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'

import { fetchLocumSOPs, signLocumSOP, signedUrl, ukDate, type LocumSOP } from '@/lib/sops'
import { sopStyles as styles } from '@/modules/screens/sops'
import { useAuthStore } from '@/stores/auth-store'
import { palette } from '@/theme/palette'

const ACCENT = palette.brand

export function LocumSOPsScreen() {
  const locumId = useAuthStore((s) => s.locumProfile?.id)
  const [items, setItems] = useState<LocumSOP[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!locumId) return
    setLoading(true)
    try {
      setItems(await fetchLocumSOPs(locumId))
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load SOPs')
    }
    setLoading(false)
  }, [locumId])

  useEffect(() => { void load() }, [load])

  const view = async (sop: LocumSOP) => {
    if (!sop.file_url) return
    setBusy(sop.id)
    try {
      await WebBrowser.openBrowserAsync(await signedUrl(sop.file_url))
      setOpened((o) => ({ ...o, [sop.id]: true }))
    } catch (e: any) {
      Alert.alert('Could not open the SOP', e?.message ?? 'Please try again.')
    }
    setBusy(null)
  }

  const sign = (sop: LocumSOP) => {
    if (!locumId) return
    Alert.alert(
      'Sign this SOP?',
      `You confirm you have read and understood "${sop.title}" (version ${sop.version}) for ${sop.org_name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign',
          onPress: async () => {
            setBusy(sop.id)
            try {
              await signLocumSOP(sop, locumId)
              await load()
            } catch (e: any) {
              Alert.alert('Could not sign', e?.message ?? 'Please try again.')
            }
            setBusy(null)
          },
        },
      ],
    )
  }

  const sections = Object.values(
    items.reduce<Record<string, { title: string; data: LocumSOP[] }>>((acc, s) => {
      ;(acc[s.org_id] ??= { title: s.org_name, data: [] }).data.push(s)
      return acc
    }, {}),
  )
  const toSign = items.filter((s) => !s.signed_at && s.is_required).length

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SectionList
        sections={sections}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.summary}>
              {toSign === 0 ? 'All required SOPs are signed.' : `${toSign} required SOP${toSign === 1 ? '' : 's'} to sign`}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={36} color={ACCENT} />
              <Text style={styles.emptyText}>No SOPs to read</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                When you book a shift, the pharmacy's SOPs appear here for you to read and sign before you start.
              </Text>
            </View>
          )
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.panelTitle, { marginTop: 8, marginBottom: 8 }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const signed = !!item.signed_at
          const working = busy === item.id
          return (
            <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Ionicons
                  name={signed ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={signed ? palette.success : palette.textMuted}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name}>{item.title}</Text>
                  {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
                  <Text style={styles.muted}>
                    Version {item.version}
                    {item.is_required ? ' · required' : ' · optional'}
                    {signed ? ` · signed ${ukDate(item.signed_at)}` : ''}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {item.file_url ? (
                  <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => view(item)} disabled={working} accessibilityRole="button">
                    <Ionicons name="open-outline" size={18} color={ACCENT} />
                    <Text style={styles.secondaryText}>Read</Text>
                  </Pressable>
                ) : null}
                {!signed ? (
                  <Pressable
                    style={[styles.primary, { flex: 1, paddingVertical: 12 }, (working || (!!item.file_url && !opened[item.id])) && { opacity: 0.5 }]}
                    onPress={() => sign(item)}
                    disabled={working || (!!item.file_url && !opened[item.id])}
                    accessibilityRole="button"
                    accessibilityHint={item.file_url && !opened[item.id] ? 'Read the SOP first' : undefined}
                  >
                    {working ? <ActivityIndicator color="#fff" /> : null}
                    <Text style={styles.primaryText}>Sign</Text>
                  </Pressable>
                ) : null}
              </View>
              {!signed && item.file_url && !opened[item.id] ? (
                <Text style={styles.muted}>Open and read the SOP before you sign.</Text>
              ) : null}
            </View>
          )
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        stickySectionHeadersEnabled={false}
      />
    </View>
  )
}
