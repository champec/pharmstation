// Pharmacy → Logs: every log the pharmacy keeps (fridge, cleaning, visitors,
// CD keys, date checks, custom), what's due today, and quick entry on the
// phone. Tap a log to see its recent entries. Building and editing logs,
// corrections, printing and export are on the website.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '@/components/ui/Button'
import { CategoryIcon } from '@/components/pharmacy/CategoryIcon'
import { LogEntrySheet } from '@/components/pharmacy/LogEntrySheet'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import {
  HANDOVER_TEMPLATE_ID,
  addDays,
  dataFields,
  displayValue,
  fetchEntries,
  fetchFields,
  fetchSubscriptions,
  formatDay,
  formatTime,
  isOutOfRange,
  isRequiredOn,
  logErrorMessage,
  relativeDay,
  ukDate,
  type LogEntry,
  type LogField,
  type LogSubscription,
} from '@/lib/logs'

type Row = { sub: LogSubscription; today: LogEntry | null; last: LogEntry | null; due: boolean }

const title = (s: LogSubscription) => s.custom_title || s.template?.title || 'Log'

export function LogsScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [subs, setSubs] = useState<LogSubscription[]>([])
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [fieldsByTemplate, setFieldsByTemplate] = useState<Record<string, LogField[]>>({})
  const [sheet, setSheet] = useState<LogSubscription | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const today = ukDate()

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const list = (await fetchSubscriptions(orgId)).filter((s) => s.template_id !== HANDOVER_TEMPLATE_ID)
      setSubs(list)
      setEntries(await fetchEntries(list.map((s) => s.id), addDays(today, -30), 500))
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

  const live = useMemo(() => entries.filter((e) => !e.voided_at), [entries])

  const rows: Row[] = useMemo(
    () =>
      subs
        .map((sub) => {
          const mine = live.filter((e) => e.subscription_id === sub.id)
          return {
            sub,
            today: mine.find((e) => e.entry_date === today) ?? null,
            last: mine[0] ?? null,
            due: isRequiredOn(sub.template, today),
          }
        })
        .sort((a, b) => title(a.sub).localeCompare(title(b.sub))),
    [subs, live, today],
  )

  const dueNow = rows.filter((r) => r.due && !r.today)
  const doneToday = rows.filter((r) => r.due && r.today)
  const asNeeded = rows.filter((r) => r.sub.template?.schedule_type === 'sporadic')
  const otherDays = rows.filter((r) => !r.due && r.sub.template?.schedule_type !== 'sporadic')

  const toggle = async (r: Row) => {
    const next = open === r.sub.id ? null : r.sub.id
    setOpen(next)
    if (next && !fieldsByTemplate[r.sub.template_id]) {
      try {
        const fs = await fetchFields(r.sub.template_id)
        setFieldsByTemplate((m) => ({ ...m, [r.sub.template_id]: dataFields(fs) }))
      } catch {
        // entries still show without labels
      }
    }
  }

  const section = (label: string, list: Row[], hint?: string) =>
    list.length ? (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{label} ({list.length})</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {list.map((r) => (
          <LogRow
            key={r.sub.id}
            row={r}
            today={today}
            expanded={open === r.sub.id}
            fields={fieldsByTemplate[r.sub.template_id]}
            entries={live.filter((e) => e.subscription_id === r.sub.id).slice(0, 5)}
            onToggle={() => toggle(r)}
            onAdd={() => setSheet(r.sub)}
          />
        ))}
      </View>
    ) : null

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading && subs.length > 0} onRefresh={load} />}
      >
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>
            {rows.some((r) => r.due)
              ? dueNow.length
                ? `${dueNow.length} ${dueNow.length === 1 ? 'log' : 'logs'} due today`
                : 'All of today’s logs are done'
              : 'Nothing due today'}
          </Text>
          <Text style={styles.hint}>{formatDay(today)}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !subs.length ? <ActivityIndicator color={palette.brand} style={{ marginTop: 24 }} /> : null}
        {!loading && !subs.length && !error ? (
          <View style={styles.empty}>
            <Ionicons name="clipboard-outline" size={28} color={palette.brandDark} />
            <Text style={styles.emptyTitle}>No logs yet</Text>
            <Text style={styles.hint}>
              Add a fridge temperature log, cleaning rota or visitor book from the log library on the website. It will show here straight away.
            </Text>
          </View>
        ) : null}

        {section('Due today', dueNow)}
        {section('As needed', asNeeded, 'Add an entry whenever it happens.')}
        {section('Done today', doneToday)}
        {section('Not due today', otherDays)}

        {subs.length ? (
          <View style={styles.footer}>
            <Ionicons name="desktop-outline" size={16} color={palette.textMuted} />
            <Text style={styles.footerText}>Build or change logs, fix an entry, print or export on the website.</Text>
          </View>
        ) : null}
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={18} color={palette.textInverse} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <LogEntrySheet
        visible={!!sheet}
        title={sheet ? title(sheet) : 'Log entry'}
        subtitle={`Today, ${formatDay(today)}`}
        subscriptionId={sheet?.id ?? null}
        templateId={sheet?.template_id ?? null}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setToast(`${sheet ? title(sheet) : 'Entry'} saved.`)
          setSheet(null)
          load()
        }}
      />
    </View>
  )
}

