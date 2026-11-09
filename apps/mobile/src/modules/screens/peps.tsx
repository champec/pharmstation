// PEPS (private and veterinary e-prescriptions) on the phone, matching the web
// pages /peps (queue), /peps/my (my prescriptions) and /peps/write.
//
// Queue:    prescriptions sent to or held by this pharmacy. Download directed
//           ones, then dispense, release to the spine or transfer.
// Collect:  claim a spine prescription with its reference (typed or scanned
//           from the barcode on the patient's copy) plus the patient's
//           surname or date of birth.
// Written:  prescriptions you wrote, with cancel.
// Write:    write, sign with your 6-digit PIN and send.
//
// The database enforces every rule (verified pharmacies only, expiry,
// controlled drug schedules, PIN, suspended prescribers), so these screens
// only hide actions that would be refused and show the server's message.
import type { ComponentType } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const WEB_URL = 'https://pharmstation.co.uk'

// ---------------------------------------------------------------- types

type RxStatus = 'available' | 'held' | 'dispensed' | 'cancelled'

type RxItem = {
  id: string
  line_order: number
  drug_name: string
  quantity: string
  dosage: string | null
  dmd_code: string | null
  dmd_type: string | null
  cd_category: string | null
}

type Rx = {
  id: string
  prescription_ref: string
  prescription_type: 'private' | 'vet'
  status: RxStatus
  written_by: string
  assigned_org_id: string | null
  prescription_date: string
  expires_at: string | null
  repeats: number
  repeats_dispensed: number
  cancelled_at: string | null
  cancel_reason: string | null
  animal_name: string | null
  animal_owner: string | null
  cascade_wording: string | null
  patient_snapshot: { full_name?: string; dob?: string | null; address?: string | null; nhs_number?: string | null } | null
  prescriber_snapshot: { full_name?: string; registration_body?: string | null; registration_number?: string; address?: string | null } | null
  prescribing_org_snapshot: { name?: string } | null
  items: RxItem[]
  assigned_org?: { id: string; name: string } | null
}

type Verify = { status: 'verified' | 'altered' | 'unsigned'; signed_at?: string | null; prescriber_status?: string | null }
type Pharmacy = { id: string; name: string; ods_code: string | null }
type DmdResult = { code: string; dmd_type: 'vmp' | 'amp'; name: string; cd_category: string | null }
type Prescriber = { id: string; full_name: string; status: string; address: string | null; registration_body: string | null; registration_number: string }

const RX_SELECT = '*, items:ps_peps_prescription_items(*)'

// ---------------------------------------------------------------- helpers

function cdSchedule(cat: string | null | undefined): 0 | 1 | 2 | 3 | 4 | 5 {
  switch (cat) {
    case '0001': return 1
    case '0002': case '0003': return 2
    case '0004': case '0005': case '0006': case '0007': return 3
    case '0008': case '0009': return 4
    case '0010': return 5
    default: return 0
  }
}
const cdLabel = (cat: string | null | undefined) => {
  const s = cdSchedule(cat)
  return s ? `CD Schedule ${s}` : ''
}
const cdBlocked = (cat: string | null | undefined) => {
  const s = cdSchedule(cat)
  return s >= 1 && s <= 3
}

const dateLabel = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const isExpired = (rx: Rx) => !!rx.expires_at && new Date(rx.expires_at).getTime() < Date.now()

function statusInfo(rx: Rx): { label: string; color: string } {
  if (rx.status === 'cancelled') return { label: 'Cancelled', color: palette.danger }
  if (rx.status === 'dispensed') return { label: 'Dispensed', color: palette.textMuted }
  if (isExpired(rx)) return { label: 'Expired', color: palette.danger }
  if (rx.status === 'held') return { label: 'Held', color: palette.success }
  return { label: rx.assigned_org_id ? 'To download' : 'On the spine', color: palette.brand }
}

const subject = (rx: Rx) =>
  rx.prescription_type === 'vet'
    ? `${rx.animal_name ?? 'Animal'}${rx.animal_owner ? ` (${rx.animal_owner})` : ''}`
    : rx.patient_snapshot?.full_name ?? 'Patient'

const one = <T,>(data: unknown) => (Array.isArray(data) ? (data[0] as T) : (data as T))

async function myUserId() {
  const { data } = await userClient.auth.getUser()
  return data.user?.id ?? null
}

/** Debounced search helper for type-ahead fields. */
function useSearch<T>(fn: (q: string) => Promise<T[]>, query: string, enabled: boolean) {
  const [results, setResults] = useState<T[]>([])
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!enabled || query.trim().length < 2) {
      setResults([])
      return
    }
    let live = true
    const t = setTimeout(() => {
      fnRef.current(query.trim()).then((r) => live && setResults(r)).catch(() => live && setResults([]))
    }, 280)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, enabled])
  return results
}

async function searchPharmacies(q: string): Promise<Pharmacy[]> {
  const { data, error } = await userClient.rpc('ps_peps_pharmacy_search', { p_query: q })
  if (error) throw error
  return (data ?? []) as Pharmacy[]
}

// ---------------------------------------------------------------- shared bits

function Badge({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.badge, { color, borderColor: color }]}>{label}</Text>
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={styles.pills}>
      {options.map(([id, label]) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          style={[styles.pill, value === id && styles.pillOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === id }}
        >
          <Text style={[styles.pillText, value === id && styles.pillTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function Action({ label, onPress, variant = 'primary', disabled, loading }: {
  label: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  loading?: boolean
}) {
  const bg = variant === 'primary' ? palette.brand : variant === 'danger' ? palette.dangerTint : palette.brandTint
  const fg = variant === 'primary' ? palette.textInverse : variant === 'danger' ? palette.danger : palette.brandDark
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={[styles.action, { backgroundColor: bg }, (disabled || loading) && { opacity: 0.5 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.actionText, { color: fg }]}>{label}</Text>}
    </Pressable>
  )
}

function Input(props: React.ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  const { label, hint, style, ...rest } = props
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, style]} placeholderTextColor={palette.textMuted} {...rest} />
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  )
}

