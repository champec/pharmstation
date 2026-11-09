import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  Switch,
  TextInput,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'

import { approveScanLine, canApproveCdScan, rejectScanLine, type SupplyDetails } from '@/lib/cd-scan-approval'
import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'
import { EmptyState as SharedEmptyState } from '@/components/ui/EmptyState'

const COLOR = '#D97706'
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!

type ScanStatus = 'uploading' | 'processing' | 'ready' | 'partially_approved' | 'fully_approved' | 'rejected' | 'error'

interface ScanQueueItem {
  id: string
  organisation_id: string
  image_path: string | null
  document_type: 'prescription' | 'invoice' | 'unknown' | null
  overall_confidence: 0 | 1 | 2 | 3 | null
  status: ScanStatus
  ai_notes: string | null
  error_message: string | null
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  patient_name: string | null
  patient_address: string | null
  prescriber_name: string | null
  prescriber_address: string | null
  prescriber_registration: string | null
  is_partial_supply: boolean
  handwritten_notes: string | null
  created_at: string
}

interface ScanDrugItem {
  id: string
  matched_drug_id: string | null
  drug_name_raw: string | null
  drug_form_raw: string | null
  drug_strength_raw: string | null
  quantity: number | null
  matched_drug_brand: string | null
  matched_drug_form: string | null
  matched_drug_strength: string | null
  confidence: number | null
  confidence_notes: string | null
  status: string
}

interface CapturedImage { uri: string; base64: string; mimeType: string }

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function addToScanQueue(organisationId: string, accessToken: string, image: CapturedImage) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
  const endpoint = `${SUPABASE_URL}/functions/v1/ai-scan`
  const uploadResponse = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify({ action: 'upload', organisation_id: organisationId }),
  })
  const upload = await uploadResponse.json()
  if (!uploadResponse.ok) throw new Error(upload.error ?? 'The scan could not be uploaded.')

  void fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ action: 'process', scan_id: upload.scan_id, organisation_id: organisationId, image_base64: image.base64, mime_type: image.mimeType }),
  }).catch(() => {})
  return upload.scan as ScanQueueItem
}

function DocumentScanScreen() {
  const organisation = useAuthStore((state) => state.organisation)
  const userSession = useAuthStore((state) => state.userSession)
  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [image, setImage] = useState<CapturedImage | null>(null)
  const [busy, setBusy] = useState(false)

  const openCamera = async () => {
    const granted = permission?.granted || (await requestPermission()).granted
    if (!granted) return Alert.alert('Camera access needed', 'Allow camera access to photograph the document.')
    setCameraOpen(true)
  }

  const takePhoto = async () => {
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.82 })
    if (!photo?.base64) return
    setImage({ uri: photo.uri, base64: photo.base64, mimeType: 'image/jpeg' })
    setCameraOpen(false)
  }

  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.82 })
    const asset = result.assets?.[0]
    if (!result.canceled && asset?.base64) setImage({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' })
  }

  const submit = async () => {
    if (!image || !organisation?.id || !userSession?.access_token) return
    setBusy(true)
    try {
      await addToScanQueue(organisation.id, userSession.access_token, image)
      setImage(null)
      Alert.alert('Added to review queue', 'The document is processing. A pharmacist or pharmacy technician must check and approve each line (in the Queue tab or on the web) before it goes in the CD register.')
    } catch (error) {
      Alert.alert('Upload failed', messageFrom(error))
    } finally { setBusy(false) }
  }

  if (cameraOpen) return (
    <View style={styles.cameraWrap}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.documentFrame} />
      <View style={styles.cameraActions}>
        <IconButton icon="close" label="Cancel" onPress={() => setCameraOpen(false)} />
        <Pressable style={styles.shutter} onPress={takePhoto} accessibilityLabel="Take photo"><View style={styles.shutterInner} /></Pressable>
        <View style={styles.actionSpacer} />
      </View>
    </View>
  )

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View><Text style={styles.heading}>Capture a document</Text><Text style={styles.subheading}>Prescriptions and invoices join the same review queue used on the web.</Text></View>
      {image ? (
        <View style={styles.previewPanel}>
          <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="contain" />
          <View style={styles.row}>
            <Button icon="refresh-outline" label="Retake" secondary onPress={() => setImage(null)} />
            <Button icon="cloud-upload-outline" label={busy ? 'Adding...' : 'Add to queue'} onPress={submit} disabled={busy} />
          </View>
        </View>
      ) : (
        <View style={styles.capturePanel}>
          <View style={styles.captureIcon}><Ionicons name="document-text-outline" size={34} color={COLOR} /></View>
          <Text style={styles.panelTitle}>Keep every corner visible</Text>
          <Text style={styles.panelText}>Use bright, even light and check that printed and handwritten text is sharp.</Text>
          <Button icon="camera-outline" label="Open camera" onPress={openCamera} />
          <Button icon="images-outline" label="Choose existing photo" secondary onPress={choosePhoto} />
        </View>
      )}
    </ScrollView>
  )
}

