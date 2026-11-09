// ============================================
// Delivery manager screens (Expo app)
//
// The pharmacy side of deliveries on the phone, for anyone with
// delivery_manage: a board of rounds, a round's detail (driver, schedule,
// notify patients, cancel), creating a round, and the redelivery queue.
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/auth-store'
import {
  ROUND_STATUS_LABEL,
  formatTimeWindow,
  useDeliveryManagerStore,
  type NewStop,
  type PatientMed,
  type PatientResult,
} from '@/stores/delivery-manager-store'
import {
  stopAddress,
  type DeliveryRound,
  type DeliveryRoundStatus,
  type DeliveryStop,
  type DeliveryStopStatus,
} from '@/types/deliveries'
import { palette, radius } from '@/theme/palette'

// ---------- helpers ----------

function isoDay(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDay(date: string | null) {
  if (!date) return 'No date set'
  if (date === isoDay(0)) return 'Today'
  if (date === isoDay(1)) return 'Tomorrow'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function isOverdue(round: DeliveryRound) {
  return !!round.scheduled_date
    && ['draft', 'scheduled', 'in_progress'].includes(round.status)
    && round.scheduled_date < isoDay(0)
}

function patientName(stop: { patient: { first_name: string; last_name: string } | null }) {
  return stop.patient ? `${stop.patient.first_name} ${stop.patient.last_name}` : 'Patient not recorded'
}

const STOP_LABEL: Record<DeliveryStopStatus, string> = {
  pending: 'To deliver',
  in_transit: 'On the way',
  arrived: 'Arrived',
  delivered: 'Delivered',
  failed: 'Not delivered',
  skipped: 'Skipped',
  pending_redelivery: 'Not delivered',
  moved_to_round: 'Moved',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

function statusTone(status: DeliveryRoundStatus | DeliveryStopStatus): { bg: string; fg: string } {
  switch (status) {
    case 'delivered':
    case 'completed':
      return { bg: palette.brandTint, fg: palette.success }
    case 'failed':
    case 'pending_redelivery':
    case 'skipped':
    case 'cancelled':
      return { bg: palette.dangerTint, fg: palette.danger }
    case 'in_progress':
    case 'scheduled':
      return { bg: palette.brandTint, fg: palette.brandDark }
    default:
      return { bg: palette.bg, fg: palette.textMuted }
  }
}

function Pill({ label, status }: { label: string; status: DeliveryRoundStatus | DeliveryStopStatus }) {
  const tone = statusTone(status)
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{label}</Text>
    </View>
  )
}

function ErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={18} color={palette.danger} />
      </Pressable>
    </View>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  )
}