function Empty({ icon, title, body }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={palette.brand} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyText}>{body}</Text> : null}
    </View>
  )
}

function RxCard({ rx, onPress, showWhere }: { rx: Rx; onPress: () => void; showWhere?: boolean }) {
  const st = statusInfo(rx)
  const hasCd = rx.items.some((it) => cdSchedule(it.cd_category) > 0)
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowBetween}>
        <Text style={styles.ref}>{rx.prescription_ref}</Text>
        <Text style={styles.muted}>{dateLabel(rx.prescription_date)}</Text>
      </View>
      <Text style={styles.name}>{subject(rx)}</Text>
      <Text style={styles.muted} numberOfLines={2}>
        {rx.items.map((it) => it.drug_name).join(', ') || 'No items'}
      </Text>
      {showWhere && rx.assigned_org?.name ? <Text style={styles.muted}>At {rx.assigned_org.name}</Text> : null}
      <View style={styles.badges}>
        <Badge label={st.label} color={st.color} />
        {rx.prescription_type === 'vet' ? <Badge label="Vet" color={palette.textMuted} /> : null}
        {hasCd ? <Badge label="Controlled drug" color={palette.warning} /> : null}
        {rx.repeats > 0 ? <Badge label={`${rx.repeats_dispensed}/${rx.repeats + 1} issued`} color={palette.textMuted} /> : null}
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------- detail sheet

function RxSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const orgId = useAuthStore((s) => s.organisation?.id ?? null)
  const [rx, setRx] = useState<Rx | null>(null)
  const [verify, setVerify] = useState<Verify | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'dispense' | 'transfer' | 'cancel'>('view')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [phText, setPhText] = useState('')
  const [target, setTarget] = useState<Pharmacy | null>(null)
  const pharmacies = useSearch(searchPharmacies, phText, mode === 'transfer' && !target)

  const load = useCallback(async () => {
    if (!id) return
    const { data, error } = await userClient.from('ps_peps_prescriptions').select(RX_SELECT).eq('id', id).single()
    if (error) {
      Alert.alert('Could not open the prescription', error.message)
      onClose()
      return
    }
    const r = data as Rx
    r.items = [...(r.items ?? [])].sort((a, b) => a.line_order - b.line_order)
    setRx(r)
    const v = await userClient.rpc('ps_peps_verify', { p_id: id })
    setVerify(v.error ? null : (v.data as Verify))
  }, [id, onClose])

  useEffect(() => {
    setRx(null)
    setVerify(null)
    setMode('view')
    setNote('')
    setReason('')
    setPhText('')
    setTarget(null)
    if (id) {
      void load()
      void myUserId().then(setUid)
    }
  }, [id, load])

  if (!id) return null

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      setMode('view')
      Alert.alert(done)
      await load()
      onChanged()
    } catch (e) {
      Alert.alert('That did not work', (e as Error).message)
    }
    setBusy(false)
  }
  const rpc = async (fnName: string, args: Record<string, unknown>) => {
    const { error } = await userClient.rpc(fnName, args)
    if (error) throw new Error(error.message)
  }

  const content = () => {
    if (!rx) return <ActivityIndicator style={{ marginTop: 40 }} color={palette.brand} />
    const expired = isExpired(rx)
    const mine = !!orgId && rx.assigned_org_id === orgId
    const held = rx.status === 'held' && mine && !expired
    const downloadable = rx.status === 'available' && mine && !expired
    const canCancel = uid === rx.written_by && (rx.status === 'available' || rx.status === 'held')
    const altered = verify?.status === 'altered'
    const blockedPrescriber = verify?.prescriber_status === 'suspended' || verify?.prescriber_status === 'revoked'
    const cdItems = rx.items.filter((it) => cdSchedule(it.cd_category) > 0)
    const st = statusInfo(rx)

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={styles.badges}>
          <Badge label={st.label} color={st.color} />
          {verify?.status === 'verified' ? <Badge label="Signed, unchanged" color={palette.success} /> : null}
          {altered ? <Badge label="Changed since signing" color={palette.danger} /> : null}
        </View>

        {rx.status === 'cancelled' ? (
          <Text style={styles.alertDanger}>
            Cancelled by the prescriber{rx.cancelled_at ? ` on ${dateLabel(rx.cancelled_at)}` : ''}{rx.cancel_reason ? `: ${rx.cancel_reason}` : ''}. Do not dispense.
          </Text>
        ) : null}
        {altered ? <Text style={styles.alertDanger}>This prescription has been changed since it was signed. Do not dispense it.</Text> : null}
        {blockedPrescriber && rx.status !== 'dispensed' && rx.status !== 'cancelled' ? (
          <Text style={styles.alertDanger}>The prescriber's account is {verify?.prescriber_status}. Do not dispense; contact the prescriber or the patient.</Text>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.eyebrow}>{rx.prescription_type === 'vet' ? 'Veterinary prescription' : 'Private prescription'}</Text>
          {rx.prescription_type === 'vet' ? (
            <>
              <Text style={styles.name}>{rx.animal_name}</Text>
              <Text style={styles.body}>Owner: {rx.animal_owner ?? rx.patient_snapshot?.full_name}</Text>
            </>
          ) : (
            <>
              <Text style={styles.name}>{rx.patient_snapshot?.full_name}</Text>
              {rx.patient_snapshot?.dob ? <Text style={styles.body}>DOB {dateLabel(rx.patient_snapshot.dob)}</Text> : null}
              {rx.patient_snapshot?.nhs_number ? <Text style={styles.muted}>NHS {rx.patient_snapshot.nhs_number}</Text> : null}
            </>
          )}
          {rx.patient_snapshot?.address ? <Text style={styles.muted}>{rx.patient_snapshot.address}</Text> : null}
          <Text style={styles.muted}>
            Written {dateLabel(rx.prescription_date)}
            {rx.expires_at && rx.status !== 'cancelled' ? ` · ${expired ? 'expired' : 'valid until'} ${dateLabel(rx.expires_at)}` : ''}
          </Text>
        </View>

        <View style={styles.block}>
          {rx.items.map((it, i) => (
            <View key={it.id} style={{ marginBottom: 6 }}>
              <Text style={styles.body}>
                {i + 1}. <Text style={{ fontWeight: '700' }}>{it.drug_name}</Text> · {it.quantity}
              </Text>
              {it.dosage ? <Text style={styles.muted}>{it.dosage}</Text> : null}
              {cdSchedule(it.cd_category) > 0 ? <Badge label={cdLabel(it.cd_category)} color={palette.warning} /> : null}
            </View>
          ))}
          {rx.cascade_wording ? <Text style={[styles.muted, { fontStyle: 'italic' }]}>{rx.cascade_wording}</Text> : null}
          {rx.repeats > 0 ? <Text style={styles.muted}>{rx.repeats_dispensed} of {rx.repeats + 1} issues dispensed</Text> : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.name}>{rx.prescriber_snapshot?.full_name}</Text>
          <Text style={styles.muted}>{rx.prescriber_snapshot?.registration_body} {rx.prescriber_snapshot?.registration_number}</Text>
          {rx.prescribing_org_snapshot?.name ? <Text style={styles.muted}>{rx.prescribing_org_snapshot.name}</Text> : null}
          {rx.prescriber_snapshot?.address ? <Text style={styles.muted}>{rx.prescriber_snapshot.address}</Text> : null}
          {verify?.signed_at ? <Text style={styles.muted}>Signed {new Date(verify.signed_at).toLocaleString('en-GB')}</Text> : null}
        </View>

        {mode === 'view' ? (
          <View style={{ gap: 10 }}>
            {downloadable ? (
              <Action label="Download to this pharmacy" loading={busy}
                onPress={() => void run(() => rpc('ps_peps_download', { p_org_id: orgId, p_ids: [rx.id] }), 'Downloaded')} />
            ) : null}
            {held ? (
              <>
                <Action label="Dispense" disabled={busy || altered || blockedPrescriber} onPress={() => setMode('dispense')} />
                <Action label="Transfer to another pharmacy" variant="secondary" disabled={busy} onPress={() => setMode('transfer')} />
                <Action label="Release to the spine" variant="secondary" disabled={busy}
                  onPress={() => Alert.alert('Release to the spine?', 'Any pharmacy can then claim it with the reference and the patient\'s surname or date of birth.', [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Release', onPress: () => void run(() => rpc('ps_peps_release', { p_id: rx.id }), 'Released to the spine') },
                  ])} />
              </>
            ) : null}
            {canCancel ? <Action label="Cancel prescription" variant="danger" disabled={busy} onPress={() => setMode('cancel')} /> : null}
            {(rx.status === 'held' || rx.status === 'dispensed') && mine ? (
              <Text style={styles.muted}>Printing a copy is on the web app.</Text>
            ) : null}
          </View>
        ) : null}

        {mode === 'dispense' ? (
          <View style={[styles.block, { gap: 10 }]}>
            <Text style={styles.name}>
              Dispense {rx.prescription_ref}{rx.repeats > 0 ? ` (issue ${rx.repeats_dispensed + 1} of ${rx.repeats + 1})` : ''}?
            </Text>
            <Text style={styles.alertDanger}>This can't be undone. Keep the record once dispensed.</Text>
            {cdItems.length > 0 ? (
              <Text style={styles.alertWarn}>
                Contains a controlled drug ({cdItems.map((it) => `${it.drug_name}: ${cdLabel(it.cd_category)}`).join('; ')}). Check it is in date and record the batch.
              </Text>
            ) : null}
            <Input label="Batch / supply note (optional)" value={note} onChangeText={setNote} placeholder="e.g. batch AB123, exp 03/2028" />
            <Action label="Confirm dispense" loading={busy}
              onPress={() => void run(async () => {
                await rpc('ps_peps_dispense', {
                  p_id: rx.id,
                  p_supplied: rx.items.map((it) => ({
                    item: it.drug_name,
                    quantity: it.quantity,
                    ...(cdSchedule(it.cd_category) > 0 ? { cd_category: it.cd_category } : {}),
                    ...(note.trim() ? { note: note.trim() } : {}),
                  })),
                })
                setNote('')
              }, 'Dispensed')} />
            <Action label="Back" variant="secondary" disabled={busy} onPress={() => setMode('view')} />
          </View>
        ) : null}

        {mode === 'transfer' ? (
          <View style={[styles.block, { gap: 10 }]}>
            <Text style={styles.name}>Transfer to another pharmacy</Text>
            <Text style={styles.muted}>It leaves your queue and goes to the chosen pharmacy, who must download it.</Text>
            <Input label="Pharmacy" value={phText} onChangeText={(t) => { setPhText(t); setTarget(null) }} placeholder="Search by name or ODS code" />
            {!target && pharmacies.map((ph) => (
              <Pressable key={ph.id} style={styles.option} onPress={() => { setTarget(ph); setPhText(ph.name) }}>
                <Text style={styles.body}>{ph.name}</Text>
                {ph.ods_code ? <Text style={styles.muted}>ODS {ph.ods_code}</Text> : null}
              </Pressable>
            ))}
            <Action label="Transfer" loading={busy} disabled={!target}
              onPress={() => target && void run(() => rpc('ps_peps_transfer', { p_id: rx.id, p_to_org_id: target.id }), `Sent to ${target.name}`)} />
            <Action label="Back" variant="secondary" disabled={busy} onPress={() => setMode('view')} />
          </View>
        ) : null}

        {mode === 'cancel' ? (
          <View style={[styles.block, { gap: 10 }]}>
            <Text style={styles.name}>Cancel {rx.prescription_ref}?</Text>
            <Text style={styles.muted}>It can't then be dispensed anywhere.{rx.assigned_org_id ? ' The pharmacy holding it will be told.' : ''}</Text>
            <Input label="Reason *" value={reason} onChangeText={setReason} placeholder="e.g. wrong dose" />
            <Action label="Cancel prescription" variant="danger" loading={busy} disabled={reason.trim().length < 3}
              onPress={() => void run(() => rpc('ps_peps_cancel', { p_id: rx.id, p_reason: reason.trim() }), 'Prescription cancelled')} />
            <Action label="Keep it" variant="secondary" disabled={busy} onPress={() => setMode('view')} />
          </View>
        ) : null}
      </ScrollView>
    )
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{rx?.prescription_ref ?? 'Prescription'}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" hitSlop={8}>
            <Ionicons name="close" size={26} color={palette.text} />
          </Pressable>
        </View>
        {content()}
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------- queue

type QueueFilter = 'download' | 'held' | 'done'

function useOrgVerified() {
  const org = useAuthStore((s) => s.organisation) as { id: string; verification_status?: string; is_verified?: boolean } | null
  const [verified, setVerified] = useState<boolean | null>(null)
  useEffect(() => {
    if (!org?.id) return
    userClient.rpc('ps_org_is_verified', { p_org_id: org.id }).then(({ data, error }) => setVerified(error ? null : !!data))
  }, [org?.id])
  return verified
}

function QueueScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id ?? null)
  const verified = useOrgVerified()
  const [rows, setRows] = useState<Rx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<QueueFilter>('held')
  const [openId, setOpenId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data, error: err } = await userClient
      .from('ps_peps_prescriptions')
      .select(RX_SELECT)
      .eq('assigned_org_id', orgId)
      .order('prescription_date', { ascending: false })
      .limit(300)
    if (err) setError(err.message)
    else {
      setError(null)
      setRows((data ?? []) as Rx[])
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const toDownload = rows.filter((r) => r.status === 'available' && !isExpired(r))
  const held = rows.filter((r) => r.status === 'held')
  const done = rows.filter((r) => r.status === 'dispensed' || r.status === 'cancelled' || (r.status === 'available' && isExpired(r)))
  const shown = filter === 'download' ? toDownload : filter === 'held' ? held : done

  const downloadAll = async () => {
    if (!orgId) return
    setDownloading(true)
    const { data, error: err } = await userClient.rpc('ps_peps_download', { p_org_id: orgId, p_ids: null })
    setDownloading(false)
    if (err) Alert.alert('Could not download', err.message)
    else {
      const n = Array.isArray(data) ? data.length : 0
      Alert.alert(n ? `Downloaded ${n} prescription${n === 1 ? '' : 's'}` : 'Nothing new to download')
      setFilter('held')
      void load()
    }
  }

  return (
    <View style={styles.screen}>
      {verified === false ? (
        <Text style={[styles.alertWarn, { margin: 16, marginBottom: 0 }]}>
          Your pharmacy hasn't been verified yet. You can receive and dispense private prescriptions once PharmStation has checked your pharmacy's details.
        </Text>
      ) : null}
      <Pills<QueueFilter>
        value={filter}
        onChange={setFilter}
        options={[
          ['download', toDownload.length ? `To download (${toDownload.length})` : 'To download'],
          ['held', held.length ? `Held (${held.length})` : 'Held'],
          ['done', 'Done'],
        ]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={shown}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          filter === 'download' && toDownload.length > 0 ? (
            <View style={{ marginBottom: 12 }}>
              <Action label={`Download all (${toDownload.length})`} loading={downloading} onPress={() => void downloadAll()} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <Empty
              icon="document-text-outline"
              title={filter === 'download' ? 'Nothing waiting to download' : filter === 'held' ? 'No prescriptions held' : 'Nothing finished yet'}
              body={filter === 'held' ? 'Prescriptions sent to your pharmacy, or claimed from the spine, appear here once downloaded.' : undefined}
            />
          )
        }
        renderItem={({ item }) => <RxCard rx={item} onPress={() => setOpenId(item.id)} />}
      />
      <RxSheet id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />
    </View>
  )
}

// ---------------------------------------------------------------- collect

function CollectScreen() {
  const orgId = useAuthStore((s) => s.organisation?.id ?? null)
  const [permission, requestPermission] = useCameraPermissions()
  const [camera, setCamera] = useState(false)
  const [ref, setRef] = useState('')
  const [check, setCheck] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [where, setWhere] = useState<{ location: string; status: string } | null>(null)

  const scan = async () => {
    const granted = permission?.granted || (await requestPermission()).granted
    if (!granted) return Alert.alert('Camera access needed', 'Allow camera access to scan the barcode on the prescription.')
    setCamera(true)
  }
  const onScanned = ({ data }: BarcodeScanningResult) => {
    setCamera(false)
    setRef(data.trim().toUpperCase())
  }

  const claim = async () => {
    if (!orgId) return
    setBusy(true)
    setWhere(null)
    const { data, error } = await userClient.rpc('ps_peps_claim', { p_org_id: orgId, p_ref: ref.trim(), p_check: check.trim() })
    setBusy(false)
    if (error) return Alert.alert('Could not collect it', error.message)
    const rx = one<{ id: string | null } | null>(data)
    if (!rx?.id) {
      return Alert.alert(
        'No match',
        'Check the reference and the surname or date of birth (DD/MM/YYYY). After 10 wrong tries in an hour you have to wait.',
      )
    }
    setRef('')
    setCheck('')
    setOpenId(rx.id)
  }

  const lookup = async () => {
    setBusy(true)
    const { data, error } = await userClient.rpc('ps_peps_spine_search', { p_query: ref.trim() })
    setBusy(false)
    if (error) return Alert.alert('Lookup failed', error.message)
    const r = (data ?? [])[0] as { location: string; status: string } | undefined
    setWhere(r ?? { location: 'No prescription with that reference', status: '' })
  }

  if (camera) {
    return (
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={onScanned}
          barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr'] }}
        />
        <View style={styles.scanFrame} />
        <Pressable style={styles.close} onPress={() => setCamera(false)} accessibilityLabel="Close camera" accessibilityRole="button">
          <Ionicons name="close" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.cameraHint}>Hold the prescription barcode inside the frame</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.heading}>Collect a spine prescription</Text>
        <Text style={styles.muted}>
          Enter or scan the reference the patient gives you, plus their surname or date of birth. It then moves to your Held list.
        </Text>
      </View>
      <Pressable style={styles.scanButton} onPress={() => void scan()} accessibilityRole="button">
        <Ionicons name="barcode-outline" size={24} color={palette.textInverse} />
        <Text style={styles.scanButtonText}>Scan the barcode</Text>
      </Pressable>
      <Input label="Prescription reference" value={ref} onChangeText={(t) => setRef(t.toUpperCase())} placeholder="PX-XXXX-XXXXX" autoCapitalize="characters" autoCorrect={false} />
      <Input label="Patient's surname or date of birth" value={check} onChangeText={setCheck} placeholder="Smith or 01/02/1980" autoCorrect={false} />
      <Action label="Collect prescription" loading={busy} disabled={!ref.trim() || !check.trim() || !orgId} onPress={() => void claim()} />
      <View style={[styles.block, { gap: 8 }]}>
        <Text style={styles.name}>Where is this prescription?</Text>
        <Text style={styles.muted}>Check which pharmacy holds a prescription. You need the full reference.</Text>
        <Action label="Look it up" variant="secondary" disabled={busy || ref.trim().length < 6} onPress={() => void lookup()} />
        {where ? <Text style={styles.body}>{where.location}{where.status ? ` · ${where.status}` : ''}</Text> : null}
      </View>
      <RxSheet id={openId} onClose={() => setOpenId(null)} onChanged={() => undefined} />
    </ScrollView>
  )
}