function ScanQueueScreen() {
  const organisation = useAuthStore((state) => state.organisation)
  const [scans, setScans] = useState<ScanQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ScanQueueItem | null>(null)
  const load = useCallback(async () => {
    if (!organisation?.id) return
    setLoading(true)
    const { data, error } = await userClient.from('ps_ai_scan_queue').select('*').eq('organisation_id', organisation.id).neq('status', 'fully_approved').order('created_at', { ascending: false }).limit(100)
    if (error) Alert.alert('Queue unavailable', error.message)
    else setScans((data as ScanQueueItem[]) ?? [])
    setLoading(false)
  }, [organisation?.id])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 8000)
    return () => clearInterval(timer)
  }, [load])

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLOR} />}>
        <View><Text style={styles.heading}>Review queue</Text><Text style={styles.subheading}>Open a scan to inspect the source details and extracted medicines.</Text></View>
        {!loading && scans.length === 0 ? <SharedEmptyState icon="checkmark-circle-outline" color={palette.success} title="Queue is clear" text="Scans waiting for review will appear here." /> : scans.map((scan) => <QueueRow key={scan.id} scan={scan} onPress={() => setSelected(scan)} />)}
      </ScrollView>
      <ScanDetail scan={selected} onClose={() => setSelected(null)} />
    </View>
  )
}

function QueueRow({ scan, onPress }: { scan: ScanQueueItem; onPress: () => void }) {
  const processing = scan.status === 'processing' || scan.status === 'uploading'
  const title = scan.document_type === 'invoice' ? (scan.supplier_name ? `Invoice - ${scan.supplier_name}` : 'Invoice') : scan.document_type === 'prescription' ? (scan.patient_name ? `Prescription - ${scan.patient_name}` : 'Prescription') : 'Document scan'
  return (
    <Pressable style={({ pressed }) => [styles.queueRow, pressed && styles.pressed]} onPress={onPress} disabled={processing}>
      <View style={[styles.statusIcon, { backgroundColor: statusColor(scan.status) + '18' }]}>{processing ? <ActivityIndicator color={statusColor(scan.status)} /> : <Ionicons name={scan.document_type === 'invoice' ? 'receipt-outline' : 'document-text-outline'} size={22} color={statusColor(scan.status)} />}</View>
      <View style={styles.flex}><Text style={styles.queueTitle} numberOfLines={1}>{processing ? 'Processing document...' : title}</Text><Text style={styles.queueMeta}>{scan.status.replaceAll('_', ' ')} · {new Date(scan.created_at).toLocaleString('en-GB')}</Text>{scan.ai_notes ? <Text style={styles.queueNote} numberOfLines={1}>{scan.ai_notes}</Text> : null}</View>
      {!processing ? <Ionicons name="chevron-forward" size={18} color={palette.textMuted} /> : null}
    </Pressable>
  )
}

function ScanDetail({ scan, onClose }: { scan: ScanQueueItem | null; onClose: () => void }) {
  const [items, setItems] = useState<ScanDrugItem[]>([])
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const membership = useAuthStore((state) => state.membership)
  const permissions = useAuthStore((state) => state.permissions)
  const profile = useAuthStore((state) => state.userProfile)
  const canApprove = !!permissions?.cd_register_write && canApproveCdScan(membership?.role, profile?.gphc_number)
  const reloadItems = useCallback(async () => {
    if (!scan) return
    const { data } = await userClient.from('ps_ai_scan_items').select('*').eq('scan_id', scan.id).order('created_at')
    setItems((data as ScanDrugItem[]) ?? [])
  }, [scan])
  useEffect(() => {
    if (!scan) return
    setLoading(true)
    Promise.all([
      userClient.from('ps_ai_scan_items').select('*').eq('scan_id', scan.id).order('created_at'),
      scan.image_path ? userClient.storage.from('scan-images').createSignedUrl(scan.image_path, 3600) : Promise.resolve({ data: null, error: null }),
    ]).then(([itemResult, imageResult]) => {
      setItems((itemResult.data as ScanDrugItem[]) ?? [])
      setImageUrl(imageResult.data?.signedUrl ?? null)
      setLoading(false)
    })
  }, [scan])

  return (
    <Modal visible={!!scan} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.modalHeader}><View style={styles.flex}><Text style={styles.heading}>Scan review</Text><Text style={styles.headerNote}>{canApprove ? 'Check each line against the document, then approve it into the CD register' : 'View only · a pharmacist or pharmacy technician must approve these lines'}</Text></View><IconButton icon="close" label="Close" onPress={onClose} /></View>
        {loading ? <ActivityIndicator style={styles.loader} color={COLOR} /> : scan ? (
          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
            {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.documentImage} resizeMode="contain" /> : null}
            <View style={styles.infoPanel}>
              <Text style={styles.sectionTitle}>{scan.document_type === 'invoice' ? 'Invoice details' : 'Prescription details'}</Text>
              {scan.document_type === 'invoice' ? <><Detail label="Supplier" value={scan.supplier_name} /><Detail label="Invoice number" value={scan.invoice_number} /><Detail label="Invoice date" value={scan.invoice_date} /></> : <><Detail label="Patient" value={scan.patient_name} /><Detail label="Patient address" value={scan.patient_address} /><Detail label="Prescriber" value={scan.prescriber_name} /><Detail label="Prescriber address" value={scan.prescriber_address} /><Detail label="Registration" value={scan.prescriber_registration} /></>}
              <Detail label="Handwritten notes" value={scan.handwritten_notes} /><Detail label="AI notes" value={scan.ai_notes} /><Detail label="Error" value={scan.error_message} />
            </View>
            <Text style={styles.sectionTitle}>Extracted medicines ({items.length})</Text>
            {items.map((item) => <ScanLine key={item.id} scan={scan} item={item} canApprove={canApprove} userId={profile?.id ?? null} onChanged={reloadItems} />)}
          </ScrollView>
        ) : null}
        <View style={styles.modalFooter}><Button icon="checkmark" label="Done" onPress={onClose} /></View>
      </SafeAreaView>
    </Modal>
  )
}

