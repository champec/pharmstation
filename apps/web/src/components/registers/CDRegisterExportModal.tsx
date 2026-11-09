// ============================================
// CDRegisterExportModal — export the whole CD register (every drug)
// for a date range, as a printable/PDF report or a CSV backup.
// ============================================

import { useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger } from '@pharmstation/types'
import { Modal } from '../Modal'
import {
  downloadCsv,
  fmtDate,
  openPrintReport,
  organisationDetail,
  preparePrintWindow,
  safeFilename,
  todayIso,
  type ExportCell,
  type ReportSection,
} from '../../utils/registerExport'
import {
  CD_EXPORT_HEADERS,
  cdEntryCsvRow,
  cdLedgerSection,
  ledgerTitle,
} from '../../utils/cdRegisterExport'

const PAGE = 1000

interface Props {
  isOpen: boolean
  onClose: () => void
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function CDRegisterExportModal({ isOpen, onClose }: Props) {
  const { organisation, activeUser } = useAuthStore()
  const [start, setStart] = useState(firstOfMonth)
  const [end, setEnd] = useState(todayIso)
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const [busy, setBusy] = useState<null | 'print' | 'csv'>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadData() {
    if (!organisation) throw new Error('No pharmacy selected')
    const client = getUserClient()
    const { data: ledgers, error: lErr } = await client
      .from('ps_register_ledgers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .in('register_type', ['CD', 'PRIVATE_CD'])
      .order('drug_class')
      .order('drug_name')
    if (lErr) throw lErr
    const ledgerList = (ledgers ?? []) as RegisterLedger[]
    if (ledgerList.length === 0) return { ledgerList, byLedger: new Map<string, RegisterEntry[]>() }

    // Page through entries (PostgREST caps each response)
    const all: RegisterEntry[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error: eErr } = await client
        .from('ps_register_entries')
        .select('*, entered_by_profile:entered_by(full_name), annotations:ps_entry_annotations(*, created_by_profile:created_by(full_name))')
        .eq('organisation_id', organisation.id)
        .in('register_type', ['CD', 'PRIVATE_CD'])
        .gte('date_of_transaction', start)
        .lte('date_of_transaction', end)
        .order('ledger_id')
        .order('entry_number')
        .range(from, from + PAGE - 1)
      if (eErr) throw eErr
      all.push(...((data ?? []) as RegisterEntry[]))
      if (!data || data.length < PAGE) break
    }

    const byLedger = new Map<string, RegisterEntry[]>()
    for (const e of all) {
      if (!byLedger.has(e.ledger_id)) byLedger.set(e.ledger_id, [])
      byLedger.get(e.ledger_id)!.push(e)
    }
    return { ledgerList, byLedger }
  }

  async function run(kind: 'print' | 'csv') {
    if (!start || !end || start > end) {
      setError('Choose a start date on or before the end date.')
      return
    }
    // Open the tab before any await so pop-up blockers allow it
    const win = kind === 'print' ? preparePrintWindow() : null
    if (kind === 'print' && !win) {
      setError('Your browser blocked the report window. Allow pop-ups for PharmStation and try again.')
      return
    }
    setBusy(kind)
    setError(null)
    try {
      const { ledgerList, byLedger } = await loadData()
      const period = `${fmtDate(start)} to ${fmtDate(end)}`

      if (kind === 'csv') {
        const headers = ['Drug', 'Class', 'Form', 'Strength', 'Register', ...CD_EXPORT_HEADERS]
        const rows: ExportCell[][] = []
        for (const l of ledgerList) {
          const entries = byLedger.get(l.id) ?? []
          const numberById = new Map(entries.map((e) => [e.id, e.entry_number]))
          for (const e of entries) {
            rows.push([
              l.drug_name ?? '',
              l.drug_class ?? '',
              l.drug_form ?? '',
              l.drug_strength ?? '',
              l.register_type === 'PRIVATE_CD' ? 'Private CD' : 'CD',
              ...cdEntryCsvRow(e, numberById),
            ])
          }
        }
        downloadCsv(safeFilename(organisation?.name, 'cd-register', start, 'to', end), headers, rows)
        onClose()
        return
      }

      const sections: ReportSection[] = []
      const emptyNames: string[] = []
      for (const l of ledgerList) {
        const entries = byLedger.get(l.id) ?? []
        if (entries.length === 0 && !includeEmpty) {
          emptyNames.push(ledgerTitle(l))
          continue
        }
        sections.push({
          ...cdLedgerSection(l, entries),
          emptyMessage: `No entries in this period. Current balance: ${l.current_balance}`,
        })
      }
      const notes = [
        'Each drug, strength and form is printed as its own section, starting on a new page.',
      ]
      if (emptyNames.length > 0) {
        notes.push(`No entries in this period for: ${emptyNames.join('; ')}.`)
      }
      const opened = openPrintReport({
        title: 'Controlled Drugs Register',
        organisationName: organisation?.name,
        organisationDetail: organisationDetail(organisation),
        periodLabel: period,
        generatedBy: activeUser?.full_name,
        sections: sections.length > 0 ? sections : [{ heading: 'No entries', headers: ['Entry'], rows: [] }],
        notes,
      }, win)
      if (!opened) setError('The report window was closed before the export finished. Try again.')
      else onClose()
    } catch (err) {
      win?.close()
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export CD register" width="480px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: 0 }}>
          Exports every CD register for the dates below. Use <strong>Print / PDF</strong> for an
          inspector or your records (one drug per page), and <strong>CSV</strong> for a spreadsheet backup.
        </p>
        <div className="form-row" style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="cd-export-start">From</label>
            <input id="cd-export-start" type="date" className="ps-input" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="cd-export-end">To</label>
            <input id="cd-export-end" type="date" className="ps-input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeEmpty} onChange={(e) => setIncludeEmpty(e.target.checked)} />
          <span>Include registers with no entries in this period (PDF only)</span>
        </label>
        {error && <div className="auth-error">{error}</div>}
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button type="button" className="ps-btn ps-btn-ghost" onClick={() => run('csv')} disabled={busy !== null}>
            {busy === 'csv' ? 'Preparing…' : '⬇ CSV'}
          </button>
          <button type="button" className="ps-btn ps-btn-primary" onClick={() => run('print')} disabled={busy !== null}>
            {busy === 'print' ? 'Preparing…' : 'Print / PDF'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
