// ============================================
// Locum module — Profile tab
//
// Everything a locum needs to stay bookable, from the phone:
//   - compliance status (and the reviewer's note when changes are needed)
//   - registration, indemnity and DBS details (changes go back for review)
//   - compliance documents (photo upload; PDFs can still go up on the web)
//   - shift alerts (saved searches that push new matching shifts)
//   - pharmacy SOPs to read and sign before working there
// ============================================

import { errorText } from '../../lib/error-text'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import * as ImagePicker from 'expo-image-picker'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const ACCENT = '#6D28D9'
const ACCENT_TINT = '#F1EAFE'

const DOC_TYPES = [
  { type: 'gphc_certificate', label: 'GPhC registration' },
  { type: 'indemnity_certificate', label: 'Indemnity insurance' },
  { type: 'dbs_certificate', label: 'DBS certificate' },
  { type: 'proof_of_id', label: 'Proof of identity' },
] as const

interface DocRow { id: string; doc_type: string; file_url: string; expiry_date: string | null; uploaded_at: string }
export interface SavedSearch {
  id: string
  name: string
  query: string | null
  minimum_rate: number
  date_filter: 'all' | 'week' | 'weekend'
  eligible_only: boolean
  alerts_enabled: boolean
}
interface SopRow { id: string; org_id: string; title: string; description: string | null; file_url: string | null; version: number; is_required: boolean }

const STATUS_COPY: Record<string, { label: string; tone: string; text: string }> = {
  approved: { label: 'Approved', tone: palette.success, text: 'You can book shifts.' },
  pending: { label: 'Under review', tone: palette.warning, text: 'We are checking your details and documents. You can browse shifts and book once approved.' },
  changes_requested: { label: 'Changes needed', tone: palette.warning, text: 'Please update the items below, then we will review again.' },
  rejected: { label: 'Not approved', tone: palette.danger, text: 'Update your details or documents and we will review them again.' },
  suspended: { label: 'Suspended', tone: palette.danger, text: 'Your account is suspended. Contact support@pharmstation.co.uk.' },
}

const isDate = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Save the Discover filters as a shift alert. Used by the Discover tab. */
export async function saveShiftAlert(input: Omit<SavedSearch, 'id' | 'alerts_enabled'>) {
  const locum = useAuthStore.getState().locumProfile
  if (!locum) throw new Error('Sign in as a locum first.')
  const { error } = await userClient.from('ps_locum_saved_searches').insert({
    locum_id: locum.id,
    name: input.name,
    query: input.query || null,
    minimum_rate: input.minimum_rate,
    date_filter: input.date_filter,
    eligible_only: input.eligible_only,
    alerts_enabled: true,
  })
  if (error) throw error
}