function ScanLine({ scan, item, canApprove, userId, onChanged }: { scan: ScanQueueItem; item: ScanDrugItem; canApprove: boolean; userId: string | null; onChanged: () => Promise<void> }) {
  const isSupply = scan.document_type !== 'invoice'
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : '')
  const [collector, setCollector] = useState<SupplyDetails['collectorType'] | ''>('')
  const [collectorName, setCollectorName] = useState('')
  const [idRequested, setIdRequested] = useState(false)
  const [idProvided, setIdProvided] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = item.status === 'pending'

  const approve = async () => {
    if (!userId) return
    if (isSupply && !collector) return setError('Choose who collected the medicine.')
    if (isSupply && collector !== 'patient' && !collectorName.trim()) return setError('Enter who collected it.')
    setBusy(true); setError(null)
    const result = await approveScanLine({
      scan, item, userId, quantity: Number(quantity.replace(',', '.')),
      supply: isSupply && collector ? { collectorType: collector, collectorDetails: collectorName, wasIdRequested: idRequested, wasIdProvided: idProvided } : undefined,
    })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setOpen(false)
    await onChanged()
  }
  const reject = async () => {
    if (!userId) return
    setBusy(true); setError(null)
    const result = await rejectScanLine(scan.id, item.id, userId)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    await onChanged()
  }

  return (
    <View style={styles.drugCard}>
      <View style={styles.rowBetween}><Text style={styles.drugName}>{item.matched_drug_brand ?? item.drug_name_raw ?? 'Unidentified medicine'}</Text><Text style={[styles.statusText, item.status === 'approved' && { color: palette.success }, item.status === 'rejected' && { color: palette.danger }]}>{item.status}</Text></View>
      <Text style={styles.panelText}>{[item.matched_drug_form ?? item.drug_form_raw, item.matched_drug_strength ?? item.drug_strength_raw].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.quantity}>Quantity: {item.quantity ?? 'Not read'} · Confidence: {item.confidence ?? 0}/3</Text>
      {item.confidence_notes ? <Text style={styles.queueNote}>{item.confidence_notes}</Text> : null}
      {canApprove && pending && !item.matched_drug_id ? <Text style={styles.queueNote}>No drug matched. Pick the drug on the web review screen.</Text> : null}
      {canApprove && pending && item.matched_drug_id && !open ? (
        <View style={styles.row}>
          <Button icon="close" label="Reject" secondary onPress={reject} disabled={busy} />
          <Button icon="checkmark" label="Check & approve" onPress={() => setOpen(true)} disabled={busy} />
        </View>
      ) : null}
      {open ? (
        <View style={styles.approveBox}>
          <Text style={styles.detailLabel}>{isSupply ? 'Quantity supplied' : 'Quantity received'}</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" accessibilityLabel="Quantity" />
          {isSupply ? (
            <>
              <Text style={styles.detailLabel}>Who collected it?</Text>
              <View style={styles.chips}>
                {([['patient', 'Patient'], ['representative', "Patient's representative"], ['hcp', 'Healthcare professional']] as const).map(([value, label]) => (
                  <Pressable key={value} onPress={() => setCollector(value)} style={[styles.chip, collector === value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: collector === value }}>
                    <Text style={[styles.chipText, collector === value && styles.chipTextOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {collector && collector !== 'patient' ? <TextInput style={styles.input} value={collectorName} onChangeText={setCollectorName} placeholder={collector === 'hcp' ? 'Name and address of the professional' : "Representative's name"} placeholderTextColor={palette.textMuted} /> : null}
              <View style={styles.switchRow}><Text style={styles.detailValue}>ID was asked for</Text><Switch value={idRequested} onValueChange={setIdRequested} accessibilityLabel="ID was asked for" /></View>
              <View style={styles.switchRow}><Text style={styles.detailValue}>ID was seen</Text><Switch value={idProvided} onValueChange={setIdProvided} accessibilityLabel="ID was seen" /></View>
            </>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.row}>
            <Button icon="arrow-back" label="Back" secondary onPress={() => { setOpen(false); setError(null) }} disabled={busy} />
            <Button icon="checkmark-done" label={busy ? 'Saving...' : 'Approve into register'} onPress={approve} disabled={busy} />
          </View>
        </View>
      ) : error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) { return value ? <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View> : null }
function statusColor(status: ScanStatus) { return status === 'error' || status === 'rejected' ? palette.danger : status === 'ready' || status === 'fully_approved' ? palette.success : COLOR }

function Button({ icon, label, onPress, secondary, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, (pressed || disabled) && styles.buttonDim]}><Ionicons name={icon} size={19} color={secondary ? COLOR : palette.textInverse} /><Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text></Pressable>
}
function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.iconButton} accessibilityLabel={label}><Ionicons name={icon} size={24} color={palette.text} /></Pressable> }

export const scanningScreens = { scan: DocumentScanScreen, queue: ScanQueueScreen }

const styles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingVertical: 12, gap: 14 }, heading: { fontSize: 22, fontWeight: '800', color: palette.text }, subheading: { marginTop: 4, color: palette.textMuted, lineHeight: 20 }, capturePanel: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: 20, gap: 12, alignItems: 'stretch' }, captureIcon: { width: 64, height: 64, alignSelf: 'center', borderRadius: radius.lg, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' }, panelTitle: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' }, panelText: { color: palette.textMuted, lineHeight: 20 }, button: { minHeight: 48, borderRadius: radius.md, backgroundColor: COLOR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14, flex: 1 }, buttonSecondary: { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FCD34D' }, buttonDim: { opacity: 0.55 }, buttonText: { color: palette.textInverse, fontWeight: '800' }, buttonTextSecondary: { color: '#92400E' }, previewPanel: { gap: 12 }, preview: { width: '100%', height: 430, borderRadius: radius.md, backgroundColor: '#111827' }, row: { flexDirection: 'row', gap: 10 }, rowBetween: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, cameraWrap: { flex: 1, marginHorizontal: -16, overflow: 'hidden' }, documentFrame: { position: 'absolute', left: 28, right: 28, top: '10%', bottom: '22%', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: radius.sm }, cameraActions: { position: 'absolute', left: 20, right: 20, bottom: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF' }, actionSpacer: { width: 44 }, iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' }, queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 13 }, pressed: { opacity: 0.65 }, statusIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }, queueTitle: { fontWeight: '800', color: palette.text, fontSize: 15 }, queueMeta: { color: palette.textMuted, fontSize: 12, marginTop: 3, textTransform: 'capitalize' }, headerNote: { color: palette.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 }, queueNote: { color: palette.textMuted, fontSize: 13, marginTop: 5, lineHeight: 18 }, empty: { paddingVertical: 70, gap: 10, alignItems: 'center' }, modal: { flex: 1, backgroundColor: palette.bg }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: palette.border }, modalFooter: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border }, loader: { flex: 1 }, detailScroll: { flex: 1 }, detailContent: { padding: 16, gap: 14, paddingBottom: 24 }, documentImage: { width: '100%', height: 360, backgroundColor: '#111827', borderRadius: radius.md }, infoPanel: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 15, gap: 10 }, sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.text }, detailRow: { gap: 2 }, detailLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700' }, detailValue: { color: palette.text, lineHeight: 20 }, drugCard: { padding: 14, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, gap: 6 }, drugName: { flex: 1, fontWeight: '800', color: palette.text }, statusText: { color: COLOR, fontSize: 12, fontWeight: '800', textTransform: 'capitalize' }, quantity: { color: palette.text, fontWeight: '700', fontSize: 13 }, approveBox: { gap: 8, marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border }, input: { minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 16, color: palette.text, backgroundColor: palette.surface }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, chipOn: { backgroundColor: COLOR, borderColor: COLOR }, chipText: { color: palette.text, fontWeight: '600' }, chipTextOn: { color: palette.textInverse }, switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }, errorText: { color: palette.danger, fontWeight: '600', lineHeight: 19 },
})
