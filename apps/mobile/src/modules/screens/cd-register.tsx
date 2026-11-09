// ============================================
// CD Register (mobile)
//
// Same rules as the web register; the database enforces them:
//  - entries are made only through ps_make_register_entry (numbered, signed,
//    immutable, optimistic lock on the ledger)
//  - adding a drug goes through ps_create_cd_register (signed opening balance)
//  - read / write / correct come from the member's permissions
// Corrections and balance adjustments are done on the web, where the full
// history is on screen.
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { SafeAreaView } from 'react-native-safe-area-context'

import { Field } from '@/components/ui/Field'
import { userClient } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { palette, radius } from '@/theme/palette'

const COLOR = '#DC2626'

// ---------- types ----------

interface CdRegister {
  drug_id: string
  drug_brand: string
  drug_form: string
  drug_strength: string
  drug_class: string
  ledger_id: string | null
  current_balance: number
  lock_version: number
  entry_count: number
}

interface CdEntry {
  id: string
  entry_number: number
  entry_type: string
  transaction_type: string | null
  date_of_transaction: string
  quantity_received: number | null
  quantity_deducted: number | null
  running_balance: number | null
  supplier_name: string | null
  invoice_number: string | null
  patient_name: string | null
  prescriber_name: string | null
  collector_type: string | null
  collector_details: string | null
  was_id_requested: boolean | null
  was_id_provided: boolean | null
  notes: string | null
  source: string | null
  corrects_entry_id: string | null
  correction_reason: string | null
  entered_at: string | null
  entered_by_profile: { full_name: string | null } | null
}

interface DrugOption {
  id: string
  drug_brand: string | null
  drug_form: string | null
  drug_strength: string | null
  drug_class: string | null
}

// ---------- helpers ----------

/** Today's date in the UK (Europe/London), as YYYY-MM-DD. */
export function ukToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

