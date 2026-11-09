// Services → Bookings: this pharmacy's appointments, with the same actions as
// the web appointment page: confirm, move, cancel (through the `appointments`
// edge function so the patient is texted and slot counts stay right), mark
// completed or no-show, call the patient and join a video appointment.
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { EmptyState as SharedEmptyState } from '@/components/ui/EmptyState'

const COLOR = '#9333EA'

type Booking = {
  id: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  hold_expires_at: string | null
  patient_review_reason: string | null
  notes: string | null
  patient: { first_name: string; last_name: string; phone: string | null } | null
  service: { name: string; is_video: boolean | null } | null
  slot: { start_time: string; end_time: string } | null
}

type Slot = { id: string; start_time: string; end_time: string }

const STATUS: Record<Booking['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: palette.warning },
  confirmed: { label: 'Confirmed', color: palette.brand },
  cancelled: { label: 'Cancelled', color: palette.danger },
  completed: { label: 'Completed', color: palette.success },
  no_show: { label: 'No show', color: palette.danger },
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

async function callAppointments(body: Record<string, unknown>) {
  const { data, error } = await userClient.functions.invoke('appointments', { body })
  let msg = (data as { error?: string } | null)?.error
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } } | null)?.context
  if (error && !msg && ctx?.json) {
    try { msg = (await ctx.json())?.error } catch { /* ignore */ }
  }
  if (error || msg) throw new Error(msg || error?.message || 'Request failed')
  return data as Record<string, any>
}

export function BookingsScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const [items, setItems] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Booking | null>(null)
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming')

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    let q = userClient
      .from('ps_appointments')
      .select('id, status, hold_expires_at, patient_review_reason, notes, patient:ps_patients(first_name, last_name, phone), service:ps_services(name, is_video), slot:ps_appointment_slots!inner(start_time, end_time)')
      .eq('org_id', orgId)
      .limit(200)
    if (view === 'upcoming') {
      // Still to happen, plus today's that haven't been marked yet.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
      q = q.in('status', ['pending', 'confirmed']).gte('slot.start_time', startOfDay.toISOString())
    } else {
      q = q.lt('slot.start_time', new Date().toISOString())
        .gte('slot.start_time', new Date(Date.now() - 30 * 86_400_000).toISOString())
    }
    const { data, error: err } = await q
    if (err) setError(err.message)
    else {
      setError(null)
      const rows = (data ?? []) as unknown as Booking[]
      rows.sort((a, b) => (a.slot?.start_time ?? '').localeCompare(b.slot?.start_time ?? ''))
      if (view === 'past') rows.reverse()
      setItems(rows)
    }
    setLoading(false)
  }, [orgId, view])

  useEffect(() => { void load() }, [load])

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(['upcoming', 'past'] as const).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} accessibilityRole="tab" accessibilityState={{ selected: view === v }}
            style={[styles.tab, view === v && styles.tabOn]}>
            <Text style={[styles.tabText, view === v && styles.tabTextOn]}>{v === 'upcoming' ? 'Upcoming' : 'Last 30 days'}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? null : (
          <SharedEmptyState
            icon="calendar-outline"
            color={COLOR}
            title={view === 'upcoming' ? 'No upcoming bookings' : 'No bookings in the last 30 days'}
            text="Appointments booked online or by the team appear here."
          />
        )}
        renderItem={({ item, index }) => {
          const start = item.slot?.start_time
          const showDay = start && (index === 0 || day(items[index - 1].slot?.start_time ?? '') !== day(start))
          const st = item.status === 'pending' && item.hold_expires_at ? { label: 'Awaiting payment', color: palette.warning } : STATUS[item.status]
          return (
            <View>
              {showDay ? <Text style={styles.day}>{day(start!)}</Text> : null}
              <Pressable style={styles.card} onPress={() => setOpen(item)} accessibilityRole="button">
                <Text style={styles.time}>{start ? time(start) : '–'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.patient ? `${item.patient.first_name} ${item.patient.last_name}` : 'Patient'}</Text>
                  <Text style={styles.muted}>{item.service?.name ?? 'Appointment'}{item.service?.is_video ? ' · video' : ''}</Text>
                </View>
                <Text style={[styles.badge, { color: st.color, borderColor: st.color }]}>{st.label}</Text>
              </Pressable>
            </View>
          )
        }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      />
      <BookingModal booking={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); void load() }} />
    </View>
  )
}

