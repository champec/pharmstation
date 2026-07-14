// ============================================
// CDLedgerPage — View & manage entries for a specific drug
// Inline entry row auto-determines IN/OUT from which field
// is filled first (supplier = IN, patient = OUT)
// ============================================

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createColumnHelper, type ColumnDef, type Row } from '@tanstack/react-table'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger, CDDrug, KnownContact, EntryAnnotation } from '@pharmstation/types'
import { RegisterTable, type RowMerge } from '../../components/table/RegisterTable'
import { Drawer } from '../../components/Drawer'
import { CDEntryForm } from '../../components/forms/CDEntryForm'
import { ContactModal } from '../../components/ContactModal'
import { Modal } from '../../components/Modal'
import { ScanImageBadge } from '../../components/scan/ScanImageBadge'
import {
  EntryAnnotationsPanel,
  addEntryAnnotation,
  hasOpenPartSupply,
  hasClosedPartSupply,
} from '../../components/annotations/EntryAnnotationsPanel'
import { CDEntryWarningModal } from '../../components/registers/CDEntryWarningModal'
import { getCDEntryWarnings, type CDEntryWarning } from '../../utils/cdEntryWarnings'

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

  // Annotations (appendage under entries) + part supply filter
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(new Set())
  const [showPartSupplyOnly, setShowPartSupplyOnly] = useState(false)

  const toggleAnnotations = useCallback((entryId: string) => {
    setExpandedEntryIds((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }, [])

  const commentedEntryIds = useMemo(
    () => entries.filter((entry) => (entry.annotations?.length ?? 0) > 0).map((entry) => entry.id),
    [entries],
  )
  const allCommentsExpanded =
    commentedEntryIds.length > 0 && commentedEntryIds.every((id) => expandedEntryIds.has(id))

  const toggleAllAnnotations = useCallback(() => {
    setExpandedEntryIds((prev) => {
      const allExpanded =
        commentedEntryIds.length > 0 && commentedEntryIds.every((id) => prev.has(id))
      return allExpanded ? new Set() : new Set(commentedEntryIds)
    })
  }, [commentedEntryIds])

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
      .select('*, annotations:ps_entry_annotations(*, created_by_profile:created_by(full_name))')
      .eq('ledger_id', activeLedger.id)
      .order('entry_number', { ascending: true })

    const loaded = (data as RegisterEntry[]) ?? []
    setEntries(loaded)
    // Entries with existing notes start expanded (list only — input stays hidden)
    setExpandedEntryIds(new Set(loaded.filter((e) => (e.annotations?.length ?? 0) > 0).map((e) => e.id)))
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

  // ============================================
  // Single-register balance check
  // ============================================
  const [bcModalOpen, setBcModalOpen] = useState(false)
  const [bcCount, setBcCount] = useState('')
  const [bcNotes, setBcNotes] = useState('')
  const [bcSaving, setBcSaving] = useState(false)
  const [bcError, setBcError] = useState<string | null>(null)
  const [bcDone, setBcDone] = useState(false)
  const [bcShowAdj, setBcShowAdj] = useState(false)
  const [bcAdjAmount, setBcAdjAmount] = useState('')
  const [bcAdjReason, setBcAdjReason] = useState('')

  const openBalanceCheck = () => {
    setBcCount('')
    setBcNotes('')
    setBcAdjAmount('')
    setBcAdjReason('')
    setBcShowAdj(false)
    setBcError(null)
    setBcDone(false)
    setBcModalOpen(true)
  }

  const submitBalanceCheck = async () => {
    if (!activeLedger || !activeUser || !organisation || !drug) return
    const actualCount = parseFloat(bcCount)
    if (isNaN(actualCount) || actualCount < 0) {
      setBcError('Please enter a valid count (0 or more).')
      return
    }

    setBcSaving(true)
    setBcError(null)

    const expectedBalance = activeLedger.current_balance ?? 0
    const matched = actualCount === expectedBalance
    const adjustmentAmount = bcShowAdj && bcAdjAmount ? parseFloat(bcAdjAmount) : 0
    const hasAdjustment = adjustmentAmount !== 0
    const gphcNum = activeUser.gphc_number ?? ''
    const checkerName = activeUser.full_name
    const checkedBy = `${checkerName}${gphcNum ? ` (GPhC: ${gphcNum})` : ''}`

    let status: string = matched ? 'matched' : 'discrepancy'
    if (hasAdjustment) status = 'adjusted'

    const balanceNote = matched
      ? `Balance checked and verified — ${checkedBy}`
      : hasAdjustment
      ? `Balance check — Adjusted by ${adjustmentAmount > 0 ? '+' : ''}${adjustmentAmount}. ${bcAdjReason || 'Balance adjustment'}. ${checkedBy}`
      : `Balance check — Discrepancy of ${actualCount - expectedBalance}.${bcNotes ? ` ${bcNotes}.` : ''} ${checkedBy}`

    try {
      // Create session for audit trail
      const { data: sessionData } = await getUserClient()
        .from('ps_balance_check_sessions')
        .insert({
          organisation_id: organisation.id,
          started_by: activeUser.id,
          status: 'completed',
          total_registers: 1,
          completed_count: 1,
          matched_count: status === 'matched' ? 1 : 0,
          discrepancy_count: status === 'discrepancy' ? 1 : 0,
          adjusted_count: status === 'adjusted' ? 1 : 0,
          notes: `Quick balance check — ${drug.drug_brand}`,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      const sessionId = sessionData?.id

      if (sessionId) {
        await getUserClient()
          .from('ps_balance_check_items')
          .insert({
            session_id: sessionId,
            drug_id: drug.id,
            drug_brand: drug.drug_brand,
            drug_form: drug.drug_form,
            drug_strength: drug.drug_strength,
            drug_class: drug.drug_class,
            expected_balance: expectedBalance,
            actual_count: actualCount,
            status,
            notes: bcNotes || null,
            checked_by: activeUser.id,
            adjustment_amount: hasAdjustment ? adjustmentAmount : null,
            adjustment_reason: hasAdjustment ? (bcAdjReason || null) : null,
          })
      }

      // Create register entry
      const isAdjIncrease = hasAdjustment && adjustmentAmount > 0
      const isAdjDecrease = hasAdjustment && adjustmentAmount < 0

      const { error: entryErr } = await getUserClient().rpc('ps_make_register_entry', {
        p_ledger_id: activeLedger.id,
        p_register_type: 'CD',
        p_entry_type: 'balance_check',
        p_date_of_transaction: new Date().toISOString().split('T')[0],
        p_notes: balanceNote,
        p_source: 'manual',
        p_expected_lock_version: activeLedger.lock_version,
        p_transaction_type: 'balance_check',
        p_quantity_received: isAdjIncrease ? Math.abs(adjustmentAmount) : null,
        p_quantity_deducted: isAdjDecrease ? Math.abs(adjustmentAmount) : null,
        p_entered_by: activeUser.id,
        p_authorised_by: checkerName,
        p_was_id_requested: false,
        p_was_id_provided: false,
      })

      if (entryErr) {
        setBcError(`Failed to create register entry: ${entryErr.message}`)
        setBcSaving(false)
        return
      }

      // Refresh entries and ledger
      await loadEntries()
      await loadLedger()
      setBcDone(true)
    } catch (e: unknown) {
      setBcError(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBcSaving(false)
    }
  }

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
          // Balance check entries: show the check note spanning this cell
          if (row.entry_type === 'balance_check') {
            return (
              <div className="bc-entry-stamp" title={row.notes ?? ''}>
                <span className="bc-entry-stamp-icon">✅</span>
                <span className="bc-entry-stamp-text">
                  {row.notes ?? 'Balance checked and verified'}
                </span>
              </div>
            )
          }
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
          if (row.entry_type === 'balance_check') return null
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
          if (row.entry_type === 'balance_check') return null
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
          if (row.entry_type === 'balance_check') return null
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
          // Balance check: show any adjustment if present, otherwise just '—'
          if (row.entry_type === 'balance_check') {
            if (row.quantity_received) {
              return (
                <span style={{ color: 'var(--ps-success)', fontWeight: 600, fontFamily: 'var(--ps-font-mono)' }}>
                  +{row.quantity_received}
                </span>
              )
            }
            if (row.quantity_deducted) {
              return (
                <span style={{ color: 'var(--ps-error)', fontWeight: 600, fontFamily: 'var(--ps-font-mono)' }}>
                  -{row.quantity_deducted}
                </span>
              )
            }
            return <span className="cell-na">—</span>
          }
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
        size: 60,
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original
          const badges: ReactNode[] = []
          if (info.getValue() === 'correction') {
            badges.push(<span key="c" title="Correction entry" className="ps-badge ps-badge-red">C</span>)
          }
          if (info.getValue() === 'balance_check') {
            badges.push(<span key="bc" title="Balance check" className="ps-badge ps-badge-blue">BC</span>)
          }
          if (hasOpenPartSupply(row)) {
            badges.push(
              <span key="ps" title="Part supply — balance owed (outstanding)" className="ps-badge ps-badge-amber">PART</span>,
            )
          } else if (hasClosedPartSupply(row)) {
            badges.push(
              <span key="psc" title="Part supply — closed" className="ps-badge part-supply-closed-badge">PART ✓</span>,
            )
          }
          if (badges.length === 0) return null
          return <span style={{ display: 'inline-flex', gap: '4px' }}>{badges}</span>
        },
      }),
      columnHelper.display({
        id: 'annotations',
        header: () => (
          <button
            type="button"
            className={`annotation-toggle annotation-toggle-header ${allCommentsExpanded ? 'annotation-toggle-open' : ''}`}
            onClick={toggleAllAnnotations}
            disabled={commentedEntryIds.length === 0}
            title={allCommentsExpanded ? 'Close all comments' : 'Expand all comments'}
            aria-label={allCommentsExpanded ? 'Close all comments' : 'Expand all comments'}
          >
            💬
          </button>
        ),
        size: 48,
        cell: (info) => {
          const row = info.row.original
          const count = row.annotations?.length ?? 0
          const expanded = expandedEntryIds.has(row.id)
          return (
            <button
              type="button"
              className={`annotation-toggle ${expanded ? 'annotation-toggle-open' : ''}`}
              onClick={() => toggleAnnotations(row.id)}
              title={count > 0 ? `${count} note${count === 1 ? '' : 's'} — click to view` : 'Add a note to this entry'}
            >
              💬
              {count > 0 && <span className="annotation-count">{count}</span>}
            </button>
          )
        },
      }),
    ] as ColumnDef<RegisterEntry, unknown>[],
    [allCommentsExpanded, commentedEntryIds.length, expandedEntryIds, toggleAllAnnotations, toggleAnnotations],
  )

  const handleAnnotationAdded = (entryId: string, annotation: EntryAnnotation) => {
    setEntries(
      entries.map((e) =>
        e.id === entryId ? { ...e, annotations: [...(e.annotations ?? []), annotation] } : e,
      ),
    )
  }

  // Outstanding part supplies (flagged, not yet closed)
  const outstandingPartCount = useMemo(() => entries.filter(hasOpenPartSupply).length, [entries])
  const displayEntries = useMemo(
    () => (showPartSupplyOnly ? entries.filter(hasOpenPartSupply) : entries),
    [entries, showPartSupplyOnly],
  )

  const handleEntrySuccess = (entry: RegisterEntry) => {
    setEntries([...entries, entry])
    if ((entry.annotations?.length ?? 0) > 0) {
      setExpandedEntryIds((prev) => new Set(prev).add(entry.id))
    }
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
  const [provPartSupply, setProvPartSupply] = useState(false)
  const [provPartLink, setProvPartLink] = useState<'none' | 'completes' | 'continues'>('none')
  const [provNote, setProvNote] = useState('')
  const [provExtrasOpen, setProvExtrasOpen] = useState(false)
  const [provSaving, setProvSaving] = useState(false)
  const [provError, setProvError] = useState<string | null>(null)
  const [entryWarnings, setEntryWarnings] = useState<CDEntryWarning[]>([])

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
    setProvPartSupply(false)
    setProvPartLink('none')
    setProvNote('')
    setProvExtrasOpen(false)
    setProvError(null)
    setEntryWarnings([])
    setEntryMode(null)
    setSelectedPatientContact(null)
    setSelectedPrescriberContact(null)
    setSelectedSupplierContact(null)
  }

  // Most recent outstanding part supply for the patient currently being entered.
  // Lets the user record this new supply as completing (or continuing) it.
  const linkedOutstanding = useMemo(() => {
    if (entryMode !== 'out' || !provPatient.trim()) return null
    const name = provPatient.trim().toLowerCase()
    const matches = entries.filter(
      (e) => e.patient_name?.trim().toLowerCase() === name && hasOpenPartSupply(e),
    )
    return matches.length > 0 ? matches[matches.length - 1] : null
  }, [entryMode, provPatient, entries])

  // Surface the outstanding part supply as soon as the patient is matched,
  // so the user can record this supply as completing/continuing it
  const linkedOutstandingId = linkedOutstanding?.id ?? null
  useEffect(() => {
    if (linkedOutstandingId) setProvExtrasOpen(true)
  }, [linkedOutstandingId])

  const submitProvision = async (skipWarnings = false) => {
    if (!activeLedger || !activeUser) return
    const isIn = entryMode === 'in'

    // Validate
    if (!entryMode) { setProvError('Enter a supplier (IN) or patient (OUT) first'); return }
    if (isIn && !provSupplier.trim()) { setProvError('Supplier required'); return }
    if (!isIn && !provPatient.trim()) { setProvError('Patient required'); return }
    if (!isIn && !provPrescriber.trim()) { setProvError('Prescriber required'); return }
    const qty = parseFloat(provQty)
    if (!qty || qty <= 0) { setProvError('Valid quantity required'); return }

    const warnings = getCDEntryWarnings({
      direction: isIn ? 'in' : 'out',
      date: provDate,
      quantity: qty,
      supplierName: provSupplier,
      invoiceNumber: provInvoice,
      patientName: provPatient,
      wasIdRequested: provIdRequested,
      wasIdProvided: provIdProvided,
      packLabel: drug?.units,
      currentBalance: activeLedger.current_balance,
    }, entries)
    if (!skipWarnings && warnings.length > 0) {
      setEntryWarnings(warnings)
      return
    }

    setProvSaving(true)
    setProvError(null)
    setEntryWarnings([])

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

      // Appended annotations (note / part supply) — entries are immutable
      let newEntry = entry as RegisterEntry
      let updatedEntries = [...entries]
      if (organisation) {
        const appended: EntryAnnotation[] = []
        if (provNote.trim()) {
          const { annotation } = await addEntryAnnotation({
            entryId: newEntry.id,
            organisationId: organisation.id,
            userId: activeUser.id,
            text: provNote.trim(),
            type: 'note',
          })
          if (annotation) appended.push(annotation)
        }
        if (!isIn && linkedOutstanding && provPartLink !== 'none') {
          // This supply relates to an earlier outstanding part supply — close it
          const { annotation: closeAnn } = await addEntryAnnotation({
            entryId: linkedOutstanding.id,
            organisationId: organisation.id,
            userId: activeUser.id,
            text:
              provPartLink === 'completes'
                ? `Balance supplied — see entry #${newEntry.entry_number}`
                : `Further part supply — see entry #${newEntry.entry_number}`,
            type: 'part_supply_closed',
          })
          if (closeAnn) {
            updatedEntries = updatedEntries.map((e) =>
              e.id === linkedOutstanding.id
                ? { ...e, annotations: [...(e.annotations ?? []), closeAnn] }
                : e,
            )
          }
          if (provPartLink === 'continues') {
            // Still not fully supplied — the outstanding marker moves to this entry
            const { annotation } = await addEntryAnnotation({
              entryId: newEntry.id,
              organisationId: organisation.id,
              userId: activeUser.id,
              text: `Part supply — balance owed (continues entry #${linkedOutstanding.entry_number})`,
              type: 'part_supply',
            })
            if (annotation) appended.push(annotation)
          }
        } else if (!isIn && provPartSupply) {
          const { annotation } = await addEntryAnnotation({
            entryId: newEntry.id,
            organisationId: organisation.id,
            userId: activeUser.id,
            text: 'Part supply — balance owed to patient',
            type: 'part_supply',
          })
          if (annotation) appended.push(annotation)
        }
        if (appended.length > 0) {
          newEntry = { ...newEntry, annotations: appended }
          setExpandedEntryIds((prev) => new Set(prev).add(newEntry.id))
        }
      }

      setEntries([...updatedEntries, newEntry])
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
      {/* Note / part supply for the new entry — subtle icon, rarely needed */}
      <td style={{ position: 'relative' }}>
        <div className="prov-cell-wrap">
          <button
            type="button"
            className={`annotation-toggle ${provExtrasOpen || provNote.trim() || provPartSupply || provPartLink !== 'none' ? 'annotation-toggle-open' : ''}`}
            onClick={() => setProvExtrasOpen((v) => !v)}
            title="Add a note or mark part supply for this entry (optional)"
            disabled={!entryMode}
          >
            💬
            {(provNote.trim() !== '' || provPartSupply || provPartLink !== 'none') && <span className="prov-extras-dot" />}
          </button>
          {provExtrasOpen && entryMode && (
            <div className="prov-extras-pop">
              <label className="prov-extras-label">Append note</label>
              <input
                className="ps-input annotation-input"
                placeholder="Optional note…"
                value={provNote}
                onChange={(e) => setProvNote(e.target.value)}
              />
              {entryMode === 'out' && (
                linkedOutstanding ? (
                  /* This patient has an outstanding part supply — offer to link this entry to it */
                  <div className="prov-part-link">
                    <span className="prov-extras-label">
                      ⏳ Part supply owed — entry #{linkedOutstanding.entry_number}
                      {' '}({new Date(linkedOutstanding.date_of_transaction).toLocaleDateString('en-GB')}
                      {linkedOutstanding.quantity_deducted ? `, -${linkedOutstanding.quantity_deducted}` : ''})
                    </span>
                    <label className="prov-part-link-option">
                      <input
                        type="radio"
                        name="prov-part-link"
                        checked={provPartLink === 'none'}
                        onChange={() => setProvPartLink('none')}
                      />
                      <span>Not related</span>
                    </label>
                    <label className="prov-part-link-option">
                      <input
                        type="radio"
                        name="prov-part-link"
                        checked={provPartLink === 'completes'}
                        onChange={() => setProvPartLink('completes')}
                      />
                      <span>✔ Completes it</span>
                    </label>
                    <label className="prov-part-link-option">
                      <input
                        type="radio"
                        name="prov-part-link"
                        checked={provPartLink === 'continues'}
                        onChange={() => setProvPartLink('continues')}
                      />
                      <span>⏳ Further part supply</span>
                    </label>
                  </div>
                ) : (
                  <label className="prov-part-supply" title="Only part of the prescribed quantity supplied — balance owed to patient">
                    <input
                      type="checkbox"
                      checked={provPartSupply}
                      onChange={(e) => setProvPartSupply(e.target.checked)}
                    />
                    <span>⏳ Part supply — balance owed</span>
                  </label>
                )
              )}
              <button
                type="button"
                className="ps-btn ps-btn-ghost annotation-btn"
                onClick={() => setProvExtrasOpen(false)}
              >
                Done
              </button>
            </div>
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
              className="ps-btn ps-btn-ghost"
              onClick={openBalanceCheck}
              disabled={!activeLedger}
              title="Quick balance check for this register"
            >
              📋 Balance Check
            </button>
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => navigate('/registers/scan')}
              title="Scan a prescription or invoice with AI"
            >
              📸 Scan
            </button>
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

      {/* Search bar + part supply filter */}
      <div style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center' }}>
        <input
          className="ps-input"
          placeholder="Search entries..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          style={{ maxWidth: '300px' }}
        />
        <button
          type="button"
          className={`ps-btn ${showPartSupplyOnly ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
          onClick={() => setShowPartSupplyOnly((v) => !v)}
          title="Show only entries with an outstanding part supply (balance owed)"
        >
          ⏳ Outstanding Part Supplies{outstandingPartCount > 0 ? ` (${outstandingPartCount})` : ''}
        </button>
      </div>

      {/* Entries Table */}
      <RegisterTable
        data={displayEntries}
        columns={columns}
        loading={entriesLoading}
        emptyMessage={
          showPartSupplyOnly
            ? 'No outstanding part supplies. 🎉'
            : 'No entries yet. Start by entering a supplier (IN) or patient (OUT) in the row below.'
        }
        globalFilter={searchFilter}
        onGlobalFilterChange={setSearchFilter}
        footerRow={provisionFooterRow}
        rowClassName={(row) => row.entry_type === 'balance_check' ? 'bc-entry-row' : undefined}
        subRow={(row: Row<RegisterEntry>) =>
          expandedEntryIds.has(row.original.id) ? (
            <EntryAnnotationsPanel entry={row.original} onAnnotationAdded={handleAnnotationAdded} />
          ) : null
        }
        rowMerge={(row: Row<RegisterEntry>): RowMerge | undefined => {
          if (row.original.entry_type !== 'balance_check') return undefined
          const r = row.original
          const adjText = r.quantity_received
            ? ` (Adjusted +${r.quantity_received})`
            : r.quantity_deducted
            ? ` (Adjusted -${r.quantity_deducted})`
            : ''
          return {
            startIndex: 2, // Supplier column
            span: 5,       // Supplier → Patient → Prescriber → ID → Amount
            content: (
              <div className="bc-entry-stamp">
                <span className="bc-entry-stamp-icon">✅</span>
                <span className="bc-entry-stamp-text">
                  {r.notes ?? 'Balance checked and verified'}{adjText}
                </span>
              </div>
            ),
          }
        }}
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
          packLabel={drug?.units}
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

      <CDEntryWarningModal
        isOpen={entryWarnings.length > 0}
        warnings={entryWarnings}
        submitting={provSaving}
        onCancel={() => setEntryWarnings([])}
        onConfirm={() => submitProvision(true)}
      />

      {/* Single-register Balance Check Modal */}
      <Modal
        isOpen={bcModalOpen}
        onClose={() => setBcModalOpen(false)}
        title="📋 Balance Check"
        width="460px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          {/* Drug & current balance info */}
          <div style={{ background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius)', padding: 'var(--ps-space-md)' }}>
            <strong style={{ fontSize: 'var(--ps-font-md)' }}>{drug?.drug_brand}</strong>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: '4px 0 0' }}>
              {drug?.drug_form} — {drug?.drug_strength}
            </p>
            <div style={{ marginTop: 'var(--ps-space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
              <span style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Register balance:</span>
              <strong style={{ fontFamily: 'var(--ps-font-mono)', fontSize: 'var(--ps-font-lg)' }}>
                {activeLedger?.current_balance ?? 0}
              </strong>
            </div>
          </div>

          {bcDone ? (
            /* Success state */
            <div style={{ textAlign: 'center', padding: 'var(--ps-space-lg) 0' }}>
              <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-sm)' }}>✅</div>
              <p style={{ fontWeight: 600, fontSize: 'var(--ps-font-md)' }}>Balance check recorded</p>
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: '4px' }}>
                Entry added to the register.
              </p>
              <button
                className="ps-btn ps-btn-primary"
                style={{ marginTop: 'var(--ps-space-md)' }}
                onClick={() => setBcModalOpen(false)}
              >
                Done
              </button>
            </div>
          ) : (
            /* Entry form */
            <>
              <div className="form-group">
                <label className="form-label">Actual count</label>
                <input
                  className="ps-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Enter physical count…"
                  value={bcCount}
                  onChange={(e) => setBcCount(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Show discrepancy info if count entered and doesn't match */}
              {bcCount !== '' && !isNaN(parseFloat(bcCount)) && parseFloat(bcCount) !== (activeLedger?.current_balance ?? 0) && (
                <div className="add-register-confirm-warning" style={{ marginTop: 0 }}>
                  <strong>Discrepancy:</strong> count is{' '}
                  {parseFloat(bcCount) - (activeLedger?.current_balance ?? 0) > 0 ? '+' : ''}
                  {parseFloat(bcCount) - (activeLedger?.current_balance ?? 0)} from register balance.

                  {!bcShowAdj && (
                    <div style={{ marginTop: 'var(--ps-space-sm)' }}>
                      <button
                        className="ps-btn ps-btn-ghost"
                        style={{ fontSize: 'var(--ps-font-xs)', padding: '4px 8px' }}
                        onClick={() => {
                          setBcShowAdj(true)
                          setBcAdjAmount(String(parseFloat(bcCount) - (activeLedger?.current_balance ?? 0)))
                        }}
                      >
                        🔧 Adjust balance to match count
                      </button>
                    </div>
                  )}
                </div>
              )}

              {bcShowAdj && (
                <>
                  <div className="form-group">
                    <label className="form-label">Adjustment amount</label>
                    <input
                      className="ps-input"
                      type="number"
                      step="any"
                      value={bcAdjAmount}
                      onChange={(e) => setBcAdjAmount(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Adjustment reason</label>
                    <input
                      className="ps-input"
                      placeholder="e.g. Breakage, spillage…"
                      value={bcAdjReason}
                      onChange={(e) => setBcAdjReason(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="form-label">Notes <span style={{ color: 'var(--ps-mist)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="ps-input"
                  placeholder="Any observations…"
                  value={bcNotes}
                  onChange={(e) => setBcNotes(e.target.value)}
                />
              </div>

              {bcError && (
                <div className="auth-error" style={{ marginTop: 0 }}>{bcError}</div>
              )}

              <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
                <button
                  className="ps-btn ps-btn-ghost"
                  onClick={() => setBcModalOpen(false)}
                  disabled={bcSaving}
                >
                  Cancel
                </button>
                <button
                  className="ps-btn ps-btn-primary"
                  onClick={submitBalanceCheck}
                  disabled={bcSaving || bcCount === ''}
                >
                  {bcSaving ? 'Saving…' : '✓ Confirm Balance Check'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
