// Pharmacy → Handover: everything the next person needs at a glance. Who is
// RP, which of today's checks are done (tap one to log it), and the shift
// handover notes from the last week. Notes are a library log ("Shift
// Handover"), so they are append-only and show on the website's Logs page.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '@/components/ui/Button'
import { LogEntrySheet } from '@/components/pharmacy/LogEntrySheet'
import { RpStatusCard } from '@/components/pharmacy/RpStatusCard'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import {
  CATEGORY_LOOK,
  HANDOVER_TEMPLATE_ID,
  addDays,
  ensureLibrarySubscription,
  fetchEntries,
  fetchSubscriptions,
  formatDay,
  formatTime,
  handoverTemplateExists,
  isRequiredOn,
  logErrorMessage,
  relativeDay,
  ukDate,
  type LogEntry,
  type LogSubscription,
} from '@/lib/logs'

type Sheet = { kind: 'log'; sub: LogSubscription } | { kind: 'handover'; sub: LogSubscription } | null

export function HandoverScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [subs, setSubs] = useState<LogSubscription[]>([])
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [handoverReady, setHandoverReady] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [opening, setOpening] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const today = ukDate()

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [list, ready] = await Promise.all([fetchSubscriptions(orgId), handoverTemplateExists()])
      setSubs(list)
      setHandoverReady(ready)
      setEntries(await fetchEntries(list.map((s) => s.id), addDays(today, -7)))
      setError(null)
    } catch (e) {
      setError(logErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [orgId, today])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const handoverSub = subs.find((s) => s.template_id === HANDOVER_TEMPLATE_ID) ?? null
  const live = entries.filter((e) => !e.voided_at)

  const checks = useMemo(
    () =>
      subs
        .filter((s) => s.template_id !== HANDOVER_TEMPLATE_ID && isRequiredOn(s.template, today))
        .map((s) => ({ sub: s, done: live.find((e) => e.subscription_id === s.id && e.entry_date === today) ?? null }))
        .sort((a, b) => Number(!!a.done) - Number(!!b.done)),
    [subs, live, today],
  )
  const doneCount = checks.filter((c) => c.done).length

  const notes = handoverSub ? live.filter((e) => e.subscription_id === handoverSub.id) : []

  const openHandover = async () => {
    if (!orgId) return
    if (handoverSub) {
      setSheet({ kind: 'handover', sub: handoverSub })
      return
    }
    setOpening(true)
    try {
      const sub = await ensureLibrarySubscription(orgId, HANDOVER_TEMPLATE_ID)
      if (sub) {
        setSubs((s) => [...s, sub])
        setSheet({ kind: 'handover', sub })
      } else setHandoverReady(false)
    } catch (e) {
      setError(logErrorMessage(e))
    } finally {
      setOpening(false)
    }
  }

  const onSaved = () => {
    setToast(sheet?.kind === 'handover' ? 'Handover saved. The next shift will see it here.' : 'Logged. Nice work!')
    setSheet(null)
    load()
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading && subs.length > 0}
            onRefresh={() => {
              setRefreshKey((k) => k + 1)
              load()
            }}
          />
        }
      >
        <RpStatusCard refreshKey={refreshKey} />

        {/* Today's checks */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Today’s checks</Text>
          {checks.length ? (
            <Text style={[styles.count, doneCount === checks.length && { color: palette.success }]}>
              {doneCount}/{checks.length} done
            </Text>
          ) : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !checks.length ? (
          <Text style={styles.empty}>No daily logs due today. Add logs like the fridge temperature log on the website.</Text>
        ) : null}
        {checks.map(({ sub, done }) => {
          const look = CATEGORY_LOOK[sub.template?.category ?? 'custom'] ?? CATEGORY_LOOK.custom
          return (
            <Pressable
              key={sub.id}
              style={({ pressed }) => [styles.check, done && styles.checkDone, pressed && !done && { opacity: 0.8 }]}
              disabled={!!done}
              onPress={() => setSheet({ kind: 'log', sub })}
            >
              <Text style={styles.emoji}>{look.emoji}</Text>
              <View style={styles.flex1}>
                <Text style={styles.checkTitle}>{sub.custom_title || sub.template?.title}</Text>
                <Text style={styles.meta}>
                  {done
                    ? `Done at ${formatTime(done.created_at)}${done.entered_by_profile?.full_name ? ` by ${done.entered_by_profile.full_name}` : ''}`
                    : 'Due today · tap to log'}
                </Text>
              </View>
              <Ionicons
                name={done ? 'checkmark-circle' : 'chevron-forward'}
                size={done ? 26 : 20}
                color={done ? palette.success : palette.textMuted}
              />
            </Pressable>
          )
        })}

        {/* Handover notes */}
        <View style={styles.sectionHead}>
          <Text style={styles.section}>Handover notes</Text>
        </View>
        {handoverReady === false ? (
          <Text style={styles.empty}>Handover notes need a quick database update before they can be used.</Text>
        ) : (
          <Button label="Write a handover note" loading={opening} onPress={openHandover} />
        )}
        {notes.length === 0 && handoverReady ? (
          <Text style={styles.empty}>No handover notes in the last week.</Text>
        ) : null}
        {notes.map((n) => (
          <NoteCard key={n.id} note={n} />
        ))}
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="sparkles" size={18} color={palette.textInverse} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <LogEntrySheet
        visible={!!sheet}
        title={sheet?.kind === 'handover' ? 'Handover note' : (sheet?.sub.custom_title || sheet?.sub.template?.title || 'Log entry')}
        subtitle={sheet?.kind === 'handover' ? 'For whoever is on next' : `Today, ${formatDay(today)}`}
        subscriptionId={sheet?.sub.id ?? null}
        templateId={sheet?.sub.template_id ?? null}
        submitLabel={sheet?.kind === 'handover' ? 'Save handover' : 'Save entry'}
        onClose={() => setSheet(null)}
        onSaved={onSaved}
      />
    </View>
  )
}

