// ============================================
// CDLedgerPage — View & manage entries for a specific drug
// TanStack Table with modal entry creation
// ============================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger, CDDrug } from '@pharmstation/types'
import { RegisterTable } from '../../components/table/RegisterTable'
import { Modal } from '../../components/Modal'
import { CDEntryForm } from '../../components/forms/CDEntryForm'

const columnHelper = createColumnHelper<RegisterEntry>()

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  supply: 'Supply',
  return_to_supplier: 'Return to Supplier',
  patient_return: 'Patient Return',
  disposal: 'Disposal',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  correction: 'Correction',
}

export function CDLedgerPage() {
  const { drugId } = useParams<{ drugId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const { activeLedger, setActiveLedger, entries, setEntries, entriesLoading, setEntriesLoading } =
    useRegisterStore()

  const [drug, setDrug] = useState<CDDrug | null>(null)
  const [showEntryModal, setShowEntryModal] = useState(false)
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
        size: 60,
        cell: (info) => (
          <span style={{ fontFamily: 'var(--ps-font-mono)', fontWeight: 600 }}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('date_of_transaction', {
        header: 'Date',
        size: 110,
        cell: (info) => {
          const d = info.getValue()
          return d ? new Date(d).toLocaleDateString('en-GB') : '—'
        },
      }),
      columnHelper.accessor('transaction_type', {
        header: 'Type',
        size: 140,
        cell: (info) => {
          const t = info.getValue()
          return (
            <span className={`ps-badge ${t === 'receipt' || t === 'transfer_in' || t === 'patient_return' ? 'ps-badge-green' : 'ps-badge-amber'}`}>
              {t ? TRANSACTION_TYPE_LABELS[t] ?? t : '—'}
            </span>
          )
        },
      }),
      columnHelper.accessor('quantity_received', {
        header: 'Qty In',
        size: 80,
        cell: (info) => {
          const v = info.getValue()
          return v !== null && v !== undefined ? (
            <span style={{ color: 'var(--ps-success)', fontWeight: 600 }}>+{v}</span>
          ) : (
            '—'
          )
        },
      }),
      columnHelper.accessor('quantity_deducted', {
        header: 'Qty Out',
        size: 80,
        cell: (info) => {
          const v = info.getValue()
          return v !== null && v !== undefined ? (
            <span style={{ color: 'var(--ps-error)', fontWeight: 600 }}>-{v}</span>
          ) : (
            '—'
          )
        },
      }),
      columnHelper.accessor('running_balance', {
        header: 'Balance',
        size: 80,
        cell: (info) => (
          <strong style={{ fontFamily: 'var(--ps-font-mono)' }}>{info.getValue() ?? '—'}</strong>
        ),
      }),
      columnHelper.accessor('supplier_name', {
        header: 'Supplier / Patient',
        size: 180,
        cell: (info) => {
          const row = info.row.original
          return row.supplier_name || row.patient_name || '—'
        },
      }),
      columnHelper.accessor('prescriber_name', {
        header: 'Prescriber',
        size: 140,
        cell: (info) => info.getValue() || '—',
      }),
      columnHelper.accessor('entered_at', {
        header: 'Entered',
        size: 140,
        cell: (info) => {
          const d = info.getValue()
          return d ? new Date(d).toLocaleString('en-GB', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit',
          }) : '—'
        },
      }),
      columnHelper.accessor('entry_type', {
        header: '',
        size: 40,
        enableSorting: false,
        cell: (info) => {
          if (info.getValue() === 'correction') {
            return <span title="Correction entry" className="ps-badge ps-badge-red">C</span>
          }
          return null
        },
      }),
    ],
    [],
  )

  const handleEntrySuccess = (entry: RegisterEntry) => {
    // Add new entry to list and refresh ledger
    setEntries([...entries, entry])
    setShowEntryModal(false)
    // Refresh ledger to get updated balance and lock version
    loadLedger()
  }

  return (
    <div>
      {/* Breadcrumbs */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
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
                <span>Current Balance</span>
                <strong>{activeLedger.current_balance}</strong>
              </div>
            )}
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => setShowEntryModal(true)}
              disabled={!activeLedger}
            >
              + Add Entry
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
        emptyMessage="No entries yet. Click '+ Add Entry' to create the first entry."
        globalFilter={searchFilter}
        onGlobalFilterChange={setSearchFilter}
      />

      {/* Add Entry Modal */}
      <Modal
        isOpen={showEntryModal}
        onClose={() => setShowEntryModal(false)}
        title="New CD Register Entry"
        width="720px"
      >
        <CDEntryForm
          onSuccess={handleEntrySuccess}
          onCancel={() => setShowEntryModal(false)}
        />
      </Modal>
    </div>
  )
}