// ---------------------------------------------------------------- written by me

function usePrescriber() {
  const [prescriber, setPrescriber] = useState<Prescriber | null>(null)
  const [pinSet, setPinSet] = useState<boolean | null>(null)
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    const uid = await myUserId()
    if (!uid) {
      setLoaded(true)
      return
    }
    const { data } = await userClient.from('ps_peps_prescribers').select('id, full_name, status, address, registration_body, registration_number').eq('user_id', uid).maybeSingle()
    setPrescriber((data as Prescriber | null) ?? null)
    if (data) {
      const r = await userClient.rpc('ps_peps_has_signing_pin')
      setPinSet(r.error ? null : !!r.data)
    }
    setLoaded(true)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return { prescriber, pinSet, loaded, reload: load }
}

function NotPrescriber({ prescriber }: { prescriber: Prescriber | null }) {
  return (
    <View style={styles.screen}>
      <Empty
        icon="id-card-outline"
        title={!prescriber ? 'Register as a prescriber first' : 'Your prescriber account is not active yet'}
        body={!prescriber
          ? 'Prescribers register once on the web app (My account, Prescriber setup). PharmStation checks your registration before you can write prescriptions.'
          : 'PharmStation is checking your registration with your regulator. You can write prescriptions once it is approved.'}
      />
      <View style={{ paddingHorizontal: 16 }}>
        <Action label="Open prescriber setup on the web" variant="secondary" onPress={() => void Linking.openURL(`${WEB_URL}/me/prescriber`)} />
      </View>
    </View>
  )
}

