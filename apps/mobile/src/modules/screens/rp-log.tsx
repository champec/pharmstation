// Pharmacy → RP Log: who is RP now (with one-tap sign in, step out, back,
// sign out and take over) and the last two weeks of RP sessions. Corrections,
// late records, printing and export stay on the website.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { RpStatusCard } from '@/components/pharmacy/RpStatusCard'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { addDays, formatTime, relativeDay, ukDate } from '@/lib/logs'
import {
  MAX_ABSENCE_MINUTES,
  buildSessions,
  formatDuration,
  formatSince,
  loadRpData,
  minutesBetween,
  rpErrorMessage,
  type RpSession,
} from '@/lib/rp-log'

const DAYS = 14

export function RpLogScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const orgCreated = useAuthStore((s) => s.organisation?.created_at)
  const [sessions, setSessions] = useState<RpSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const data = await loadRpData(orgId, addDays(ukDate(), -DAYS))
      setSessions(buildSessions(data.entries, data.absences))
      setError(null)
    } catch (e) {
      setError(rpErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const refresh = () => {
    setRefreshKey((k) => k + 1)
    load()
  }

  const days = useMemo(() => {
    const today = ukDate()
    const byDay = new Map<string, RpSession[]>()
    for (const s of sessions) {
      const d = s.current.rp_signed_in_at ? ukDate(new Date(s.current.rp_signed_in_at)) : s.date
      byDay.set(d, [...(byDay.get(d) ?? []), s])
    }
    // Don't list days before the pharmacy existed (or its earliest record, if older).
    const opened = orgCreated ? ukDate(new Date(orgCreated)) : null
    const earliest = [...byDay.keys()].sort()[0] ?? null
    const firstDay = [opened, earliest].filter((d): d is string => !!d).sort()[0] ?? null
    const out: { date: string; sessions: RpSession[] }[] = []
    for (let i = 0; i <= DAYS; i++) {
      const d = addDays(today, -i)
      if (firstDay && d < firstDay && d !== today) break
      out.push({ date: d, sessions: (byDay.get(d) ?? []).slice().reverse() })
    }
    return out
  }, [sessions, orgCreated])

  // Collapse runs of empty days into one line.
  const rows: ({ kind: 'day'; date: string; sessions: RpSession[] } | { kind: 'gap'; from: string; to: string } | { kind: 'carry'; session: RpSession })[] = []
  const open = sessions.find((s) => s.isOpen) ?? null
  for (const d of days) {
    const last = rows[rows.length - 1]
    if (d.sessions.length) rows.push({ kind: 'day', ...d })
    // Today with nobody new, but an RP still on duty from an earlier day.
    else if (d.date === ukDate() && open?.current.rp_signed_in_at) rows.push({ kind: 'carry', session: open })
    else if (last?.kind === 'gap') last.to = d.date
    else rows.push({ kind: 'gap', from: d.date, to: d.date })
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading && sessions.length > 0} onRefresh={refresh} />}
    >
      <RpStatusCard refreshKey={refreshKey} onChange={load} />

      <Text style={styles.section}>Last {DAYS} days</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {rows.map((r) =>
        r.kind === 'carry' ? (
          <View key="carry" style={styles.day}>
            <Text style={styles.dayTitle}>Today</Text>
            <Text style={styles.carry}>
              {r.session.current.pharmacist_name} is still on duty, signed in {formatSince(r.session.current.rp_signed_in_at!)}.
            </Text>
          </View>
        ) : r.kind === 'gap' ? (
          <Text key={`gap-${r.from}`} style={styles.gap}>
            {r.from === r.to ? relativeDay(r.from) : `${relativeDay(r.to)} – ${relativeDay(r.from)}`} · no RP recorded
          </Text>
        ) : (
          <View key={r.date} style={styles.day}>
            <Text style={styles.dayTitle}>{relativeDay(r.date)}</Text>
            {r.sessions.map((s) => (
              <SessionRow key={s.root.id} s={s} />
            ))}
          </View>
        ),
      )}

      <View style={styles.footer}>
        <Ionicons name="desktop-outline" size={16} color={palette.textMuted} />
        <Text style={styles.footerText}>Corrections, late records, printing and export are on the website.</Text>
      </View>
    </ScrollView>
  )
}

function SessionRow({ s }: { s: RpSession }) {
  const c = s.current
  const mins = c.rp_signed_in_at ? minutesBetween(c.rp_signed_in_at, c.rp_signed_out_at) : 0
  const awayMins = s.absences.reduce((t, a) => t + minutesBetween(a.absent_from, a.returned_at), 0)
  const outDay = c.rp_signed_out_at ? ukDate(new Date(c.rp_signed_out_at)) : null
  const inDay = c.rp_signed_in_at ? ukDate(new Date(c.rp_signed_in_at)) : null
  return (
    <View style={styles.session}>
      <View style={styles.sessionHead}>
        <Text style={styles.sessionName} numberOfLines={1}>{c.pharmacist_name}</Text>
        {s.isOpen ? <Text style={[styles.badge, styles.badgeOn]}>On duty</Text> : null}
        {s.edits.length ? <Text style={[styles.badge, styles.badgeEdit]}>Corrected</Text> : null}
      </View>
      <Text style={styles.meta}>GPhC {c.gphc_number}</Text>
      <Text style={styles.times}>
        {formatTime(c.rp_signed_in_at)} → {c.rp_signed_out_at ? formatTime(c.rp_signed_out_at) : 'now'}
        {outDay && inDay && outDay !== inDay ? ` (${relativeDay(outDay)})` : ''} · {formatDuration(mins)}
      </Text>
      {s.absences.length ? (
        <Text style={[styles.meta, awayMins > MAX_ABSENCE_MINUTES && { color: palette.danger }]}>
          Away {s.absences.length}× · {formatDuration(awayMins)}
          {awayMins > MAX_ABSENCE_MINUTES ? ' · over 2 hours' : ''}
          {s.absences.map((a) => (a.reason ? ` · ${a.reason}` : '')).join('')}
        </Text>
      ) : null}
      {c.notes ? <Text style={styles.meta}>{c.notes}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, color: palette.textMuted, marginTop: 8, textTransform: 'uppercase' },
  error: { color: palette.danger, fontSize: 14 },
  carry: { fontSize: 14, color: palette.text, paddingHorizontal: 4 },
  gap: { fontSize: 13, color: palette.textMuted, paddingHorizontal: 4, fontStyle: 'italic' },
  day: { gap: 8 },
  dayTitle: { fontSize: 15, fontWeight: '800', color: palette.text, paddingHorizontal: 4 },
  session: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 3,
  },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionName: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: palette.text },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  badgeOn: { color: palette.success, backgroundColor: palette.successTint },
  badgeEdit: { color: palette.warning, backgroundColor: palette.warningTint },
  times: { fontSize: 15, fontWeight: '600', color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8, paddingHorizontal: 4 },
  footerText: { flex: 1, fontSize: 13, color: palette.textMuted },
})
