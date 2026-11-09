// Care homes — tab screens.
// Residents (records, allergies, medicines, notes), Doses (today's MAR rounds
// on published charts), Requests (medication requests both ways) and Groups
// (the pharmacy's delivery board). Setting up care homes, groups, bags and
// preparing MAR charts stays on the website.
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { create } from 'zustand'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import {
  NEXT_REQUEST_STEP,
  OPEN_REQUEST_STATUSES,
  addResidentNote,
  careHomeErrorMessage,
  chLabel,
  createRequest,
  fetchDosesForDay,
  fetchGroups,
  fetchLinks,
  fetchRequests,
  fetchResidentDetail,
  fetchResidents,
  recordDose,
  residentName,
  setRequestStatus,
  todayIso,
  ukDate,
  updateResidentStatus,
  type CareHomeGroup,
  type CareHomeLink,
  type CareHomeNote,
  type CareHomeRequest,
  type CareHomeResident,
  type CareHomeSchedule,
  type MarDose,
} from '@/lib/care-homes'

const COLOR = '#0F766E' // module accent: header tile, launcher card and active tab only

// ---------- shared context: which care home is selected ----------

interface LinkState {
  links: CareHomeLink[]
  linkId: string | null
  loaded: boolean
  error: string | null
  load: (orgId: string, isCareHome: boolean) => Promise<void>
  select: (id: string) => void
}

const useLinkStore = create<LinkState>((set, get) => ({
  links: [],
  linkId: null,
  loaded: false,
  error: null,
  load: async (orgId, isCareHome) => {
    try {
      const links = await fetchLinks(orgId, isCareHome)
      const current = get().linkId
      set({ links, linkId: current && links.some((l) => l.id === current) ? current : links[0]?.id ?? null, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: careHomeErrorMessage(e) })
    }
  },
  select: (id) => set({ linkId: id }),
}))

function useCareHomeContext() {
  const orgId = useAuthStore((s) => s.organisation?.id)
  const isCareHome = useAuthStore((s) => s.organisation?.organisation_type === 'carehome')
  const permissions = useAuthStore((s) => s.permissions)
  const userId = useAuthStore((s) => s.userProfile?.id)
  const { links, linkId, loaded, error, load, select } = useLinkStore()

  useEffect(() => {
    if (orgId) void load(orgId, isCareHome)
  }, [orgId, isCareHome, load])

  return {
    isCareHome,
    userId,
    links,
    linkId,
    loaded,
    error,
    select,
    reloadLinks: () => (orgId ? load(orgId, isCareHome) : Promise.resolve()),
    can: (key: string) => permissions?.[key] === true,
  }
}

