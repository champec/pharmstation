import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera'
import { Ionicons } from '@expo/vector-icons'

import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const COLOR = '#0F766E'
const GS = '\u001d'

interface ParsedBarcode { gtin: string; expiry: string | null; batch: string | null; serial: string | null }
interface LookupResult {
  found: boolean
  gtin: string
  matched_gtin?: string
  message?: string
  historical?: boolean
  pack?: { nm: string; legal_catcd: string | null }
  product?: { nm: string } | null
  virtual_pack?: { nm: string; qtyval: number | null; qty_uomcd: string | null } | null
  catalogue_match?: { drug_brand: string | null; drug_class: string | null; drug_form: string | null; drug_strength: string | null } | null
  organisation_register?: { id: string; drug_id: string } | null
  ledger?: { current_balance: number; is_active: boolean; entry_count: number } | null
}

function normalizeExpiry(value: string | null) {
  if (!value || !/^\d{6}$/.test(value)) return null
  const year = 2000 + Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  let day = Number(value.slice(4, 6))
  if (month < 1 || month > 12) return null
  if (day === 0) day = new Date(year, month, 0).getDate()
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null
}

function parseBarcode(raw: string): ParsedBarcode {
  const payload = raw.trim().replace(/^\]d2/, '')
  const parenthesized = payload.match(/\(01\)\s*(\d{14})/)
  if (parenthesized) return {
    gtin: parenthesized[1],
    expiry: normalizeExpiry(payload.match(/\(17\)\s*(\d{6})/)?.[1] ?? null),
    batch: payload.match(/\(10\)\s*([^()\u001d]+)/)?.[1]?.trim() ?? null,
    serial: payload.match(/\(21\)\s*([^()\u001d]+)/)?.[1]?.trim() ?? null,
  }
  const simple = payload.replace(/[\s-]/g, '')
  if (/^\d{13,14}$/.test(simple)) return { gtin: simple, expiry: null, batch: null, serial: null }
  const gtin = payload.match(/(?:^|\u001d)01(\d{14})/)
  if (!gtin) throw new Error('No GTIN medicine identifier was found.')
  const read = (ai: string) => payload.match(new RegExp(`(?:^|${GS})${ai}([^${GS}]+)`))?.[1] ?? null
  return { gtin: gtin[1], expiry: normalizeExpiry(payload.match(/17(\d{6})/)?.[1] ?? null), batch: read('10'), serial: read('21') }
}

function hasValidCheckDigit(gtin: string) {
  const digits = gtin.split('').map(Number)
  const check = digits.pop()
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  return check !== undefined && (10 - (sum % 10)) % 10 === check
}

function ProductScannerScreen() {
  const organisation = useAuthStore((state) => state.organisation)
  const [permission, requestPermission] = useCameraPermissions()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [parsed, setParsed] = useState<ParsedBarcode | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [busy, setBusy] = useState(false)

  const startCamera = async () => {
    const granted = permission?.granted || (await requestPermission()).granted
    if (!granted) return Alert.alert('Camera access needed', 'Allow camera access to scan a medicine pack.')
    setResult(null)
    setCameraOpen(true)
  }

  const lookup = async (raw: string) => {
    if (busy || !organisation?.id) return
    setBusy(true)
    setCameraOpen(false)
    try {
      const barcode = parseBarcode(raw)
      if (!hasValidCheckDigit(barcode.gtin)) throw new Error('The GTIN check digit is invalid.')
      setParsed(barcode)
      const { data, error } = await userClient.functions.invoke('barcode-lookup', { body: { organisation_id: organisation.id, gtin: barcode.gtin } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setResult(data as LookupResult)
    } catch (error) {
      Alert.alert('Barcode not recognised', error instanceof Error ? error.message : 'Lookup failed.')
    } finally { setBusy(false) }
  }

  const onScanned = ({ data }: BarcodeScanningResult) => void lookup(data)

  if (cameraOpen) return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={busy ? undefined : onScanned}
        barcodeScannerSettings={{ barcodeTypes: ['datamatrix', 'qr', 'code128', 'ean13', 'ean8', 'upc_a', 'upc_e'] }}
      />
      <View style={styles.scanFrame}><View style={styles.scanLine} /></View>
      <Pressable style={styles.close} onPress={() => setCameraOpen(false)} accessibilityLabel="Close camera"><Ionicons name="close" size={26} color={palette.text} /></Pressable>
      <Text style={styles.cameraHint}>Hold the pack code inside the frame</Text>
    </View>
  )

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View><Text style={styles.heading}>Medicine pack lookup</Text><Text style={styles.subheading}>Demonstration scanner using the same dm+d lookup as the web app.</Text></View>
      <Pressable style={styles.scanButton} onPress={startCamera}><Ionicons name="scan-outline" size={24} color={palette.textInverse} /><Text style={styles.scanButtonText}>Scan product barcode</Text></Pressable>
      <View style={styles.manualRow}><TextInput value={manual} onChangeText={setManual} style={styles.input} keyboardType="number-pad" placeholder="Enter a 13 or 14 digit GTIN" placeholderTextColor={palette.textMuted} /><Pressable style={styles.lookupButton} onPress={() => void lookup(manual)} disabled={busy}><Ionicons name="search" size={21} color={palette.textInverse} /></Pressable></View>
      {busy ? <ActivityIndicator size="large" color={COLOR} style={styles.loading} /> : null}
      {parsed && result ? <ResultCard parsed={parsed} result={result} /> : null}
    </ScrollView>
  )
}