function BookingModal({ booking, onClose, onChanged }: { booking: Booking | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [slots, setSlots] = useState<Slot[] | null>(null)

  const [video, setVideo] = useState<{ url: string } | null>(null)

  useEffect(() => { setSlots(null) }, [booking?.id])
  useEffect(() => {
    setVideo(null)
    if (!booking?.service?.is_video) return
    userClient.from('ps_video_consultations')
      .select('daily_room_url, org_token')
      .eq('appointment_id', booking.id).not('status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const v = data as { daily_room_url: string | null; org_token: string | null } | null
        if (v?.daily_room_url) setVideo({ url: v.org_token ? `${v.daily_room_url}?t=${v.org_token}` : v.daily_room_url })
      })
  }, [booking?.id, booking?.service?.is_video])
  if (!booking) return null

  // Completed / no-show need no text to the patient, so they are a plain update
  // (the same as the web appointment page).
  const mark = async (status: 'completed' | 'no_show', done: string) => {
    setBusy(true)
    const { error } = await userClient.from('ps_appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', booking.id).in('status', ['pending', 'confirmed'])
    setBusy(false)
    if (error) { Alert.alert('Could not update', error.message); return }
    Alert.alert(done)
    onChanged()
  }

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      const out = await callAppointments({ appointment_id: booking.id, ...body })
      if (out?.refund_error) Alert.alert('Refund failed', out.refund_error)
      else Alert.alert(done)
      onChanged()
    } catch (e) {
      Alert.alert('Could not update', (e as Error).message)
    }
    setBusy(false)
  }

  const cancel = () => Alert.alert('Cancel this booking?', 'The patient is texted and any online payment is refunded.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Cancel booking', style: 'destructive', onPress: () => run({ action: 'staff_set_status', status: 'cancelled', refund: true }, 'Booking cancelled') },
  ])

  const loadSlots = async () => {
    setBusy(true)
    try {
      const out = await callAppointments({ action: 'staff_slots', appointment_id: booking.id })
      setSlots(out.slots as Slot[])
    } catch (e) {
      Alert.alert('Could not load times', (e as Error).message)
    }
    setBusy(false)
  }

  const active = booking.status === 'pending' || booking.status === 'confirmed'

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{booking.service?.name ?? 'Appointment'}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={styles.name}>{booking.patient ? `${booking.patient.first_name} ${booking.patient.last_name}` : 'Patient'}</Text>
          {booking.patient?.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${booking.patient!.phone}`)} accessibilityRole="link" accessibilityLabel={`Call ${booking.patient.phone}`}>
              <Text style={[styles.muted, { color: palette.brand, fontWeight: '600' }]}>
                <Ionicons name="call-outline" size={14} /> {booking.patient.phone}
              </Text>
            </Pressable>
          ) : null}
          {booking.slot ? <Text style={styles.muted}>{day(booking.slot.start_time)}, {time(booking.slot.start_time)} to {time(booking.slot.end_time)}</Text> : null}
          {booking.patient_review_reason ? <Text style={styles.warn}>Check the patient record: {booking.patient_review_reason}</Text> : null}
          {booking.hold_expires_at ? <Text style={styles.warn}>The patient is still paying online.</Text> : null}
          {booking.notes ? <Text style={styles.muted}>Notes: {booking.notes}</Text> : null}

          {busy ? <ActivityIndicator color={COLOR} /> : null}

          {active && !slots ? (
            <View style={{ gap: 10, marginTop: 8 }}>
              {booking.status === 'pending' && !booking.hold_expires_at ? (
                <Action label="Confirm and text patient" color={COLOR} onPress={() => run({ action: 'staff_set_status', status: 'confirmed' }, 'Booking confirmed')} disabled={busy} />
              ) : null}
              {video ? <Action label="Join video call" color={COLOR} onPress={() => Linking.openURL(video.url)} disabled={busy} /> : null}
              {booking.service?.is_video && !video ? (
                <Text style={styles.muted}>The video room is set up automatically before the appointment, or from the web app.</Text>
              ) : null}
              {!booking.hold_expires_at ? <Action label="Mark completed" color={palette.success} onPress={() => mark('completed', 'Marked completed')} disabled={busy} /> : null}
              {!booking.hold_expires_at ? <Action label="Mark no-show" color={palette.warning} outline onPress={() => mark('no_show', 'Marked as no-show')} disabled={busy} /> : null}
              {!booking.hold_expires_at ? <Action label="Move to another time" color={palette.brand} outline onPress={loadSlots} disabled={busy} /> : null}
              <Action label="Cancel booking" color={palette.danger} outline onPress={cancel} disabled={busy} />
            </View>
          ) : null}

          {slots ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={styles.day}>Pick a new time</Text>
              {slots.length === 0 ? <Text style={styles.muted}>No free slots in the next 90 days.</Text> : null}
              {slots.slice(0, 60).map((s) => (
                <Pressable key={s.id} style={styles.slot} disabled={busy}
                  onPress={() => run({ action: 'staff_reschedule', slot_id: s.id }, 'Booking moved. The patient has been texted.')}>
                  <Text style={styles.name}>{day(s.start_time)}</Text>
                  <Text style={styles.muted}>{time(s.start_time)}</Text>
                </Pressable>
              ))}
              <Action label="Back" color={palette.textMuted} outline onPress={() => setSlots(null)} disabled={busy} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

function Action({ label, color, outline, onPress, disabled }: { label: string; color: string; outline?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.action, outline ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.actionText, { color: outline ? color : palette.textInverse }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  error: { color: palette.danger, padding: 16 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 80 },
  emptyText: { color: palette.textMuted, fontSize: 15 },
  day: { fontSize: 13, fontWeight: '700', color: palette.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, marginBottom: 8 },
  time: { fontSize: 16, fontWeight: '700', color: palette.text, width: 52 },
  name: { fontSize: 15, fontWeight: '600', color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted },
  warn: { fontSize: 13, color: palette.warning },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  sheet: { flex: 1, backgroundColor: palette.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: palette.text, flex: 1 },
  slot: { padding: 12, backgroundColor: palette.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.border },
  action: { paddingVertical: 13, borderRadius: radius.md, alignItems: 'center' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, alignItems: 'center' },
  tabOn: { backgroundColor: COLOR, borderColor: COLOR },
  tabText: { fontSize: 14, fontWeight: '600', color: palette.text },
  tabTextOn: { color: palette.textInverse },
  actionText: { fontSize: 15, fontWeight: '700' },
})