/** Care home picker shown above every tab when there is more than one link. */
function LinkPicker({ ctx }: { ctx: ReturnType<typeof useCareHomeContext> }) {
  if (ctx.links.length < 2) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {ctx.links.map((link) => {
        const name = (ctx.isCareHome ? link.pharmacy_organisation?.name : link.care_home_organisation?.name) ?? 'Care home'
        const active = link.id === ctx.linkId
        return (
          <Pressable key={link.id} onPress={() => ctx.select(link.id)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/** Shared states for "no care home yet" / loading / errors. Returns null when ready. */
function Gate({ ctx }: { ctx: ReturnType<typeof useCareHomeContext> }) {
  if (!ctx.loaded) return <ActivityIndicator color={palette.brand} style={{ marginTop: 32 }} />
  if (ctx.error) return <Text style={styles.error}>{ctx.error}</Text>
  if (!ctx.linkId) {
    return (
      <EmptyState
        icon="home-outline"
        color={COLOR}
        title={ctx.isCareHome ? 'No pharmacy connection yet' : 'No care homes yet'}
        text={ctx.isCareHome ? 'When your pharmacy connects your care home, residents and requests appear here.' : 'Add the care homes you supply on the website under Care homes, Manage care homes.'}
      />
    )
  }
  return null
}

// ---------- Residents ----------

function ResidentsScreen() {
  const ctx = useCareHomeContext()
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<CareHomeResident | null>(null)

  const load = useCallback(async () => {
    if (!ctx.linkId) return
    setLoading(true)
    try {
      setResidents(await fetchResidents(ctx.linkId))
      setError(null)
    } catch (e) {
      setError(careHomeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [ctx.linkId])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? residents.filter((r) => residentName(r.patient).toLowerCase().includes(q) || (r.room_number ?? '').toLowerCase().includes(q))
      : residents
    return [...list].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
  }, [residents, query])

  const gate = Gate({ ctx })
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && residents.length > 0} onRefresh={() => { void ctx.reloadLinks(); void load() }} />}>
        <LinkPicker ctx={ctx} />
        {gate ?? (
          <>
            <Text style={styles.summaryTitle}>{(() => { const n = residents.filter((r) => r.status === 'active').length; return `${n} active resident${n === 1 ? '' : 's'}` })()}</Text>
            {residents.length > 6 ? (
              <TextInput style={styles.search} placeholder="Search by name or room" placeholderTextColor={palette.textMuted} value={query} onChangeText={setQuery} accessibilityLabel="Search residents" />
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading && !residents.length ? <ActivityIndicator color={palette.brand} style={{ marginTop: 24 }} /> : null}
            {!loading && !residents.length && !error ? (
              <EmptyState icon="people-outline" color={COLOR} title="No residents yet" text={ctx.isCareHome ? 'Residents appear here once the pharmacy adds them.' : 'Add residents on the website from the care home profile.'} />
            ) : null}
            {shown.map((r) => (
              <Pressable key={r.id} style={styles.card} onPress={() => setOpen(r)} accessibilityRole="button" accessibilityLabel={`Open ${residentName(r.patient)}`}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{residentName(r.patient)}</Text>
                  <Badge tone={r.status === 'active' ? 'success' : 'warning'} label={chLabel('residentStatus', r.status)} />
                </View>
                <Text style={styles.muted}>{r.room_number ? `Room ${r.room_number}` : 'Room not recorded'}{r.patient?.dob ? ` · Born ${ukDate(r.patient.dob)}` : ''}</Text>
                {r.allergies ? <Text style={styles.allergy}>Allergies: {r.allergies}</Text> : null}
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
      <ResidentSheet
        resident={open}
        canEditStatus={ctx.isCareHome || ctx.can('care_home_manage')}
        userId={ctx.userId}
        onClose={() => setOpen(null)}
        onChanged={(next) => { setResidents((list) => list.map((r) => (r.id === next.id ? next : r))); setOpen(next) }}
      />
    </View>
  )
}

const RESIDENT_STATUSES = ['active', 'hospital', 'leave', 'discharged', 'deceased']
const NOTE_TYPES = ['general', 'clinical', 'hospital', 'incident', 'medication', 'communication']

function ResidentSheet({ resident, canEditStatus, userId, onClose, onChanged }: {
  resident: CareHomeResident | null
  canEditStatus: boolean
  userId?: string
  onClose: () => void
  onChanged: (r: CareHomeResident) => void
}) {
  const [schedules, setSchedules] = useState<CareHomeSchedule[]>([])
  const [notes, setNotes] = useState<CareHomeNote[]>([])
  const [loading, setLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('general')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!resident) return
    setLoading(true)
    try {
      const out = await fetchResidentDetail(resident.id)
      setSchedules(out.schedules)
      setNotes(out.notes)
    } catch (e) {
      Alert.alert('Could not load', careHomeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [resident])

  useEffect(() => { setNoteText(''); void load() }, [load])
  if (!resident) return null

  const changeStatus = () => {
    Alert.alert('Resident status', 'Only active residents are included in repeat requests.', [
      ...RESIDENT_STATUSES.filter((s) => s !== resident.status).map((s) => ({
        text: chLabel('residentStatus', s),
        onPress: async () => {
          try {
            await updateResidentStatus(resident.id, s)
            onChanged({ ...resident, status: s })
          } catch (e) {
            Alert.alert('Could not update', careHomeErrorMessage(e))
          }
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const saveNote = async () => {
    if (!userId || !noteText.trim()) return
    setBusy(true)
    try {
      await addResidentNote(resident.id, noteType, noteText, userId)
      setNoteText('')
      await load()
    } catch (e) {
      Alert.alert('Could not save note', careHomeErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{residentName(resident.patient)}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>{resident.room_number ? `Room ${resident.room_number}` : 'Room not recorded'} · NHS {resident.patient?.nhs_number ?? 'not recorded'}</Text>
            <Pressable onPress={canEditStatus ? changeStatus : undefined} disabled={!canEditStatus} accessibilityRole="button" accessibilityLabel="Change resident status">
              <Badge tone={resident.status === 'active' ? 'success' : 'warning'} label={`${chLabel('residentStatus', resident.status)}${canEditStatus ? ' ▾' : ''}`} />
            </Pressable>
          </View>

          <View style={[styles.card, resident.allergies ? styles.cardWarn : null]}>
            <Text style={styles.label}>Allergies</Text>
            <Text style={styles.body}>{resident.allergies || 'None recorded'}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.label}>GP</Text>
            <Text style={styles.body}>{resident.gp_name || 'Not recorded'}{resident.gp_practice ? `, ${resident.gp_practice}` : ''}</Text>
            {resident.special_instructions ? (<><Text style={[styles.label, { marginTop: 8 }]}>Special instructions</Text><Text style={styles.body}>{resident.special_instructions}</Text></>) : null}
          </View>

          <Text style={styles.sectionTitle}>Current medicines ({schedules.length})</Text>
          {loading ? <ActivityIndicator color={palette.brand} /> : null}
          {!loading && !schedules.length ? <Text style={styles.muted}>No medicine rounds set up yet.</Text> : null}
          {schedules.map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{s.patient_medication?.drug_name ?? 'Medicine'}</Text>
                <Text style={styles.time}>{s.round_time ? s.round_time.slice(0, 5) : 'PRN'}</Text>
              </View>
              <Text style={styles.muted}>{s.dose}{s.route ? ` · ${s.route}` : ''} · {chLabel('scheduleType', s.schedule_type)}</Text>
              {s.instructions ? <Text style={styles.body}>{s.instructions}</Text> : null}
            </View>
          ))}

          <Text style={styles.sectionTitle}>Notes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInline}>
            {NOTE_TYPES.map((t) => (
              <Pressable key={t} onPress={() => setNoteType(t)} style={[styles.chip, noteType === t && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: noteType === t }}>
                <Text style={[styles.chipText, noteType === t && styles.chipTextActive]}>{chLabel('noteType', t)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput style={styles.textArea} multiline placeholder="Add a dated note (today)" placeholderTextColor={palette.textMuted} value={noteText} onChangeText={setNoteText} accessibilityLabel="Note" />
          <Button label="Save note" onPress={saveNote} loading={busy} disabled={!noteText.trim()} />
          {notes.map((n) => (
            <View key={n.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Badge tone={n.note_type === 'incident' ? 'danger' : n.note_type === 'hospital' ? 'warning' : 'info'} label={chLabel('noteType', n.note_type)} />
                <Text style={styles.muted}>{ukDate(n.note_date)}</Text>
              </View>
              <Text style={styles.body}>{n.note_text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ---------- Doses (MAR) ----------

const DOSE_ACTIONS: Array<{ status: string; label: string }> = [
  { status: 'administered', label: 'Given' },
  { status: 'refused', label: 'Refused' },
  { status: 'omitted', label: 'Omitted' },
  { status: 'not_available', label: 'Not available' },
  { status: 'away', label: 'Away' },
  { status: 'self_administered', label: 'Self-administered' },
]

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + by)
  return d.toISOString().slice(0, 10)
}

function DosesScreen() {
  const ctx = useCareHomeContext()
  const [day, setDay] = useState(todayIso())
  const [doses, setDoses] = useState<MarDose[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const canRecord = ctx.can('care_home_mar_administer')

  const load = useCallback(async () => {
    if (!ctx.linkId) return
    setLoading(true)
    try {
      setDoses(await fetchDosesForDay(ctx.linkId, day))
      setError(null)
    } catch (e) {
      setError(careHomeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [ctx.linkId, day])

  useEffect(() => { void load() }, [load])

  const rounds = useMemo(() => {
    const map = new Map<string, MarDose[]>()
    for (const d of doses) {
      const key = d.round_time ? d.round_time.slice(0, 5) : 'When required'
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return [...map.entries()]
  }, [doses])

  const record = (dose: MarDose, status: string) => {
    if (!ctx.userId) return
    const save = async (notes?: string) => {
      setSaving(dose.id)
      try {
        await recordDose(dose.id, status, ctx.userId!, notes)
        setDoses((list) => list.map((d) => (d.id === dose.id ? { ...d, status, notes: notes ?? null, administered_at: new Date().toISOString() } : d)))
      } catch (e) {
        Alert.alert('Could not record dose', careHomeErrorMessage(e))
      } finally {
        setSaving(null)
      }
    }
    if (status === 'administered' || status === 'self_administered') {
      void save()
      return
    }
    if (Platform.OS === 'ios') {
      Alert.prompt(
        chLabel('marEntryStatus', status),
        'Add a short reason (optional).',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: (text?: string) => void save(text) }],
        'plain-text',
      )
      return
    }
    Alert.alert(chLabel('marEntryStatus', status), 'Record this dose as not given?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Record', onPress: () => void save() },
    ])
  }

  const done = doses.filter((d) => d.status !== 'planned').length
  const isToday = day === todayIso()
  const gate = Gate({ ctx })

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && doses.length > 0} onRefresh={load} />}>
      <LinkPicker ctx={ctx} />
      {gate ?? (
        <>
          <View style={styles.dayBar}>
            <Pressable onPress={() => setDay(shiftDay(day, -1))} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={8}><Ionicons name="chevron-back" size={24} color={palette.brand} /></Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.summaryTitle}>{isToday ? 'Today' : ukDate(day)}</Text>
              <Text style={styles.muted}>{doses.length ? `${done} of ${doses.length} doses recorded` : 'No doses due'}</Text>
            </View>
            <Pressable onPress={() => setDay(shiftDay(day, 1))} accessibilityRole="button" accessibilityLabel="Next day" hitSlop={8}><Ionicons name="chevron-forward" size={24} color={palette.brand} /></Pressable>
          </View>
          {!isToday ? <Button label="Back to today" variant="ghost" onPress={() => setDay(todayIso())} /> : null}
          {!canRecord ? <Text style={styles.hint}>You can view doses. Recording them needs MAR permission.</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && !doses.length ? <ActivityIndicator color={palette.brand} style={{ marginTop: 24 }} /> : null}
          {!loading && !doses.length && !error ? (
            <EmptyState icon="medkit-outline" color={COLOR} title="No doses due" text="Doses appear here from MAR charts the pharmacy has published for this care home." />
          ) : null}
          {rounds.map(([time, list]) => (
            <View key={time} style={styles.section}>
              <Text style={styles.sectionTitle}>{time} ({list.filter((d) => d.status !== 'planned').length}/{list.length})</Text>
              {list.map((d) => {
                const recorded = d.status !== 'planned'
                return (
                  <View key={d.id} style={[styles.card, recorded && styles.cardDone]}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{residentName(d.cycle?.resident?.patient)}</Text>
                      <Badge tone={d.status === 'administered' || d.status === 'self_administered' ? 'success' : recorded ? 'warning' : 'muted'} label={chLabel('marEntryStatus', d.status)} />
                    </View>
                    <Text style={styles.body}>{d.medication_schedule?.patient_medication?.drug_name ?? 'Medicine'}</Text>
                    <Text style={styles.muted}>{d.dose ?? 'Dose not set'}{d.medication_schedule?.route ? ` · ${d.medication_schedule.route}` : ''}{d.cycle?.resident?.room_number ? ` · Room ${d.cycle.resident.room_number}` : ''}</Text>
                    {d.medication_schedule?.instructions ? <Text style={styles.muted}>{d.medication_schedule.instructions}</Text> : null}
                    {d.notes ? <Text style={styles.muted}>Reason: {d.notes}</Text> : null}
                    {canRecord ? (
                      saving === d.id ? <ActivityIndicator color={palette.brand} /> : (
                        <View style={styles.actionsWrap}>
                          {DOSE_ACTIONS.map((a) => (
                            <Pressable key={a.status} onPress={() => record(d, a.status)} style={[styles.chip, d.status === a.status && styles.chipActive]} accessibilityRole="button" accessibilityLabel={`${a.label}: ${d.medication_schedule?.patient_medication?.drug_name ?? 'medicine'}`}>
                              <Text style={[styles.chipText, d.status === a.status && styles.chipTextActive]}>{a.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )
                    ) : null}
                  </View>
                )
              })}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  )
}

// ---------- Requests ----------

const REQUEST_TYPES = ['repeat', 'regular', 'acute', 'change', 'query']

function RequestsScreen() {
  const ctx = useCareHomeContext()
  const [requests, setRequests] = useState<CareHomeRequest[]>([])
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [composing, setComposing] = useState(false)
  const canRequest = ctx.can('care_home_requests')
  const canReview = !ctx.isCareHome && canRequest

  const load = useCallback(async () => {
    if (!ctx.linkId) return
    setLoading(true)
    try {
      const [r, res] = await Promise.all([fetchRequests(ctx.linkId), fetchResidents(ctx.linkId)])
      setRequests(r)
      setResidents(res)
      setError(null)
    } catch (e) {
      setError(careHomeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [ctx.linkId])

  useEffect(() => { void load() }, [load])

  const shown = filter === 'open' ? requests.filter((r) => OPEN_REQUEST_STATUSES.includes(r.status)) : requests
  const waiting = requests.filter((r) => r.status === 'submitted').length

  const move = async (request: CareHomeRequest, status: string) => {
    if (!ctx.userId) return
    try {
      await setRequestStatus(request.id, status, ctx.userId)
      setRequests((list) => list.map((r) => (r.id === request.id ? { ...r, status } : r)))
    } catch (e) {
      Alert.alert('Could not update', careHomeErrorMessage(e))
    }
  }

  const confirmMove = (request: CareHomeRequest, status: string, title: string, text: string) =>
    Alert.alert(title, text, [{ text: 'Keep', style: 'cancel' }, { text: title, style: 'destructive', onPress: () => void move(request, status) }])

  const gate = Gate({ ctx })
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && requests.length > 0} onRefresh={load} />}>
        <LinkPicker ctx={ctx} />
        {gate ?? (
          <>
            <Text style={styles.summaryTitle}>{waiting ? `${waiting} waiting for the pharmacy` : 'Nothing waiting for the pharmacy'}</Text>
            {canRequest ? <Button label="+ New request" onPress={() => setComposing(true)} disabled={!residents.some((r) => r.status === 'active')} /> : null}
            {canRequest && !residents.some((r) => r.status === 'active') && !loading ? <Text style={styles.hint}>Requests need at least one active resident.</Text> : null}
            <View style={styles.chipsRow}>
              {(['open', 'all'] as const).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: filter === f }}>
                  <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'open' ? 'Open' : 'All'} ({f === 'open' ? requests.filter((r) => OPEN_REQUEST_STATUSES.includes(r.status)).length : requests.length})</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading && !requests.length ? <ActivityIndicator color={palette.brand} style={{ marginTop: 24 }} /> : null}
            {!loading && !shown.length && !error ? (
              <EmptyState icon="clipboard-outline" color={COLOR} title={filter === 'open' ? 'No open requests' : 'No requests yet'} text={ctx.isCareHome ? 'Send the pharmacy a request when a resident needs a medicine.' : 'Requests from the care home appear here.'} />
            ) : null}
            {shown.map((r) => {
              const next = NEXT_REQUEST_STEP[r.status]
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{r.medicine_name}</Text>
                    <Badge tone={r.status === 'completed' ? 'success' : ['declined', 'cancelled', 'refused'].includes(r.status) ? 'muted' : r.status === 'submitted' ? 'warning' : 'info'} label={chLabel('requestStatus', r.status)} />
                  </View>
                  <Text style={styles.muted}>{residentName(r.resident?.patient)}{r.resident?.room_number ? ` · Room ${r.resident.room_number}` : ''}</Text>
                  <Text style={styles.muted}>{chLabel('requestType', r.request_type)}{r.quantity ? ` · Qty ${r.quantity}` : ''} · Requested {ukDate(r.requested_at)}{r.needed_by ? ` · Needed by ${ukDate(r.needed_by)}` : ''}</Text>
                  {r.request_notes ? <Text style={styles.body}>{r.request_notes}</Text> : null}
                  <View style={styles.actionsWrap}>
                    {canReview && next ? <Pressable onPress={() => void move(r, next.status)} style={[styles.chip, styles.chipActive]} accessibilityRole="button"><Text style={[styles.chipText, styles.chipTextActive]}>{next.label}</Text></Pressable> : null}
                    {canReview && ['submitted', 'acknowledged'].includes(r.status) ? <Pressable onPress={() => confirmMove(r, 'declined', 'Decline', 'The care home will see this request as declined.')} style={styles.chip} accessibilityRole="button"><Text style={styles.chipText}>Decline</Text></Pressable> : null}
                    {ctx.isCareHome && canRequest && r.status === 'submitted' && r.requested_by === ctx.userId ? <Pressable onPress={() => confirmMove(r, 'cancelled', 'Cancel request', 'The pharmacy will no longer action this request.')} style={styles.chip} accessibilityRole="button"><Text style={styles.chipText}>Cancel request</Text></Pressable> : null}
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>
      {composing && ctx.linkId ? (
        <NewRequestSheet
          linkId={ctx.linkId}
          residents={residents.filter((r) => r.status === 'active')}
          fromCareHome={ctx.isCareHome}
          userId={ctx.userId}
          onClose={() => setComposing(false)}
          onSent={() => { setComposing(false); void load() }}
        />
      ) : null}
    </View>
  )
}

function NewRequestSheet({ linkId, residents, fromCareHome, userId, onClose, onSent }: {
  linkId: string
  residents: CareHomeResident[]
  fromCareHome: boolean
  userId?: string
  onClose: () => void
  onSent: () => void
}) {
  const [residentId, setResidentId] = useState('')
  const [type, setType] = useState('repeat')
  const [medicine, setMedicine] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = Boolean(residentId && medicine.trim() && userId)

  const send = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await createRequest({ linkId, residentId, requestType: type, medicineName: medicine, quantity: quantity ? Number(quantity) : undefined, notes, userId: userId!, fromCareHome })
      Alert.alert(fromCareHome ? 'Sent to the pharmacy' : 'Request added')
      onSent()
    } catch (e) {
      Alert.alert('Could not send', careHomeErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>New request</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={26} color={palette.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Resident *</Text>
          {residents.map((r) => (
            <Pressable key={r.id} onPress={() => setResidentId(r.id)} style={[styles.option, residentId === r.id && styles.optionActive]} accessibilityRole="radio" accessibilityState={{ checked: residentId === r.id }}>
              <Text style={styles.cardTitle}>{residentName(r.patient)}</Text>
              <Text style={styles.muted}>{r.room_number ? `Room ${r.room_number}` : 'Room not recorded'}</Text>
            </Pressable>
          ))}
          <Text style={styles.label}>Type</Text>
          <View style={styles.actionsWrap}>
            {REQUEST_TYPES.map((t) => (
              <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, type === t && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ checked: type === t }}>
                <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{chLabel('requestType', t)}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Medicine *" value={medicine} onChangeText={setMedicine} placeholder="Name, strength and form" />
          <Field label="Quantity" value={quantity} onChangeText={(t) => setQuantity(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" />
          <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Anything the pharmacy should know" />
          <Button label={fromCareHome ? 'Send to pharmacy' : 'Add request'} onPress={send} loading={busy} disabled={!ready} />
          {!ready ? <Text style={styles.hint}>Pick a resident and enter the medicine to send.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

// ---------- Groups (pharmacy) ----------

const GROUP_STATES = ['idle', 'preparing', 'ready', 'in_transit', 'delivered']

function GroupsScreen() {
  const ctx = useCareHomeContext()
  const [groups, setGroups] = useState<CareHomeGroup[]>([])
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!ctx.linkId) return
    setLoading(true)
    try {
      const [g, r] = await Promise.all([fetchGroups(ctx.linkId), fetchResidents(ctx.linkId)])
      setGroups(g)
      setResidents(r)
      setError(null)
    } catch (e) {
      setError(careHomeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [ctx.linkId])

  useEffect(() => { void load() }, [load])

  const count = (g: CareHomeGroup) => residents.filter((r) => r.unit_id === g.id || (r.group_memberships ?? []).some((m) => m.group_id === g.id)).length
  const gate = Gate({ ctx })

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && groups.length > 0} onRefresh={load} />}>
      <LinkPicker ctx={ctx} />
      {gate ?? (
        <>
          <Text style={styles.hint}>Packing bags and starting delivery runs is done on the website.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && !groups.length ? <ActivityIndicator color={palette.brand} style={{ marginTop: 24 }} /> : null}
          {!loading && !groups.length && !error ? (
            <EmptyState icon="albums-outline" color={COLOR} title="No delivery groups yet" text="Create groups for each delivery cycle on the website, under the care home profile." />
          ) : null}
          {GROUP_STATES.map((state) => {
            const list = groups.filter((g) => g.group_state === state)
            if (!list.length) return null
            return (
              <View key={state} style={styles.section}>
                <Text style={styles.sectionTitle}>{chLabel('groupState', state)} ({list.length})</Text>
                {list.map((g) => (
                  <View key={g.id} style={styles.card}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{g.name}</Text>
                      <Badge tone={g.group_type === 'acute' ? 'warning' : 'muted'} label={chLabel('groupType', g.group_type)} />
                    </View>
                    <Text style={styles.muted}>{count(g)} resident{count(g) === 1 ? '' : 's'}{g.cycle_day ? ` · Day ${g.cycle_day}` : ''}{g.floor_name ? ` · ${g.floor_name}` : ''}</Text>
                    {g.state_changed_at ? <Text style={styles.muted}>Since {ukDate(g.state_changed_at)}</Text> : null}
                  </View>
                ))}
              </View>
            )
          })}
        </>
      )}
    </ScrollView>
  )
}

// ---------- small bits ----------

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'muted' }) {
  const map = {
    success: { bg: palette.successTint, fg: palette.success },
    warning: { bg: palette.warningTint, fg: palette.warning },
    danger: { bg: palette.dangerTint, fg: palette.danger },
    info: { bg: palette.brandTint, fg: palette.brandDark },
    muted: { bg: palette.bg, fg: palette.textMuted },
  }[tone]
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: palette.text, marginTop: 8 },
  summaryTitle: { fontSize: 17, fontWeight: '700', color: palette.text },
  hint: { fontSize: 13, color: palette.textMuted },
  muted: { fontSize: 13, color: palette.textMuted },
  body: { fontSize: 14, color: palette.text, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  error: { color: palette.danger, fontSize: 14 },
  allergy: { fontSize: 13, color: palette.danger, fontWeight: '600' },
  time: { fontSize: 15, fontWeight: '700', color: palette.brandDark },
  card: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 4 },
  cardWarn: { borderColor: palette.danger, backgroundColor: palette.dangerTint },
  cardDone: { opacity: 0.85 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: palette.text, flexShrink: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  search: { height: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, backgroundColor: palette.surface, color: palette.text },
  textArea: { minHeight: 80, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, fontSize: 16, backgroundColor: palette.surface, color: palette.text, textAlignVertical: 'top' },
  chips: { gap: 8, paddingBottom: 4 },
  chipsInline: { gap: 8 },
  chipsRow: { flexDirection: 'row', gap: 8 },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { fontSize: 14, fontWeight: '600', color: palette.text },
  chipTextActive: { color: palette.textInverse },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 12, fontWeight: '700' },
  dayBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 12 },
  option: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, backgroundColor: palette.surface },
  optionActive: { borderColor: palette.brand, backgroundColor: palette.brandTint },
  sheet: { flex: 1, backgroundColor: palette.bg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: palette.text, flexShrink: 1 },
  sheetBody: { padding: 16, gap: 10, paddingBottom: 48 },
})

export const careHomesScreens: Record<string, ComponentType> = {
  residents: ResidentsScreen,
  doses: DosesScreen,
  requests: RequestsScreen,
  groups: GroupsScreen,
}
