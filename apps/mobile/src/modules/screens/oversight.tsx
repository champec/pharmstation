// Pharmacy → Oversight: owners and managers see every pharmacy they run at a
// glance. RP on duty, today's logs, CD checks, bookings, deliveries, staff, an
// alert list per pharmacy and a recent activity feed. Same data as the web
// /oversight page (ps_org_oversight RPC). Needs view_audit + two-step sign-in.
import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { EmptyState } from '@/components/ui/EmptyState'
import { userClient } from '@/lib/supabase'
import { palette, radius } from '@/theme/palette'

interface OversightAlert { level: 'error' | 'warning' | 'info'; module: string; text: string }
interface OversightOrg {
  id: string
  name: string
  town: string | null
  rp: { name: string | null; since: string } | null
  rp_last: { name: string | null; at: string } | null
  cd: { last_check_at: string | null; entries_7d: number }
  logs: { due_today: number; done_today: number; missing: string[] }
  appointments: { today: number; upcoming_7d: number }
  deliveries: { today: number; completed_today: number }
  staff: { active: number; active_today: number }
  shop: { open_orders: number }
  alerts: OversightAlert[]
}
interface OversightEvent { org_id: string; org_name: string; at: string; module: string; text: string }
interface OversightData { generated_at: string; organisations: OversightOrg[]; activity: OversightEvent[] }

const MODULE_LABEL: Record<string, string> = {
  rp: 'RP', cd: 'CD', logs: 'Logs', appointments: 'Bookings', deliveries: 'Deliveries',
  sops: 'SOPs', staff: 'Staff', safety: 'Safety', shop: 'Shop', nhs111: 'NHS 111',
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
function fmtWhen(iso: string) {
  const sameDay = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) ===
    new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' })
  return sameDay ? fmtTime(iso) : `${fmtDate(iso)} ${fmtTime(iso)}`
}

