// ============================================
// CDLedgerPage — View & manage entries for a specific drug
// Inline entry row auto-determines IN/OUT from which field
// is filled first (supplier = IN, patient = OUT)
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
import { ContactModal } from '../../components/ContactModal'
import { Modal } from '../../components/Modal'
import { ScanImageBadge } from '../../components/scan/ScanImageBadge'

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

  // Table columns — no separate "Type" column; IN/OUT direction is
  // inferred from which amount field is populated. Single "Amount" column.
  // ID check is a yes/no field. Multi-line cells for patient & supplier.
  const columns = useMemo(
    () => [
      columnHelper.accessor('entry_number', {
        header: '#',
        size: 70,
        cell: (info) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontFamily: 'var(--ps-font-mono)', fontWeight: 600 }}>
              {info.getValue()}
            </span>
            {info.row.original.scan_image_path && (
              <ScanImageBadge imagePath={info.row.original.scan_image_path} />
            )}
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
      columnHelper.accessor('supplier_name', {
        header: 'Supplier',
        size: 180,
        cell: (info) => {
          const row = info.row.original
          if (row.supplier_name) {
            return (
              <div className="cell-multiline">
                <span className="cell-primary">{row.supplier_name}</span>
                {row.invoice_number && (
                  <span className="cell-secondary">Inv: {row.invoice_number}</span>
                )}
              </div>
            )
          }
          return <span className="cell-na">—</span>
        },
      }),
      columnHelper.accessor('patient_name', {
        header: 'Patient',
        size: 180,
        cell: (info) => {
          const row = info.row.original
          if (row.patient_name) {
            return (
              <div className="cell-multiline">
                <span className="cell-primary">{row.patient_name}</span>
                {row.patient_address && (
                  <span className="cell-secondary">{row.patient_address}</span>
                )}
              </div>
            )
          }
          return <span className="cell-na">—</span>
        },
      }),
      columnHelper.accessor('prescriber_name', {
        header: 'Prescriber',
        size: 160,
        cell: (info) => {
          const row = info.row.original
          if (row.prescriber_name) {
            return (
              <div className="cell-multiline">
                <span className="cell-primary">{row.prescriber_name}</span>
                {row.prescriber_registration && (
                  <span className="cell-secondary">Reg: {row.prescriber_registration}</span>
                )}
              </div>
            )
          }
          return <span className="cell-na">—</span>
        },
      }),
      columnHelper.display({
        id: 'id_check',
        header: 'ID Req / Given',
        size: 140,
        cell: (info) => {
          const row = info.row.original
          if (!row.patient_name) return <span className="cell-na">—</span>
          const requested = row.was_id_requested
          const provided = row.was_id_provided
          const reqLabel = requested ? 'Yes' : 'No'
          const provLabel = provided ? 'Yes' : 'No'
          const color = requested && provided
            ? 'ps-badge-green'
            : requested && !provided
            ? 'ps-badge-amber'
            : ''
          return (
            <span className={`ps-badge ${color}`} style={!color ? { background: 'var(--ps-off-white)', color: 'var(--ps-mist)' } : undefined}>
              {reqLabel}/{provLabel}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'amount',
        header: 'Amount',
        size: 80,
        cell: (info) => {
          const row = info.row.original
          if (row.quantity_received !== null && row.quantity_received !== undefined) {
            return (
              <span style={{ color: 'var(--ps-success)', fontWeight: 600, fontFamily: 'var(--ps-font-mono)' }}>
                +{row.quantity_received}
              </span>
            )
          }
          if (row.quantity_deducted !== null && row.quantity_deducted !== undefined) {
            return (
              <span style={{ color: 'var(--ps-error)', fontWeight: 600, fontFamily: 'var(--ps-font-mono)' }}>
                -{row.quantity_deducted}
              </span>
            )
          }
          return '—'
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
  // Inline Entry Row — auto-determines IN/OUT
  // Supplier field = IN, Patient field = OUT
  // All other fields stay locked until direction is determined
  // ============================================
  const [provDate, setProvDate] = useState(new Date().toISOString().split('T')[0])
  const [provSupplier, setProvSupplier] = useState('')
  const [provInvoice, setProvInvoice] = useState('')
  const [provPatient, setProvPatient] = useState('')
  const [provAddress, setProvAddress] = useState('')
  const [provPrescriber, setProvPrescriber] = useState('')
  const [provPrescriberAddr, setProvPrescriberAddr] = useState('')
  const [provPrescriberReg, setProvPrescriberReg] = useState('')
  const [provIdRequested, setProvIdRequested] = useState(false)
  const [provIdProvided, setProvIdProvided] = useState(false)
  const [provQty, setProvQty] = useState('')
  const [provSaving, setProvSaving] = useState(false)
  const [provError, setProvError] = useState<string | null>(null)
  const [showNegativeBalanceConfirm, setShowNegativeBalanceConfirm] = useState(false)

  // Direction is determined by which field the user fills first
  // null = undetermined, 'in' = supplier filled first, 'out' = patient filled first
  const [entryMode, setEntryMode] = useState<'in' | 'out' | null>(null)

  // Selected contact references (for edit button)
  const [selectedPatientContact, setSelectedPatientContact] = useState<KnownContact | null>(null)
  const [selectedPrescriberContact, setSelectedPrescriberContact] = useState<KnownContact | null>(null)
  const [selectedSupplierContact, setSelectedSupplierContact] = useState<KnownContact | null>(null)

  // Contact suggestions
  const [provPatientSugg, setProvPatientSugg] = useState<KnownContact[]>([])
  const [provPrescriberSugg, setProvPrescriberSugg] = useState<KnownContact[]>([])
  const [provSupplierSugg, setProvSupplierSugg] = useState<KnownContact[]>([])
  const [showProvPatientSugg, setShowProvPatientSugg] = useState(false)
  const [showProvPrescriberSugg, setShowProvPrescriberSugg] = useState(false)
  const [showProvSupplierSugg, setShowProvSupplierSugg] = useState(false)
  const supplierInputRef = useRef<HTMLInputElement>(null)
  const patientInputRef = useRef<HTMLInputElement>(null)

  // Contact modal state
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [contactModalType, setContactModalType] = useState<'patient' | 'prescriber' | 'supplier'>('patient')
  const [contactModalEdit, setContactModalEdit] = useState<KnownContact | null>(null)
  const [contactModalInitialName, setContactModalInitialName] = useState('')

  // Negative balance warning modal
  const [showNegativeWarning, setShowNegativeWarning] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState(false)

  // Previous invoice from localStorage
  const { lastInvoice, setLastInvoice } = useRegisterStore()

  // Auto-determine direction when user starts typing
  const handleSupplierChange = (value: string) => {
    setProvSupplier(value)
    if (value.trim() && !entryMode) {
      setEntryMode('in')
    }
  }

  const handlePatientChange = (value: string) => {
    setProvPatient(value)
    if (value.trim() && !entryMode) {
      setEntryMode('out')
    }
  }

  // Search contacts
  const searchProvContacts = useCallback(
    async (query: string, type: 'patient' | 'prescriber' | 'supplier') => {
      if (!organisation || query.length < 2) {
        if (type === 'patient') setProvPatientSugg([])
        else if (type === 'prescriber') setProvPrescriberSugg([])
        else setProvSupplierSugg([])
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
        else if (type === 'prescriber') setProvPrescriberSugg(data)
        else setProvSupplierSugg(data)
      }
    },
    [organisation],
  )

  // Debounced search for patient
  useEffect(() => {
    const timer = setTimeout(() => {
      if (provPatient.length >= 2) searchProvContacts(provPatient, 'patient')
      else setProvPatientSugg([])
    }, 300)
    return () => clearTimeout(timer)
  }, [provPatient, searchProvContacts])

  // Debounced search for prescriber
  useEffect(() => {
    const timer = setTimeout(() => {
      if (provPrescriber.length >= 2) searchProvContacts(provPrescriber, 'prescriber')
      else setProvPrescriberSugg([])
    }, 300)
    return () => clearTimeout(timer)
  }, [provPrescriber, searchProvContacts])

  // Debounced search for supplier
  useEffect(() => {
    const timer = setTimeout(() => {
      if (provSupplier.length >= 2) searchProvContacts(provSupplier, 'supplier')
      else setProvSupplierSugg([])
    }, 300)
    return () => clearTimeout(timer)
  }, [provSupplier, searchProvContacts])

  // Auto-populate last prescriber & ID answer for selected patient
  const autoPopulateForPatient = useCallback(async (patientName: string) => {
    if (!activeLedger || !patientName) return
    // Find last entry for this patient in this ledger
    const { data } = await getUserClient()
      .from('ps_register_entries')
      .select('prescriber_name, prescriber_address, was_id_requested, was_id_provided')
      .eq('ledger_id', activeLedger.id)
      .eq('patient_name', patientName)
      .order('entered_at', { ascending: false })
      .limit(1)

    if (data && data.length > 0) {
      const last = data[0]
      if (last.prescriber_name && !provPrescriber) {
        setProvPrescriber(last.prescriber_name)
      }
      if (last.prescriber_address && !provPrescriberAddr) {
        setProvPrescriberAddr(last.prescriber_address)
      }
      // Auto-fill ID check from last entry
      if (last.was_id_requested !== undefined) {
        setProvIdRequested(!!last.was_id_requested)
      }
      if (last.was_id_provided !== undefined) {
        setProvIdProvided(!!last.was_id_provided)
      }
    }
  }, [activeLedger, provPrescriber, provPrescriberAddr])

  const selectProvContact = (contact: KnownContact, type: 'patient' | 'prescriber' | 'supplier') => {
    if (type === 'patient') {
      setProvPatient(contact.full_name)
      setProvAddress(
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setSelectedPatientContact(contact)
      setShowProvPatientSugg(false)
      setProvPatientSugg([])
      if (!entryMode) setEntryMode('out')
      // Auto-populate prescriber and ID from last entry for this patient
      autoPopulateForPatient(contact.full_name)
    } else if (type === 'prescriber') {
      setProvPrescriber(contact.full_name)
      setProvPrescriberAddr(
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setProvPrescriberReg(contact.gmc_number ?? '')
      setSelectedPrescriberContact(contact)
      setShowProvPrescriberSugg(false)
      setProvPrescriberSugg([])
    } else {
      setProvSupplier(contact.full_name)
      setSelectedSupplierContact(contact)
      setShowProvSupplierSugg(false)
      setProvSupplierSugg([])
      if (!entryMode) setEntryMode('in')
    }
  }

  // Open contact modal for "Add New"
  const openAddContactModal = (type: 'patient' | 'prescriber' | 'supplier', initialName: string) => {
    setContactModalType(type)
    setContactModalEdit(null)
    setContactModalInitialName(initialName)
    setContactModalOpen(true)
  }

  // Open contact modal for "Edit"
  const openEditContactModal = (type: 'patient' | 'prescriber' | 'supplier', contact: KnownContact) => {
    setContactModalType(type)
    setContactModalEdit(contact)
    setContactModalInitialName('')
    setContactModalOpen(true)
  }

  // Handle contact modal save
  const handleContactSaved = (contact: KnownContact) => {
    setContactModalOpen(false)
    if (contactModalType === 'patient') {
      setProvPatient(contact.full_name)
      setProvAddress(
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setSelectedPatientContact(contact)
      if (!entryMode) setEntryMode('out')
    } else if (contactModalType === 'prescriber') {
      setProvPrescriber(contact.full_name)
      setProvPrescriberAddr(
        [contact.address_line_1, contact.city, contact.postcode].filter(Boolean).join(', '),
      )
      setProvPrescriberReg(contact.gmc_number ?? '')
      setSelectedPrescriberContact(contact)
    } else {
      setProvSupplier(contact.full_name)
      setSelectedSupplierContact(contact)
      if (!entryMode) setEntryMode('in')
    }
  }

  const resetProvisionRow = () => {
    setProvDate(new Date().toISOString().split('T')[0])
    setProvSupplier('')
    setProvInvoice('')
    setProvPatient('')
    setProvAddress('')
    setProvPrescriber('')
    setProvPrescriberAddr('')
    setProvPrescriberReg('')
    setProvIdRequested(false)
    setProvIdProvided(false)
    setProvQty('')
    setProvError(null)
    setEntryMode(null)
    setSelectedPatientContact(null)
    setSelectedPrescriberContact(null)
    setSelectedSupplierContact(null)
  }

  // Check if submitting would cause negative balance
  const wouldGoNegative = () => {
    if (!activeLedger || entryMode !== 'out') return false
    const qty = parseFloat(provQty)
    if (!qty || qty <= 0) return false
    return (activeLedger.current_balance - qty) < 0
  }

  const submitProvision = async (forceNegative = false) => {
    if (!activeLedger || !activeUser) return
    const isIn = entryMode === 'in'

    // Validate
    if (!entryMode) { setProvError('Enter a supplier (IN) or patient (OUT) first'); return }
    if (isIn && !provSupplier.trim()) { setProvError('Supplier required'); return }
    if (!isIn && !provPatient.trim()) { setProvError('Patient required'); return }
    if (!isIn && !provPrescriber.trim()) { setProvError('Prescriber required'); return }
    const qty = parseFloat(provQty)
    if (!qty || qty <= 0) { setProvError('Valid quantity required'); return }

    // Negative balance warning — show confirmation modal instead of blocking
    if (!isIn && !forceNegative && (activeLedger.current_balance - qty) < 0) {
      setShowNegativeBalanceConfirm(true)
      return
    }

    setProvSaving(true)
    setProvError(null)
    setShowNegativeBalanceConfirm(false)

    try {
      const { data: entry, error } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: activeLedger.id,
        p_register_type: activeLedger.register_type,
        p_entry_type: 'normal',
        p_date_of_transaction: provDate,
        p_notes: null,
        p_source: 'manual',
        p_expected_lock_version: activeLedger.lock_version,
        p_transaction_type: isIn ? 'receipt' : 'supply',
        p_quantity_received: isIn ? qty : null,
        p_quantity_deducted: isIn ? null : qty,
        p_entered_by: activeUser.id,
        p_supplier_name: isIn ? provSupplier : null,
        p_invoice_number: isIn ? (provInvoice || null) : null,
        p_patient_name: !isIn ? provPatient : null,
        p_patient_address: !isIn ? (provAddress || null) : null,
        p_prescriber_name: !isIn ? provPrescriber : null,
        p_prescriber_address: !isIn ? (provPrescriberAddr || null) : null,
        p_prescriber_registration: !isIn ? (provPrescriberReg || null) : null,
        p_prescription_date: null,
        p_witness_name: null,
        p_witness_role: null,
        p_authorised_by: activeUser.full_name,
        p_was_id_requested: !isIn ? provIdRequested : null,
        p_was_id_provided: !isIn ? provIdProvided : null,
      })

      if (error) {
        if (error.message.includes('CONFLICT')) {
          setProvError('Conflict — refresh and retry')
        } else {
          setProvError(error.message)
        }
        return
      }

      // Save invoice to localStorage for reuse across registers
      if (isIn && provInvoice.trim()) {
        setLastInvoice(provInvoice.trim())
      }

      setEntries([...entries, entry as RegisterEntry])
      loadLedger()
      resetProvisionRow()
      // Focus appropriate field for next entry
      if (isIn) supplierInputRef.current?.focus()
      else patientInputRef.current?.focus()
    } catch (err) {
      setProvError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setProvSaving(false)
    }
  }

  const handleProvKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitProvision(false)
    }
  }

  // ============================================
  // Autocomplete dropdown renderer with "Add New" at bottom
  // ============================================
  const renderContactDropdown = (
    suggestions: KnownContact[],
    show: boolean,
    type: 'patient' | 'prescriber' | 'supplier',
    inputValue: string,
    onSelect: (c: KnownContact) => void,
    onHide: () => void,
  ) => {
    if (!show) return null
    const hasResults = suggestions.length > 0
    if (!hasResults && inputValue.length < 2) return null

    return (
      <div className="autocomplete-dropdown" style={{ bottom: '100%', top: 'auto' }}>
        {suggestions.map((c) => (
          <button
            key={c.id}
            type="button"
            className="autocomplete-item"
            onClick={() => onSelect(c)}
          >
            <div className="autocomplete-item-left">
              <span className="autocomplete-name">{c.full_name}</span>
              {c.gmc_number && <span className="autocomplete-detail">Reg: {c.gmc_number}</span>}
              {c.postcode && <span className="autocomplete-detail">{c.postcode}</span>}
              {c.address_line_1 && (
                <span className="autocomplete-detail">{c.address_line_1}</span>
              )}
            </div>
          </button>
        ))}
        {/* Add New button always at bottom */}
        <button
          type="button"
          className="autocomplete-item autocomplete-add-new"
          onClick={() => {
            onHide()
            openAddContactModal(type, inputValue)
          }}
        >
          <span className="autocomplete-name">＋ Add new {type}</span>
          {inputValue.length >= 2 && (
            <span className="autocomplete-detail">"{inputValue}"</span>
          )}
        </button>
      </div>
    )
  }

  // ============================================
  // Selected contact display with edit icon
  // ============================================
  const renderSelectedContact = (
    contact: KnownContact | null,
    type: 'patient' | 'prescriber' | 'supplier',
    onClear: () => void,
  ) => {
    if (!contact) return null
    return (
      <div className="selected-contact-badge">
        <span className="selected-contact-name">{contact.full_name}</span>
        <button
          type="button"
          className="selected-contact-edit"
          title="Edit details"
          onClick={() => openEditContactModal(type, contact)}
        >
          ✎
        </button>
        <button
          type="button"
          className="selected-contact-clear"
          title="Clear"
          onClick={onClear}
        >
          ×
        </button>
      </div>
    )
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
      {/* Supplier cell — locked when mode is OUT */}
      <td style={{ position: 'relative' }}>
        <div className={`prov-cell-wrap ${entryMode === 'out' ? 'prov-locked' : ''}`}>
          {selectedSupplierContact
            ? renderSelectedContact(selectedSupplierContact, 'supplier', () => {
                setSelectedSupplierContact(null)
                setProvSupplier('')
                if (entryMode === 'in') setEntryMode(null)
              })
            : (
              <input
                ref={supplierInputRef}
                className="prov-input"
                placeholder={entryMode === 'out' ? '—' : 'Supplier'}
                value={provSupplier}
                onChange={(e) => handleSupplierChange(e.target.value)}
                onFocus={() => setShowProvSupplierSugg(true)}
                onBlur={() => setTimeout(() => setShowProvSupplierSugg(false), 200)}
                disabled={entryMode === 'out'}
              />
            )
          }
          {entryMode !== 'out' && renderContactDropdown(
            provSupplierSugg,
            showProvSupplierSugg,
            'supplier',
            provSupplier,
            (c) => selectProvContact(c, 'supplier'),
            () => setShowProvSupplierSugg(false),
          )}
          {/* Invoice sub-field, shown when supplier is set */}
          {entryMode === 'in' && provSupplier.trim() && (
            <div className="prov-invoice-field">
              <input
                className="prov-input prov-invoice-input"
                placeholder="Invoice #"
                value={provInvoice}
                onChange={(e) => setProvInvoice(e.target.value)}
              />
              {lastInvoice && !provInvoice && (
                <button
                  type="button"
                  className="prov-use-previous"
                  onClick={() => setProvInvoice(lastInvoice)}
                  title={`Use previous: ${lastInvoice}`}
                >
                  ↩ Use previous
                </button>
              )}
            </div>
          )}
        </div>
      </td>
      {/* Patient cell — locked when mode is IN */}
      <td style={{ position: 'relative' }}>
        <div className={`prov-cell-wrap ${entryMode === 'in' ? 'prov-locked' : ''}`}>
          {selectedPatientContact
            ? (
              <div>
                {renderSelectedContact(selectedPatientContact, 'patient', () => {
                  setSelectedPatientContact(null)
                  setProvPatient('')
                  setProvAddress('')
                  if (entryMode === 'out') setEntryMode(null)
                })}
                {provAddress && (
                  <span className="prov-address-line">{provAddress}</span>
                )}
              </div>
            )
            : (
              <input
                ref={patientInputRef}
                className="prov-input"
                placeholder={entryMode === 'in' ? '—' : 'Patient name'}
                value={provPatient}
                onChange={(e) => handlePatientChange(e.target.value)}
                onFocus={() => setShowProvPatientSugg(true)}
                onBlur={() => setTimeout(() => setShowProvPatientSugg(false), 200)}
                disabled={entryMode === 'in'}
              />
            )
          }
          {entryMode !== 'in' && renderContactDropdown(
            provPatientSugg,
            showProvPatientSugg,
            'patient',
            provPatient,
            (c) => selectProvContact(c, 'patient'),
            () => setShowProvPatientSugg(false),
          )}
        </div>
      </td>
      {/* Prescriber cell — locked unless mode is OUT */}
      <td style={{ position: 'relative' }}>
        <div className={`prov-cell-wrap ${entryMode !== 'out' ? 'prov-locked' : ''}`}>
          {selectedPrescriberContact
            ? (
              <div>
                {renderSelectedContact(selectedPrescriberContact, 'prescriber', () => {
                  setSelectedPrescriberContact(null)
                  setProvPrescriber('')
                  setProvPrescriberAddr('')
                  setProvPrescriberReg('')
                })}
                {provPrescriberReg && (
                  <span className="prov-address-line">Reg: {provPrescriberReg}</span>
                )}
              </div>
            )
            : (
              <input
                className="prov-input"
                placeholder={entryMode === 'out' ? 'Prescriber' : '—'}
                value={provPrescriber}
                onChange={(e) => setProvPrescriber(e.target.value)}
                onFocus={() => setShowProvPrescriberSugg(true)}
                onBlur={() => setTimeout(() => setShowProvPrescriberSugg(false), 200)}
                disabled={entryMode !== 'out'}
              />
            )
          }
          {entryMode === 'out' && renderContactDropdown(
            provPrescriberSugg,
            showProvPrescriberSugg,
            'prescriber',
            provPrescriber,
            (c) => selectProvContact(c, 'prescriber'),
            () => setShowProvPrescriberSugg(false),
          )}
        </div>
      </td>
      {/* ID check cell — single dropdown: Requested/Provided — disabled unless mode is OUT */}
      <td>
        <div className={`prov-cell-wrap prov-id-cell ${entryMode !== 'out' ? 'prov-locked' : ''}`}>
          <select
            className="prov-input prov-id-select"
            value={
              provIdRequested && provIdProvided ? 'yes/yes'
              : provIdRequested && !provIdProvided ? 'yes/no'
              : !provIdRequested && provIdProvided ? 'no/yes'
              : 'no/no'
            }
            onChange={(e) => {
              const v = e.target.value
              setProvIdRequested(v === 'yes/yes' || v === 'yes/no')
              setProvIdProvided(v === 'yes/yes' || v === 'no/yes')
            }}
            disabled={entryMode !== 'out'}
          >
            <option value="no/no">No / No</option>
            <option value="yes/no">Yes / No</option>
            <option value="yes/yes">Yes / Yes</option>
            <option value="no/yes">No / Yes</option>
          </select>
        </div>
      </td>
      {/* Amount (single column) — locked until direction is chosen */}
      <td>
        <div className={`prov-cell-wrap ${!entryMode ? 'prov-locked' : ''}`}>
          <input
            type="number"
            className="prov-input prov-qty"
            placeholder={entryMode ? 'Qty' : '—'}
            step="any"
            min="0"
            value={provQty}
            onChange={(e) => setProvQty(e.target.value)}
            disabled={!entryMode}
          />
        </div>
      </td>
      <td>
        {/* Auto-calculated new balance preview */}
        {entryMode && provQty && activeLedger ? (
          (() => {
            const qty = parseFloat(provQty) || 0
            const newBal = entryMode === 'in'
              ? activeLedger.current_balance + qty
              : activeLedger.current_balance - qty
            const isNeg = newBal < 0
            return (
              <div className="prov-new-balance">
                <span className="prov-new-balance-label">New bal:</span>
                <strong
                  className="prov-new-balance-value"
                  style={{ color: isNeg ? 'var(--ps-error)' : 'var(--ps-success)' }}
                >
                  {newBal}
                </strong>
              </div>
            )
          })()
        ) : (
          <strong style={{ fontFamily: 'var(--ps-font-mono)' }}>{activeLedger?.current_balance ?? '—'}</strong>
        )}
      </td>
      <td style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-mist)' }}>
        {activeUser?.full_name}
      </td>
      <td>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className="ps-btn ps-btn-primary prov-save-btn"
            onClick={() => submitProvision(false)}
            disabled={provSaving}
            title="Save entry (Enter)"
          >
            {provSaving ? '...' : '✓'}
          </button>
          {entryMode && (
            <button
              type="button"
              className="ps-btn ps-btn-ghost prov-save-btn"
              onClick={resetProvisionRow}
              title="Reset"
            >
              ↺
            </button>
          )}
        </div>
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
            {/* Direction indicator based on current entry mode */}
            {entryMode && (
              <span className={`entry-direction-badge ${entryMode === 'in' ? 'entry-in' : 'entry-out'}`}>
                {entryMode === 'in' ? '📥 IN' : '📤 OUT'}
              </span>
            )}
            <button
              className="ps-btn ps-btn-success"
              onClick={() => openDrawer('in')}
              disabled={!activeLedger}
              title="Open full IN form"
            >
              📥 Full IN
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => openDrawer('out')}
              disabled={!activeLedger}
              title="Open full OUT form"
            >
              📤 Full OUT
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
        emptyMessage="No entries yet. Start by entering a supplier (IN) or patient (OUT) in the row below."
        globalFilter={searchFilter}
        onGlobalFilterChange={setSearchFilter}
        footerRow={provisionFooterRow}
      />

      {provError && (
        <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)', maxWidth: '500px' }}>
          {provError}
        </div>
      )}

      {/* Entry Drawer (full form) */}
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

      {/* Contact Add/Edit Modal */}
      <ContactModal
        isOpen={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        contactType={contactModalType}
        existingContact={contactModalEdit}
        initialName={contactModalInitialName}
        onSaved={handleContactSaved}
        onDeleted={(deletedId) => {
          setContactModalOpen(false)
          // Clear the selected contact if it was the one deleted
          if (selectedPatientContact?.id === deletedId) {
            setSelectedPatientContact(null)
            setProvPatient('')
            setProvAddress('')
            if (entryMode === 'out') setEntryMode(null)
          }
          if (selectedPrescriberContact?.id === deletedId) {
            setSelectedPrescriberContact(null)
            setProvPrescriber('')
            setProvPrescriberAddr('')
            setProvPrescriberReg('')
          }
          if (selectedSupplierContact?.id === deletedId) {
            setSelectedSupplierContact(null)
            setProvSupplier('')
            if (entryMode === 'in') setEntryMode(null)
          }
        }}
      />

      {/* Negative Balance Confirmation Modal */}
      <Modal
        isOpen={showNegativeBalanceConfirm}
        onClose={() => setShowNegativeBalanceConfirm(false)}
        title="⚠️ Negative Balance Warning"
        width="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          <div className="add-register-confirm-warning" style={{ marginTop: 0 }}>
            Submitting this entry will cause the balance to go <strong>negative</strong>.
            <br /><br />
            <strong>Current balance:</strong> {activeLedger?.current_balance ?? 0}
            <br />
            <strong>Deducting:</strong> {provQty}
            <br />
            <strong>New balance:</strong> {(activeLedger?.current_balance ?? 0) - (parseFloat(provQty) || 0)}
            <br /><br />
            This usually means there is a discrepancy that needs investigating. <strong>This entry cannot be reversed.</strong>
          </div>
          <div className="form-actions" style={{ justifyContent: 'center' }}>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => setShowNegativeBalanceConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="ps-btn ps-btn-primary"
              style={{ background: 'var(--ps-error)' }}
              onClick={() => submitProvision(true)}
              disabled={provSaving}
            >
              {provSaving ? 'Saving...' : 'Yes, submit anyway'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
