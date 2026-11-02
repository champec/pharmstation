// ============================================================
// Patient CD Returns Register
// Single-table register — emulates a physical returns book.
// One new-entry form row at the bottom; pending rows expand
// inline for destruction recording. Smart validation.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

// ─── Types ────────────────────────────────────────────────────

type ViewMode = 'all' | 'pending' | 'destroyed'

interface DrugSuggestion {
  name: string
  form: string | null
  strength: string | null
}

interface AutoSuggestion {
  name: string
  extra?: string
  extra2?: string
  sig?: string
}

interface ReturnRow {
  receiveEntry: RegisterEntry
  destructionEntry: RegisterEntry | null
  status: 'pending' | 'destroyed'
}

// ─── Blank form state ─────────────────────────────────────────

function blankNewEntry() {
  return {
    dateIn: new Date().toISOString().split('T')[0],
    patientName: '',
    address: '',
    role: '',
    receivedBy: '',
    drugName: '',
    drugForm: '',
    drugStrength: '',
    qty: '',
    // destruction (optional — leaving these blank → receive-only save)
    dateDestroyed: '',
    pharmacistName: '',
    pharmacistReg: '',
    pharmacistSig: '',
    witnessName: '',
    witnessRole: '',
    witnessSig: '',
  }
}

function blankDestroyForm() {
  return {
    dateDestroyed: new Date().toISOString().split('T')[0],
    pharmacistName: '',
    pharmacistReg: '',
    pharmacistSig: '',
    witnessName: '',
    witnessRole: '',
    witnessSig: '',
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function fmtDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB')
}

// ─── Signature pad ────────────────────────────────────────────

function SignaturePad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const W = 600
  const H = 160
  const [paths, setPaths] = useState<string[]>([])
  const [cur, setCur] = useState('')
  const drawing = useRef(false)

  const pt = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H }
  }

  const emit = (ps: string[]) => {
    if (!ps.length) { onChange(''); return }
    const markup = ps
      .map((d) => `<path d="${d}" fill="none" stroke="#0a0f1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${markup}</svg>`
    onChange(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ border: '1px solid var(--ps-border)', borderRadius: 8, background: '#fff', position: 'relative', overflow: 'hidden' }}>
        {!paths.length && value && (
          <img src={value} alt="sig" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        )}
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={(e) => {
            e.preventDefault()
            const p = pt(e)
            setCur(`M ${p.x} ${p.y}`)
            drawing.current = true
            if (!paths.length && value) onChange('')
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return
            const p = pt(e)
            setCur((prev) => `${prev} L ${p.x} ${p.y}`)
          }}
          onPointerUp={(e) => {
            if (!drawing.current) return
            drawing.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
            if (!cur) return
            const next = [...paths, cur]
            setPaths(next)
            setCur('')
            emit(next)
          }}
          onPointerLeave={(e) => {
            if (!drawing.current) return
            drawing.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
        >
          {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#0a0f1a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
          {cur && <path d={cur} fill="none" stroke="#0a0f1a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="ps-btn ps-btn-ghost" onClick={() => { setPaths([]); setCur(''); onChange('') }}>
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Autocomplete input ───────────────────────────────────────

function AutoInput({
  value,
  onChange,
  placeholder,
  suggestions,
  onPick,
  onFocus,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  suggestions: AutoSuggestion[]
  onPick: (s: AutoSuggestion) => void
  onFocus?: () => void
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type="text"
        className="ps-input"
        style={{ width: '100%', minWidth: 0 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { setOpen(true); onFocus?.() }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
      />
      {open && suggestions.length > 0 && (
        <div className="autocomplete-dropdown" style={{ top: '100%', bottom: 'auto', zIndex: 9999 }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="autocomplete-item"
              onMouseDown={(e) => { e.preventDefault(); onPick(s); setOpen(false) }}
            >
              <div className="autocomplete-item-left">
                <span className="autocomplete-name">{s.name}</span>
                {(s.extra || s.extra2) && (
                  <span className="autocomplete-detail">{[s.extra, s.extra2].filter(Boolean).join(' — ')}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────

export function ReturnsPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { activeLedger, setActiveLedger, entries, setEntries, entriesLoading, setEntriesLoading } = useRegisterStore()

  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [search, setSearch] = useState('')

  // New entry form state
  const [newEntry, setNewEntry] = useState(blankNewEntry)
  const [newEntryError, setNewEntryError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Inline destruction expansion
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [destroyForm, setDestroyForm] = useState(blankDestroyForm)
  const [destroyError, setDestroyError] = useState<string | null>(null)
  const [destroySaving, setDestroySaving] = useState(false)

  // Signature modal: 'new-pharma' | 'new-witness' | 'destroy-pharma' | 'destroy-witness'
  const [sigModal, setSigModal] = useState<string | null>(null)

  // Autocomplete suggestions
  const [receivedBySuggestions, setReceivedBySuggestions] = useState<AutoSuggestion[]>([])
  const [pharmacistSuggestions, setPharmacistSuggestions] = useState<AutoSuggestion[]>([])
  const [witnessSuggestions, setWitnessSuggestions] = useState<AutoSuggestion[]>([])
  const [drugSuggestions, setDrugSuggestions] = useState<AutoSuggestion[]>([])

  // ── Ledger ──

  const loadLedger = useCallback(async () => {
    if (!organisation) return
    const { data: existing } = await getUserClient()
      .from('ps_register_ledgers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .eq('register_type', 'RETURNS')
      .is('drug_id', null)
      .maybeSingle()

    if (existing) { setActiveLedger(existing as RegisterLedger); return }

    const { data: created } = await getUserClient()
      .from('ps_register_ledgers')
      .insert({ organisation_id: organisation.id, register_type: 'RETURNS', drug_name: 'Patient CD Returns Register' })
      .select('*')
      .single()

    if (created) setActiveLedger(created as RegisterLedger)
  }, [organisation, setActiveLedger])

  const loadEntries = useCallback(async () => {
    if (!activeLedger) return
    setEntriesLoading(true)
    const { data } = await getUserClient()
      .from('ps_register_entries')
      .select('*')
      .eq('ledger_id', activeLedger.id)
      .order('entry_number', { ascending: true })
    setEntries((data as RegisterEntry[]) ?? [])
    setEntriesLoading(false)
  }, [activeLedger, setEntries, setEntriesLoading])

  useEffect(() => { loadLedger() }, [loadLedger])
  useEffect(() => { loadEntries() }, [loadEntries])
  useEffect(() => () => { setActiveLedger(null); setEntries([]) }, [setActiveLedger, setEntries])

  // ── Autocomplete loaders ──

  const loadReceivedBy = useCallback(async (q: string) => {
    if (!organisation) return
    let req = getUserClient()
      .from('ps_register_entries')
      .select('return_received_by')
      .eq('organisation_id', organisation.id)
      .not('return_received_by', 'is', null)
      .order('entered_at', { ascending: false })
      .limit(8)
    if (q.trim()) req = req.ilike('return_received_by', `%${q}%`)
    const { data } = await req
    const seen = new Set<string>()
    const result: AutoSuggestion[] = []
    for (const row of (data ?? []) as Array<{ return_received_by: string | null }>) {
      const n = row.return_received_by?.trim()
      if (!n || seen.has(n.toLowerCase())) continue
      seen.add(n.toLowerCase())
      result.push({ name: n })
    }
    setReceivedBySuggestions(result)
  }, [organisation])

  const loadPharmacist = useCallback(async (q: string) => {
    if (!organisation) return
    let req = getUserClient()
      .from('ps_register_entries')
      .select('pharmacist_name, gphc_number, disposal_pharmacist_signature')
      .eq('organisation_id', organisation.id)
      .not('pharmacist_name', 'is', null)
      .order('entered_at', { ascending: false })
      .limit(8)
    if (q.trim()) req = req.ilike('pharmacist_name', `%${q}%`)
    const { data } = await req
    const seen = new Set<string>()
    const result: AutoSuggestion[] = []
    for (const row of (data ?? []) as Array<{ pharmacist_name: string | null; gphc_number: string | null; disposal_pharmacist_signature: string | null }>) {
      const n = row.pharmacist_name?.trim()
      if (!n || seen.has(n.toLowerCase())) continue
      seen.add(n.toLowerCase())
      result.push({ name: n, extra: row.gphc_number ? `Reg ${row.gphc_number}` : undefined, sig: row.disposal_pharmacist_signature ?? '' })
    }
    setPharmacistSuggestions(result)
  }, [organisation])

  const loadWitness = useCallback(async (q: string) => {
    if (!organisation) return
    let req = getUserClient()
      .from('ps_register_entries')
      .select('witness_name, witness_role, witness_signature')
      .eq('organisation_id', organisation.id)
      .not('witness_name', 'is', null)
      .order('entered_at', { ascending: false })
      .limit(8)
    if (q.trim()) req = req.ilike('witness_name', `%${q}%`)
    const { data } = await req
    const seen = new Set<string>()
    const result: AutoSuggestion[] = []
    for (const row of (data ?? []) as Array<{ witness_name: string | null; witness_role: string | null; witness_signature: string | null }>) {
      const n = row.witness_name?.trim()
      if (!n || seen.has(n.toLowerCase())) continue
      seen.add(n.toLowerCase())
      result.push({ name: n, extra: row.witness_role ?? undefined, sig: row.witness_signature ?? '' })
    }
    setWitnessSuggestions(result)
  }, [organisation])

  const loadDrugs = useCallback(async (q: string) => {
    let req = getUserClient()
      .from('cdr_drugs_unique')
      .select('drug_brand, drug_form, drug_strength')
      .order('drug_brand')
      .limit(8)
    const trimmed = q.trim()
    if (trimmed) req = req.or(`drug_brand.ilike.%${trimmed}%,drug_form.ilike.%${trimmed}%`)
    const { data } = await req
    const seen = new Set<string>()
    const result: AutoSuggestion[] = []
    for (const row of (data ?? []) as Array<{ drug_brand: string; drug_form: string | null; drug_strength: string | null }>) {
      const key = `${row.drug_brand}|${row.drug_form ?? ''}|${row.drug_strength ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ name: row.drug_brand, extra: row.drug_form ?? undefined, extra2: row.drug_strength ?? undefined })
    }
    setDrugSuggestions(result)
  }, [])

  // Debounced autocomplete
  useEffect(() => { const t = setTimeout(() => loadReceivedBy(newEntry.receivedBy), 220); return () => clearTimeout(t) }, [newEntry.receivedBy, loadReceivedBy])
  useEffect(() => { const t = setTimeout(() => loadPharmacist(newEntry.pharmacistName), 220); return () => clearTimeout(t) }, [newEntry.pharmacistName, loadPharmacist])
  useEffect(() => { const t = setTimeout(() => loadWitness(newEntry.witnessName), 220); return () => clearTimeout(t) }, [newEntry.witnessName, loadWitness])
  useEffect(() => { const t = setTimeout(() => loadDrugs(newEntry.drugName), 220); return () => clearTimeout(t) }, [newEntry.drugName, loadDrugs])
  useEffect(() => { const t = setTimeout(() => loadPharmacist(destroyForm.pharmacistName), 220); return () => clearTimeout(t) }, [destroyForm.pharmacistName, loadPharmacist])
  useEffect(() => { const t = setTimeout(() => loadWitness(destroyForm.witnessName), 220); return () => clearTimeout(t) }, [destroyForm.witnessName, loadWitness])

  // ── Row pairing ──

  const returnRows = useMemo((): ReturnRow[] => {
    const receives = entries.filter((e) => e.transaction_type === 'patient_return')
    const destroyMap = new Map<string, RegisterEntry>()
    for (const e of entries) {
      if (e.transaction_type === 'disposal' && e.return_parent_entry_id) {
        destroyMap.set(e.return_parent_entry_id, e)
      }
    }
    return receives
      .map((r) => ({
        receiveEntry: r,
        destructionEntry: destroyMap.get(r.id) ?? null,
        status: destroyMap.has(r.id) ? 'destroyed' : 'pending',
      } satisfies ReturnRow))
      .sort((a, b) => new Date(b.receiveEntry.date_of_transaction).getTime() - new Date(a.receiveEntry.date_of_transaction).getTime())
  }, [entries])

  const pendingCount = useMemo(() => returnRows.filter((r) => r.status === 'pending').length, [returnRows])
  const destroyedCount = useMemo(() => returnRows.filter((r) => r.status === 'destroyed').length, [returnRows])

  const filteredRows = useMemo(() => {
    const byMode =
      viewMode === 'pending' ? returnRows.filter((r) => r.status === 'pending') :
      viewMode === 'destroyed' ? returnRows.filter((r) => r.status === 'destroyed') :
      returnRows

    const q = search.trim().toLowerCase()
    if (!q) return byMode

    return byMode.filter((row) => {
      const r = row.receiveEntry
      const d = row.destructionEntry
      const haystack = [
        r.return_patient_name, r.patient_address, r.return_person_role, r.return_received_by,
        r.return_drug_name, r.return_drug_form, r.return_drug_strength, String(r.return_quantity ?? ''),
        d?.pharmacist_name, d?.gphc_number, d?.witness_name, d?.witness_role,
        fmtDate(r.date_of_transaction), fmtDate(d?.disposal_date),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [returnRows, viewMode, search])

  // ── Smart detection: has the user started filling destruction fields? ──
  const ne = newEntry
  const hasDestructionData = !!(ne.dateDestroyed || ne.pharmacistName.trim() || ne.witnessName.trim())

  // ── Submit new entry ──

  const submitNew = async () => {
    if (!activeLedger || !activeUser) return

    // Receive validations (always)
    if (!ne.dateIn) { setNewEntryError('Date received is required'); return }
    if (!ne.patientName.trim()) { setNewEntryError('Patient name is required'); return }
    if (!ne.role.trim()) { setNewEntryError('Role of person returning is required'); return }
    if (!ne.receivedBy.trim()) { setNewEntryError('Received by is required'); return }
    if (!ne.drugName.trim()) { setNewEntryError('Drug name is required'); return }
    const qty = parseFloat(ne.qty)
    if (!qty || qty <= 0) { setNewEntryError('Quantity must be greater than 0'); return }

    // Destruction validations — only if destruction data touched
    if (hasDestructionData) {
      if (!ne.dateDestroyed) { setNewEntryError('Date destroyed is required when recording destruction'); return }
      if (!ne.pharmacistName.trim()) { setNewEntryError('Pharmacist name is required'); return }
      if (!/^\d{1,8}$/.test(ne.pharmacistReg.trim())) { setNewEntryError('Pharmacist registration must be a number'); return }
      if (!ne.pharmacistSig) { setNewEntryError('Pharmacist signature is required'); return }
      if (!ne.witnessName.trim()) { setNewEntryError('Witness name is required'); return }
      if (!ne.witnessRole.trim()) { setNewEntryError('Witness role is required'); return }
      if (!ne.witnessSig) { setNewEntryError('Witness signature is required'); return }
    }

    setSaving(true)
    setNewEntryError(null)

    // Save receive entry
    const { data: receiveEntry, error: receiveErr } = await getUserClient().rpc('ps_make_register_entry', {
      p_ledger_id: activeLedger.id,
      p_register_type: 'RETURNS',
      p_entry_type: 'normal',
      p_date_of_transaction: ne.dateIn,
      p_source: 'manual',
      p_expected_lock_version: activeLedger.lock_version,
      p_transaction_type: 'patient_return',
      p_entered_by: activeUser.id,
      p_authorised_by: activeUser.full_name,
      p_return_patient_name: ne.patientName.trim(),
      p_patient_address: ne.address.trim() || null,
      p_return_person_role: ne.role.trim(),
      p_return_received_by: ne.receivedBy.trim(),
      p_return_drug_name: ne.drugName.trim(),
      p_return_drug_form: ne.drugForm.trim() || null,
      p_return_drug_strength: ne.drugStrength.trim() || null,
      p_return_quantity: qty,
    })

    if (receiveErr) {
      setNewEntryError(receiveErr.message.includes('CONFLICT') ? 'Another entry was saved first. Please retry.' : receiveErr.message)
      setSaving(false)
      return
    }

    if (hasDestructionData && receiveEntry) {
      // Reload ledger for fresh lock_version
      const { data: freshLedger } = await getUserClient()
        .from('ps_register_ledgers')
        .select('*')
        .eq('id', activeLedger.id)
        .single()

      const { error: destroyErr } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: (freshLedger ?? activeLedger).id,
        p_register_type: 'RETURNS',
        p_entry_type: 'normal',
        p_date_of_transaction: ne.dateDestroyed,
        p_source: 'manual',
        p_expected_lock_version: (freshLedger ?? activeLedger).lock_version,
        p_transaction_type: 'disposal',
        p_entered_by: activeUser.id,
        p_authorised_by: activeUser.full_name,
        p_return_parent_entry_id: (receiveEntry as RegisterEntry).id,
        p_return_patient_name: ne.patientName.trim(),
        p_patient_address: ne.address.trim() || null,
        p_return_person_role: ne.role.trim(),
        p_return_received_by: ne.receivedBy.trim(),
        p_return_drug_name: ne.drugName.trim(),
        p_return_drug_form: ne.drugForm.trim() || null,
        p_return_drug_strength: ne.drugStrength.trim() || null,
        p_return_quantity: qty,
        p_disposal_date: ne.dateDestroyed,
        p_disposal_method: 'Destroyed',
        p_pharmacist_name: ne.pharmacistName.trim(),
        p_gphc_number: ne.pharmacistReg.trim(),
        p_disposal_pharmacist_signature: ne.pharmacistSig,
        p_witness_name: ne.witnessName.trim(),
        p_witness_role: ne.witnessRole.trim(),
        p_witness_signature: ne.witnessSig,
        p_disposal_witness: ne.witnessName.trim(),
      })

      if (destroyErr) {
        await loadEntries()
        setNewEntryError(`Entry received and saved. Destruction save failed: ${destroyErr.message}`)
        setSaving(false)
        return
      }

      setViewMode('destroyed')
    } else {
      setViewMode('pending')
    }

    await loadEntries()
    await loadLedger()
    setNewEntry(blankNewEntry())
    setSaving(false)
  }

  // ── Submit inline destruction for a pending row ──

  const submitDestroy = async (pendingRow: ReturnRow) => {
    if (!activeLedger || !activeUser) return

    const df = destroyForm
    if (!df.dateDestroyed) { setDestroyError('Date destroyed is required'); return }
    if (!df.pharmacistName.trim()) { setDestroyError('Pharmacist name is required'); return }
    if (!/^\d{1,8}$/.test(df.pharmacistReg.trim())) { setDestroyError('Pharmacist registration must be a number'); return }
    if (!df.pharmacistSig) { setDestroyError('Pharmacist signature is required'); return }
    if (!df.witnessName.trim()) { setDestroyError('Witness name is required'); return }
    if (!df.witnessRole.trim()) { setDestroyError('Witness role is required'); return }
    if (!df.witnessSig) { setDestroyError('Witness signature is required'); return }

    setDestroySaving(true)
    setDestroyError(null)

    const r = pendingRow.receiveEntry
    const { data: freshLedger } = await getUserClient()
      .from('ps_register_ledgers')
      .select('*')
      .eq('id', activeLedger.id)
      .single()

    const { error } = await getUserClient().rpc('ps_make_register_entry', {
      p_ledger_id: (freshLedger ?? activeLedger).id,
      p_register_type: 'RETURNS',
      p_entry_type: 'normal',
      p_date_of_transaction: df.dateDestroyed,
      p_source: 'manual',
      p_expected_lock_version: (freshLedger ?? activeLedger).lock_version,
      p_transaction_type: 'disposal',
      p_entered_by: activeUser.id,
      p_authorised_by: activeUser.full_name,
      p_return_parent_entry_id: r.id,
      p_return_patient_name: r.return_patient_name,
      p_patient_address: r.patient_address,
      p_return_person_role: r.return_person_role,
      p_return_received_by: r.return_received_by,
      p_return_drug_name: r.return_drug_name,
      p_return_drug_form: r.return_drug_form,
      p_return_drug_strength: r.return_drug_strength,
      p_return_quantity: r.return_quantity,
      p_disposal_date: df.dateDestroyed,
      p_disposal_method: 'Destroyed',
      p_pharmacist_name: df.pharmacistName.trim(),
      p_gphc_number: df.pharmacistReg.trim(),
      p_disposal_pharmacist_signature: df.pharmacistSig,
      p_witness_name: df.witnessName.trim(),
      p_witness_role: df.witnessRole.trim(),
      p_witness_signature: df.witnessSig,
      p_disposal_witness: df.witnessName.trim(),
    })

    if (error) {
      setDestroyError(error.message.includes('CONFLICT') ? 'Another entry was saved first. Please retry.' : error.message)
      setDestroySaving(false)
      return
    }

    await loadEntries()
    await loadLedger()
    setExpandedRowId(null)
    setDestroyForm(blankDestroyForm())
    setViewMode('destroyed')
    setDestroySaving(false)
  }

  const toggleExpand = (id: string) => {
    if (expandedRowId === id) {
      setExpandedRowId(null)
      setDestroyForm(blankDestroyForm())
      setDestroyError(null)
    } else {
      setExpandedRowId(id)
      setDestroyForm(blankDestroyForm())
      setDestroyError(null)
    }
  }

  // ── Cell styles ──

  const th: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: '11px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--ps-slate)',
    whiteSpace: 'nowrap',
    borderBottom: '2px solid var(--ps-border)',
    background: 'var(--ps-surface)',
    position: 'sticky',
    top: 0,
    zIndex: 2,
  }

  const td: React.CSSProperties = {
    padding: '9px 10px',
    verticalAlign: 'middle',
    fontSize: '13px',
    borderBottom: '1px solid var(--ps-border)',
  }

  const tdForm: React.CSSProperties = {
    padding: '6px 4px',
    verticalAlign: 'middle',
    borderBottom: 'none',
    borderTop: '2px solid var(--ps-primary)',
    background: 'color-mix(in srgb, var(--ps-primary) 4%, transparent)',
  }

  const inputStyle: React.CSSProperties = { width: '100%', minWidth: 0, fontSize: '12px' }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/registers" onClick={(e) => { e.preventDefault(); navigate('/registers') }}>Registers</a>
          <span className="separator">/</span>
          <span>Patient Returns</span>
        </div>
        <h1>↩ Patient Returns Register</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: 4, fontSize: '13px' }}>
          Record received CDs and their destruction. Fill the destruction columns too to record both at once — or leave them blank and come back later.
        </p>
      </div>

      {/* Lifecycle filter + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'pending', 'destroyed'] as ViewMode[]).map((mode) => {
          const count = mode === 'all' ? returnRows.length : mode === 'pending' ? pendingCount : destroyedCount
          return (
            <button
              key={mode}
              className={`ps-btn ${viewMode === mode ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              style={{ textTransform: 'capitalize' }}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'all' ? 'All' : mode === 'pending' ? '⏳ Pending' : '✅ Destroyed'}
              <span style={{ marginLeft: 6, opacity: 0.65, fontWeight: 400 }}>({count})</span>
            </button>
          )
        })}
        <input
          className="ps-input"
          style={{ marginLeft: 'auto', maxWidth: 280 }}
          placeholder="Search entries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Register table */}
      <div className="ps-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1720 }}>
            <colgroup>
              {/* # */}<col style={{ width: 38 }} />
              {/* date in */}<col style={{ width: 112 }} />
              {/* patient */}<col style={{ width: 148 }} />
              {/* address */}<col style={{ width: 148 }} />
              {/* role */}<col style={{ width: 128 }} />
              {/* received by */}<col style={{ width: 138 }} />
              {/* drug */}<col style={{ width: 138 }} />
              {/* form */}<col style={{ width: 98 }} />
              {/* strength */}<col style={{ width: 98 }} />
              {/* qty */}<col style={{ width: 68 }} />
              {/* status */}<col style={{ width: 90 }} />
              {/* divider */}<col style={{ width: 1 }} />
              {/* date destroyed */}<col style={{ width: 112 }} />
              {/* pharmacist */}<col style={{ width: 138 }} />
              {/* reg */}<col style={{ width: 88 }} />
              {/* pharm sig */}<col style={{ width: 58 }} />
              {/* witness */}<col style={{ width: 128 }} />
              {/* witness role */}<col style={{ width: 118 }} />
              {/* witness sig */}<col style={{ width: 58 }} />
              {/* actions */}<col style={{ width: 118 }} />
            </colgroup>

            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Date Received</th>
                <th style={th}>Patient Name</th>
                <th style={th}>Address</th>
                <th style={th}>Role (Returning)</th>
                <th style={th}>Received By</th>
                <th style={th}>Drug Name</th>
                <th style={th}>Form</th>
                <th style={th}>Strength</th>
                <th style={th}>Qty</th>
                <th style={th}>Status</th>
                {/* Visual divider column */}
                <th style={{ ...th, padding: 0, background: 'var(--ps-border)', width: 2 }} />
                <th style={th}>Date Destroyed</th>
                <th style={th}>Pharmacist</th>
                <th style={th}>Reg #</th>
                <th style={{ ...th, textAlign: 'center' }}>Pharm Sig</th>
                <th style={th}>Witness</th>
                <th style={th}>Witness Role</th>
                <th style={{ ...th, textAlign: 'center' }}>Witness Sig</th>
                <th style={th} />
              </tr>
            </thead>

            <tbody>
              {entriesLoading ? (
                <tr>
                  <td colSpan={20} style={{ ...td, textAlign: 'center', color: 'var(--ps-slate)', padding: '40px 16px' }}>
                    Loading entries…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={20} style={{ ...td, textAlign: 'center', color: 'var(--ps-slate)', padding: '40px 16px' }}>
                    {search.trim() ? 'No entries match your search.' : 'No entries yet — fill in the row below and press Save.'}
                  </td>
                </tr>
              ) : (
                filteredRows.flatMap((row, idx) => {
                  const r = row.receiveEntry
                  const d = row.destructionEntry
                  const isPending = row.status === 'pending'
                  const isExpanded = expandedRowId === r.id

                  const dataRow = (
                    <tr
                      key={r.id}
                      style={{ background: isExpanded ? 'color-mix(in srgb, var(--ps-primary) 4%, transparent)' : idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}
                    >
                      <td style={{ ...td, color: 'var(--ps-slate)', fontSize: '11px', textAlign: 'center' }}>
                        {r.entry_number ?? idx + 1}
                      </td>
                      <td style={td}>{fmtDate(r.date_of_transaction)}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{r.return_patient_name || '—'}</td>
                      <td style={{ ...td, fontSize: '12px', color: 'var(--ps-slate)' }}>{r.patient_address || '—'}</td>
                      <td style={td}>{r.return_person_role || '—'}</td>
                      <td style={td}>{r.return_received_by || '—'}</td>
                      <td style={{ ...td, fontWeight: 500 }}>{r.return_drug_name || '—'}</td>
                      <td style={td}>{r.return_drug_form || '—'}</td>
                      <td style={td}>{r.return_drug_strength || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.return_quantity ?? '—'}</td>
                      <td style={td}>
                        {isPending
                          ? <span className="ps-badge ps-badge-amber">Pending</span>
                          : <span className="ps-badge ps-badge-green">Destroyed</span>}
                      </td>
                      {/* Divider */}
                      <td style={{ padding: 0, background: 'var(--ps-border)', width: 2 }} />
                      <td style={td}>{d ? fmtDate(d.disposal_date ?? d.date_of_transaction) : <span style={{ color: 'var(--ps-border)' }}>—</span>}</td>
                      <td style={td}>{d?.pharmacist_name || <span style={{ color: 'var(--ps-border)' }}>—</span>}</td>
                      <td style={td}>{d?.gphc_number || <span style={{ color: 'var(--ps-border)' }}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {d?.disposal_pharmacist_signature
                          ? <img src={d.disposal_pharmacist_signature} alt="sig" style={{ height: 28, maxWidth: 54, objectFit: 'contain' }} />
                          : <span style={{ color: 'var(--ps-border)' }}>—</span>}
                      </td>
                      <td style={td}>{d?.witness_name || <span style={{ color: 'var(--ps-border)' }}>—</span>}</td>
                      <td style={td}>{d?.witness_role || <span style={{ color: 'var(--ps-border)' }}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {d?.witness_signature
                          ? <img src={d.witness_signature} alt="sig" style={{ height: 28, maxWidth: 54, objectFit: 'contain' }} />
                          : <span style={{ color: 'var(--ps-border)' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', paddingRight: 12 }}>
                        {isPending && (
                          <button
                            type="button"
                            className={`ps-btn ${isExpanded ? 'ps-btn-ghost' : 'ps-btn-ghost'}`}
                            style={{ fontSize: '12px', padding: '3px 10px', opacity: isExpanded ? 0.5 : 1 }}
                            onClick={() => toggleExpand(r.id)}
                          >
                            {isExpanded ? '✕ Cancel' : '🗑 Destroy'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )

                  if (!isPending || !isExpanded) return [dataRow]

                  const expansionRow = (
                    <tr key={`${r.id}-destroy-form`}>
                      <td
                        colSpan={20}
                        style={{
                          padding: '14px 16px',
                          borderBottom: '2px solid var(--ps-border)',
                          background: 'color-mix(in srgb, var(--ps-primary) 6%, transparent)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', marginRight: 4, paddingBottom: 6 }}>
                            Record destruction for this return:
                          </span>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Date destroyed *</label>
                            <input type="date" className="ps-input" style={{ width: 130, fontSize: '13px' }}
                              value={destroyForm.dateDestroyed}
                              onChange={(e) => setDestroyForm((f) => ({ ...f, dateDestroyed: e.target.value }))} />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Pharmacist *</label>
                            <AutoInput
                              value={destroyForm.pharmacistName}
                              onChange={(v) => setDestroyForm((f) => ({ ...f, pharmacistName: v }))}
                              placeholder="Name"
                              suggestions={pharmacistSuggestions}
                              onPick={(s) => setDestroyForm((f) => ({
                                ...f,
                                pharmacistName: s.name,
                                pharmacistReg: s.extra?.replace('Reg ', '') ?? f.pharmacistReg,
                                pharmacistSig: s.sig ?? f.pharmacistSig,
                              }))}
                              style={{ width: 160 }}
                            />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Reg # *</label>
                            <input className="ps-input" style={{ width: 90, fontSize: '13px' }} placeholder="GPhC #"
                              value={destroyForm.pharmacistReg}
                              onChange={(e) => setDestroyForm((f) => ({ ...f, pharmacistReg: e.target.value.replace(/\D/g, '') }))} />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Pharm sig *</label>
                            <button
                              type="button"
                              className={`ps-btn ${destroyForm.pharmacistSig ? 'ps-btn-secondary' : 'ps-btn-ghost'}`}
                              style={{ fontSize: '12px', padding: '5px 12px' }}
                              onClick={() => setSigModal('destroy-pharma')}
                            >
                              {destroyForm.pharmacistSig ? '✓ Signed' : '🖊 Sign'}
                            </button>
                          </div>

                          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--ps-border)', margin: '0 4px' }} />

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Witness *</label>
                            <AutoInput
                              value={destroyForm.witnessName}
                              onChange={(v) => setDestroyForm((f) => ({ ...f, witnessName: v }))}
                              placeholder="Name"
                              suggestions={witnessSuggestions}
                              onPick={(s) => setDestroyForm((f) => ({
                                ...f,
                                witnessName: s.name,
                                witnessRole: s.extra ?? f.witnessRole,
                                witnessSig: s.sig ?? f.witnessSig,
                              }))}
                              style={{ width: 150 }}
                            />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Witness role *</label>
                            <input className="ps-input" style={{ width: 130, fontSize: '13px' }} placeholder="Role"
                              value={destroyForm.witnessRole}
                              onChange={(e) => setDestroyForm((f) => ({ ...f, witnessRole: e.target.value }))} />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <label style={{ fontSize: '11px', color: 'var(--ps-slate)', fontWeight: 500 }}>Witness sig *</label>
                            <button
                              type="button"
                              className={`ps-btn ${destroyForm.witnessSig ? 'ps-btn-secondary' : 'ps-btn-ghost'}`}
                              style={{ fontSize: '12px', padding: '5px 12px' }}
                              onClick={() => setSigModal('destroy-witness')}
                            >
                              {destroyForm.witnessSig ? '✓ Signed' : '🖊 Sign'}
                            </button>
                          </div>

                          <button
                            type="button"
                            className="ps-btn ps-btn-primary"
                            style={{ fontSize: '13px', marginLeft: 'auto' }}
                            disabled={destroySaving}
                            onClick={() => submitDestroy(row)}
                          >
                            {destroySaving ? 'Saving…' : 'Save Destruction'}
                          </button>
                        </div>

                        {destroyError && (
                          <div className="ps-alert ps-alert-error" style={{ marginTop: 10 }}>{destroyError}</div>
                        )}
                      </td>
                    </tr>
                  )

                  return [dataRow, expansionRow]
                })
              )}

              {/* ─── New entry form row ─── */}
              <tr>
                <td style={tdForm} />
                <td style={tdForm}>
                  <input type="date" className="ps-input" style={inputStyle} value={ne.dateIn}
                    onChange={(e) => setNewEntry((f) => ({ ...f, dateIn: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Patient name" value={ne.patientName}
                    onChange={(e) => setNewEntry((f) => ({ ...f, patientName: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Address" value={ne.address}
                    onChange={(e) => setNewEntry((f) => ({ ...f, address: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="e.g. Patient, Carer" value={ne.role}
                    onChange={(e) => setNewEntry((f) => ({ ...f, role: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <AutoInput value={ne.receivedBy} onChange={(v) => setNewEntry((f) => ({ ...f, receivedBy: v }))}
                    placeholder="Staff name" suggestions={receivedBySuggestions}
                    onPick={(s) => setNewEntry((f) => ({ ...f, receivedBy: s.name }))}
                    onFocus={() => loadReceivedBy(ne.receivedBy)} style={inputStyle} />
                </td>
                <td style={tdForm}>
                  <AutoInput value={ne.drugName} onChange={(v) => setNewEntry((f) => ({ ...f, drugName: v }))}
                    placeholder="Drug name" suggestions={drugSuggestions}
                    onPick={(s) => setNewEntry((f) => ({ ...f, drugName: s.name, drugForm: s.extra ?? f.drugForm, drugStrength: s.extra2 ?? f.drugStrength }))}
                    onFocus={() => loadDrugs(ne.drugName)} style={inputStyle} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Form" value={ne.drugForm}
                    onChange={(e) => setNewEntry((f) => ({ ...f, drugForm: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Strength" value={ne.drugStrength}
                    onChange={(e) => setNewEntry((f) => ({ ...f, drugStrength: e.target.value }))} />
                </td>
                <td style={tdForm}>
                  <input type="number" className="ps-input" style={inputStyle} placeholder="Qty" min="0" step="0.001" value={ne.qty}
                    onChange={(e) => setNewEntry((f) => ({ ...f, qty: e.target.value }))} />
                </td>
                {/* Status cell — empty in form row */}
                <td style={tdForm} />
                {/* Divider */}
                <td style={{ ...tdForm, padding: 0, background: 'var(--ps-primary)', width: 2, opacity: 0.3 }} />
                <td style={tdForm}>
                  <input type="date" className="ps-input" style={inputStyle} value={ne.dateDestroyed}
                    onChange={(e) => setNewEntry((f) => ({ ...f, dateDestroyed: e.target.value }))}
                    title="Optional — fills destruction date; leave blank to record destruction later" />
                </td>
                <td style={tdForm}>
                  <AutoInput value={ne.pharmacistName} onChange={(v) => setNewEntry((f) => ({ ...f, pharmacistName: v }))}
                    placeholder="Pharmacist" suggestions={pharmacistSuggestions}
                    onPick={(s) => setNewEntry((f) => ({
                      ...f, pharmacistName: s.name,
                      pharmacistReg: s.extra?.replace('Reg ', '') ?? f.pharmacistReg,
                      pharmacistSig: s.sig ?? f.pharmacistSig,
                    }))}
                    onFocus={() => loadPharmacist(ne.pharmacistName)} style={inputStyle} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Reg #" value={ne.pharmacistReg}
                    onChange={(e) => setNewEntry((f) => ({ ...f, pharmacistReg: e.target.value.replace(/\D/g, '') }))} />
                </td>
                <td style={{ ...tdForm, textAlign: 'center' }}>
                  <button type="button"
                    className={`ps-btn ${ne.pharmacistSig ? 'ps-btn-secondary' : 'ps-btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '4px 8px', width: '100%' }}
                    onClick={() => setSigModal('new-pharma')} title="Pharmacist signature">
                    {ne.pharmacistSig ? '✓' : '🖊'}
                  </button>
                </td>
                <td style={tdForm}>
                  <AutoInput value={ne.witnessName} onChange={(v) => setNewEntry((f) => ({ ...f, witnessName: v }))}
                    placeholder="Witness" suggestions={witnessSuggestions}
                    onPick={(s) => setNewEntry((f) => ({
                      ...f, witnessName: s.name,
                      witnessRole: s.extra ?? f.witnessRole,
                      witnessSig: s.sig ?? f.witnessSig,
                    }))}
                    onFocus={() => loadWitness(ne.witnessName)} style={inputStyle} />
                </td>
                <td style={tdForm}>
                  <input className="ps-input" style={inputStyle} placeholder="Role" value={ne.witnessRole}
                    onChange={(e) => setNewEntry((f) => ({ ...f, witnessRole: e.target.value }))} />
                </td>
                <td style={{ ...tdForm, textAlign: 'center' }}>
                  <button type="button"
                    className={`ps-btn ${ne.witnessSig ? 'ps-btn-secondary' : 'ps-btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '4px 8px', width: '100%' }}
                    onClick={() => setSigModal('new-witness')} title="Witness signature">
                    {ne.witnessSig ? '✓' : '🖊'}
                  </button>
                </td>
                <td style={tdForm} />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Submit bar — lives at very bottom of the card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderTop: '2px solid var(--ps-primary)',
          background: 'color-mix(in srgb, var(--ps-primary) 4%, transparent)',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: '12px', color: 'var(--ps-slate)', flex: 1 }}>
            {hasDestructionData
              ? '📋 Destruction details detected — both the receipt and destruction records will be saved together.'
              : 'Fill in Date Destroyed, Pharmacist and Witness columns to record both receipt and destruction at once.'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {newEntryError && (
              <span style={{ color: 'var(--ps-danger)', fontSize: '13px', maxWidth: 380, textAlign: 'right' }}>{newEntryError}</span>
            )}
            <button type="button" className="ps-btn ps-btn-ghost" onClick={() => { setNewEntry(blankNewEntry()); setNewEntryError(null) }}>
              Clear
            </button>
            <button
              type="button"
              className="ps-btn ps-btn-primary"
              style={{ minWidth: 140 }}
              disabled={saving || !activeLedger}
              onClick={submitNew}
            >
              {saving ? 'Saving…' : hasDestructionData ? '↩ Save Entry + Destruction' : '↩ Save Received Return'}
            </button>
          </div>
        </div>
      </div>

      {/* Signature modals */}
      <Modal
        isOpen={!!sigModal}
        onClose={() => setSigModal(null)}
        title={sigModal?.includes('pharma') ? 'Pharmacist Signature' : 'Witness Signature'}
        width="660px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ color: 'var(--ps-slate)', margin: 0, fontSize: '14px' }}>Draw your signature below.</p>
          <SignaturePad
            value={
              sigModal === 'new-pharma' ? ne.pharmacistSig
              : sigModal === 'new-witness' ? ne.witnessSig
              : sigModal === 'destroy-pharma' ? destroyForm.pharmacistSig
              : destroyForm.witnessSig
            }
            onChange={(v) => {
              if (sigModal === 'new-pharma') setNewEntry((f) => ({ ...f, pharmacistSig: v }))
              else if (sigModal === 'new-witness') setNewEntry((f) => ({ ...f, witnessSig: v }))
              else if (sigModal === 'destroy-pharma') setDestroyForm((f) => ({ ...f, pharmacistSig: v }))
              else if (sigModal === 'destroy-witness') setDestroyForm((f) => ({ ...f, witnessSig: v }))
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="ps-btn ps-btn-primary" onClick={() => setSigModal(null)}>Done</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