function LogRow({
  row,
  today,
  expanded,
  fields,
  entries,
  onToggle,
  onAdd,
}: {
  row: Row
  today: string
  expanded: boolean
  fields?: LogField[]
  entries: LogEntry[]
  onToggle: () => void
  onAdd: () => void
}) {
  const { sub, today: todayEntry, last, due } = row
  const sporadic = sub.template?.schedule_type === 'sporadic'
  const meta = due
    ? todayEntry
      ? `Done at ${formatTime(todayEntry.created_at)}${todayEntry.entered_by_profile?.full_name ? ` by ${todayEntry.entered_by_profile.full_name}` : ''}`
      : 'Due today'
    : last
      ? `Last entry ${relativeDay(last.entry_date, today).toLowerCase()} at ${formatTime(last.created_at)}`
      : 'No entries yet'

  return (
    <View style={[styles.card, due && !todayEntry && styles.cardDue, due && todayEntry && styles.cardDone]}>
      <Pressable style={styles.cardHead} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }}>
        <CategoryIcon category={sub.template?.category} />
        <View style={styles.flex1}>
          <Text style={styles.cardTitle}>{title(sub)}</Text>
          <Text style={[styles.meta, due && !todayEntry && { color: palette.warning, fontWeight: '700' }]}>{meta}</Text>
        </View>
        <Ionicons
          name={due && todayEntry ? 'checkmark-circle' : expanded ? 'chevron-up' : 'chevron-down'}
          size={due && todayEntry ? 24 : 20}
          color={due && todayEntry ? palette.success : palette.textMuted}
        />
      </Pressable>

      {(!todayEntry || sporadic) && !expanded ? (
        <Button label={due ? 'Log now' : 'Add entry'} variant={due ? 'primary' : 'secondary'} onPress={onAdd} />
      ) : null}

      {expanded ? (
        <View style={styles.entries}>
          {entries.length === 0 ? <Text style={styles.meta}>No entries in the last 30 days.</Text> : null}
          {entries.map((e) => {
            const shown = (fields ?? []).filter((f) => f.field_type !== 'canvas' && f.field_type !== 'signature').slice(0, 4)
            const warn = (fields ?? []).some((f) => isOutOfRange(f, e.data[f.field_key]))
            return (
              <View key={e.id} style={[styles.entry, warn && styles.entryWarn]}>
                <Text style={styles.entryHead}>
                  {relativeDay(e.entry_date, today)} · {formatTime(e.created_at)} · {e.entered_by_profile?.full_name ?? 'Not recorded'}
                  {e.edit_reason ? ' · edited' : ''}
                </Text>
                {shown.map((f) => (
                  <Text key={f.id} style={[styles.entryLine, isOutOfRange(f, e.data[f.field_key]) && { color: palette.danger, fontWeight: '700' }]}>
                    {f.label}: {displayValue(f, e.data[f.field_key])}
                  </Text>
                ))}
              </View>
            )
          })}
          {!todayEntry || sporadic ? (
            <Button label={due ? 'Log now' : 'Add entry'} variant={due ? 'primary' : 'secondary'} onPress={onAdd} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex1: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  summary: { gap: 2 },
  summaryTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  section: { gap: 10, marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, color: palette.textMuted, textTransform: 'uppercase' },
  hint: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  error: { color: palette.danger, fontSize: 14 },
  empty: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 12,
  },
  cardDue: { borderLeftWidth: 4, borderLeftColor: palette.warning },
  cardDone: { borderLeftWidth: 4, borderLeftColor: palette.success, backgroundColor: palette.successTint },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  entries: { gap: 8 },
  entry: { padding: 10, borderRadius: radius.sm, backgroundColor: palette.bg, gap: 2 },
  entryWarn: { backgroundColor: palette.dangerTint },
  entryHead: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  entryLine: { fontSize: 14, color: palette.text },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8, paddingHorizontal: 4 },
  footerText: { flex: 1, fontSize: 13, color: palette.textMuted },
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
