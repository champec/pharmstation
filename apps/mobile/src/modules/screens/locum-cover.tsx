// ============================================
// Locum cover — the pharmacy side of locum shifts, on the phone
//
// For people who can approve locums (approve_locums, two-step sign-in):
//   Shifts    upcoming shifts, applications to confirm or turn down, cancel
//   To record finished shifts with no sign-out: record worked or no-show
// Posting a new shift stays on the website (rates, criteria, SOPs).
// All writes go through the same database functions the website uses.
// ============================================

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { EmptyState as SharedEmptyState } from '@/components/ui/EmptyState'

const ACCENT = '#6D28D9'
const ACCENT_TINT = '#F1EAFE'

interface Booking {
  id: string
  locum_id: string
  status: string
  applied_at: string
  name: string
  gphc: string | null
  signed_in_at: string | null
  signed_out_at: string | null
}
interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  rate_per_hour: number
  status: string
  booking_mode: 'auto' | 'manual'
  bookings: Booking[]
}

const ukToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const t = (v: string) => v.slice(0, 5)
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

function useCover() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
      const { data, error: e } = await userClient
        .from('ps_locum_shifts')
        .select('id, date, start_time, end_time, rate_per_hour, status, booking_mode, bookings:ps_locum_bookings(id, locum_id, status, applied_at, sign_in:ps_locum_sign_ins(signed_in_at, signed_out_at))')
        .eq('org_id', orgId)
        .gte('date', since)
        .order('date')
        .order('start_time')
      if (e) throw e
      type Raw = Omit<Shift, 'bookings'> & { bookings: (Omit<Booking, 'name' | 'gphc' | 'signed_in_at' | 'signed_out_at'> & { sign_in: { signed_in_at: string; signed_out_at: string | null } | { signed_in_at: string; signed_out_at: string | null }[] | null })[] }
      const raw = (data ?? []) as unknown as Raw[]
      const ids = [...new Set(raw.flatMap((s) => s.bookings.map((b) => b.locum_id)))]
      const names = new Map<string, { name: string; gphc: string | null }>()
      if (ids.length) {
        const { data: people } = await userClient.rpc('ps_org_shift_locums', { p_org_id: orgId, p_locum_ids: ids })
        for (const p of (people ?? []) as { locum_id: string; full_name: string; gphc_number: string | null }[]) names.set(p.locum_id, { name: p.full_name, gphc: p.gphc_number })
      }
      setShifts(raw.map((s) => ({
        ...s,
        bookings: s.bookings.map((b) => {
          const si = Array.isArray(b.sign_in) ? b.sign_in[0] ?? null : b.sign_in
          return { ...b, name: names.get(b.locum_id)?.name ?? 'Locum', gphc: names.get(b.locum_id)?.gphc ?? null, signed_in_at: si?.signed_in_at ?? null, signed_out_at: si?.signed_out_at ?? null }
        }),
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load shifts.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, fn: string, args: Record<string, unknown>) => {
    setBusy(key)
    setError(null)
    const { error: e } = await userClient.rpc(fn, args)
    setBusy(null)
    if (e) setError(e.message.includes('Forbidden') || e.message.includes('permission') ? 'You need permission to manage locums, and two-step sign-in, to do this.' : e.message)
    await load()
  }

  return { shifts, loading, error, busy, load, run }
}

function ShiftsScreen() {
  const { shifts, loading, error, busy, load, run } = useCover()
  const today = ukToday()
  const upcoming = useMemo(() => shifts.filter((s) => s.date >= today && s.status !== 'cancelled' && s.status !== 'completed'), [shifts, today])
  const pendingCount = upcoming.reduce((n, s) => n + s.bookings.filter((b) => b.status === 'pending').length, 0)

  const review = (b: Booking, decision: 'approve' | 'reject') => Alert.alert(
    decision === 'approve' ? `Confirm ${b.name}?` : `Turn down ${b.name}?`,
    decision === 'approve' ? 'They will be booked for this shift and told by email. Other applicants are turned down.' : 'They will be told by email.',
    [{ text: 'Back', style: 'cancel' }, { text: decision === 'approve' ? 'Confirm' : 'Turn down', style: decision === 'reject' ? 'destructive' : 'default', onPress: () => void run(b.id, 'ps_org_review_booking', { p_booking_id: b.id, p_action: decision, p_reason: null }) }],
  )
  const cancel = (s: Shift) => Alert.alert('Cancel this shift?', `${day(s.date)} ${t(s.start_time)}–${t(s.end_time)}. Anyone booked or applied is told by email.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel shift', style: 'destructive', onPress: () => void run(s.id, 'ps_org_cancel_shift', { p_shift_id: s.id, p_reason: null }) },
  ])

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={ACCENT} />}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Locum cover</Text>
        <Text style={styles.heroText}>{upcoming.length} upcoming shift{upcoming.length === 1 ? '' : 's'}{pendingCount ? ` · ${pendingCount} application${pendingCount === 1 ? '' : 's'} to review` : ''}</Text>
        <Text style={styles.heroHint}>Post new shifts on pharmstation.co.uk › Shifts.</Text>
      </View>
      {error ? <ErrorBox text={error} /> : null}
      {!loading && upcoming.length === 0 ? <Empty text="No upcoming locum shifts." /> : null}
      {upcoming.map((s) => {
        const live = s.bookings.filter((b) => b.status === 'pending' || b.status === 'approved')
        const booked = live.find((b) => b.status === 'approved')
        return (
          <View key={s.id} style={styles.card}>
            <View style={styles.between}>
              <Text style={styles.cardTitle}>{day(s.date)} · {t(s.start_time)}–{t(s.end_time)}</Text>
              <Pill text={booked ? 'Booked' : s.status === 'open' ? 'Open' : s.status} tone={booked ? palette.success : palette.warning} />
            </View>
            <Text style={styles.meta}>£{Number(s.rate_per_hour).toFixed(2)}/hr · {s.booking_mode === 'auto' ? 'instant booking' : 'you confirm applicants'}</Text>
            {live.length === 0 ? <Text style={styles.meta}>No applications yet.</Text> : null}
            {live.map((b) => (
              <View key={b.id} style={styles.person}>
                <Ionicons name={b.status === 'approved' ? 'checkmark-circle' : 'person-circle-outline'} size={22} color={b.status === 'approved' ? palette.success : ACCENT} />
                <View style={styles.flex}>
                  <Text style={styles.personName}>{b.name}</Text>
                  <Text style={styles.meta}>{b.gphc ? `GPhC ${b.gphc} · ` : ''}{b.status === 'approved' ? 'Confirmed' : 'Applied'}</Text>
                </View>
                {b.status === 'pending' ? (
                  busy === b.id ? <ActivityIndicator color={ACCENT} /> : (
                    <>
                      <Pressable onPress={() => review(b, 'reject')} style={styles.ghostBtn}><Text style={styles.ghostText}>Decline</Text></Pressable>
                      <Pressable onPress={() => review(b, 'approve')} style={styles.solidBtn}><Text style={styles.solidText}>Confirm</Text></Pressable>
                    </>
                  )
                ) : null}
              </View>
            ))}
            <Pressable onPress={() => cancel(s)} disabled={busy === s.id} style={styles.cancelLink}><Text style={styles.cancelText}>{busy === s.id ? 'Cancelling…' : 'Cancel shift'}</Text></Pressable>
          </View>
        )
      })}
    </ScrollView>
  )
}

function RecordScreen() {
  const { shifts, loading, error, busy, load, run } = useCover()
  const today = ukToday()
  const items = useMemo(() => shifts.flatMap((s) => s.date <= today ? s.bookings.filter((b) => b.status === 'approved').map((b) => ({ s, b })) : [])
    .filter(({ s }) => s.date < today || s.end_time <= new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false })), [shifts, today])
  const recent = useMemo(() => shifts.flatMap((s) => s.bookings.filter((b) => b.status === 'completed' || b.status === 'no_show').map((b) => ({ s, b }))).reverse().slice(0, 15), [shifts])

  const mark = (b: Booking, status: 'completed' | 'no_show') => Alert.alert(
    status === 'completed' ? `Confirm ${b.name} worked this shift?` : `Record ${b.name} as a no-show?`,
    status === 'completed' ? 'The shift goes on both timesheets.' : 'This is kept on their record with your pharmacy.',
    [{ text: 'Back', style: 'cancel' }, { text: status === 'completed' ? 'Worked' : 'No-show', style: status === 'no_show' ? 'destructive' : 'default', onPress: () => void run(b.id, 'ps_org_mark_booking', { p_booking_id: b.id, p_status: status }) }],
  )

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={ACCENT} />}>
      <Text style={styles.section}>Needs recording</Text>
      <Text style={styles.meta}>Finished shifts waiting for you to confirm. Shifts where the locum signed in and out for the booked hours are confirmed automatically after the shift.</Text>
      {error ? <ErrorBox text={error} /> : null}
      {!loading && items.length === 0 ? <Empty text="Nothing to record." /> : null}
      {items.map(({ s, b }) => (
        <View key={b.id} style={styles.card}>
          <Text style={styles.cardTitle}>{b.name}</Text>
          <Text style={styles.meta}>{day(s.date)} · {t(s.start_time)}–{t(s.end_time)}{b.signed_in_at ? ` · in ${clock(b.signed_in_at)}${b.signed_out_at ? `, out ${clock(b.signed_out_at)}` : ', no sign-out'}` : ' · never signed in'}</Text>
          <View style={styles.actions}>
            {busy === b.id ? <ActivityIndicator color={ACCENT} /> : (
              <>
                {!b.signed_in_at ? <Pressable onPress={() => mark(b, 'no_show')} style={styles.ghostBtn}><Text style={styles.ghostText}>No-show</Text></Pressable> : null}
                <Pressable onPress={() => mark(b, 'completed')} style={styles.solidBtn}><Text style={styles.solidText}>Worked</Text></Pressable>
              </>
            )}
          </View>
        </View>
      ))}
      <Text style={styles.section}>Recently recorded</Text>
      {recent.length === 0 ? <Text style={styles.meta}>None in the last two weeks.</Text> : null}
      {recent.map(({ s, b }) => (
        <View key={b.id} style={styles.recentRow}>
          <Ionicons name={b.status === 'completed' ? 'checkmark-circle' : 'close-circle'} size={18} color={b.status === 'completed' ? palette.success : palette.danger} />
          <Text style={styles.flex}>{b.name} · {day(s.date)}</Text>
          <Text style={styles.meta}>{b.status === 'completed' ? 'Worked' : 'No-show'}</Text>
        </View>
      ))}
    </ScrollView>
  )
}

const Pill = ({ text, tone }: { text: string; tone: string }) => <View style={[styles.pill, { borderColor: tone }]}><Text style={[styles.pillText, { color: tone }]}>{text}</Text></View>
const ErrorBox = ({ text }: { text: string }) => <View style={styles.error}><Ionicons name="alert-circle" size={18} color={palette.danger} /><Text style={styles.errorText}>{text}</Text></View>
const Empty = ({ text }: { text: string }) => <SharedEmptyState icon="calendar-clear-outline" color={ACCENT} title={text} />

export const locumCoverScreens: Record<string, ComponentType> = {
  shifts: ShiftsScreen,
  record: RecordScreen,
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48, gap: 12 },
  flex: { flex: 1, color: palette.text },
  hero: { backgroundColor: palette.brand, borderRadius: radius.lg, padding: 18, gap: 4 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  heroText: { color: 'rgba(255,255,255,0.82)', fontSize: 14 },
  heroHint: { color: 'rgba(255,255,255,0.82)', fontSize: 12, marginTop: 4 },
  section: { fontSize: 16, fontWeight: '700', color: palette.text, marginTop: 4 },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.text, flexShrink: 1 },
  meta: { fontSize: 13, color: palette.textMuted },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: palette.border },
  personName: { fontSize: 15, fontWeight: '600', color: palette.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, minHeight: 40, justifyContent: 'center' },
  ghostText: { color: palette.text, fontWeight: '600' },
  solidBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: palette.brand, minHeight: 40, justifyContent: 'center' },
  solidText: { color: '#fff', fontWeight: '700' },
  cancelLink: { alignSelf: 'flex-start', paddingVertical: 6 },
  cancelText: { color: palette.danger, fontWeight: '600', fontSize: 13 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: ACCENT_TINT },
  pillText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  error: { flexDirection: 'row', gap: 8, backgroundColor: palette.dangerTint, padding: 12, borderRadius: radius.md, alignItems: 'center' },
  errorText: { flex: 1, color: palette.danger },
  empty: { alignItems: 'center', gap: 8, padding: 24 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
})