function fmtQty(n: number | null | undefined) {
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function friendlyError(message: string) {
  if (message.includes('CONFLICT')) return 'Someone else made an entry on this register a moment ago. It has been refreshed, so check the balance and try again.'
  if (message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('negative')) return 'That would take the balance below zero. Check the quantity.'
  return message
}

const COLLECTORS: { value: 'patient' | 'representative' | 'hcp'; label: string }[] = [
  { value: 'patient', label: 'Patient' },
  { value: 'representative', label: "Patient's representative" },
  { value: 'hcp', label: 'Healthcare professional' },
]

function entryTitle(e: CdEntry) {
  if (e.entry_type === 'correction') return 'Correction'
  switch (e.transaction_type) {
    case 'opening_balance': return 'Opening balance'
    case 'receipt': return e.supplier_name ? `Received from ${e.supplier_name}` : 'Received'
    case 'supply': return e.patient_name ? `Supplied to ${e.patient_name}` : 'Supplied'
    case 'balance_check': return e.notes?.includes('Discrepancy') ? 'Balance check: discrepancy' : e.notes?.includes('Adjusted') ? 'Balance check: adjusted' : 'Balance check: matched'
    case 'return_to_supplier': return 'Returned to supplier'
    case 'disposal': return 'Destroyed'
    case 'patient_return': return 'Patient return'
    case 'transfer_in': return 'Transfer in'
    case 'transfer_out': return 'Transfer out'
    default: return 'Entry'
  }
}

// ---------- data ----------

async function loadRegisters(orgId: string): Promise<CdRegister[]> {
  const [subs, ledgers] = await Promise.all([
    userClient
      .from('ps_subscribed_registers')
      .select('drug_id, drug_brand, drug_form, drug_strength, drug_class')
      .eq('organisation_id', orgId),
    userClient
      .from('ps_register_ledgers')
      .select('id, drug_id, current_balance, lock_version, entry_count')
      .eq('organisation_id', orgId)
      .eq('register_type', 'CD'),
  ])
  if (subs.error) throw subs.error
  if (ledgers.error) throw ledgers.error
  const byDrug = new Map((ledgers.data ?? []).map((l) => [l.drug_id as string, l]))
  return (subs.data ?? [])
    .map((s) => {
      const l = byDrug.get(s.drug_id as string)
      return {
        drug_id: s.drug_id as string,
        drug_brand: (s.drug_brand as string) || 'Unnamed drug',
        drug_form: (s.drug_form as string) ?? '',
        drug_strength: (s.drug_strength as string) ?? '',
        drug_class: (s.drug_class as string) ?? '',
        ledger_id: (l?.id as string) ?? null,
        current_balance: Number(l?.current_balance ?? 0),
        lock_version: Number(l?.lock_version ?? 0),
        entry_count: Number(l?.entry_count ?? 0),
      }
    })
    .sort((a, b) => a.drug_class.localeCompare(b.drug_class) || a.drug_brand.localeCompare(b.drug_brand))
}

async function loadLedger(ledgerId: string) {
  const { data, error } = await userClient
    .from('ps_register_ledgers')
    .select('id, current_balance, lock_version, entry_count')
    .eq('id', ledgerId)
    .single()
  if (error) throw error
  return data as { id: string; current_balance: number; lock_version: number; entry_count: number }
}

// ---------- screens ----------

function CdRegisterScreen() {
  const organisation = useAuthStore((s) => s.organisation)
  const permissions = useAuthStore((s) => s.permissions)
  const canRead = !!permissions?.cd_register_read
  const canWrite = !!permissions?.cd_register_write

  const [registers, setRegisters] = useState<CdRegister[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openDrugId, setOpenDrugId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!organisation?.id || !canRead) { setLoading(false); return }
    setLoading(true)
    try {
      setRegisters(await loadRegisters(organisation.id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the register.')
    } finally {
      setLoading(false)
    }
  }, [organisation?.id, canRead])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return registers
    return registers.filter((r) =>
      [r.drug_brand, r.drug_class, r.drug_form, r.drug_strength].join(' ').toLowerCase().includes(q),
    )
  }, [registers, query])

  const open = registers.find((r) => r.drug_id === openDrugId) ?? null

  if (!canRead) {
    return (
      <View style={styles.centre}>
        <Ionicons name="lock-closed-outline" size={36} color={palette.textMuted} />
        <Text style={styles.emptyTitle}>You can't view the CD register</Text>
        <Text style={styles.muted}>Ask the pharmacy owner or manager to give you CD register access.</Text>
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLOR} />}
      >
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.heading}>CD register</Text>
            <Text style={styles.muted}>{registers.length} {registers.length === 1 ? 'drug' : 'drugs'} on your register</Text>
          </View>
          {canWrite ? (
            <Pressable style={styles.addButton} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Add a drug to the register">
              <Ionicons name="add" size={20} color={palette.textInverse} />
              <Text style={styles.addButtonText}>Add drug</Text>
            </Pressable>
          ) : null}
        </View>

        {!canWrite ? <Banner text="You can view the register but not make entries." /> : null}

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search drug, class or strength"
            placeholderTextColor={palette.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>

        {error ? <Banner tone="danger" text={error} /> : null}

        {!loading && filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={36} color={palette.textMuted} />
            <Text style={styles.emptyTitle}>{registers.length === 0 ? 'No drugs on your register yet' : 'No matches'}</Text>
            {registers.length === 0 && canWrite ? <Text style={styles.muted}>Tap “Add drug” to start a register with an opening balance.</Text> : null}
          </View>
        ) : (
          filtered.map((r) => (
            <Pressable
              key={r.drug_id}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              onPress={() => setOpenDrugId(r.drug_id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.drug_brand}, balance ${fmtQty(r.current_balance)}`}
            >
              <View style={styles.flex}>
                <Text style={styles.cardTitle} numberOfLines={1}>{r.drug_brand}</Text>
                <Text style={styles.muted} numberOfLines={1}>{[r.drug_class, r.drug_strength, r.drug_form].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.balanceLabel}>Balance</Text>
                <Text style={styles.balance}>{r.ledger_id ? fmtQty(r.current_balance) : '—'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <LedgerModal register={open} onClose={() => setOpenDrugId(null)} onChanged={load} />
      <AddRegisterModal existing={registers.map((r) => r.drug_id)} visible={adding} onClose={() => setAdding(false)} onAdded={async (drugId) => { setAdding(false); await load(); setOpenDrugId(drugId) }} />
    </View>
  )
}

// ---------- ledger ----------

function LedgerModal({ register, onClose, onChanged }: { register: CdRegister | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const organisation = useAuthStore((s) => s.organisation)
  const permissions = useAuthStore((s) => s.permissions)
  const canWrite = !!permissions?.cd_register_write

  const [ledger, setLedger] = useState<{ id: string; current_balance: number; lock_version: number; entry_count: number } | null>(null)
  const [entries, setEntries] = useState<CdEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<'in' | 'out' | 'check' | null>(null)
  const [selected, setSelected] = useState<CdEntry | null>(null)

  const refresh = useCallback(async () => {
    if (!register?.ledger_id) return
    setLoading(true)
    try {
      const [l, e] = await Promise.all([
        loadLedger(register.ledger_id),
        userClient
          .from('ps_register_entries')
          .select('*, entered_by_profile:entered_by(full_name)')
          .eq('ledger_id', register.ledger_id)
          .order('entry_number', { ascending: false })
          .limit(200),
      ])
      if (e.error) throw e.error
      setLedger(l)
      setEntries((e.data as CdEntry[]) ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load entries.')
    } finally {
      setLoading(false)
    }
  }, [register?.ledger_id])

  useEffect(() => {
    if (register) { setLedger(null); setEntries([]); void refresh() }
  }, [register, refresh])

  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (!register) setNotice(null) }, [register])
  const afterSave = async (message?: string) => {
    setForm(null)
    setNotice(message ?? 'Entry saved.')
    await refresh()
    await onChanged()
  }

  const corrected = useMemo(() => new Set(entries.map((e) => e.corrects_entry_id).filter(Boolean) as string[]), [entries])

  return (
    <Modal visible={!!register} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.modalHeader}>
          <View style={styles.flex}>
            <Text style={styles.heading} numberOfLines={1}>{register?.drug_brand}</Text>
            <Text style={styles.muted} numberOfLines={1}>{[register?.drug_class, register?.drug_strength, register?.drug_form].filter(Boolean).join(' · ')}</Text>
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>

        <ScrollView
          contentContainerStyle={styles.modalContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLOR} />}
        >
          {!register?.ledger_id ? (
            <Banner text="This drug has no register yet. Add it again from the list to record an opening balance." />
          ) : (
            <>
              <View style={styles.balancePanel}>
                <Text style={styles.balanceLabel}>Running balance</Text>
                <Text style={styles.bigBalance}>{ledger ? fmtQty(ledger.current_balance) : '…'}</Text>
                <Text style={styles.muted}>{ledger ? `${ledger.entry_count} ${ledger.entry_count === 1 ? 'entry' : 'entries'}` : ' '}</Text>
              </View>

              {canWrite && ledger ? (
                <View style={styles.actions}>
                  <ActionButton icon="arrow-down-circle-outline" label="Receive" onPress={() => setForm('in')} />
                  <ActionButton icon="arrow-up-circle-outline" label="Supply" onPress={() => setForm('out')} />
                  <ActionButton icon="checkmark-done-outline" label="Check balance" onPress={() => setForm('check')} />
                </View>
              ) : null}

              {notice ? <Banner tone={notice.startsWith('Discrepancy') ? 'danger' : 'success'} text={notice} /> : null}
              {error ? <Banner tone="danger" text={error} /> : null}

              <Text style={styles.sectionTitle}>Entries</Text>
              {entries.length === 0 && !loading ? <Text style={styles.muted}>No entries yet.</Text> : null}
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} isCorrected={corrected.has(e.id)} onPress={() => setSelected(e)} />
              ))}
              <Text style={styles.footnote}>Corrections and balance adjustments are made on the web register.</Text>
            </>
          )}
        </ScrollView>

        {register && ledger && organisation ? (
          <>
            <EntryFormModal
              visible={form === 'in' || form === 'out'}
              direction={form === 'out' ? 'out' : 'in'}
              register={register}
              ledger={ledger}
              onClose={() => setForm(null)}
              onSaved={() => afterSave()}
              onConflict={refresh}
            />
            <BalanceCheckModal
              visible={form === 'check'}
              organisationId={organisation.id}
              register={register}
              ledger={ledger}
              onClose={() => setForm(null)}
              onSaved={afterSave}
              onConflict={refresh}
            />
          </>
        ) : null}
        <EntryDetailModal entry={selected} onClose={() => setSelected(null)} />
      </SafeAreaView>
    </Modal>
  )
}

function EntryRow({ entry, isCorrected, onPress }: { entry: CdEntry; isCorrected: boolean; onPress: () => void }) {
  const inQty = entry.quantity_received
  const outQty = entry.quantity_deducted
  return (
    <Pressable style={({ pressed }) => [styles.entry, isCorrected && styles.entryCorrected, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      <View style={styles.entryNumber}><Text style={styles.entryNumberText}>{entry.entry_number}</Text></View>
      <View style={styles.flex}>
        <Text style={[styles.entryTitle, isCorrected && styles.strike]} numberOfLines={1}>{entryTitle(entry)}</Text>
        <Text style={styles.entryMeta} numberOfLines={1}>
          {fmtDate(entry.date_of_transaction)} · {entry.entered_by_profile?.full_name ?? 'Unknown'}{entry.source === 'ai_scan' ? ' · scan' : ''}
        </Text>
      </View>
      <View style={styles.entryQty}>
        {inQty ? <Text style={styles.qtyIn}>+{fmtQty(inQty)}</Text> : null}
        {outQty ? <Text style={styles.qtyOut}>−{fmtQty(outQty)}</Text> : null}
        <Text style={styles.entryBalance}>{fmtQty(entry.running_balance)}</Text>
      </View>
    </Pressable>
  )
}

function EntryDetailModal({ entry, onClose }: { entry: CdEntry | null; onClose: () => void }) {
  return (
    <Modal visible={!!entry} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.modalHeader}>
          <View style={styles.flex}>
            <Text style={styles.heading}>Entry {entry?.entry_number}</Text>
            <Text style={styles.muted}>{entry ? entryTitle(entry) : ''}</Text>
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        {entry ? (
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.panel}>
              <Detail label="Date" value={fmtDate(entry.date_of_transaction)} />
              <Detail label="Received" value={entry.quantity_received ? fmtQty(entry.quantity_received) : null} />
              <Detail label="Supplied" value={entry.quantity_deducted ? fmtQty(entry.quantity_deducted) : null} />
              <Detail label="Balance after" value={fmtQty(entry.running_balance)} />
              <Detail label="Supplier" value={entry.supplier_name} />
              <Detail label="Invoice" value={entry.invoice_number} />
              <Detail label="Patient" value={entry.patient_name} />
              <Detail label="Prescriber" value={entry.prescriber_name} />
              <Detail label="Collected by" value={entry.collector_type ? `${COLLECTORS.find((c) => c.value === entry.collector_type)?.label ?? entry.collector_type}${entry.collector_details ? ` — ${entry.collector_details}` : ''}` : null} />
              <Detail label="ID asked for" value={entry.was_id_requested == null || entry.transaction_type !== 'supply' ? null : entry.was_id_requested ? 'Yes' : 'No'} />
              <Detail label="ID seen" value={entry.was_id_provided == null || entry.transaction_type !== 'supply' ? null : entry.was_id_provided ? 'Yes' : 'No'} />
              <Detail label="Correction reason" value={entry.correction_reason} />
              <Detail label="Notes" value={entry.notes} />
              <Detail label="Entered by" value={entry.entered_by_profile?.full_name ?? null} />
              <Detail label="Recorded at" value={entry.entered_at ? new Date(entry.entered_at).toLocaleString('en-GB') : null} />
            </View>
            <Text style={styles.footnote}>Register entries can't be edited or deleted. A pharmacist corrects mistakes on the web register.</Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

// ---------- receive / supply ----------

function EntryFormModal({
  visible, direction, register, ledger, onClose, onSaved, onConflict,
}: {
  visible: boolean
  direction: 'in' | 'out'
  register: CdRegister
  ledger: { id: string; current_balance: number; lock_version: number }
  onClose: () => void
  onSaved: () => Promise<void>
  onConflict: () => Promise<void>
}) {
  const profile = useAuthStore((s) => s.userProfile)
  const [date, setDate] = useState(ukToday())
  const [quantity, setQuantity] = useState('')
  const [supplier, setSupplier] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [invoice, setInvoice] = useState('')
  const [patient, setPatient] = useState('')
  const [patientAddress, setPatientAddress] = useState('')
  const [prescriber, setPrescriber] = useState('')
  const [prescriberAddress, setPrescriberAddress] = useState('')
  const [collectorType, setCollectorType] = useState<'patient' | 'representative' | 'hcp' | ''>('')
  const [collectorName, setCollectorName] = useState('')
  const [idRequested, setIdRequested] = useState(false)
  const [idProvided, setIdProvided] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setDate(ukToday()); setQuantity(''); setSupplier(''); setSupplierAddress(''); setInvoice('')
    setPatient(''); setPatientAddress(''); setPrescriber(''); setPrescriberAddress('')
    setCollectorType(''); setCollectorName(''); setIdRequested(false); setIdProvided(false); setNotes(''); setError(null)
  }, [visible, direction])

  const isIn = direction === 'in'

  const save = async () => {
    const qty = Number(quantity.replace(',', '.'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Enter the date as YYYY-MM-DD.')
    if (date > ukToday()) return setError("The date can't be in the future.")
    if (!Number.isFinite(qty) || qty <= 0) return setError('Enter a quantity greater than 0.')
    if (isIn && !supplier.trim()) return setError('Enter the supplier.')
    if (!isIn && !patient.trim()) return setError("Enter the patient's name.")
    if (!isIn && !prescriber.trim()) return setError("Enter the prescriber's name.")
    if (!isIn && qty > ledger.current_balance) return setError(`Only ${fmtQty(ledger.current_balance)} in stock on the register.`)
    if (!isIn && collectorType && collectorType !== 'patient' && !collectorName.trim()) return setError('Enter who collected it.')

    setSaving(true)
    setError(null)
    const { error: rpcError } = await userClient.rpc('ps_make_register_entry', {
      p_ledger_id: ledger.id,
      p_register_type: 'CD',
      p_entry_type: 'normal',
      p_date_of_transaction: date,
      p_notes: notes.trim() || null,
      p_source: 'manual',
      p_expected_lock_version: ledger.lock_version,
      p_transaction_type: isIn ? 'receipt' : 'supply',
      p_quantity_received: isIn ? qty : null,
      p_quantity_deducted: isIn ? null : qty,
      p_authorised_by: profile?.full_name ?? null,
      p_supplier_name: isIn ? supplier.trim() : null,
      p_supplier_address: isIn ? supplierAddress.trim() || null : null,
      p_invoice_number: isIn ? invoice.trim() || null : null,
      p_patient_name: isIn ? null : patient.trim(),
      p_patient_address: isIn ? null : patientAddress.trim() || null,
      p_prescriber_name: isIn ? null : prescriber.trim(),
      p_prescriber_address: isIn ? null : prescriberAddress.trim() || null,
      p_collector_type: isIn ? null : collectorType || null,
      p_collector_details: isIn ? null : collectorName.trim() || null,
      p_was_id_requested: isIn ? null : idRequested,
      p_was_id_provided: isIn ? null : idProvided,
    })
    setSaving(false)
    if (rpcError) {
      if (rpcError.message.includes('CONFLICT')) await onConflict()
      return setError(friendlyError(rpcError.message))
    }
    await onSaved()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.heading}>{isIn ? 'Receive stock' : 'Supply to patient'}</Text>
              <Text style={styles.muted} numberOfLines={1}>{register.drug_brand} · balance {fmtQty(ledger.current_balance)}</Text>
            </View>
            <IconButton icon="close" label="Cancel" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <Field label={isIn ? 'Quantity received' : 'Quantity supplied'} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="0" />
            {isIn ? (
              <>
                <Field label="Supplier" value={supplier} onChangeText={setSupplier} placeholder="e.g. Alliance Healthcare" />
                <Field label="Supplier address (optional)" value={supplierAddress} onChangeText={setSupplierAddress} />
                <Field label="Invoice number (optional)" value={invoice} onChangeText={setInvoice} autoCapitalize="characters" />
              </>
            ) : (
              <>
                <Field label="Patient name" value={patient} onChangeText={setPatient} autoCapitalize="words" />
                <Field label="Patient address (optional)" value={patientAddress} onChangeText={setPatientAddress} />
                <Field label="Prescriber name" value={prescriber} onChangeText={setPrescriber} autoCapitalize="words" />
                <Field label="Prescriber address (optional)" value={prescriberAddress} onChangeText={setPrescriberAddress} />
                <Text style={styles.fieldLabel}>Who collected it?</Text>
                <View style={styles.chips}>
                  {COLLECTORS.map((c) => (
                    <Pressable
                      key={c.value}
                      onPress={() => setCollectorType(collectorType === c.value ? '' : c.value)}
                      style={[styles.chip, collectorType === c.value && styles.chipOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: collectorType === c.value }}
                    >
                      <Text style={[styles.chipText, collectorType === c.value && styles.chipTextOn]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {collectorType && collectorType !== 'patient' ? (
                  <Field label={collectorType === 'hcp' ? 'Name and address of the professional' : "Representative's name"} value={collectorName} onChangeText={setCollectorName} />
                ) : null}
                <Toggle label="ID was asked for" value={idRequested} onChange={setIdRequested} />
                <Toggle label="ID was seen" value={idProvided} onChange={setIdProvided} />
              </>
            )}
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline style={styles.notes} />
            {error ? <Banner tone="danger" text={error} /> : null}
          </ScrollView>
          <View style={styles.modalFooter}>
            <PrimaryButton label={saving ? 'Saving…' : isIn ? 'Record receipt' : 'Record supply'} onPress={save} disabled={saving} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ---------- balance check ----------

function BalanceCheckModal({
  visible, organisationId, register, ledger, onClose, onSaved, onConflict,
}: {
  visible: boolean
  organisationId: string
  register: CdRegister
  ledger: { id: string; current_balance: number; lock_version: number }
  onClose: () => void
  onSaved: (message?: string) => Promise<void>
  onConflict: () => Promise<void>
}) {
  const profile = useAuthStore((s) => s.userProfile)
  const [count, setCount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (visible) { setCount(''); setNotes(''); setError(null) } }, [visible])

  const counted = count.trim() === '' ? NaN : Number(count.replace(',', '.'))
  const diff = Number.isFinite(counted) ? counted - ledger.current_balance : null

  const save = async () => {
    if (!profile) return
    if (!Number.isFinite(counted) || counted < 0) return setError('Enter the physical count (0 or more).')
    if (diff !== 0 && !notes.trim()) return setError("The count doesn't match. Add a note about what you've checked.")
    setSaving(true)
    setError(null)
    const matched = diff === 0
    const status = matched ? 'matched' : 'discrepancy'
    const who = `${profile.full_name}${profile.gphc_number ? ` (GPhC: ${profile.gphc_number})` : ''}`
    const note = matched
      ? `Balance checked and verified — ${who}`
      : `Balance check — Discrepancy of ${fmtQty(diff)}. ${notes.trim()}. ${who}`
    const now = new Date().toISOString()

    const { data: session, error: sErr } = await userClient
      .from('ps_balance_check_sessions')
      .insert({
        organisation_id: organisationId,
        started_by: profile.id,
        status: 'completed',
        total_registers: 1,
        checked_count: 1,
        discrepancy_count: matched ? 0 : 1,
        notes: `Quick balance check (mobile) — ${register.drug_brand}`,
        completed_at: now,
        completed_by: profile.id,
      })
      .select('id')
      .single()
    if (sErr || !session) { setSaving(false); return setError(`Could not save the check: ${sErr?.message ?? 'unknown error'}`) }

    const { error: iErr } = await userClient.from('ps_balance_check_items').insert({
      session_id: session.id,
      organisation_id: organisationId,
      ledger_id: ledger.id,
      drug_id: register.drug_id,
      drug_brand: register.drug_brand,
      drug_form: register.drug_form,
      drug_strength: register.drug_strength,
      drug_class: register.drug_class,
      expected_balance: ledger.current_balance,
      actual_count: counted,
      status,
      notes: notes.trim() || null,
      checked_by: profile.id,
      checked_at: now,
    })
    if (iErr) { setSaving(false); return setError(`Could not save the check: ${iErr.message}`) }

    const { error: rpcError } = await userClient.rpc('ps_make_register_entry', {
      p_ledger_id: ledger.id,
      p_register_type: 'CD',
      p_entry_type: 'balance_check',
      p_date_of_transaction: ukToday(),
      p_notes: note,
      p_source: 'manual',
      p_expected_lock_version: ledger.lock_version,
      p_transaction_type: 'balance_check',
      p_authorised_by: profile.full_name,
    })
    setSaving(false)
    if (rpcError) {
      if (rpcError.message.includes('CONFLICT')) await onConflict()
      return setError(friendlyError(rpcError.message))
    }
    await onSaved(matched
      ? 'Balance check saved. The count matches the register.'
      : 'Discrepancy recorded. Investigate the difference; once resolved, a pharmacist records the adjustment on the web register.')
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.heading}>Check balance</Text>
              <Text style={styles.muted} numberOfLines={1}>{register.drug_brand}</Text>
            </View>
            <IconButton icon="close" label="Cancel" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.balancePanel}>
              <Text style={styles.balanceLabel}>Register says</Text>
              <Text style={styles.bigBalance}>{fmtQty(ledger.current_balance)}</Text>
            </View>
            <Field label="Physical count" value={count} onChangeText={setCount} keyboardType="decimal-pad" placeholder="Count the stock" />
            {diff != null ? (
              <Banner tone={diff === 0 ? 'success' : 'danger'} text={diff === 0 ? 'Matches the register.' : `Doesn't match: ${diff > 0 ? '+' : ''}${fmtQty(diff)} against the register.`} />
            ) : null}
            <Field label={diff != null && diff !== 0 ? 'What have you checked? (required)' : 'Notes (optional)'} value={notes} onChangeText={setNotes} multiline style={styles.notes} />
            {error ? <Banner tone="danger" text={error} /> : null}
          </ScrollView>
          <View style={styles.modalFooter}>
            <PrimaryButton label={saving ? 'Saving…' : 'Save check'} onPress={save} disabled={saving} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ---------- add a drug ----------

function AddRegisterModal({ existing, visible, onClose, onAdded }: { existing: string[]; visible: boolean; onClose: () => void; onAdded: (drugId: string) => Promise<void> }) {
  const organisation = useAuthStore((s) => s.organisation)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DrugOption[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<DrugOption | null>(null)
  const [opening, setOpening] = useState('0')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setQuery(''); setResults([]); setPicked(null); setOpening('0'); setReason(''); setError(null)
  }, [visible])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const safe = q.replace(/[%_,()]/g, ' ')
      const { data, error: sErr } = await userClient
        .from('cdr_drugs_unique')
        .select('id, drug_brand, drug_form, drug_strength, drug_class')
        .or(`drug_brand.ilike.%${safe}%,drug_class.ilike.%${safe}%`)
        .order('drug_brand')
        .limit(30)
      if (cancelled) return
      setSearching(false)
      if (sErr) setError(sErr.message)
      else setResults((data as DrugOption[]) ?? [])
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const save = async () => {
    if (!picked || !organisation) return
    const qty = Number(opening.replace(',', '.'))
    if (!Number.isFinite(qty) || qty < 0) return setError('Enter an opening balance of 0 or more.')
    if (qty > 0 && !reason.trim()) return setError('Say where the opening balance comes from, for example "stock count on 9 Nov".')
    setSaving(true)
    setError(null)
    const { error: rpcError } = await userClient.rpc('ps_create_cd_register', {
      p_organisation_id: organisation.id,
      p_drug_id: picked.id,
      p_opening_balance: qty,
      p_reason: reason.trim() || null,
    })
    setSaving(false)
    if (rpcError) return setError(friendlyError(rpcError.message))
    await onAdded(picked.id)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <View style={styles.flex}>
              <Text style={styles.heading}>Add a drug</Text>
              <Text style={styles.muted}>Start a CD register page with an opening balance</Text>
            </View>
            <IconButton icon="close" label="Cancel" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {picked ? (
              <>
                <View style={styles.pickedCard}>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>{picked.drug_brand}</Text>
                    <Text style={styles.muted}>{[picked.drug_class, picked.drug_strength, picked.drug_form].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Pressable onPress={() => setPicked(null)} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>Change</Text></Pressable>
                </View>
                <Field label="Opening balance" value={opening} onChangeText={setOpening} keyboardType="decimal-pad" />
                <Field label="Where does this balance come from?" value={reason} onChangeText={setReason} placeholder="e.g. stock count on go-live" />
                <Text style={styles.footnote}>The opening balance becomes the first signed line on the register and can't be changed later.</Text>
              </>
            ) : (
              <>
                <View style={styles.search}>
                  <Ionicons name="search" size={18} color={palette.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search by brand or drug, e.g. Zomorph"
                    placeholderTextColor={palette.textMuted}
                    value={query}
                    onChangeText={setQuery}
                    autoFocus
                    autoCorrect={false}
                  />
                  {searching ? <ActivityIndicator size="small" color={COLOR} /> : null}
                </View>
                {results.map((d) => {
                  const onRegister = existing.includes(d.id)
                  return (
                    <Pressable key={d.id} style={({ pressed }) => [styles.card, onRegister && styles.dim, pressed && styles.pressed]} onPress={() => setPicked(d)} disabled={onRegister} accessibilityRole="button" accessibilityState={{ disabled: onRegister }}>
                      <View style={styles.flex}>
                        <Text style={styles.cardTitle}>{d.drug_brand}</Text>
                        <Text style={styles.muted}>{[d.drug_class, d.drug_strength, d.drug_form].filter(Boolean).join(' · ')}</Text>
                      </View>
                      {onRegister ? <Text style={styles.muted}>On register</Text> : <Ionicons name="add-circle-outline" size={22} color={COLOR} />}
                    </Pressable>
                  )
                })}
                {query.trim().length >= 2 && !searching && results.length === 0 ? <Text style={styles.muted}>No drugs match “{query.trim()}”.</Text> : null}
              </>
            )}
            {error ? <Banner tone="danger" text={error} /> : null}
          </ScrollView>
          {picked ? (
            <View style={styles.modalFooter}>
              <PrimaryButton label={saving ? 'Adding…' : 'Add to register'} onPress={save} disabled={saving} />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ---------- small components ----------

function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'danger' | 'success' }) {
  const colors = tone === 'danger'
    ? { bg: palette.dangerTint, fg: palette.danger, icon: 'alert-circle-outline' as const }
    : tone === 'success'
      ? { bg: '#D1FAE5', fg: palette.success, icon: 'checkmark-circle-outline' as const }
      : { bg: palette.brandTint, fg: palette.brandDark, icon: 'information-circle-outline' as const }
  return (
    <View style={[styles.banner, { backgroundColor: colors.bg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Ionicons name={colors.icon} size={18} color={colors.fg} />
      <Text style={[styles.bannerText, { color: colors.fg }]}>{text}</Text>
    </View>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return value ? (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  ) : null
}

function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={COLOR} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  )
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.primary, (pressed || disabled) && styles.dim]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Ionicons name={icon} size={24} color={palette.text} />
    </Pressable>
  )
}

export const cdRegisterScreen = CdRegisterScreen

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingVertical: 12, gap: 12, paddingBottom: 32 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: palette.text },
  muted: { color: palette.textMuted, fontSize: 13, lineHeight: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLOR, paddingHorizontal: 14, minHeight: 44, borderRadius: radius.md },
  addButtonText: { color: palette.textInverse, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 16, color: palette.text, paddingVertical: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 14 },
  pickedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.brandTint, borderRadius: radius.md, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  pressed: { opacity: 0.65 },
  balanceBox: { alignItems: 'flex-end', minWidth: 60 },
  balanceLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  balance: { fontSize: 20, fontWeight: '800', color: palette.text, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: radius.md, padding: 12 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  modal: { flex: 1, backgroundColor: palette.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  modalContent: { padding: 16, gap: 12, paddingBottom: 32 },
  modalFooter: { padding: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface },
  balancePanel: { alignItems: 'center', backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, paddingVertical: 18, gap: 2 },
  bigBalance: { fontSize: 40, fontWeight: '800', color: palette.text, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  actionText: { fontSize: 13, fontWeight: '700', color: palette.text },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.text, marginTop: 4 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: 12 },
  entryCorrected: { opacity: 0.6 },
  strike: { textDecorationLine: 'line-through' },
  entryNumber: { minWidth: 34, height: 34, borderRadius: radius.sm, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  entryNumberText: { fontWeight: '800', color: palette.textMuted, fontVariant: ['tabular-nums'] },
  entryTitle: { fontWeight: '700', color: palette.text, fontSize: 15 },
  entryMeta: { color: palette.textMuted, fontSize: 12, marginTop: 2 },
  entryQty: { alignItems: 'flex-end', minWidth: 56 },
  qtyIn: { color: palette.success, fontWeight: '800', fontVariant: ['tabular-nums'] },
  qtyOut: { color: palette.danger, fontWeight: '800', fontVariant: ['tabular-nums'] },
  entryBalance: { color: palette.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  footnote: { color: palette.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 4 },
  panel: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, padding: 15, gap: 10 },
  detailRow: { gap: 2 },
  detailLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
  detailValue: { color: palette.text, fontSize: 15, lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  chipText: { color: palette.text, fontWeight: '600' },
  chipTextOn: { color: palette.textInverse },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 52 },
  toggleLabel: { fontSize: 15, color: palette.text, fontWeight: '600' },
  notes: { height: 88, paddingTop: 12, textAlignVertical: 'top' },
  link: { color: palette.brand, fontWeight: '800' },
  primary: { minHeight: 52, borderRadius: radius.md, backgroundColor: COLOR, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: palette.textInverse, fontSize: 16, fontWeight: '800' },
  dim: { opacity: 0.55 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
