// Pharmacy → Activity: searchable log of who did what, when and at which
// pharmacy, for owners and managers. Same data as the web /oversight/activity
// page (ps_activity_log RPC). Filter by period, module and free text.
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { EmptyState } from '@/components/ui/EmptyState'
import { userClient } from '@/lib/supabase'
import { palette, radius } from '@/theme/palette'

interface ActivityRow {
  at: string
  org_id: string
  org_name: string
  module: string
  action: string
  actor_name: string
  detail: string | null
  record_id: string | null
}

const MODULES: [string, string][] = [
  ['', 'All'], ['rp', 'RP'], ['cd', 'CD'], ['logs', 'Logs'], ['appointments', 'Bookings'], ['services', 'Services'],
  ['deliveries', 'Deliveries'], ['sops', 'SOPs'], ['shop', 'Shop'], ['safety', 'Safety'], ['nhs111', 'NHS 111'], ['staff', 'Staff'],
]
const PERIODS: [number, string][] = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']]
const PAGE = 100

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
})

export function ActivityLogScreen() {
  const [days, setDays] = useState(7)
  const [module, setModule] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchRows = useCallback(async (offset: number) => {
    const from = new Date()
    if (days === 1) from.setHours(0, 0, 0, 0)
    else from.setDate(from.getDate() - days)
    const { data, error: err } = await userClient.rpc('ps_activity_log', {
      p_from: from.toISOString(),
      p_to: new Date().toISOString(),
      p_module: module || null,
      p_search: search || null,
      p_limit: PAGE,
      p_offset: offset,
    })
    if (err) throw err
    return (data ?? []) as ActivityRow[]
  }, [days, module, search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchRows(0)
      setRows(r)
      setHasMore(r.length === PAGE)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [fetchRows])

  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const r = await fetchRows(rows.length)
      setRows((prev) => [...prev, ...r])
      setHasMore(r.length === PAGE)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const multiOrg = new Set(rows.map((r) => r.org_id)).size > 1

  return (
    <FlatList
      style={styles.flex}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(r, i) => `${r.record_id}-${r.at}-${i}`}
      refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <View style={styles.header}>
          <TextInput
            style={styles.search}
            placeholder="Search drug, action, name"
            placeholderTextColor={palette.textMuted}
            value={searchInput}
            onChangeText={setSearchInput}
            autoCorrect={false}
          />
          <Chips options={PERIODS.map(([d, l]) => [String(d), l])} value={String(days)} onChange={(v) => setDays(Number(v))} />
          <Chips options={MODULES} value={module} onChange={setModule} />
          {error && <Text style={styles.error}>Could not load: {error}</Text>}
        </View>
      }
      ListEmptyComponent={loading ? null : (
        <EmptyState
          icon="time-outline"
          title={module || search ? 'No activity matches' : 'No activity in this period'}
          text={module || search ? 'Try another module, a longer period or a different search.' : 'Owners and managers with two-step sign-in see their pharmacies here.'}
        />
      )}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.time}>{fmt(item.at)}</Text>
          <View style={styles.body}>
            <Text style={styles.action}>{item.action}</Text>
            <Text style={styles.meta}>{item.actor_name}{multiOrg ? ` · ${item.org_name}` : ''}</Text>
            {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          </View>
        </View>
      )}
    />
  )
}

function Chips({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map(([k, label]) => (
        <Pressable key={k || 'all'} onPress={() => onChange(k)} style={[styles.chip, value === k && styles.chipActive]} accessibilityRole="button">
          <Text style={[styles.chipText, value === k && styles.chipTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 16, paddingBottom: 40 },
  header: { gap: 10, marginBottom: 8 },
  search: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: palette.text },
  error: { color: palette.danger },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.text, fontSize: 13 },
  chipTextActive: { color: palette.textInverse },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  time: { width: 92, color: palette.textMuted, fontSize: 12 },
  body: { flex: 1, gap: 2 },
  action: { color: palette.text, fontSize: 14, fontWeight: '600' },
  meta: { color: palette.textMuted, fontSize: 12 },
  detail: { color: palette.text, fontSize: 13 },
})