function NoteCard({ note }: { note: LogEntry }) {
  const d = note.data as Record<string, unknown>
  const urgent = d.urgent === true
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return (
    <View style={[styles.note, urgent && styles.noteUrgent]}>
      <View style={styles.noteHead}>
        {urgent ? <Text style={[styles.badge, styles.badgeUrgent]}>Urgent</Text> : null}
        <Text style={styles.meta}>
          {relativeDay(note.entry_date)} · {formatTime(note.created_at)} · {str(d.handed_over_by) ?? note.entered_by_profile?.full_name ?? 'Someone'}
          {str(d.handed_to) ? ` → ${str(d.handed_to)}` : ''}
        </Text>
      </View>
      {str(d.summary) ? <Text style={styles.noteText}>{str(d.summary)}</Text> : null}
      {str(d.outstanding) ? (
        <View style={styles.todo}>
          <Text style={styles.todoLabel}>Still to do</Text>
          <Text style={styles.noteText}>{str(d.outstanding)}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex1: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  section: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, color: palette.textMuted, textTransform: 'uppercase' },
  count: { fontSize: 13, fontWeight: '800', color: palette.brandDark },
  error: { color: palette.danger, fontSize: 14 },
  empty: { fontSize: 14, color: palette.textMuted, lineHeight: 20 },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderLeftWidth: 4,
    borderLeftColor: palette.warning,
  },
  checkDone: { borderLeftColor: palette.success, backgroundColor: '#F7FEFB' },
  emoji: { fontSize: 24 },
  checkTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted, lineHeight: 18, flexShrink: 1 },
  note: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 8,
  },
  noteUrgent: { borderColor: palette.danger, backgroundColor: '#FFF7F7' },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  noteText: { fontSize: 15, lineHeight: 21, color: palette.text },
  todo: { backgroundColor: '#FFFBEB', borderRadius: radius.sm, padding: 10, gap: 2 },
  todoLabel: { fontSize: 12, fontWeight: '800', color: palette.warning, textTransform: 'uppercase' },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  badgeUrgent: { color: palette.danger, backgroundColor: palette.dangerTint },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.success,
    borderRadius: radius.md,
    padding: 14,
  },
  toastText: { flex: 1, color: palette.textInverse, fontWeight: '700', fontSize: 14 },
})