export function LocumProfileScreen() {
  const userId = useAuthStore((s) => s.userProfile?.id)
  const locum = useAuthStore((s) => s.locumProfile)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [alerts, setAlerts] = useState<SavedSearch[]>([])
  const [sops, setSops] = useState<SopRow[]>([])
  const [signed, setSigned] = useState<Set<string>>(new Set())
  const [orgNames, setOrgNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ gphc_number: '', gphc_expiry: '', indemnity_provider: '', indemnity_expiry: '', dbs_number: '', dbs_expiry: '' })
  const [status, setStatus] = useState<{ status: string; notes: string | null }>({ status: 'pending', notes: null })

  const load = useCallback(async () => {
    if (!locum) return
    setLoading(true)
    setError(null)
    try {
      const [profileRes, docRes, alertRes, bookingRes, signRes] = await Promise.all([
        userClient.from('ps_locum_profiles').select('gphc_number, gphc_expiry, indemnity_provider, indemnity_expiry, dbs_number, dbs_expiry, compliance_status, compliance_review_notes').eq('id', locum.id).single(),
        userClient.from('ps_locum_documents').select('id, doc_type, file_url, expiry_date, uploaded_at').eq('locum_id', locum.id).eq('is_current', true),
        userClient.from('ps_locum_saved_searches').select('id, name, query, minimum_rate, date_filter, eligible_only, alerts_enabled').eq('locum_id', locum.id).order('created_at'),
        userClient.from('ps_locum_bookings').select('shift:ps_locum_shifts(org_id)').eq('locum_id', locum.id).in('status', ['approved', 'completed']),
        userClient.from('ps_locum_sop_signoffs').select('sop_id, sop_version').eq('locum_id', locum.id),
      ])
      if (profileRes.error) throw profileRes.error
      const p = profileRes.data
      setForm({
        gphc_number: p.gphc_number ?? '', gphc_expiry: p.gphc_expiry ?? '',
        indemnity_provider: p.indemnity_provider ?? '', indemnity_expiry: p.indemnity_expiry ?? '',
        dbs_number: p.dbs_number ?? '', dbs_expiry: p.dbs_expiry ?? '',
      })
      setStatus({ status: p.compliance_status ?? 'pending', notes: p.compliance_review_notes ?? null })
      setDocs((docRes.data ?? []) as DocRow[])
      setAlerts((alertRes.data ?? []) as SavedSearch[])
      setSigned(new Set((signRes.data ?? []).map((s) => `${s.sop_id}:${s.sop_version}`)))

      const orgIds = [...new Set(((bookingRes.data ?? []) as unknown as { shift: { org_id: string } | { org_id: string }[] | null }[])
        .flatMap((b) => (Array.isArray(b.shift) ? b.shift : b.shift ? [b.shift] : []).map((s) => s.org_id)))]
      if (orgIds.length) {
        const [sopRes, orgRes] = await Promise.all([
          userClient.from('ps_locum_sop_documents').select('id, org_id, title, description, file_url, version, is_required').in('org_id', orgIds).eq('is_active', true).order('title'),
          userClient.rpc('ps_locum_shift_orgs', { p_org_ids: orgIds }),
        ])
        setSops((sopRes.data ?? []) as SopRow[])
        setOrgNames(Object.fromEntries(((orgRes.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name])))
      } else {
        setSops([])
      }
    } catch (e) {
      setError(errorText(e, 'Could not load your profile.'))
    } finally {
      setLoading(false)
    }
  }, [locum])

  useEffect(() => { void load() }, [load])

  if (!locum) return null

  const saveDetails = async () => {
    for (const k of ['gphc_expiry', 'indemnity_expiry', 'dbs_expiry'] as const) {
      if (!isDate(form[k])) { setError('Enter dates as YYYY-MM-DD, for example 2027-03-31.'); return }
    }
    setBusy('details')
    setError(null)
    const { error: e } = await userClient.from('ps_locum_profiles').update({
      gphc_number: form.gphc_number.trim() || null, gphc_expiry: form.gphc_expiry || null,
      indemnity_provider: form.indemnity_provider.trim() || null, indemnity_expiry: form.indemnity_expiry || null,
      dbs_number: form.dbs_number.trim() || null, dbs_expiry: form.dbs_expiry || null,
    }).eq('id', locum.id)
    setBusy(null)
    if (e) { setError(e.message.includes('gphc_number_unique') ? 'That GPhC number is already registered to another PharmStation locum. Check the number, or contact support@pharmstation.co.uk.' : e.message); return }
    useAuthStore.setState({ locumProfile: { ...locum, gphc_number: form.gphc_number.trim() || null, gphc_expiry: form.gphc_expiry || null, indemnity_provider: form.indemnity_provider.trim() || null, indemnity_expiry: form.indemnity_expiry || null, dbs_number: form.dbs_number.trim() || null, dbs_expiry: form.dbs_expiry || null } })
    Alert.alert('Saved', 'Your details are saved. A change to your GPhC, DBS or indemnity goes back for a quick review.')
    void load()
  }

  const uploadDoc = async (docType: string, fromCamera: boolean) => {
    if (!userId) return
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access so you can add a photo of the document.'); return }
    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })
    if (picked.canceled || !picked.assets[0]) return
    const asset = picked.assets[0]
    setBusy(docType)
    setError(null)
    try {
      const mime = asset.mimeType || 'image/jpeg'
      const ext = mime === 'image/png' ? 'png' : 'jpg'
      const path = `${userId}/${docType}/${Date.now()}.${ext}`
      const bytes = await (await fetch(asset.uri)).arrayBuffer()
      const { error: upErr } = await userClient.storage.from('locum-documents').upload(path, bytes, { contentType: mime, upsert: true })
      if (upErr) throw upErr
      await userClient.from('ps_locum_documents').update({ is_current: false }).eq('locum_id', locum.id).eq('doc_type', docType)
      const { error: dbErr } = await userClient.from('ps_locum_documents').insert({ locum_id: locum.id, doc_type: docType, file_url: path, is_current: true })
      if (dbErr) throw dbErr
      await load()
    } catch (e) {
      setError(errorText(e, 'Upload failed.'))
    } finally {
      setBusy(null)
    }
  }

  const chooseUpload = (docType: string, label: string) => Alert.alert(label, 'Add a clear photo of the whole document. PDFs can be uploaded on pharmstation.co.uk.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Choose photo', onPress: () => void uploadDoc(docType, false) },
    { text: 'Take photo', onPress: () => void uploadDoc(docType, true) },
  ])

  const openFile = async (bucket: string, path: string) => {
    const { data, error: e } = await userClient.storage.from(bucket).createSignedUrl(path, 600)
    if (e || !data) { setError('Could not open the file.'); return }
    await Linking.openURL(data.signedUrl)
  }

  const toggleAlert = async (a: SavedSearch, on: boolean) => {
    setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, alerts_enabled: on } : x)))
    const { error: e } = await userClient.from('ps_locum_saved_searches').update({ alerts_enabled: on }).eq('id', a.id)
    if (e) { setError(e.message); void load() }
  }
  const deleteAlert = (a: SavedSearch) => Alert.alert('Delete this alert?', a.name, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const { error: e } = await userClient.from('ps_locum_saved_searches').delete().eq('id', a.id)
      if (e) setError(e.message); else setAlerts((prev) => prev.filter((x) => x.id !== a.id))
    } },
  ])

  const signSop = (sop: SopRow) => Alert.alert('Sign this SOP?', `By signing you confirm you have read and understood "${sop.title}" (version ${sop.version}).`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'I have read it', onPress: async () => {
      setBusy(sop.id)
      const { error: e } = await userClient.from('ps_locum_sop_signoffs').insert({ sop_id: sop.id, locum_id: locum.id, sop_version: sop.version, signed_at: new Date().toISOString() })
      setBusy(null)
      if (e) setError(e.message); else setSigned((prev) => new Set(prev).add(`${sop.id}:${sop.version}`))
    } },
  ])

  const s = STATUS_COPY[status.status] ?? STATUS_COPY.pending
  const unsigned = sops.filter((x) => !signed.has(`${x.id}:${x.version}`))

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={ACCENT} />}>
      <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: s.tone }]}>
        <Text style={styles.eyebrow}>COMPLIANCE</Text>
        <Text style={[styles.statusLabel, { color: s.tone }]}>{s.label}</Text>
        <Text style={styles.body}>{s.text}</Text>
        {status.notes && status.status !== 'approved' ? <Text style={styles.note}>Reviewer's note: {status.notes}</Text> : null}
      </View>

      {error ? <View style={styles.error}><Ionicons name="alert-circle" size={18} color={palette.danger} /><Text style={styles.errorText}>{error}</Text></View> : null}

      <Text style={styles.section}>Registration and insurance</Text>
      <View style={styles.card}>
        <Field label="GPhC number" value={form.gphc_number} onChange={(v) => setForm({ ...form, gphc_number: v })} keyboard="number-pad" />
        <Field label="GPhC renewal date" value={form.gphc_expiry} onChange={(v) => setForm({ ...form, gphc_expiry: v })} placeholder="YYYY-MM-DD" />
        <Field label="Indemnity provider" value={form.indemnity_provider} onChange={(v) => setForm({ ...form, indemnity_provider: v })} />
        <Field label="Indemnity expiry" value={form.indemnity_expiry} onChange={(v) => setForm({ ...form, indemnity_expiry: v })} placeholder="YYYY-MM-DD" />
        <Field label="DBS certificate number" value={form.dbs_number} onChange={(v) => setForm({ ...form, dbs_number: v })} />
        <Field label="DBS issue or expiry date" value={form.dbs_expiry} onChange={(v) => setForm({ ...form, dbs_expiry: v })} placeholder="YYYY-MM-DD" />
        <Pressable style={styles.primary} onPress={() => void saveDetails()} disabled={busy === 'details'}>
          {busy === 'details' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save details</Text>}
        </Pressable>
      </View>

      <Text style={styles.section}>Documents</Text>
      <View style={styles.card}>
        {DOC_TYPES.map((d) => {
          const doc = docs.find((x) => x.doc_type === d.type)
          return (
            <View key={d.type} style={styles.row}>
              <Ionicons name={doc ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={doc ? palette.success : palette.textMuted} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{d.label}</Text>
                <Text style={styles.meta}>{doc ? `Uploaded ${new Date(doc.uploaded_at).toLocaleDateString('en-GB')}` : 'Not uploaded'}</Text>
              </View>
              {doc ? <Pressable onPress={() => void openFile('locum-documents', doc.file_url)} style={styles.link}><Text style={styles.linkText}>View</Text></Pressable> : null}
              <Pressable onPress={() => chooseUpload(d.type, d.label)} style={styles.link} disabled={busy === d.type}>
                {busy === d.type ? <ActivityIndicator color={ACCENT} /> : <Text style={styles.linkText}>{doc ? 'Replace' : 'Upload'}</Text>}
              </Pressable>
            </View>
          )
        })}
      </View>

      <Text style={styles.section}>Shift alerts</Text>
      <View style={styles.card}>
        {alerts.length === 0 ? <Text style={styles.body}>No alerts yet. On Discover, set your filters and tap "Alert me" to get a notification when a matching shift is posted.</Text> : null}
        {alerts.map((a) => (
          <View key={a.id} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{a.name}</Text>
              <Text style={styles.meta}>{[a.query, a.minimum_rate ? `£${a.minimum_rate}+/hr` : null, a.date_filter === 'week' ? 'next 7 days' : a.date_filter === 'weekend' ? 'weekends' : null, a.eligible_only ? 'eligible only' : null].filter(Boolean).join(' · ') || 'Any shift'}</Text>
            </View>
            <Switch value={a.alerts_enabled} onValueChange={(on) => void toggleAlert(a, on)} trackColor={{ true: ACCENT }} />
            <Pressable onPress={() => deleteAlert(a)} accessibilityLabel={`Delete alert ${a.name}`} style={styles.link}><Ionicons name="trash-outline" size={19} color={palette.textMuted} /></Pressable>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Pharmacy SOPs {unsigned.length ? `(${unsigned.length} to sign)` : ''}</Text>
      <View style={styles.card}>
        {sops.length === 0 ? <Text style={styles.body}>When you book with a pharmacy, its standard operating procedures appear here to read and sign before your shift.</Text> : null}
        {sops.map((sop) => {
          const done = signed.has(`${sop.id}:${sop.version}`)
          return (
            <View key={sop.id} style={styles.row}>
              <Ionicons name={done ? 'checkmark-circle' : 'document-text-outline'} size={20} color={done ? palette.success : ACCENT} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{sop.title}</Text>
                <Text style={styles.meta}>{orgNames[sop.org_id] ?? 'Pharmacy'} · v{sop.version}{sop.is_required ? ' · required' : ''}</Text>
              </View>
              {sop.file_url ? <Pressable onPress={() => void openFile('sop-pdfs', sop.file_url!)} style={styles.link}><Text style={styles.linkText}>Read</Text></Pressable> : null}
              {!done ? <Pressable onPress={() => signSop(sop)} style={styles.link} disabled={busy === sop.id}><Text style={styles.linkText}>Sign</Text></Pressable> : null}
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function Field({ label, value, onChange, placeholder, keyboard }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboard?: 'number-pad' }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.textMuted} keyboardType={keyboard} autoCapitalize="none" style={styles.input} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 48, gap: 12 },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: 16, gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: palette.textMuted, letterSpacing: 0.8 },
  statusLabel: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, color: palette.textMuted, lineHeight: 20 },
  note: { fontSize: 14, color: palette.text, backgroundColor: ACCENT_TINT, padding: 10, borderRadius: radius.sm },
  section: { fontSize: 16, fontWeight: '700', color: palette.text, marginTop: 8 },
  error: { flexDirection: 'row', gap: 8, backgroundColor: palette.dangerTint, padding: 12, borderRadius: radius.md, alignItems: 'center' },
  errorText: { flex: 1, color: palette.danger, fontSize: 14 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.text },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: palette.text, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: palette.text },
  meta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  link: { paddingHorizontal: 8, paddingVertical: 6, minWidth: 44, alignItems: 'center' },
  linkText: { color: ACCENT, fontWeight: '700', fontSize: 14 },
})