export function OversightScreen() {
  const [data, setData] = useState<OversightData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgFilter, setOrgFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: res, error: err } = await userClient.rpc('ps_org_oversight', { p_activity_limit: 40 })
    if (err) setError(err.message)
    else { setData(res as OversightData); setError(null) }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const orgs = data?.organisations ?? []
  const shown = orgFilter === 'all' ? orgs : orgs.filter((o) => o.id === orgFilter)
  const alertCount = shown.reduce((n, o) => n + o.alerts.length, 0)
  const rpOn = shown.filter((o) => o.rp).length
  const logsDue = shown.reduce((n, o) => n + o.logs.due_today, 0)
  const logsDone = shown.reduce((n, o) => n + o.logs.done_today, 0)
  const activity = (data?.activity ?? []).filter((e) => orgFilter === 'all' || e.org_id === orgFilter)

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} />}
    >
      {error && <Text style={styles.error}>Could not load: {error}</Text>}

      {!loading && !error && orgs.length === 0 && (
        <EmptyState
          icon="pulse-outline"
          title="No pharmacies to oversee"
          text="This shows pharmacies where you are an owner or manager. Two-step sign-in must be on."
        />
      )}

      {orgs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[{ id: 'all', name: `All (${orgs.length})` }, ...orgs].map((o) => (
            <Pressable
              key={o.id}
              onPress={() => setOrgFilter(o.id)}
              style={[styles.chip, orgFilter === o.id && styles.chipActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, orgFilter === o.id && styles.chipTextActive]}>{o.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {orgs.length > 0 && (
        <View style={styles.stats}>
          <Stat label="Needs action" value={String(alertCount)} accent={alertCount > 0} />
          <Stat label="RP signed in" value={`${rpOn} of ${shown.length}`} />
          <Stat label="Logs today" value={`${logsDone} of ${logsDue}`} />
          <Stat label="Bookings today" value={String(shown.reduce((n, o) => n + o.appointments.today, 0))} />
        </View>
      )}

      {shown.map((o) => <OrgCard key={o.id} org={o} />)}

      {orgs.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent activity</Text>
          {activity.length === 0 ? (
            <Text style={styles.muted}>Nothing in the last 7 days.</Text>
          ) : activity.map((e, i) => (
            <View key={`${e.at}-${i}`} style={styles.feedRow}>
              <Text style={styles.feedTime}>{fmtWhen(e.at)}</Text>
              <View style={styles.feedBody}>
                <Text style={styles.feedText}>{e.text}</Text>
                <Text style={styles.muted}>{MODULE_LABEL[e.module] ?? e.module}{orgs.length > 1 ? ` · ${e.org_name}` : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.stat, accent && styles.statAccent]}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

function OrgCard({ org }: { org: OversightOrg }) {
  const urgent = org.alerts.some((a) => a.level === 'error')
  const edge = urgent ? palette.danger : org.alerts.length ? palette.warning : palette.success
  return (
    <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: edge }]}>
      <Text style={styles.cardTitle}>{org.name}</Text>
      {org.town ? <Text style={styles.muted}>{org.town}</Text> : null}
      <Text style={styles.rp}>
        {org.rp
          ? `RP: ${org.rp.name ?? 'Pharmacist'} since ${fmtWhen(org.rp.since)}`
          : `No RP signed in${org.rp_last ? ` · last ${org.rp_last.name ?? 'RP'}, ${fmtWhen(org.rp_last.at)}` : ''}`}
      </Text>
      <View style={styles.metrics}>
        <Metric label="Logs today" value={`${org.logs.done_today}/${org.logs.due_today}`} />
        <Metric label="CD entries 7d" value={String(org.cd.entries_7d)} />
        <Metric label="Last CD check" value={org.cd.last_check_at ? fmtDate(org.cd.last_check_at) : 'Never'} />
        <Metric label="Bookings today" value={String(org.appointments.today)} />
        <Metric label="Rounds today" value={`${org.deliveries.completed_today}/${org.deliveries.today}`} />
        <Metric label="Staff active" value={`${org.staff.active_today}/${org.staff.active}`} />
      </View>
      {org.alerts.length === 0 ? (
        <View style={styles.alertRow}>
          <Ionicons name="checkmark-circle-outline" size={16} color={palette.success} />
          <Text style={[styles.alertText, { color: palette.success }]}>Nothing needs attention</Text>
        </View>
      ) : org.alerts.map((a, i) => (
        <View key={i} style={styles.alertRow}>
          <Ionicons name="warning-outline" size={16} color={a.level === 'error' ? palette.danger : palette.warning} />
          <Text style={styles.alertText}>{a.text}</Text>
        </View>
      ))}
      {org.logs.missing.length > 0 && (
        <Text style={styles.muted}>Not filled in today: {org.logs.missing.join(', ')}</Text>
      )}
    </View>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  error: { color: palette.danger },
  muted: { color: palette.textMuted, fontSize: 12 },
  chips: { gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.text, fontSize: 13 },
  chipTextActive: { color: palette.textInverse },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, backgroundColor: palette.surface, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: palette.border },
  statAccent: { borderLeftWidth: 4, borderLeftColor: palette.warning },
  statLabel: { fontSize: 11, fontWeight: '600', color: palette.textMuted, letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: '700', color: palette.text, marginTop: 2 },
  card: { backgroundColor: palette.surface, borderRadius: radius.md, padding: 16, gap: 8, borderWidth: 1, borderColor: palette.border },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  rp: { color: palette.text, fontSize: 14 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: { flexBasis: '31%', flexGrow: 1, backgroundColor: palette.bg, borderRadius: radius.sm, padding: 8 },
  metricLabel: { fontSize: 11, color: palette.textMuted },
  metricValue: { fontSize: 15, fontWeight: '700', color: palette.text, marginTop: 2 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertText: { flex: 1, color: palette.text, fontSize: 14 },
  feedRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.bg },
  feedTime: { width: 84, color: palette.textMuted, fontSize: 12 },
  feedBody: { flex: 1 },
  feedText: { color: palette.text, fontSize: 14 },
})