function ResultCard({ parsed, result }: { parsed: ParsedBarcode; result: LookupResult }) {
  return (
    <View style={styles.result}>
      <View style={styles.resultHeader}><View style={[styles.resultIcon, { backgroundColor: result.found ? '#CCFBF1' : palette.dangerTint }]}><Ionicons name={result.found ? 'checkmark' : 'help'} size={25} color={result.found ? COLOR : palette.danger} /></View><View style={styles.flex}><Text style={styles.resultTitle}>{result.found ? result.pack?.nm ?? result.product?.nm ?? 'Medicine identified' : 'No match found'}</Text><Text style={styles.gtin}>GTIN {result.matched_gtin ?? result.gtin}</Text></View></View>
      {result.message ? <Text style={styles.message}>{result.message}</Text> : null}
      <Field label="Product" value={result.product?.nm} />
      <Field label="Virtual pack" value={result.virtual_pack?.nm} />
      <Field label="Catalogue match" value={[result.catalogue_match?.drug_brand, result.catalogue_match?.drug_form, result.catalogue_match?.drug_strength].filter(Boolean).join(' · ')} />
      <Field label="Expiry" value={parsed.expiry} />
      <Field label="Batch" value={parsed.batch} />
      <Field label="Serial" value={parsed.serial} />
      <Field label="CD register" value={result.organisation_register ? 'Subscribed at this pharmacy' : 'Not subscribed'} />
      <Field label="Current balance" value={result.ledger ? String(result.ledger.current_balance) : null} />
      {result.historical ? <Text style={styles.warning}>This is a historical dm+d pack mapping.</Text> : null}
      <Text style={styles.disclaimer}>Result is for demonstration only</Text>
    </View>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) { return value ? <View style={styles.field}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View> : null }

export const productScannerScreens = { scan: ProductScannerScreen }

const styles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingVertical: 12, gap: 14 }, heading: { fontSize: 22, fontWeight: '800', color: palette.text }, subheading: { color: palette.textMuted, lineHeight: 20, marginTop: 4 }, scanButton: { minHeight: 58, borderRadius: radius.md, backgroundColor: COLOR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, scanButtonText: { color: palette.textInverse, fontWeight: '800', fontSize: 16 }, manualRow: { flexDirection: 'row', gap: 8 }, input: { flex: 1, minHeight: 48, paddingHorizontal: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, color: palette.text }, lookupButton: { width: 50, borderRadius: radius.md, backgroundColor: COLOR, alignItems: 'center', justifyContent: 'center' }, loading: { marginTop: 40 }, cameraWrap: { flex: 1, marginHorizontal: -16, overflow: 'hidden' }, scanFrame: { position: 'absolute', left: 30, right: 30, top: '30%', height: 190, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: radius.md, justifyContent: 'center' }, scanLine: { height: 2, backgroundColor: '#2DD4BF', marginHorizontal: 12 }, close: { position: 'absolute', top: 18, right: 18, width: 46, height: 46, borderRadius: 23, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' }, cameraHint: { position: 'absolute', bottom: 42, alignSelf: 'center', color: '#FFFFFF', fontWeight: '800', backgroundColor: palette.overlay, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill }, result: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: 16, gap: 12 }, resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, resultIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }, resultTitle: { color: palette.text, fontSize: 17, fontWeight: '800' }, gtin: { color: palette.textMuted, fontSize: 12, marginTop: 3 }, message: { color: palette.textMuted, lineHeight: 20 }, field: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 9 }, label: { color: palette.textMuted, fontSize: 12, fontWeight: '700' }, value: { color: palette.text, marginTop: 2, lineHeight: 20 }, warning: { color: '#92400E', backgroundColor: '#FEF3C7', padding: 10, borderRadius: radius.sm }, disclaimer: { color: palette.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'center', paddingTop: 4 },
})