function Empty({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={palette.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  )
}

// ---------- Board (tab: "rounds") ----------

type View_ = { kind: 'board' } | { kind: 'detail'; id: string } | { kind: 'new' }

const BOARD_SECTIONS: Array<{ key: string; title: string; statuses: DeliveryRoundStatus[] }> = [
  { key: 'out', title: 'Out for delivery', statuses: ['in_progress'] },
  { key: 'scheduled', title: 'Scheduled', statuses: ['scheduled'] },
  { key: 'draft', title: 'Drafts', statuses: ['draft'] },
  { key: 'done', title: 'Completed (last 14 days)', statuses: ['completed'] },
]

export function DeliveryBoardScreen() {
  const [view, setView] = useState<View_>({ kind: 'board' })
  if (view.kind === 'detail') return <RoundDetail roundId={view.id} onBack={() => setView({ kind: 'board' })} />
  if (view.kind === 'new') {
    return (
      <NewRound
        onCancel={() => setView({ kind: 'board' })}
        onCreated={(id) => setView({ kind: 'detail', id })}
      />
    )
  }
  return <Board onOpen={(id) => setView({ kind: 'detail', id })} onNew={() => setView({ kind: 'new' })} />
}

function Board({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const organisation = useAuthStore((s) => s.organisation)
  const { rounds, loading, error, fetchRounds, fetchDrivers, clearError } = useDeliveryManagerStore()
  const [showDone, setShowDone] = useState(false)

  const refresh = useCallback(() => {
    if (!organisation?.id) return
    void fetchRounds(organisation.id)
    void fetchDrivers(organisation.id)
  }, [organisation?.id, fetchRounds, fetchDrivers])
  useEffect(refresh, [refresh])

  const overdue = rounds.filter(isOverdue).length
  const sections = BOARD_SECTIONS.filter((s) => showDone || s.key !== 'done')

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Delivery rounds</Text>
          <Text style={styles.subtitle}>
            {overdue > 0 ? `${overdue} overdue. ` : ''}Plan rounds, assign drivers and follow progress.
          </Text>
        </View>
      </View>
      <Button label="+ New round" onPress={onNew} />
      {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}
      {loading && rounds.length === 0 ? <ActivityIndicator color={palette.brand} style={styles.loader} /> : null}

      {!loading && rounds.length === 0 ? (
        <Empty icon="car-outline" title="No delivery rounds yet" body="Create a round to plan who gets their medicines, and when." />
      ) : null}

      {rounds.length > 0 && sections.map((section) => {
        const list = rounds.filter((r) => section.statuses.includes(r.status))
        return (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>({list.length})</Text>
            </View>
            {list.length === 0 ? <Text style={styles.quiet}>Nothing here.</Text> : null}
            {list.map((round) => <RoundRow key={round.id} round={round} onPress={() => onOpen(round.id)} />)}
          </View>
        )
      })}

      {rounds.length > 0 ? (
        <Pressable onPress={() => setShowDone((v) => !v)} style={styles.linkRow}>
          <Text style={styles.link}>{showDone ? 'Hide completed rounds' : 'Show completed rounds'}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

function RoundRow({ round, onPress }: { round: DeliveryRound; onPress: () => void }) {
  const drivers = useDeliveryManagerStore((s) => s.drivers)
  const total = round.patients.length
  const delivered = round.patients.filter((p) => p.status === 'delivered').length
  const driver = drivers.find((d) => d.id === round.driver_id)?.name
  const window = formatTimeWindow(round.scheduled_time_start, round.scheduled_time_end)
  const overdue = isOverdue(round)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, styles.flex]} numberOfLines={1}>{round.title || 'Delivery round'}</Text>
        <Pill label={ROUND_STATUS_LABEL[round.status]} status={round.status} />
      </View>
      <Text style={[styles.meta, overdue && styles.overdue]}>
        {overdue ? 'Overdue · ' : ''}{formatDay(round.scheduled_date)}{window ? `, ${window}` : ''}
      </Text>
      <Text style={styles.meta}>
        {round.status === 'draft' || round.status === 'scheduled'
          ? `${total} stop${total === 1 ? '' : 's'}`
          : `${delivered} of ${total} delivered`}
        {' · '}
        {round.driver_id ? (driver ?? 'Driver assigned') : 'No driver yet'}
      </Text>
    </Pressable>
  )
}

// ---------- Round detail ----------

function RoundDetail({ roundId, onBack }: { roundId: string; onBack: () => void }) {
  const organisation = useAuthStore((s) => s.organisation)
  const {
    activeRound, drivers, loading, saving, error,
    fetchRound, fetchDrivers, updateRound, removeStop, deleteRound, notifyPatients, clearError,
  } = useDeliveryManagerStore()
  const [driverOpen, setDriverOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const refresh = useCallback(() => { void fetchRound(roundId) }, [roundId, fetchRound])
  useEffect(refresh, [refresh])
  useEffect(() => {
    if (organisation?.id && drivers.length === 0) void fetchDrivers(organisation.id)
  }, [organisation?.id, drivers.length, fetchDrivers])

  const round = activeRound?.id === roundId ? activeRound : null
  if (!round) {
    return (
      <View style={styles.scroll}>
        <BackLink onPress={onBack} />
        {error ? <ErrorNotice message={error} onDismiss={clearError} /> : <ActivityIndicator color={palette.brand} style={styles.loader} />}
      </View>
    )
  }

  const editable = round.status === 'draft' || round.status === 'scheduled'
  const driverName = drivers.find((d) => d.id === round.driver_id)?.name
  const window = formatTimeWindow(round.scheduled_time_start, round.scheduled_time_end)
  const total = round.patients.length
  const delivered = round.patients.filter((p) => p.status === 'delivered').length
  const pending = round.patients.filter((p) => p.status === 'pending').length

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn() } catch { /* error shown from the store */ }
  }

  const confirmCancel = () => Alert.alert(
    'Cancel this round?',
    'The driver will no longer see it. You can delete it afterwards.',
    [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel round', style: 'destructive', onPress: () => void run(() => updateRound(round.id, { status: 'cancelled' })) }],
  )

  const confirmDelete = () => Alert.alert(
    'Delete this round?',
    'This removes the round and its stops for good.',
    [{ text: 'Keep it', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void run(async () => { await deleteRound(round.id); onBack() }) }],
  )

  const confirmNotify = () => {
    if (!organisation?.id) return
    Alert.alert(
      'Text patients?',
      `Patients still waiting (${pending}) get a text saying when to expect their medicines. Anyone who opted out is skipped.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Send texts',
          onPress: () => void run(async () => {
            const r = await notifyPatients(round, organisation.id)
            const parts = [`${r.sent} sent`]
            if (r.failed) parts.push(`${r.failed} failed`)
            if (r.noPhone) parts.push(`${r.noPhone} with no mobile number`)
            if (r.optedOut) parts.push(`${r.optedOut} opted out`)
            Alert.alert('Texts sent', `${parts.join(', ')}.`)
          }),
        },
      ],
    )
  }

  const confirmRemove = (stop: DeliveryStop) => Alert.alert(
    'Remove this patient?',
    `${patientName(stop)} will be taken off this round.`,
    [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(() => removeStop(stop.id)) }],
  )

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <BackLink onPress={onBack} />
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.flex]}>{round.title || 'Delivery round'}</Text>
        <Pill label={ROUND_STATUS_LABEL[round.status]} status={round.status} />
      </View>
      {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}

      <View style={styles.card}>
        <InfoRow icon="calendar-outline" label="When" value={`${formatDay(round.scheduled_date)}${window ? `, ${window}` : ''}`} warn={isOverdue(round)} />
        <InfoRow icon="person-outline" label="Driver" value={round.driver_id ? (driverName ?? 'Assigned') : 'No driver yet'} />
        <InfoRow icon="cube-outline" label="Progress" value={`${delivered} of ${total} delivered`} />
        {round.notes ? <InfoRow icon="document-text-outline" label="Notes" value={round.notes} /> : null}
      </View>

      {editable ? (
        <View style={styles.actions}>
          <Button label={round.driver_id ? 'Change driver' : 'Assign driver'} variant="secondary" style={styles.flex} onPress={() => setDriverOpen(true)} />
          <Button label={round.scheduled_date ? 'Change date' : 'Set date'} variant="secondary" style={styles.flex} onPress={() => setScheduleOpen(true)} />
        </View>
      ) : null}
      {round.status === 'draft' && round.scheduled_date ? (
        <Button label="Mark as scheduled" loading={saving} onPress={() => void run(() => updateRound(round.id, { status: 'scheduled' }))} />
      ) : null}
      {(round.status === 'scheduled' || round.status === 'in_progress') && pending > 0 ? (
        <Button label="Text patients" variant="secondary" loading={saving} onPress={confirmNotify} />
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Stops</Text>
        <Text style={styles.sectionCount}>({total})</Text>
      </View>
      {total === 0 ? <Empty icon="people-outline" title="No patients on this round" body="Add patients to a round on the website, or create a new round here." /> : null}
      {round.patients.map((stop) => (
        <StopCard key={stop.id} stop={stop} canRemove={editable && stop.status === 'pending'} onRemove={() => confirmRemove(stop)} />
      ))}

      {editable || round.status === 'cancelled' ? (
        <View style={styles.dangerZone}>
          {editable ? <Button label="Cancel round" variant="danger" onPress={confirmCancel} /> : null}
          {round.status === 'draft' || round.status === 'cancelled' ? (
            <Button label="Delete round" variant="ghost" onPress={confirmDelete} />
          ) : null}
        </View>
      ) : null}

      <DriverPicker
        open={driverOpen}
        current={round.driver_id}
        onClose={() => setDriverOpen(false)}
        onPick={(id) => { setDriverOpen(false); void run(() => updateRound(round.id, { driver_id: id })) }}
      />
      <ScheduleSheet
        open={scheduleOpen}
        initial={{ date: round.scheduled_date, start: round.scheduled_time_start, end: round.scheduled_time_end }}
        onClose={() => setScheduleOpen(false)}
        onSave={(s) => {
          setScheduleOpen(false)
          void run(() => updateRound(round.id, {
            scheduled_date: s.date,
            scheduled_time_start: s.start,
            scheduled_time_end: s.end,
            ...(round.status === 'draft' && s.date ? { status: 'scheduled' as const } : {}),
          }))
        }}
      />
    </ScrollView>
  )
}

function BackLink({ onPress, label = 'All rounds' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.back} accessibilityRole="button">
      <Ionicons name="chevron-back" size={18} color={palette.brand} />
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  )
}

function InfoRow({ icon, label, value, warn }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={palette.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, warn && styles.overdue]}>{warn ? `Overdue · ${value}` : value}</Text>
    </View>
  )
}

function StopCard({ stop, canRemove, onRemove }: { stop: DeliveryStop; canRemove: boolean; onRemove: () => void }) {
  const phone = stop.patient?.phone
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.order}>{stop.delivery_order}</Text>
        <Text style={[styles.cardTitle, styles.flex]} numberOfLines={1}>{patientName(stop)}</Text>
        <Pill label={STOP_LABEL[stop.status]} status={stop.status} />
      </View>
      <Text style={styles.meta}>{stopAddress(stop) || 'No address recorded'}</Text>
      {stop.medications.length > 0 ? (
        <Text style={styles.meta}>
          {stop.medications.map((m) => [m.patient_medication?.drug_name, m.patient_medication?.drug_strength].filter(Boolean).join(' ')).join(', ')}
        </Text>
      ) : null}
      {stop.notes ? <Text style={styles.note}>{stop.notes}</Text> : null}
      {stop.status === 'delivered' ? (
        <Text style={styles.meta}>
          Delivered{stop.delivered_at ? ` at ${new Date(stop.delivered_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
          {stop.delivery_recipient_name ? ` · ${stop.delivery_method === 'left_in_safe_place' ? 'Left: ' : 'To: '}${stop.delivery_recipient_name}` : ''}
          {stop.signature_data ? ' · signed' : ''}
          {stop.proof_photo_paths?.length ? ` · ${stop.proof_photo_paths.length} photo${stop.proof_photo_paths.length === 1 ? '' : 's'}` : ''}
        </Text>
      ) : null}
      {stop.failure_reason ? <Text style={[styles.meta, styles.overdue]}>Reason: {stop.failure_reason}</Text> : null}
      {phone || canRemove ? (
        <View style={styles.inlineActions}>
          {phone ? (
            <Pressable style={styles.inlineAction} onPress={() => void Linking.openURL(`tel:${phone}`)} accessibilityRole="button">
              <Ionicons name="call-outline" size={16} color={palette.brand} />
              <Text style={styles.inlineActionText}>Call</Text>
            </Pressable>
          ) : null}
          {canRemove ? (
            <Pressable style={styles.inlineAction} onPress={onRemove} accessibilityRole="button">
              <Ionicons name="trash-outline" size={16} color={palette.danger} />
              <Text style={[styles.inlineActionText, { color: palette.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={palette.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function DriverPicker({ open, current, onClose, onPick }: { open: boolean; current: string | null; onClose: () => void; onPick: (id: string | null) => void }) {
  const drivers = useDeliveryManagerStore((s) => s.drivers)
  return (
    <Sheet open={open} title="Choose a driver" onClose={onClose}>
      <OptionRow label="No driver (any driver can take it)" selected={!current} onPress={() => onPick(null)} />
      {drivers.map((d) => <OptionRow key={d.id} label={d.name} selected={current === d.id} onPress={() => onPick(d.id)} />)}
      {drivers.length === 0 ? <Text style={styles.quiet}>No team members can drive yet. Give someone the delivery driver permission on the website.</Text> : null}
    </Sheet>
  )
}

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.option} accessibilityRole="button" accessibilityState={{ selected }}>
      <Text style={[styles.optionText, styles.flex]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={20} color={palette.brand} /> : null}
    </Pressable>
  )
}

const TIME_WINDOWS: Array<{ label: string; start: string | null; end: string | null }> = [
  { label: 'Any time', start: null, end: null },
  { label: 'Morning 09:00–12:00', start: '09:00', end: '12:00' },
  { label: 'Afternoon 12:00–17:00', start: '12:00', end: '17:00' },
  { label: 'Evening 17:00–20:00', start: '17:00', end: '20:00' },
]

interface Schedule { date: string | null; start: string | null; end: string | null }

function ScheduleFields({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const days = useMemo(() => Array.from({ length: 8 }, (_, i) => isoDay(i)), [])
  const win = TIME_WINDOWS.find((w) => w.start === (value.start?.slice(0, 5) ?? null) && w.end === (value.end?.slice(0, 5) ?? null))
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Not yet (draft)" selected={!value.date} onPress={() => onChange({ ...value, date: null })} />
        {days.map((d) => <Chip key={d} label={formatDay(d)} selected={value.date === d} onPress={() => onChange({ ...value, date: d })} />)}
        {value.date && !days.includes(value.date) ? <Chip label={formatDay(value.date)} selected onPress={() => undefined} /> : null}
      </ScrollView>
      <Text style={styles.label}>Time</Text>
      <View style={styles.chipsWrap}>
        {TIME_WINDOWS.map((w) => (
          <Chip key={w.label} label={w.label} selected={win?.label === w.label} onPress={() => onChange({ ...value, start: w.start, end: w.end })} />
        ))}
        {!win ? <Chip label={formatTimeWindow(value.start, value.end) || 'Custom'} selected onPress={() => undefined} /> : null}
      </View>
    </View>
  )
}

function ScheduleSheet({ open, initial, onClose, onSave }: { open: boolean; initial: Schedule; onClose: () => void; onSave: (s: Schedule) => void }) {
  const [value, setValue] = useState<Schedule>(initial)
  useEffect(() => { if (open) setValue(initial) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} title="When is this round?" onClose={onClose}>
      <ScheduleFields value={value} onChange={setValue} />
      <Button label="Save" onPress={() => onSave(value)} />
    </Sheet>
  )
}

// ---------- New round ----------

function NewRound({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const organisation = useAuthStore((s) => s.organisation)
  const { drivers, saving, error, fetchDrivers, createRound, searchPatients, fetchPatientMeds, clearError } = useDeliveryManagerStore()
  const [title, setTitle] = useState('')
  const [schedule, setSchedule] = useState<Schedule>({ date: isoDay(0), start: null, end: null })
  const [driverId, setDriverId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [stops, setStops] = useState<NewStop[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientResult[]>([])
  const [searching, setSearching] = useState(false)
  const [driverOpen, setDriverOpen] = useState(false)
  const searchSeq = useRef(0)

  useEffect(() => {
    if (organisation?.id && drivers.length === 0) void fetchDrivers(organisation.id)
  }, [organisation?.id, drivers.length, fetchDrivers])

  useEffect(() => {
    const q = query.trim()
    if (!organisation?.id || q.length < 2) { setResults([]); return }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const found = await searchPatients(organisation.id, q)
        if (seq === searchSeq.current) setResults(found)
      } catch {
        if (seq === searchSeq.current) setResults([])
      }
      if (seq === searchSeq.current) setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query, organisation?.id, searchPatients])

  const addPatient = async (patient: PatientResult) => {
    if (stops.some((s) => s.patient.id === patient.id)) return
    setQuery('')
    setResults([])
    let meds: PatientMed[] = []
    try { meds = await fetchPatientMeds(patient.id) } catch { /* add with no medicines */ }
    setStops((cur) => [...cur, { patient, medications: meds.map((med) => ({ med, selected: true })), notes: '' }])
  }

  const toggleMed = (patientId: string, medId: string) => setStops((cur) => cur.map((s) => s.patient.id !== patientId ? s : {
    ...s,
    medications: s.medications.map((m) => (m.med.id === medId ? { ...m, selected: !m.selected } : m)),
  }))

  const move = (index: number, delta: number) => setStops((cur) => {
    const next = [...cur]
    const target = index + delta
    if (target < 0 || target >= next.length) return cur
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })

  const create = async () => {
    if (!organisation?.id) return
    try {
      const id = await createRound({
        orgId: organisation.id,
        title,
        scheduledDate: schedule.date,
        timeStart: schedule.start,
        timeEnd: schedule.end,
        notes,
        driverId,
        stops,
      })
      onCreated(id)
    } catch { /* error shown from the store */ }
  }

  const driverName = drivers.find((d) => d.id === driverId)?.name

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <BackLink onPress={onCancel} />
      <Text style={styles.title}>New delivery round</Text>
      <Text style={styles.subtitle}>Add the patients, check their medicines, then pick a day and driver.</Text>
      {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}

      <View style={styles.card}>
        <Text style={styles.label}>Round name</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={`e.g. ${formatDay(schedule.date)} afternoon round`} placeholderTextColor={palette.textMuted} />
        <ScheduleFields value={schedule} onChange={setSchedule} />
        <Text style={styles.label}>Driver</Text>
        <Pressable style={styles.select} onPress={() => setDriverOpen(true)} accessibilityRole="button">
          <Text style={[styles.optionText, styles.flex]}>{driverName ?? 'No driver (any driver can take it)'}</Text>
          <Ionicons name="chevron-down" size={18} color={palette.textMuted} />
        </Pressable>
        <Text style={styles.label}>Notes for the driver</Text>
        <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} multiline placeholder="Optional" placeholderTextColor={palette.textMuted} />
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Patients</Text>
        <Text style={styles.sectionCount}>({stops.length})</Text>
      </View>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name, NHS number, phone or postcode"
        placeholderTextColor={palette.textMuted}
        autoCorrect={false}
      />
      {searching ? <ActivityIndicator color={palette.brand} /> : null}
      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((p) => {
            const added = stops.some((s) => s.patient.id === p.id)
            return (
              <Pressable key={p.id} style={styles.option} disabled={added} onPress={() => void addPatient(p)} accessibilityRole="button">
                <View style={styles.flex}>
                  <Text style={styles.optionText}>{p.first_name} {p.last_name}</Text>
                  <Text style={styles.meta}>{[p.address_line_1, p.postcode].filter(Boolean).join(', ') || 'No address recorded'}</Text>
                </View>
                <Ionicons name={added ? 'checkmark' : 'add-circle-outline'} size={22} color={palette.brand} />
              </Pressable>
            )
          })}
        </View>
      ) : query.trim().length >= 2 && !searching ? (
        <Text style={styles.quiet}>No patients match “{query.trim()}”. Add new patients on the website.</Text>
      ) : null}

      {stops.map((stop, index) => (
        <View key={stop.patient.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.order}>{index + 1}</Text>
            <Text style={[styles.cardTitle, styles.flex]} numberOfLines={1}>{stop.patient.first_name} {stop.patient.last_name}</Text>
            <Pressable onPress={() => move(index, -1)} disabled={index === 0} hitSlop={6} accessibilityLabel="Move up">
              <Ionicons name="arrow-up" size={18} color={index === 0 ? palette.border : palette.textMuted} />
            </Pressable>
            <Pressable onPress={() => move(index, 1)} disabled={index === stops.length - 1} hitSlop={6} accessibilityLabel="Move down">
              <Ionicons name="arrow-down" size={18} color={index === stops.length - 1 ? palette.border : palette.textMuted} />
            </Pressable>
            <Pressable onPress={() => setStops((cur) => cur.filter((s) => s.patient.id !== stop.patient.id))} hitSlop={6} accessibilityLabel="Remove patient">
              <Ionicons name="close" size={20} color={palette.danger} />
            </Pressable>
          </View>
          {stop.medications.length === 0 ? (
            <Text style={styles.meta}>No active medicines on record. Add them on the website, or note what to deliver below.</Text>
          ) : stop.medications.map((m) => (
            <Pressable key={m.med.id} style={styles.medRow} onPress={() => toggleMed(stop.patient.id, m.med.id)} accessibilityRole="checkbox" accessibilityState={{ checked: m.selected }}>
              <Ionicons name={m.selected ? 'checkbox' : 'square-outline'} size={20} color={m.selected ? palette.brand : palette.textMuted} />
              <Text style={[styles.optionText, styles.flex]}>
                {[m.med.drug_name, m.med.drug_strength, m.med.drug_form].filter(Boolean).join(' ')}
              </Text>
            </Pressable>
          ))}
          <TextInput
            style={styles.input}
            value={stop.notes}
            onChangeText={(t) => setStops((cur) => cur.map((s) => (s.patient.id === stop.patient.id ? { ...s, notes: t } : s)))}
            placeholder="Note for this stop (optional)"
            placeholderTextColor={palette.textMuted}
          />
        </View>
      ))}

      <Button label={schedule.date ? 'Create round' : 'Save as draft'} loading={saving} disabled={stops.length === 0} onPress={() => void create()} />
      {stops.length === 0 ? <Text style={styles.helper}>Add at least one patient to create the round.</Text> : null}

      <DriverPicker open={driverOpen} current={driverId} onClose={() => setDriverOpen(false)} onPick={(id) => { setDriverId(id); setDriverOpen(false) }} />
    </ScrollView>
  )
}

// ---------- Redelivery queue (tab: "redelivery") ----------

export function RedeliveryQueueScreen() {
  const organisation = useAuthStore((s) => s.organisation)
  const { redeliveryQueue, loading, saving, error, fetchRedeliveryQueue, createRedeliveryRound, resolveRedelivery, clearError } = useDeliveryManagerStore()
  const [selected, setSelected] = useState<string[]>([])
  const [openRound, setOpenRound] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (organisation?.id) void fetchRedeliveryQueue(organisation.id)
  }, [organisation?.id, fetchRedeliveryQueue])
  useEffect(refresh, [refresh])

  if (openRound) return <RoundDetail roundId={openRound} onBack={() => { setOpenRound(null); refresh() }} />

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const createRound = async () => {
    try {
      const id = await createRedeliveryRound(selected)
      setSelected([])
      setOpenRound(id)
    } catch { /* error shown from the store */ }
  }

  const resolve = (stopId: string, status: 'returned' | 'cancelled') => Alert.alert(
    status === 'returned' ? 'Back in the pharmacy?' : 'Stop trying to deliver?',
    status === 'returned' ? 'Marks the medicines as returned to the pharmacy and takes this off the queue.' : 'Takes this off the queue without another delivery.',
    [{ text: 'Not now', style: 'cancel' }, { text: 'Confirm', onPress: () => void resolveRedelivery(stopId, status).catch(() => undefined) }],
  )

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Redelivery queue</Text>
      <Text style={styles.subtitle}>Stops that weren’t delivered. Select them to book a new round.</Text>
      {error ? <ErrorNotice message={error} onDismiss={clearError} /> : null}
      {selected.length > 0 ? (
        <Button label={`Create round for ${selected.length} patient${selected.length === 1 ? '' : 's'}`} loading={saving} onPress={() => void createRound()} />
      ) : null}
      {loading && redeliveryQueue.length === 0 ? <ActivityIndicator color={palette.brand} style={styles.loader} /> : null}
      {!loading && redeliveryQueue.length === 0 ? (
        <Empty icon="checkmark-done-outline" title="Nothing to redeliver" body="When a driver can’t deliver, the stop appears here." />
      ) : null}
      {redeliveryQueue.map((stop) => {
        const isSelected = selected.includes(stop.id)
        return (
          <Pressable key={stop.id} onPress={() => toggle(stop.id)} style={[styles.card, isSelected && styles.cardSelected]} accessibilityRole="checkbox" accessibilityState={{ checked: isSelected }}>
            <View style={styles.cardTop}>
              <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={22} color={isSelected ? palette.brand : palette.textMuted} />
              <Text style={[styles.cardTitle, styles.flex]} numberOfLines={1}>{patientName(stop)}</Text>
              <Pill label={stop.status === 'skipped' ? 'Skipped' : 'Not delivered'} status={stop.status} />
            </View>
            <Text style={styles.meta}>{stopAddress(stop) || 'No address recorded'}</Text>
            <Text style={styles.meta}>From {stop.round?.title || 'a round'} · {formatDay(stop.round?.scheduled_date ?? null)}</Text>
            {stop.failure_reason ? <Text style={[styles.meta, styles.overdue]}>Reason: {stop.failure_reason}</Text> : null}
            <View style={styles.inlineActions}>
              <Pressable style={styles.inlineAction} onPress={() => resolve(stop.id, 'returned')} accessibilityRole="button">
                <Ionicons name="return-down-back-outline" size={16} color={palette.brand} />
                <Text style={styles.inlineActionText}>Returned to pharmacy</Text>
              </Pressable>
              <Pressable style={styles.inlineAction} onPress={() => resolve(stop.id, 'cancelled')} accessibilityRole="button">
                <Ionicons name="close-circle-outline" size={16} color={palette.danger} />
                <Text style={[styles.inlineActionText, { color: palette.danger }]}>No redelivery</Text>
              </Pressable>
            </View>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

// ---------- styles ----------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { gap: 12, paddingBottom: 28 },
  pressed: { opacity: 0.85 },
  loader: { marginVertical: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 14, color: palette.textMuted, marginTop: 2, lineHeight: 19 },
  section: { gap: 8, marginTop: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  sectionCount: { fontSize: 14, color: palette.textMuted, fontWeight: '600' },
  quiet: { fontSize: 13, color: palette.textMuted },
  helper: { fontSize: 13, color: palette.textMuted, textAlign: 'center' },
  linkRow: { alignSelf: 'center', paddingVertical: 8 },
  link: { color: palette.brand, fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, gap: 8 },
  cardSelected: { borderColor: palette.brand, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  meta: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  overdue: { color: palette.danger, fontWeight: '700' },
  note: { fontSize: 13, color: palette.warning, backgroundColor: palette.bg, padding: 8, borderRadius: radius.sm },
  order: { width: 26, height: 26, borderRadius: radius.pill, backgroundColor: palette.brandTint, color: palette.brandDark, textAlign: 'center', lineHeight: 26, fontWeight: '800', fontSize: 13, overflow: 'hidden' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '800' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: radius.md, backgroundColor: palette.dangerTint },
  errorText: { flex: 1, color: palette.danger, fontSize: 13, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 6, padding: 24, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  emptyBody: { fontSize: 13, color: palette.textMuted, textAlign: 'center', lineHeight: 18 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, paddingVertical: 4 },
  backText: { color: palette.brand, fontWeight: '700', fontSize: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { width: 70, fontSize: 13, color: palette.textMuted, fontWeight: '600' },
  infoValue: { flex: 1, fontSize: 14, color: palette.text },
  actions: { flexDirection: 'row', gap: 8 },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.bg, borderRadius: radius.sm, paddingHorizontal: 10, height: 36 },
  inlineActionText: { color: palette.brand, fontSize: 13, fontWeight: '700' },
  dangerZone: { gap: 8, marginTop: 10 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: palette.overlay },
  sheet: { maxHeight: '88%', backgroundColor: palette.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, paddingBottom: 6 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  sheetBody: { padding: 18, paddingTop: 6, gap: 10, paddingBottom: 36 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  optionText: { fontSize: 15, color: palette.text },
  results: { gap: 6 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted, marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, color: palette.text, backgroundColor: palette.surface },
  multiline: { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  select: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: palette.surface },
  chips: { gap: 8, paddingVertical: 2 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: 14, height: 38, justifyContent: 'center' },
  chipSelected: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { fontSize: 14, color: palette.text, fontWeight: '600' },
  chipTextSelected: { color: palette.textInverse },
  medRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
})
