// ============================================
// CDLedgerPage — View & manage entries for a specific drug
// IN/OUT buttons open a right drawer, not a modal
// ============================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger, CDDrug, KnownContact } from '@pharmstation/types'
import { RegisterTable } from '../../components/table/RegisterTable'
import { Drawer } from '../../components/Drawer'
import { CDEntryForm } from '../../components/forms/CDEntryForm'

const columnHelper = createColumnHelper<RegisterEntry>()

export function CDLedgerPage() {
  const { drugId } = useParams<{ drugId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { activeLedger, setActiveLedger, entries, setEntries, entriesLoading, setEntriesLoading } =
    useRegisterStore()

  const [drug, setDrug] = useState<CDDrug | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [entryDirection, setEntryDirection] = useState<'in' | 'out'>('in')
  const [searchFilter, setSearchFilter] = useState('')

  // Fetch drug info
  useEffect(() => {
    if (!drugId) return
    async function fetchDrug() {
      const { data } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .eq('id', drugId)
        .single()
      if (data) setDrug(data as CDDrug)
    }
    fetchDrug()
  }, [drugId])

  // Fetch or create ledger for this drug
  const loadLedger = useCallback(async () => {
    if (!organisation || !drugId || !drug) return

    // Try to find existing ledger
    const { data: existingLedger } = await getUserClient()
      .from('ps_register_ledgers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .eq('register_type', 'CD')
      .eq('drug_id', drugId)
      .single()

    if (existingLedger) {
      setActiveLedger(existingLedger as RegisterLedger)
      return
    }

    // Create new ledger for this drug
    const { data: newLedger, error } = await getUserClient()
      .from('ps_register_ledgers')
      .insert({
        organisation_id: organisation.id,
        register_type: 'CD',
        drug_id: drugId,
        drug_name: drug.drug_brand,
        drug_form: drug.drug_form,
        drug_strength: drug.drug_strength,
        drug_class: drug.drug_class,
      })
      .select()
      .single()

    if (newLedger && !error) {
      setActiveLedger(newLedger as RegisterLedger)
    }
  }, [organisation, drugId, drug, setActiveLedger])

  useEffect(() => {
    loadLedger()
  }, [loadLedger])

  // Fetch entries when ledger is loaded
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

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      setActiveLedger(null)
      setEntries([])
    }
  }, [setActiveLedger, setEntries])

  // Table columns
  const columns = useMemo(
    () => [
      columnHelper.accessor('entry_number', {
        header: '#',
        size: 50,
        cell: (info) => (
          <span style={{ fontFamily: 'var(--ps-font-mono)', fontWeight: 600 }}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('date_of_transaction', {
        header: 'Date',
        size: 100,
        cell: (info) => {
          const d = info.getValue()
          return d ? new Date(d).toLocaleDateString('en-GB') : '—'
        },
      }),
      columnHelper.accessor('transaction_type', {
        header: 'Type',
        size: 60,
        cell: (info) => {
          const t = info.getValue()
          const isIn = t === 'receipt' || t === 'transfer_in' || t === 'patient_return'
          return (
            <span className={`ps-badge ${isIn ? 'ps-badge-green' : 'ps-badge-amber'}`}>
              {isIn ? 'IN' : 'OUT'}
            </span>
          )
        },
      }),
      columnHelper.accessor('supplier_name', {
        header: 'Supplier / Invoice',
        size: 180,
        cell: (info) => {
          const row = info.row.original
          if (row.supplier_name) {
            return (
              <span>
                {row.supplier_name}
                {row.invoice_number && (
                  <span style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-xs)', marginLeft: '4px' }}>
                    ({row.invoice_number})
                  </span>
                )}
              </span>
            )
          }
          return '—'
        },
      }),
      columnHelper.accessor('patient_name', {
        header: 'Patient / Address',
        size: 180,
        cell: (info) => {
          const row = info.row.original
          if (row.patient_name) {
            return (
              <span>
                {row.patient_name}
                {row.patient_address && (
                  <span style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-xs)', display: 'block' }}>
                    {row.patient_address}
                  </span>
                )}
              </span>
            )
          }
          return '—'
        },
      }),
      columnHelper.accessor('prescriber_name', {
        header: 'Prescriber',
        size: 140,
        cell: (info) => info.getValue() || '—',
      }),
      columnHelper.accessor('quantity_received', {
        header: 'In',
        size: 60,
        cell: (info) => {
          const v = info.getValue()
          return v !== null && v !== undefined ? (
            <span style={{ color: 'var(--ps-success)', fontWeight: 600 }}>+{v}</span>
          ) : (
            ''
          )
        },
      }),
      columnHelper.accessor('quantity_deducted', {
        header: 'Out',
        size: 60,
        cell: (info) => {
          const v = info.getValue()
          return v !== null && v !== undefined ? (
            <span style={{ color: 'var(--ps-error)', fontWeight: 600 }}>-{v}</span>
          ) : (
            ''
          )
        },
      }),
      columnHelper.accessor('running_balance', {
        header: 'Balance',
        size: 70,
        cell: (info) => (
          <strong style={{ fontFamily: 'var(--ps-font-mono)' }}>{info.getValue() ?? '—'}</strong>
        ),
      }),
      columnHelper.display({
        id: 'entered_by_name',
        header: 'Entered By',
        size: 120,
        cell: (info) => {
          const row = info.row.original
          return row.entered_by_profile?.full_name || row.authorised_by || '—'
        },
      }),
      columnHelper.accessor('entry_type', {
        header: '',
        size: 30,
        enableSorting: false,
        cell: (info) => {
          if (info.getValue() === 'correction') {
            return <span title="Correction entry" className="ps-badge ps-badge-red">C</span>
          }
          return null
        },
      }),
    ] as ColumnDef<RegisterEntry, unknown>[],
    [],
  )

  const handleEntrySuccess = (entry: RegisterEntry) => {
    setEntries([...entries, entry])
    setDrawerOpen(false)
    loadLedger()
  }

  const openDrawer = (dir: 'in' | 'out') => {
    setEntryDirection(dir)
    setDrawerOpen(true)
  }

  // ============================================
  // Inline Provision Row (quick OUT entry)
  // ============================================
  const [provDate, setProvDate] = useState(new Date().toISOString().split('T')[0])
  const [provPatient, setProvPatient] = useState('')
  const [provAddress, setProvAddress] = useState('')
  const [provPrescriber, setProvPrescriber] = useState('')
  const [provQty, setProvQty] = useState('')
  const [provSaving, setProvSaving] = useState(false)
  const [provError, setProvError] = useState<string | null>(null)

  // Contact suggestions
  const [provPatientSugg, setProvPatientSugg] = useState<KnownContact[]>([])
  const [provPrescriberSugg, setProvPrescriberSugg] = useState<KnownContact[]>([])
  const [showProvPatientSugg, setShowProvPatientSugg] = useState(false)
  const [showProvPrescriberSugg, setShowProvPrescriberSugg] = useState(false)
  const patientInputRef = useRef<HTMLInputElement>(null)

  const searchProvContacts = useCallback(
    async (query: string, type: 'patient' | 'prescriber') => {
      if (!organisation || query.length < 2) {
        if (type === 'patient') setProvPatientSugg([])
        else setProvPrescriberSugg([])
        return
      }
      const { data } = await getUserClient()
        .from('ps_known_contacts')
        .select('*')
        .eq('organisation_id', organisation.id)
        .eq('contact_type', type)
        .ilike('search_key', `%${query.toLowerCase()}%`)
        .order('usage_count', { ascending: false })
        .limit(5)
      if (data) {
        if (type === 'patient') setProvPatientSugg(data)
        else setProvPrescriberSugg(data)
      }
    },
    [organisation],
  )

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (provPatient.length >= 2) searchProvContacts(provPatient, 'patient')
      else setProvPatientSugg([])
    }, 300)
    return () => clearTimeout(timer)
  }, [provPatient, searchProvContacts])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (provPrescriber.length >= 2) searchProvContacts(provPrescriber, 'prescriber')
      else setProvPrescriberSugg([])
    }, 300)
    return () => clearTimeout(timer)
  }, [provPrescriber, searchProvContacts])

  const selectProvContact = (contact: KnownContact, type: 'patient' | 'prescriber') => {
    if (type === 'patient') {
      setProvPatient(contact.full_name)
      setProvAddress(
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setShowProvPatientSugg(false)
      setProvPatientSugg([])
    } else {
      setProvPrescriber(contact.full_name)
      setShowProvPrescriberSugg(false)
      setProvPrescriberSugg([])
    }
  }

  const resetProvisionRow = () => {
    setProvDate(new Date().toISOString().split('T')[0])
    setProvPatient('')
    setProvAddress('')
    setProvPrescriber('')
    setProvQty('')
    setProvError(null)
  }

  const submitProvision = async () => {
    if (!activeLedger || !activeUser) return
    if (!provPatient.trim()) { setProvError('Patient required'); return }
    if (!provPrescriber.trim()) { setProvError('Prescriber required'); return }
    const qty = parseFloat(provQty)
    if (!qty || qty <= 0) { setProvError('Valid quantity required'); return }

    setProvSaving(true)
    setProvError(null)

    try {
      const { data: entry, error } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: activeLedger.id,
        p_register_type: activeLedger.register_type,
        p_entry_type: 'normal',
        p_date_of_transaction: provDate,
        p_notes: null,
        p_source: 'manual',
        p_expected_lock_version: activeLedger.lock_version,
        p_transaction_type: 'supply',
        p_quantity_received: null,
        p_quantity_deducted: qty,
        p_entered_by: activeUser.id,
        p_supplier_name: null,
        p_invoice_number: null,
        p_patient_name: provPatient,
        p_patient_address: provAddress || null,
        p_prescriber_name: provPrescriber,
        p_prescriber_address: null,
        p_prescription_date: null,
        p_witness_name: null,
        p_witness_role: null,
        p_authorised_by: activeUser.full_name,
      })

      if (error) {
        if (error.message.includes('CONFLICT')) {
          setProvError('Conflict — refresh and retry')
        } else {
          setProvError(error.message)
        }
        return
      }

      setEntries([...entries, entry as RegisterEntry])
      loadLedger()
      resetProvisionRow()
      patientInputRef.current?.focus()
    } catch (err) {
      setProvError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setProvSaving(false)
    }
  }

  const handleProvKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitProvision()
    }
  }

  const provisionFooterRow = activeLedger ? (
    <tr className="inline-provision-row" onKeyDown={handleProvKeyDown}>
      <td>{/* # auto */}</td>
      <td>
        <input
          type="date"
          className="prov-input"
          value={provDate}
          onChange={(e) => setProvDate(e.target.value)}
        />
      </td>
      <td>
        <span className="entry-direction-badge entry-out" style={{ fontSize: '10px' }}>OUT</span>
      </td>
      <td>{/* supplier — N/A for provision */}</td>
      <td style={{ position: 'relative' }}>
        <input
          ref={patientInputRef}
          className="prov-input"
          placeholder="Patient name"
          value={provPatient}
          onChange={(e) => setProvPatient(e.target.value)}
          onFocus={() => setShowProvPatientSugg(true)}
          onBlur={() => setTimeout(() => setShowProvPatientSugg(false), 200)}
        />
        {showProvPatientSugg && provPatientSugg.length > 0 && (
          <div className="autocomplete-dropdown" style={{ bottom: '100%', top: 'auto' }}>
            {provPatientSugg.map((c) => (
              <button
                key={c.id}
                type="button"
                className="autocomplete-item"
                onClick={() => selectProvContact(c, 'patient')}
              >
                <span className="autocomplete-name">{c.full_name}</span>
                {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
              </button>
            ))}
          </div>
        )}
      </td>
      <td style={{ position: 'relative' }}>
        <input
          className="prov-input"
          placeholder="Prescriber"
          value={provPrescriber}
          onChange={(e) => setProvPrescriber(e.target.value)}
          onFocus={() => setShowProvPrescriberSugg(true)}
          onBlur={() => setTimeout(() => setShowProvPrescriberSugg(false), 200)}
        />
        {showProvPrescriberSugg && provPrescriberSugg.length > 0 && (
          <div className="autocomplete-dropdown" style={{ bottom: '100%', top: 'auto' }}>
            {provPrescriberSugg.map((c) => (
              <button
                key={c.id}
                type="button"
                className="autocomplete-item"
                onClick={() => selectProvContact(c, 'prescriber')}
              >
                <span className="autocomplete-name">{c.full_name}</span>
              </button>
            ))}
          </div>
        )}
      </td>
      <td>{/* In — blank */}</td>
      <td>
        <input
          type="number"
          className="prov-input prov-qty"
          placeholder="Qty"
          step="any"
          min="0"
          value={provQty}
          onChange={(e) => setProvQty(e.target.value)}
        />
      </td>
      <td>{/* Balance — auto */}</td>
      <td style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)' }}>
        {activeUser?.full_name}
      </td>
      <td>
        <button
          type="button"
          className="ps-btn ps-btn-primary prov-save-btn"
          onClick={submitProvision}
          disabled={provSaving}
          title="Save entry (Enter)"
        >
          {provSaving ? '...' : '✓'}
        </button>
      </td>
    </tr>
  ) : null

  return (
    <div>
      {/* Breadcrumbs */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/registers" onClick={(e) => { e.preventDefault(); navigate('/registers') }}>Registers</a>
          <span className="separator">/</span>
          <a href="/registers/cd" onClick={(e) => { e.preventDefault(); navigate('/registers/cd') }}>CD Register</a>
          <span className="separator">/</span>
          <span>{drug?.drug_brand ?? 'Loading...'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <div>
            <h1>📋 {drug?.drug_brand ?? 'Loading...'}</h1>
            {drug && (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: '2px' }}>
                {drug.drug_form} — {drug.drug_strength} — {drug.drug_class} — {drug.drug_type}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center' }}>
            {activeLedger && (
              <div className="ledger-balance-badge">
                <span>Balance</span>
                <strong>{activeLedger.current_balance}</strong>
              </div>
            )}
            <button
              className="ps-btn ps-btn-success"
              onClick={() => openDrawer('in')}
              disabled={!activeLedger}
            >
              📥 IN
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => openDrawer('out')}
              disabled={!activeLedger}
            >
              📤 OUT
            </button>
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 'var(--ps-space-md)', maxWidth: '300px' }}>
        <input
          className="ps-input"
          placeholder="Search entries..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
      </div>

      {/* Entries Table */}
      <RegisterTable
        data={entries}
        columns={columns}
        loading={entriesLoading}
        emptyMessage="No entries yet. Click IN or OUT to record your first entry."
        globalFilter={searchFilter}
        onGlobalFilterChange={setSearchFilter}
        footerRow={provisionFooterRow}
      />

      {provError && (
        <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)', maxWidth: '500px' }}>
          {provError}
        </div>
      )}

      {/* Entry Drawer */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={entryDirection === 'in' ? '📥 Receive Stock IN' : '📤 Supply Stock OUT'}
        width="560px"
      >
        <CDEntryForm
          direction={entryDirection}
          onSuccess={handleEntrySuccess}
          onCancel={() => setDrawerOpen(false)}
        />
      </Drawer>
    </div>
  )
}