function WrittenScreen() {
  const { prescriber, loaded } = usePrescriber()
  const [rows, setRows] = useState<Rx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const uid = await myUserId()
    if (!uid) return
    setLoading(true)
    const { data, error: err } = await userClient
      .from('ps_peps_prescriptions')
      .select(`${RX_SELECT}, assigned_org:ps_organisations!ps_peps_prescriptions_assigned_org_id_fkey(id, name)`)
      .eq('written_by', uid)
      .order('created_at', { ascending: false })
      .limit(200)
    if (err) setError(err.message)
    else {
      setError(null)
      setRows((data ?? []) as Rx[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} color={palette.brand} />
  if (!prescriber) return <NotPrescriber prescriber={null} />

  return (
    <View style={styles.screen}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={loading ? null : <Empty icon="create-outline" title="No prescriptions yet" body="Prescriptions you write appear here, with where they are now." />}
        renderItem={({ item }) => <RxCard rx={item} showWhere onPress={() => setOpenId(item.id)} />}
      />
      <RxSheet id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />
    </View>
  )
}

// ---------------------------------------------------------------- write

type Draft = { key: string; drug_name: string; dmd_code: string | null; dmd_type: 'vmp' | 'amp' | 'free_text'; cd_category: string | null; quantity: string; dosage: string }
const newDraft = (): Draft => ({ key: Math.random().toString(36).slice(2), drug_name: '', dmd_code: null, dmd_type: 'free_text', cd_category: null, quantity: '', dosage: '' })

/** dd/mm/yyyy -> yyyy-mm-dd, or null if not a real past date. */
function parseDob(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1 || dt.getTime() > Date.now()) return null
  return dt.toISOString().slice(0, 10)
}

function ItemRow({ item, vet, onChange, onRemove, canRemove }: {
  item: Draft
  vet: boolean
  onChange: (patch: Partial<Draft>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [focused, setFocused] = useState(false)
  const results = useSearch<DmdResult>(async (q) => {
    const { data, error } = await userClient.rpc('ps_peps_dmd_search', { p_query: q, p_include_cd: true })
    if (error) throw error
    // Many AMPs share a name (one per supplier): keep one row per name, VMP first
    const seen = new Map<string, DmdResult>()
    for (const r of (data ?? []) as DmdResult[]) {
      const k = r.name.trim().toLowerCase()
      const prev = seen.get(k)
      if (!prev || (prev.dmd_type !== 'vmp' && r.dmd_type === 'vmp')) seen.set(k, r)
    }
    return [...seen.values()]
  }, item.drug_name, focused && !item.dmd_code)
  return (
    <View style={[styles.block, { gap: 8 }]}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>Medicine</Text>
        {canRemove ? (
          <Pressable onPress={onRemove} accessibilityLabel="Remove medicine" accessibilityRole="button" hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={palette.danger} />
          </Pressable>
        ) : null}
      </View>
      <TextInput
        style={styles.input}
        value={item.drug_name}
        onChangeText={(t) => onChange({ drug_name: t, dmd_code: null, dmd_type: 'free_text', cd_category: null })}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder="Search dm+d: name and strength"
        placeholderTextColor={palette.textMuted}
      />
      {results.map((d) => (
        <Pressable
          key={`${d.dmd_type}-${d.code}`}
          style={styles.option}
          onPress={() => {
            onChange({ drug_name: d.name, dmd_code: d.code, dmd_type: d.dmd_type, cd_category: d.cd_category })
            setFocused(false)
          }}
        >
          <Text style={styles.body}>{d.name}</Text>
          <Text style={[styles.muted, cdBlocked(d.cd_category) && { color: palette.danger }]}>
            {[d.dmd_type.toUpperCase(), cdLabel(d.cd_category), cdBlocked(d.cd_category) ? 'not allowed' : ''].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      ))}
      {cdBlocked(item.cd_category) ? (
        <Text style={styles.alertDanger}>{cdLabel(item.cd_category)} drugs must be prescribed on the paper FP10PCD form.</Text>
      ) : cdSchedule(item.cd_category) > 0 ? (
        <Badge label={cdLabel(item.cd_category)} color={palette.warning} />
      ) : null}
      {!vet && item.drug_name.trim() && !item.dmd_code ? <Text style={[styles.muted, { color: palette.danger }]}>Pick this medicine from the list.</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={item.quantity} onChangeText={(t) => onChange({ quantity: t })} placeholder="Quantity" placeholderTextColor={palette.textMuted} />
        <TextInput style={[styles.input, { flex: 2 }]} value={item.dosage} onChangeText={(t) => onChange({ dosage: t })} placeholder="Directions" placeholderTextColor={palette.textMuted} />
      </View>
    </View>
  )
}

function WriteScreen() {
  const organisation = useAuthStore((s) => s.organisation)
  const { prescriber, pinSet, loaded } = usePrescriber()
  const [type, setType] = useState<'private' | 'vet'>('private')
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [patientId, setPatientId] = useState<string | null>(null)
  const [animal, setAnimal] = useState('')
  const [cascade, setCascade] = useState(false)
  const [repeats, setRepeats] = useState(0)
  const [items, setItems] = useState<Draft[]>([newDraft()])
  const [confirmNoCd, setConfirmNoCd] = useState(false)
  const [route, setRoute] = useState<'spine' | 'pharmacy'>('spine')
  const [phText, setPhText] = useState('')
  const [target, setTarget] = useState<Pharmacy | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentId, setSentId] = useState<string | null>(null)
  const [patientFocus, setPatientFocus] = useState(false)

  const pharmacies = useSearch(searchPharmacies, phText, route === 'pharmacy' && !target)
  const patients = useSearch(async (q) => {
    if (!organisation?.id) return []
    const w = q.split(/\s+/)[0]
    const { data, error } = await userClient
      .from('ps_patients')
      .select('id, first_name, last_name, dob, address_line_1, address_line_2, city, postcode')
      .eq('organisation_id', organisation.id)
      .or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`)
      .limit(6)
    if (error) throw error
    return (data ?? []) as Array<{ id: string; first_name: string; last_name: string; dob: string | null; address_line_1: string | null; address_line_2: string | null; city: string | null; postcode: string | null }>
  }, name, type === 'private' && patientFocus && !patientId && !!organisation?.id)

  if (!loaded) return <ActivityIndicator style={{ marginTop: 40 }} color={palette.brand} />
  if (!prescriber || prescriber.status !== 'active') return <NotPrescriber prescriber={prescriber} />

  const vet = type === 'vet'
  const filled = items.filter((it) => it.drug_name.trim() && it.quantity.trim())
  const freeText = filled.some((it) => !it.dmd_code)
  const sch4 = filled.some((it) => cdSchedule(it.cd_category) === 4)
  const dobIso = parseDob(dob)

  const problems: string[] = []
  if (!prescriber.address || prescriber.address.trim().length < 5) problems.push('Add your practice address in Prescriber setup on the web.')
  if (pinSet === false) problems.push('Set your signing PIN in Prescriber setup on the web.')
  if (vet && !animal.trim()) problems.push("Enter the animal's name.")
  if (name.trim().length < 2) problems.push(vet ? "Enter the owner's name." : "Enter the patient's name.")
  if (!vet && !dobIso) problems.push("Enter the patient's date of birth as DD/MM/YYYY.")
  if (address.trim().length < 5) problems.push(vet ? "Enter the owner's address." : "Enter the patient's address.")
  if (filled.length === 0) problems.push('Add at least one medicine with a quantity.')
  if (filled.some((it) => cdBlocked(it.cd_category))) problems.push('Remove the Schedule 1, 2 or 3 controlled drug.')
  if (!vet && freeText) problems.push('Choose every medicine from the dm+d list.')
  if (vet && freeText && !confirmNoCd) problems.push('Confirm no free-text item is a Schedule 1, 2 or 3 controlled drug.')
  if (route === 'pharmacy' && !target) problems.push('Choose the pharmacy to send it to.')
  if (!/^\d{6}$/.test(pin)) problems.push('Enter your 6-digit signing PIN.')

  const reset = () => {
    setName(''); setDob(''); setAddress(''); setPatientId(null); setAnimal(''); setCascade(false); setRepeats(0)
    setItems([newDraft()]); setConfirmNoCd(false); setRoute('spine'); setPhText(''); setTarget(null); setPin('')
  }

  const send = async () => {
    setBusy(true)
    const { data, error } = await userClient.rpc('ps_peps_create_prescription', {
      p: {
        origin_org_id: organisation?.id ?? null,
        patient_id: vet ? null : patientId,
        patient_snapshot: vet
          ? { full_name: name.trim(), address: address.trim() }
          : { full_name: name.trim(), dob: dobIso, address: address.trim() },
        prescribing_org_id: null,
        prescribing_org_snapshot: organisation?.name ? { name: organisation.name } : {},
        prescription_type: type,
        animal_name: vet ? animal.trim() : null,
        animal_owner: vet ? name.trim() : null,
        cascade_wording: vet && cascade ? 'Prescribed under the veterinary cascade. For administration to the animal(s) under my care.' : null,
        repeats,
        assigned_org_id: route === 'pharmacy' ? target?.id ?? null : null,
        created_metadata: { source: 'mobile_app' },
        pin,
        confirm_no_sch123: vet && freeText ? confirmNoCd : false,
        items: filled.map((it) => ({
          dmd_code: it.dmd_code,
          dmd_type: it.dmd_code ? it.dmd_type : 'free_text',
          drug_name: it.drug_name.trim(),
          quantity: it.quantity.trim(),
          dosage: it.dosage.trim() || null,
        })),
      },
    })
    setBusy(false)
    setPin('')
    if (error) return Alert.alert('Not sent', error.message)
    const rx = one<{ id: string | null; prescription_ref: string } | null>(data)
    if (!rx?.id) return Alert.alert('Wrong PIN', 'That signing PIN is not right. After 5 wrong tries it locks for 15 minutes.')
    Alert.alert(
      'Prescription sent',
      route === 'spine'
        ? `Reference ${rx.prescription_ref}. Give it to the patient: any PharmStation pharmacy can collect it with the reference and their surname or date of birth.`
        : `Reference ${rx.prescription_ref}, sent to ${target?.name}.`,
    )
    reset()
    setSentId(rx.id)
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
      <View style={styles.block}>
        <Text style={styles.name}>{prescriber.full_name}</Text>
        <Text style={styles.muted}>{prescriber.registration_body} {prescriber.registration_number}</Text>
        {prescriber.address ? <Text style={styles.muted}>{prescriber.address}</Text> : null}
      </View>

      <Pills<'private' | 'vet'> value={type} onChange={(t) => { setType(t); setPatientId(null) }} options={[['private', 'Private (human)'], ['vet', 'Veterinary']]} />

      {vet ? <Input label="Animal's name *" value={animal} onChangeText={setAnimal} /> : null}
      <View style={{ gap: 4 }}>
        <Input
          label={vet ? "Owner's name *" : "Patient's name *"}
          value={name}
          onChangeText={(t) => { setName(t); setPatientId(null) }}
          onFocus={() => setPatientFocus(true)}
          onBlur={() => setTimeout(() => setPatientFocus(false), 200)}
          placeholder={vet ? 'Full name' : 'Type to search your patients, or enter a new name'}
        />
        {patients.map((p) => (
          <Pressable
            key={p.id}
            style={styles.option}
            onPress={() => {
              setPatientId(p.id)
              setName(`${p.first_name} ${p.last_name}`)
              if (p.dob) {
                const [y, m, d] = p.dob.split('-')
                setDob(`${d}/${m}/${y}`)
              }
              const addr = [p.address_line_1, p.address_line_2, p.city, p.postcode].filter(Boolean).join(', ')
              if (addr) setAddress(addr)
              setPatientFocus(false)
            }}
          >
            <Text style={styles.body}>{p.first_name} {p.last_name}</Text>
            <Text style={styles.muted}>{[p.dob ? dateLabel(p.dob) : null, p.postcode].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        ))}
      </View>
      {!vet ? (
        <Input label="Date of birth *" value={dob} onChangeText={setDob} placeholder="DD/MM/YYYY" keyboardType="numbers-and-punctuation" />
      ) : null}
      <Input label={vet ? "Owner's address *" : 'Address *'} value={address} onChangeText={setAddress} placeholder="House, street, town, postcode" multiline style={{ minHeight: 64, textAlignVertical: 'top', paddingTop: 12 }} />

      <View style={{ gap: 4 }}>
        <Text style={styles.label}>Repeats</Text>
        <View style={styles.pills}>
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <Pressable key={n} onPress={() => setRepeats(n)} style={[styles.pillSmall, repeats === n && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: repeats === n }}>
              <Text style={[styles.pillText, repeats === n && styles.pillTextOn]}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.muted}>
        Choose medicines from dm+d. Schedule 1, 2 and 3 controlled drugs can't be sent through PEPS. Schedule 4 makes the prescription valid for 28 days.
        {vet ? ' Veterinary prescriptions may use free text for products not in dm+d.' : ''}
      </Text>
      {items.map((it) => (
        <ItemRow
          key={it.key}
          item={it}
          vet={vet}
          canRemove={items.length > 1}
          onChange={(patch) => setItems((all) => all.map((x) => (x.key === it.key ? { ...x, ...patch } : x)))}
          onRemove={() => setItems((all) => all.filter((x) => x.key !== it.key))}
        />
      ))}
      <Action label="+ Add medicine" variant="secondary" onPress={() => setItems((all) => [...all, newDraft()])} />

      {vet ? (
        <View style={styles.switchRow}>
          <Text style={[styles.body, { flex: 1 }]}>Prescribed under the veterinary cascade</Text>
          <Switch value={cascade} onValueChange={setCascade} />
        </View>
      ) : null}
      {vet && freeText ? (
        <View style={styles.switchRow}>
          <Text style={[styles.body, { flex: 1 }]}>I confirm no free-text item is a Schedule 1, 2 or 3 controlled drug</Text>
          <Switch value={confirmNoCd} onValueChange={setConfirmNoCd} />
        </View>
      ) : null}
      {sch4 ? <Text style={styles.alertWarn}>Contains a Schedule 4 controlled drug, so it is valid for 28 days.</Text> : null}

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Send to</Text>
        <Pills<'spine' | 'pharmacy'> value={route} onChange={(r) => { setRoute(r); setTarget(null); setPhText('') }} options={[['spine', 'PEPS spine'], ['pharmacy', 'A pharmacy']]} />
        <Text style={styles.muted}>
          {route === 'spine' ? 'The patient takes the reference to any PharmStation pharmacy.' : 'It goes straight to the pharmacy you choose.'}
        </Text>
        {route === 'pharmacy' ? (
          <>
            <TextInput style={styles.input} value={phText} onChangeText={(t) => { setPhText(t); setTarget(null) }} placeholder="Search pharmacies by name or ODS" placeholderTextColor={palette.textMuted} />
            {!target && pharmacies.map((ph) => (
              <Pressable key={ph.id} style={styles.option} onPress={() => { setTarget(ph); setPhText(ph.name) }}>
                <Text style={styles.body}>{ph.name}</Text>
                {ph.ods_code ? <Text style={styles.muted}>ODS {ph.ods_code}</Text> : null}
              </Pressable>
            ))}
          </>
        ) : null}
      </View>

      <Input
        label="Signing PIN *"
        hint="Entering your PIN signs the prescription. It is sealed when sent, so any later change can be detected."
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        style={{ letterSpacing: 6 }}
      />

      {problems.length > 0 ? (
        <View style={{ gap: 2 }}>
          {problems.map((p) => <Text key={p} style={styles.muted}>· {p}</Text>)}
        </View>
      ) : null}
      <Action label={route === 'spine' ? 'Sign and send to the spine' : 'Sign and send to the pharmacy'} loading={busy} disabled={problems.length > 0} onPress={() => void send()} />

      <RxSheet id={sentId} onClose={() => setSentId(null)} onChanged={() => undefined} />
    </ScrollView>
  )
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  error: { color: palette.danger, paddingHorizontal: 16, paddingTop: 8 },
  heading: { fontSize: 20, fontWeight: '800', color: palette.text, marginBottom: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 0, paddingTop: 0 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pillSmall: { minWidth: 40, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  pillOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  pillText: { fontSize: 14, fontWeight: '600', color: palette.text },
  pillTextOn: { color: palette.textInverse },
  empty: { alignItems: 'center', gap: 8, paddingTop: 64, paddingHorizontal: 24, paddingBottom: 24 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: palette.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: { padding: 14, backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, marginBottom: 10, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  ref: { fontSize: 13, fontWeight: '700', color: palette.textMuted, fontFamily: 'monospace' },
  name: { fontSize: 16, fontWeight: '600', color: palette.text },
  body: { fontSize: 15, color: palette.text },
  muted: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  eyebrow: { fontSize: 11, fontWeight: '700', color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  sheet: { flex: 1, backgroundColor: palette.bg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: palette.text, flex: 1, fontFamily: 'monospace' },
  block: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 4 },
  alertDanger: { color: palette.danger, backgroundColor: palette.dangerTint, padding: 10, borderRadius: radius.sm, fontSize: 14, lineHeight: 20 },
  alertWarn: { color: palette.text, backgroundColor: palette.brandTint, borderLeftWidth: 3, borderLeftColor: palette.warning, padding: 10, borderRadius: radius.sm, fontSize: 14, lineHeight: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: 12, fontSize: 16, color: palette.text },
  option: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  action: { minHeight: 50, paddingVertical: 13, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 15, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12 },
  scanButton: { minHeight: 56, borderRadius: radius.md, backgroundColor: palette.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  scanButtonText: { color: palette.textInverse, fontWeight: '800', fontSize: 16 },
  cameraWrap: { flex: 1, overflow: 'hidden', backgroundColor: palette.text },
  scanFrame: { position: 'absolute', left: 30, right: 30, top: '35%', height: 140, borderWidth: 2, borderColor: palette.textInverse, borderRadius: radius.md },
  close: { position: 'absolute', top: 18, right: 18, width: 46, height: 46, borderRadius: 23, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  cameraHint: { position: 'absolute', bottom: 42, alignSelf: 'center', color: palette.textInverse, fontWeight: '800', backgroundColor: palette.overlay, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
})

export const pepsScreens: Record<string, ComponentType> = {
  queue: QueueScreen,
  collect: CollectScreen,
  written: WrittenScreen,
  write: WriteScreen,
}
