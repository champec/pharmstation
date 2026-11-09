// Video Consultations: the phone version of the web Video page.
// Staff book a call, text the patient their link, and join the Daily room in
// the phone's browser (camera and microphone work there). Same table and
// edge function as the web: ps_video_consultations + `daily-video`.
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { EmptyState as SharedEmptyState } from '@/components/ui/EmptyState'

const COLOR = '#475569'
const PUBLIC_URL = 'https://pharmstation.co.uk'
// Daily rooms close two hours after the booked time.
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000

type Status = 'scheduled' | 'active' | 'completed' | 'cancelled'
type Consultation = {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string | null
  patient_access_code: string
  daily_room_url: string
  status: Status
  scheduled_for: string
}
type PatientHit = { id: string; first_name: string | null; last_name: string | null; phone: string | null }
type View_ = 'upcoming' | 'past'

const STATUS_LABEL: Record<Status, string> = {
  scheduled: 'Booked', active: 'In progress', completed: 'Finished', cancelled: 'Cancelled',
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

const isExpired = (c: Consultation) =>
  c.status === 'scheduled' && new Date(c.scheduled_for).getTime() + ROOM_LIFETIME_MS < Date.now()

async function callVideo<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await userClient.functions.invoke('daily-video', { body })
  if (error) {
    let msg: string | undefined
    if ('context' in error) {
      try { msg = (await (error as { context: Response }).context.json()).error } catch { /* ignore */ }
    }
    throw new Error(msg || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

async function textLink(orgId: string, c: Consultation) {
  const when = fmt(c.scheduled_for)
  const { data, error } = await userClient.functions.invoke('sms-works', {
    body: {
      action: 'notify',
      org_id: orgId,
      channel: 'sms',
      patient_id: c.patient_id ?? undefined,
      to: c.patient_phone ?? undefined,
      feature: 'video',
      body: `Your video consultation on ${when} is ready. Join here: ${PUBLIC_URL}/consult/${c.id}. Access code: ${c.patient_access_code}.`,
    },
  })
  if (error || data?.error) {
    let msg = data?.error as string | undefined
    if (!msg && error && 'context' in error) {
      try { msg = (await (error as { context: Response }).context.json()).error } catch { /* ignore */ }
    }
    throw new Error(msg || 'The text could not be sent')
  }
}

function VideoScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id ?? null)
  const [view, setView] = useState<View_>('upcoming')
  const [rows, setRows] = useState<Consultation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    const cutoff = new Date(Date.now() - ROOM_LIFETIME_MS).toISOString()
    let q = userClient.from('ps_video_consultations')
      .select('id, patient_id, patient_name, patient_phone, patient_access_code, daily_room_url, status, scheduled_for')
      .eq('org_id', orgId)
    if (view === 'upcoming') {
      q = q.in('status', ['scheduled', 'active']).gte('scheduled_for', cutoff).order('scheduled_for', { ascending: true })
    } else {
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
      q = q.or(`status.in.(completed,cancelled),and(status.eq.scheduled,scheduled_for.lt.${cutoff})`)
        .gte('scheduled_for', monthAgo).order('scheduled_for', { ascending: false })
    }
    const { data, error: err } = await q.limit(100)
    if (err) setError(err.message)
    else setRows((data ?? []) as Consultation[])
    setLoading(false)
  }, [orgId, view])

  useEffect(() => { void load() }, [load])

  const join = async (c: Consultation) => {
    setBusyId(c.id)
    try {
      const { org_token } = await callVideo<{ org_token: string }>({ action: 'get_staff_token', consultation_id: c.id })
      await WebBrowser.openBrowserAsync(`${c.daily_room_url}?t=${encodeURIComponent(org_token)}`)
      // Back from the call: offer to close it so the patient's link stops working.
      Alert.alert('Finished the call?', `Mark the consultation with ${c.patient_name} as finished.`, [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Mark finished', onPress: () => void finish(c) },
      ])
    } catch (e) {
      Alert.alert('Could not join', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const finish = async (c: Consultation) => {
    setBusyId(c.id)
    try {
      await callVideo({ action: 'end_consultation', consultation_id: c.id })
      await load()
    } catch (e) {
      Alert.alert('Could not finish', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const cancel = (c: Consultation) => {
    Alert.alert('Cancel this video call?', `${c.patient_name}, ${fmt(c.scheduled_for)}. The patient's link will stop working.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel call', style: 'destructive', onPress: async () => {
          setBusyId(c.id)
          const { error: err } = await userClient.from('ps_video_consultations').update({ status: 'cancelled' }).eq('id', c.id)
          setBusyId(null)
          if (err) Alert.alert('Could not cancel', err.message)
          else void load()
        },
      },
    ])
  }

  const resend = async (c: Consultation) => {
    if (!orgId) return
    setBusyId(c.id)
    try {
      await textLink(orgId, c)
      Alert.alert('Link sent', `${c.patient_name} has been texted their video link.`)
    } catch (e) {
      Alert.alert('Not sent', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.segmented}>
        {(['upcoming', 'past'] as const).map((v) => (
          <Pressable key={v} onPress={() => setView(v)} style={[styles.segment, view === v && styles.segmentActive]} accessibilityRole="tab" accessibilityState={{ selected: view === v }}>
            <Text style={[styles.segmentText, view === v && styles.segmentTextActive]}>{v === 'upcoming' ? 'Upcoming' : 'Past 30 days'}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={({ pressed }) => [styles.newButton, pressed && styles.pressed]} onPress={() => setCreating(true)} accessibilityRole="button">
        <Ionicons name="videocam" size={20} color="#FFFFFF" />
        <Text style={styles.newButtonText}>New video call</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={COLOR} style={{ marginTop: 32 }} /> : (
          <SharedEmptyState
            icon="videocam-outline"
            color={COLOR}
            title={view === 'upcoming' ? 'No video calls booked' : 'No past video calls'}
            text="Book one here and we'll text the patient a link. They join from their phone's browser, no app needed."
          />
        )}
        renderItem={({ item: c }) => {
          const live = view === 'upcoming' && (c.status === 'scheduled' || c.status === 'active')
          const busy = busyId === c.id
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{c.patient_name}</Text>
                <Text style={[styles.badge, c.status === 'active' && styles.badgeActive]}>
                  {isExpired(c) ? 'Expired' : STATUS_LABEL[c.status]}
                </Text>
              </View>
              <Text style={styles.muted}>{fmt(c.scheduled_for)}{c.patient_phone ? ` · ${c.patient_phone}` : ''}</Text>
              <Text style={styles.muted}>Patient access code: <Text style={styles.code}>{c.patient_access_code}</Text></Text>
              {live ? (
                <View style={styles.actions}>
                  <Button label="Join call" onPress={() => join(c)} loading={busy} />
                  <View style={styles.actionRow}>
                    <Pressable style={styles.linkButton} onPress={() => resend(c)} disabled={busy}>
                      <Text style={styles.linkText}>Text link again</Text>
                    </Pressable>
                    {c.status === 'active' ? (
                      <Pressable style={styles.linkButton} onPress={() => finish(c)} disabled={busy}>
                        <Text style={styles.linkText}>Mark finished</Text>
                      </Pressable>
                    ) : (
                      <Pressable style={styles.linkButton} onPress={() => cancel(c)} disabled={busy}>
                        <Text style={[styles.linkText, { color: palette.danger }]}>Cancel</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          )
        }}
      />

      <NewCallModal
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); setView('upcoming'); void load() }}
      />
    </View>
  )
}

const WHEN_CHOICES: { label: string; at: () => Date }[] = [
  { label: 'Now', at: () => new Date() },
  { label: 'In 15 min', at: () => new Date(Date.now() + 15 * 60_000) },
  { label: 'In 30 min', at: () => new Date(Date.now() + 30 * 60_000) },
  { label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60_000) },
  { label: 'Tomorrow 9:00', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d } },
  { label: 'Tomorrow 14:00', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d } },
]

function NewCallModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const orgId = useAuthStore((s) => s.organisation?.id ?? null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientHit[]>([])
  const [patientId, setPatientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [whenIdx, setWhenIdx] = useState(0)
  const [sendText, setSendText] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setQuery(''); setResults([]); setPatientId(null); setName(''); setPhone(''); setWhenIdx(0); setSendText(true)
  }, [visible])

  useEffect(() => {
    if (!visible || !orgId) return
    const q = query.trim().replace(/[%(),]/g, '')
    if (q.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await userClient.from('ps_patients')
        .select('id, first_name, last_name, phone')
        .eq('organisation_id', orgId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
        .order('last_name').limit(8)
      setResults((data ?? []) as PatientHit[])
    }, 300)
    return () => clearTimeout(t)
  }, [query, visible, orgId])

  const pick = (p: PatientHit) => {
    setPatientId(p.id)
    setName([p.first_name, p.last_name].filter(Boolean).join(' '))
    setPhone(p.phone ?? '')
    setQuery(''); setResults([])
  }

  const create = async () => {
    if (!orgId) return
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Almost there', 'Add the patient’s name and mobile number.')
      return
    }
    setSaving(true)
    try {
      const { consultation } = await callVideo<{ consultation: Consultation }>({
        action: 'create_room',
        org_id: orgId,
        patient_name: name.trim(),
        patient_phone: phone.trim(),
        patient_id: patientId ?? undefined,
        scheduled_for: WHEN_CHOICES[whenIdx].at().toISOString(),
      })
      let textNote = ''
      if (sendText) {
        try { await textLink(orgId, consultation); textNote = ' We’ve texted them the link.' }
        catch (e) { textNote = ` The text didn’t send (${e instanceof Error ? e.message : 'unknown error'}). Use “Text link again”.` }
      }
      Alert.alert('Video call booked', `Access code ${consultation.patient_access_code}.${textNote}`)
      onCreated()
    } catch (e) {
      Alert.alert('Not booked', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Back" style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <Text style={styles.modalTitle}>New video call</Text>
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={palette.textMuted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Find a patient (optional)" placeholderTextColor={palette.textMuted} style={styles.searchInput} />
            </View>
            {results.map((p) => (
              <Pressable key={p.id} style={({ pressed }) => [styles.hit, pressed && styles.pressed]} onPress={() => pick(p)}>
                <Text style={styles.cardTitle}>{[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed patient'}</Text>
                <Text style={styles.muted}>{p.phone ?? 'No phone on record'}</Text>
              </Pressable>
            ))}
            <Field label="Patient name" value={name} onChangeText={(v) => { setName(v); setPatientId(null) }} maxLength={120} />
            <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
            <Text style={styles.label}>When</Text>
            <View style={styles.chips}>
              {WHEN_CHOICES.map((w, i) => (
                <Pressable key={w.label} onPress={() => setWhenIdx(i)} style={[styles.chip, whenIdx === i && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: whenIdx === i }}>
                  <Text style={[styles.chipText, whenIdx === i && styles.chipTextActive]}>{w.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>Need another time? Book it on the website. The link works for two hours from the booked time.</Text>
            <Pressable style={styles.checkRow} onPress={() => setSendText((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: sendText }} aria-checked={sendText}>
              <Ionicons name={sendText ? 'checkbox' : 'square-outline'} size={22} color={sendText ? palette.brand : palette.textMuted} />
              <Text style={styles.checkText}>Text the patient their link and access code</Text>
            </Pressable>
            <Button label="Book video call" onPress={create} loading={saving} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

export const videoScreens: Record<string, ComponentType> = {
  consultations: VideoScreen,
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 8 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  segmented: { height: 42, backgroundColor: '#E9EDF3', borderRadius: radius.sm, padding: 3, flexDirection: 'row', marginBottom: 12 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: palette.surface },
  segmentText: { color: palette.textMuted, fontWeight: '700' },
  segmentTextActive: { color: palette.text },
  newButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: palette.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  newButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  error: { color: palette.danger, marginBottom: 8 },
  listContent: { paddingBottom: 24, gap: 10, flexGrow: 1 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '700' },
  badge: { fontSize: 12, fontWeight: '700', color: palette.textMuted, backgroundColor: '#F1F5F9', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  badgeActive: { color: palette.success, backgroundColor: '#ECFDF5' },
  muted: { fontSize: 13, lineHeight: 18, color: palette.textMuted },
  code: { fontWeight: '800', color: palette.text, letterSpacing: 1 },
  actions: { gap: 8, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 16 },
  linkButton: { paddingVertical: 6 },
  linkText: { color: palette.brand, fontWeight: '700', fontSize: 14 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: palette.text },
  modal: { flex: 1, backgroundColor: palette.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: '800' },
  form: { padding: 16, gap: 14, paddingBottom: 40 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, backgroundColor: palette.surface, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 16, color: palette.text },
  hit: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12, gap: 2 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipActive: { backgroundColor: palette.brandTint, borderColor: palette.brand },
  chipText: { fontSize: 13, color: palette.text },
  chipTextActive: { color: palette.brandDark, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17, color: palette.textMuted },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkText: { flex: 1, fontSize: 14, color: palette.text },
})
