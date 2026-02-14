import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useRegisterStore } from '@pharmstation/core'
import type { RegisterEntry, RegisterLedger } from '@pharmstation/types'
import { RegisterTable } from '../../components/table/RegisterTable'
import { Drawer } from '../../components/Drawer'
import { Modal } from '../../components/Modal'
import { RPEntryForm } from '../../components/forms/RPEntryForm'
import { RPCertificate } from '../../components/RPCertificate'

interface RPEditHistoryItem {
  correctionEntry: RegisterEntry
  editedBy: string
  editedAt: string
  reason: string
}

interface RPDayRow {
  date: string
  entry: RegisterEntry | null
  originalEntry: RegisterEntry | null
  editedBy: string | null
  editedAt: string | null
  editedReason: string | null
  editHistory: RPEditHistoryItem[]
}

interface RPDraft {
  date: string
  pharmacist_name: string
  gphc_number: string
  rp_signed_in_at: string
  rp_signed_out_at: string
  notes: string
}

const columnHelper = createColumnHelper<RPDayRow>()

const NOTES_MAX_LENGTH = 200
const GPHC_PATTERN = /^\d{0,7}$/

function toIsoDateLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().split('T')[0]
}

function toTimeLocalValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(11, 16)
}

function buildDateRange(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T00:00:00`)
  const end = new Date(`${endIso}T00:00:00`)
  const dates: string[] = []

  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(toIsoDateLocal(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB')
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RPLogPage() {
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()
  const { activeLedger, setActiveLedger, entries, setEntries, entriesLoading, setEntriesLoading } =
    useRegisterStore()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [includeDb, setIncludeDb] = useState(false)
  const [dbSearchResults, setDbSearchResults] = useState<RegisterEntry[]>([])
  const [dbSearching, setDbSearching] = useState(false)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [userNameMap, setUserNameMap] = useState<Record<string, string>>({})

  const [editingRowDate, setEditingRowDate] = useState<string | null>(null)
  const [editingTargetEntry, setEditingTargetEntry] = useState<RegisterEntry | null>(null)
  const [draft, setDraft] = useState<RPDraft | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [historyModalRow, setHistoryModalRow] = useState<RPDayRow | null>(null)
  const [notesModalRow, setNotesModalRow] = useState<RPDayRow | null>(null)
  const [certModalOpen, setCertModalOpen] = useState(false)
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [printMode, setPrintMode] = useState<'current' | 'custom'>('current')
  const [printStartDate, setPrintStartDate] = useState(() => toIsoDateLocal(new Date()))
  const [printDaysCount, setPrintDaysCount] = useState(30)

  const todayIso = useMemo(() => toIsoDateLocal(new Date()), [])

  const draftRef = useRef(draft)
  draftRef.current = draft
  const editingRowDateRef = useRef(editingRowDate)
  editingRowDateRef.current = editingRowDate

  const loadLedger = useCallback(async () => {
    if (!organisation) return

    const { data: existingLedger, error } = await getUserClient()
      .from('ps_register_ledgers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .eq('register_type', 'RP')
      .is('drug_id', null)
      .maybeSingle()

    if (error) throw error

    if (existingLedger) {
      setActiveLedger(existingLedger as RegisterLedger)
      return
    }

    const { data: newLedger, error: createError } = await getUserClient()
      .from('ps_register_ledgers')
      .insert({
        organisation_id: organisation.id,
        register_type: 'RP',
        drug_name: 'Responsible Pharmacist Log',
      })
      .select('*')
      .single()

    if (createError) throw createError

    setActiveLedger(newLedger as RegisterLedger)
  }, [organisation, setActiveLedger])

  const loadEntries = useCallback(async () => {
    if (!activeLedger) return
    setEntriesLoading(true)

    const { data, error } = await getUserClient()
      .from('ps_register_entries')
      .select('*')
      .eq('ledger_id', activeLedger.id)
      .order('entry_number', { ascending: true })

    if (error) {
      setEntries([])
      setEntriesLoading(false)
      return
    }

    setEntries((data as RegisterEntry[]) ?? [])
    setEntriesLoading(false)
  }, [activeLedger, setEntries, setEntriesLoading])

  const loadUserNames = useCallback(async () => {
    const ids = Array.from(new Set(entries.map((entry) => entry.entered_by).filter(Boolean)))
    if (ids.length === 0) {
      setUserNameMap({})
      return
    }

    const { data } = await getUserClient().from('ps_user_profiles').select('id, full_name').in('id', ids)

    const mapped: Record<string, string> = {}
    for (const row of data ?? []) {
      const item = row as { id: string; full_name: string }
      mapped[item.id] = item.full_name
    }
    setUserNameMap(mapped)
  }, [entries])

  useEffect(() => {
    loadLedger()
  }, [loadLedger])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  useEffect(() => {
    loadUserNames()
  }, [loadUserNames])

  const runDbSearch = useCallback(async () => {
    if (!activeLedger || !searchFilter.trim()) return
    setDbSearching(true)
    const q = searchFilter.trim()
    const { data } = await getUserClient()
      .from('ps_register_entries')
      .select('*')
      .eq('ledger_id', activeLedger.id)
      .or(`pharmacist_name.ilike.%${q}%,gphc_number.ilike.%${q}%,notes.ilike.%${q}%`)
      .order('entry_number', { ascending: true })
    setDbSearchResults((data as RegisterEntry[]) ?? [])
    setDbSearching(false)
  }, [activeLedger, searchFilter])

  // Reset db search when search term changes or is cleared
  useEffect(() => {
    if (!searchFilter.trim()) {
      setIncludeDb(false)
      setDbSearchResults([])
    } else if (includeDb) {
      // Re-run db search when term changes while db mode is on
      runDbSearch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFilter])

  // Clear db results when include toggled off
  useEffect(() => {
    if (!includeDb) {
      setDbSearchResults([])
    } else if (searchFilter.trim()) {
      runDbSearch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDb])

  useEffect(() => {
    return () => {
      setActiveLedger(null)
      setEntries([])
    }
  }, [setActiveLedger, setEntries])

  // Calculate the full date range from the earliest entry to today (min 30 days)
  const totalDays = useMemo(() => {
    const normals = entries.filter((e) => e.entry_type === 'normal')
    if (normals.length === 0) return 30
    const earliestDate = normals.reduce(
      (min, e) => (e.date_of_transaction < min ? e.date_of_transaction : min),
      normals[0].date_of_transaction,
    )
    const start = new Date(`${earliestDate}T00:00:00`)
    const end = new Date()
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    return Math.max(diff, 30)
  }, [entries])

  const dayRows = useMemo(() => {
    const today = toIsoDateLocal(new Date())
    const startCursor = new Date()
    startCursor.setDate(startCursor.getDate() - (totalDays - 1))
    const startDate = toIsoDateLocal(startCursor)

    const allEntries = includeDb && dbSearchResults.length > 0
      ? [...entries, ...dbSearchResults.filter(dbE => !entries.some(e => e.id === dbE.id))]
      : entries

    const normals = allEntries.filter((entry) => entry.entry_type === 'normal')
    const corrections = allEntries.filter((entry) => entry.entry_type === 'correction')

    // Group all corrections by original entry id
    const correctionsByTarget = new Map<string, RegisterEntry[]>()
    for (const correction of corrections) {
      if (!correction.corrects_entry_id) continue
      const list = correctionsByTarget.get(correction.corrects_entry_id) ?? []
      list.push(correction)
      correctionsByTarget.set(correction.corrects_entry_id, list)
    }

    const effectiveByDate = new Map<string, RPDayRow>()
    for (const normal of normals) {
      const allCorrections = correctionsByTarget.get(normal.id) ?? []
      allCorrections.sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())

      const latest = allCorrections.length > 0 ? allCorrections[allCorrections.length - 1] : null
      const effective = latest ?? normal

      const editHistory: RPEditHistoryItem[] = allCorrections.map((c) => ({
        correctionEntry: c,
        editedBy: c.authorised_by || userNameMap[c.entered_by] || 'Unknown',
        editedAt: c.entered_at,
        reason: c.correction_reason ?? '',
      }))

      const nextRow: RPDayRow = {
        date: effective.date_of_transaction,
        entry: effective,
        originalEntry: normal,
        editedBy: latest
          ? latest.authorised_by || userNameMap[latest.entered_by] || 'Unknown'
          : null,
        editedAt: latest?.entered_at ?? null,
        editedReason: latest?.correction_reason ?? null,
        editHistory,
      }

      const existing = effectiveByDate.get(effective.date_of_transaction)
      if (!existing || (existing.entry && new Date(effective.entered_at) > new Date(existing.entry.entered_at))) {
        effectiveByDate.set(effective.date_of_transaction, nextRow)
      }
    }

    const dates = buildDateRange(startDate, today)
    // Reverse so most recent dates appear first
    return dates.reverse().map((date) => {
      return (
        effectiveByDate.get(date) ?? {
          date,
          entry: null,
          originalEntry: null,
          editedBy: null,
          editedAt: null,
          editedReason: null,
          editHistory: [],
        }
      )
    })
  }, [entries, totalDays, includeDb, dbSearchResults, userNameMap])

  const filteredRows = useMemo(() => {
    const query = searchFilter.trim().toLowerCase()
    if (!query) return dayRows

    return dayRows.filter((row) => {
      const entry = row.entry
      const values = [
        formatDate(row.date),
        entry?.pharmacist_name ?? '',
        entry?.gphc_number ?? '',
        entry?.notes ?? '',
        row.editedBy ?? '',
        row.editedReason ?? '',
      ]
      return values.join(' ').toLowerCase().includes(query)
    })
  }, [dayRows, searchFilter])

  const startRowEdit = useCallback((row: RPDayRow) => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const currentTime = `${hh}:${mm}`
    const defaultStartTime = now.getHours() >= 10 ? currentTime : '09:00'
    const defaultEndTime = '18:00'

    setEditingRowDate(row.date)
    setEditingTargetEntry(row.entry)
    setEditError(null)
    setDraft({
      date: row.date,
      pharmacist_name: row.entry?.pharmacist_name ?? '',
      gphc_number: row.entry?.gphc_number ?? '',
      rp_signed_in_at: row.entry?.rp_signed_in_at
        ? toTimeLocalValue(row.entry.rp_signed_in_at)
        : defaultStartTime,
      rp_signed_out_at: row.entry?.rp_signed_out_at
        ? toTimeLocalValue(row.entry.rp_signed_out_at)
        : defaultEndTime,
      notes: row.entry?.notes ?? '',
    })
  }, [])

  const cancelRowEdit = useCallback(() => {
    setEditingRowDate(null)
    setEditingTargetEntry(null)
    setDraft(null)
    setEditError(null)
  }, [])

  const saveRowEdit = useCallback(async () => {
    if (!activeLedger || !draft || !editingRowDate) return

    if (!draft.date) {
      setEditError('Date is required')
      return
    }
    if (!draft.pharmacist_name.trim()) {
      setEditError('Pharmacist name is required')
      return
    }
    if (!draft.gphc_number.trim()) {
      setEditError('GPhC number is required')
      return
    }
    if (!/^\d{1,7}$/.test(draft.gphc_number)) {
      setEditError('GPhC number must be up to 7 digits')
      return
    }
    if (!draft.rp_signed_in_at) {
      setEditError('Start time is required')
      return
    }
    if (draft.notes.length > NOTES_MAX_LENGTH) {
      setEditError(`Notes must be ${NOTES_MAX_LENGTH} characters or less`)
      return
    }

    setEditSaving(true)
    setEditError(null)

    const isCorrection = !!editingTargetEntry
    const signedInIso = new Date(`${draft.date}T${draft.rp_signed_in_at}`).toISOString()
    const signedOutIso = draft.rp_signed_out_at
      ? new Date(`${draft.date}T${draft.rp_signed_out_at}`).toISOString()
      : null

    const { error } = await getUserClient().rpc('ps_make_register_entry', {
      p_ledger_id: activeLedger.id,
      p_register_type: 'RP',
      p_entry_type: isCorrection ? 'correction' : 'normal',
      p_date_of_transaction: draft.date,
      p_notes: draft.notes || null,
      p_source: 'manual',
      p_corrects_entry_id: isCorrection ? editingTargetEntry?.id ?? null : null,
      p_correction_reason: isCorrection ? `Inline RP correction for ${editingRowDate}` : null,
      p_expected_lock_version: activeLedger.lock_version,
      p_pharmacist_name: draft.pharmacist_name,
      p_gphc_number: draft.gphc_number,
      p_rp_signed_in_at: signedInIso,
      p_rp_signed_out_at: signedOutIso,
    })

    if (error) {
      if (error.message.includes('CONFLICT')) {
        setEditError('Another RP entry was saved first. Please retry.')
      } else {
        setEditError(error.message)
      }
      setEditSaving(false)
      return
    }

    await Promise.all([loadLedger(), loadEntries()])
    setEditSaving(false)
    cancelRowEdit()
  }, [activeLedger, draft, editingRowDate, editingTargetEntry, loadEntries, loadLedger, cancelRowEdit])

  const renderCellDisplay = (row: RPDayRow, value: string, muted = false) => (
    <button
      type="button"
      onClick={() => startRowEdit(row)}
      style={{
        border: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        textAlign: 'left',
        color: muted ? 'var(--ps-mist)' : 'var(--ps-midnight)',
        cursor: 'text',
        width: '100%',
      }}
      title="Click to edit row"
    >
      {value || '—'}
    </button>
  )

  const columns = useMemo(
    () =>
      [
        columnHelper.accessor('date', {
          header: 'Date',
          size: 120,
          cell: (info) => {
            const row = info.row.original
            return renderCellDisplay(row, formatDate(row.date), !row.entry)
          },
        }),
        columnHelper.display({
          id: 'name',
          header: 'Name',
          size: 220,
          cell: (info) => {
            const row = info.row.original
            const d = draftRef.current

            if (editingRowDateRef.current === row.date && d) {
              return (
                <input
                  className="ps-input"
                  value={d.pharmacist_name}
                  onChange={(e) =>
                    setDraft((prev) => (prev ? { ...prev, pharmacist_name: e.target.value } : prev))
                  }
                />
              )
            }

            if (!row.entry) return renderCellDisplay(row, '—', true)

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {renderCellDisplay(row, row.entry.pharmacist_name || '—')}
                {row.editHistory.length > 0 && (
                  <button
                    type="button"
                    className="ps-badge ps-badge-amber"
                    style={{ cursor: 'pointer', border: 'none', fontSize: 'var(--ps-font-xs)' }}
                    title="View edit history"
                    onClick={(e) => { e.stopPropagation(); setHistoryModalRow(row) }}
                  >
                    Edited ({row.editHistory.length})
                  </button>
                )}
              </div>
            )
          },
        }),
        columnHelper.display({
          id: 'reg',
          header: 'Reg',
          size: 130,
          cell: (info) => {
            const row = info.row.original
            const d = draftRef.current
            if (editingRowDateRef.current === row.date && d) {
              return (
                <input
                  className="ps-input"
                  value={d.gphc_number}
                  inputMode="numeric"
                  maxLength={7}
                  placeholder="e.g. 2087654"
                  onChange={(e) => {
                    const val = e.target.value
                    if (GPHC_PATTERN.test(val)) {
                      setDraft((prev) => (prev ? { ...prev, gphc_number: val } : prev))
                    }
                  }}
                />
              )
            }
            return renderCellDisplay(row, row.entry?.gphc_number || '—', !row.entry)
          },
        }),
        columnHelper.display({
          id: 'started',
          header: 'Time Started',
          size: 180,
          cell: (info) => {
            const row = info.row.original
            const d = draftRef.current
            if (editingRowDateRef.current === row.date && d) {
              return (
                <input
                  type="time"
                  className="ps-input"
                  value={d.rp_signed_in_at}
                  onChange={(e) =>
                    setDraft((prev) => (prev ? { ...prev, rp_signed_in_at: e.target.value } : prev))
                  }
                />
              )
            }
            return renderCellDisplay(row, formatTime(row.entry?.rp_signed_in_at ?? null), !row.entry)
          },
        }),
        columnHelper.display({
          id: 'ended',
          header: 'Time Ended',
          size: 180,
          cell: (info) => {
            const row = info.row.original
            const d = draftRef.current
            if (editingRowDateRef.current === row.date && d) {
              return (
                <input
                  type="time"
                  className="ps-input"
                  value={d.rp_signed_out_at}
                  onChange={(e) =>
                    setDraft((prev) => (prev ? { ...prev, rp_signed_out_at: e.target.value } : prev))
                  }
                />
              )
            }
            return renderCellDisplay(row, formatTime(row.entry?.rp_signed_out_at ?? null), !row.entry)
          },
        }),
        columnHelper.display({
          id: 'notes',
          header: 'Notes',
          size: 260,
          cell: (info) => {
            const row = info.row.original
            const d = draftRef.current
            if (editingRowDateRef.current === row.date && d) {
              return (
                <textarea
                  className="ps-input"
                  rows={2}
                  value={d.notes}
                  maxLength={NOTES_MAX_LENGTH}
                  placeholder={`Max ${NOTES_MAX_LENGTH} chars`}
                  onChange={(e) => setDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                  style={{ resize: 'vertical', minHeight: '36px' }}
                />
              )
            }

            const noteText = row.entry?.notes || ''
            if (!noteText) return renderCellDisplay(row, '—', !row.entry)

            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    cursor: 'text',
                  }}
                  onClick={() => startRowEdit(row)}
                  title={noteText}
                >
                  {noteText}
                </span>
                {noteText.length > 30 && (
                  <button
                    type="button"
                    className="ps-btn ps-btn-ghost"
                    style={{ padding: '0 4px', fontSize: 'var(--ps-font-xs)', flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); setNotesModalRow(row) }}
                  >
                    more
                  </button>
                )}
              </div>
            )
          },
        }),
      ] as ColumnDef<RPDayRow, unknown>[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startRowEdit],
  )

  const uniqueEntryCount = useMemo(() => {
    return entries.filter((e) => e.entry_type === 'normal').length
  }, [entries])

  const todayRowClassName = useCallback(
    (row: RPDayRow) => (row.date === todayIso ? 'rp-today-row' : undefined),
    [todayIso],
  )

  const handleEntrySuccess = async () => {
    setDrawerOpen(false)
    await Promise.all([loadLedger(), loadEntries()])
  }

  const buildPrintRows = useCallback(
    (rows: RPDayRow[]) => {
      return rows
        .map((row) => {
          const entry = row.entry
          const edited = row.editHistory.length > 0 ? ` (Edited ${row.editHistory.length}×)` : ''
          return `<tr${row.date === todayIso ? ' class="rp-today-row"' : ''}>
            <td>${formatDate(row.date)}</td>
            <td>${entry?.pharmacist_name || '—'}${edited}</td>
            <td>${entry?.gphc_number || '—'}</td>
            <td>${formatTime(entry?.rp_signed_in_at ?? null)}</td>
            <td>${formatTime(entry?.rp_signed_out_at ?? null)}</td>
            <td>${entry?.notes || '—'}</td>
          </tr>`
        })
        .join('')
    },
    [todayIso],
  )

  const executePrint = useCallback(
    (rows: RPDayRow[], subtitle: string) => {
      const printWindow = window.open('', '_blank')
      if (!printWindow) return
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>RP Log — ${organisation?.name ?? 'PharmStation'}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 8px; }
            @page { size: A4 landscape; margin: 12mm; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              tr { page-break-inside: avoid; }
              thead { display: table-header-group; }
            }
            h1 { font-size: 16px; margin-bottom: 4px; }
            .print-header { margin-bottom: 12px; }
            .print-header p { font-size: 11px; color: #666; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th, td { padding: 3px 5px; border: 1px solid #aaa; text-align: left; }
            th { background: #eee; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
            tr:nth-child(even) { background: #fafafa; }
            .rp-today-row { background: rgba(4, 176, 255, 0.08) !important; }
            .rp-today-row td:first-child { font-weight: 700; color: #257BB4; }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>👤 RP Log</h1>
            <p>${organisation?.name ?? ''} — ${subtitle} — Printed ${new Date().toLocaleString('en-GB')}</p>
          </div>
          <table>
            <thead><tr>
              <th>Date</th><th>Name</th><th>Reg</th><th>Time Started</th><th>Time Ended</th><th>Notes</th>
            </tr></thead>
            <tbody>${buildPrintRows(rows)}</tbody>
          </table>
        </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
      printWindow.close()
    },
    [organisation, buildPrintRows],
  )

  const handlePrintFromModal = useCallback(() => {
    if (printMode === 'current') {
      executePrint(filteredRows, `${filteredRows.length} days — Current view`)
    } else {
      // Custom range: build rows from printStartDate going back printDaysCount days
      const endDate = new Date(`${printStartDate}T00:00:00`)
      const startCursor = new Date(endDate)
      startCursor.setDate(startCursor.getDate() - (printDaysCount - 1))

      const allEntries =
        includeDb && dbSearchResults.length > 0
          ? [...entries, ...dbSearchResults.filter((dbE) => !entries.some((e) => e.id === dbE.id))]
          : entries

      const normals = allEntries.filter((entry) => entry.entry_type === 'normal')
      const corrections = allEntries.filter((entry) => entry.entry_type === 'correction')

      const correctionsByTarget = new Map<string, RegisterEntry[]>()
      for (const correction of corrections) {
        if (!correction.corrects_entry_id) continue
        const list = correctionsByTarget.get(correction.corrects_entry_id) ?? []
        list.push(correction)
        correctionsByTarget.set(correction.corrects_entry_id, list)
      }

      const effectiveByDate = new Map<string, RPDayRow>()
      for (const normal of normals) {
        const allCorrections = correctionsByTarget.get(normal.id) ?? []
        allCorrections.sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())
        const latest = allCorrections.length > 0 ? allCorrections[allCorrections.length - 1] : null
        const effective = latest ?? normal
        const editHistory: RPEditHistoryItem[] = allCorrections.map((c) => ({
          correctionEntry: c,
          editedBy: c.authorised_by || userNameMap[c.entered_by] || 'Unknown',
          editedAt: c.entered_at,
          reason: c.correction_reason ?? '',
        }))
        const nextRow: RPDayRow = {
          date: effective.date_of_transaction,
          entry: effective,
          originalEntry: normal,
          editedBy: latest ? latest.authorised_by || userNameMap[latest.entered_by] || 'Unknown' : null,
          editedAt: latest?.entered_at ?? null,
          editedReason: latest?.correction_reason ?? null,
          editHistory,
        }
        const existing = effectiveByDate.get(effective.date_of_transaction)
        if (!existing || (existing.entry && new Date(effective.entered_at) > new Date(existing.entry.entered_at))) {
          effectiveByDate.set(effective.date_of_transaction, nextRow)
        }
      }

      const dates = buildDateRange(toIsoDateLocal(startCursor), toIsoDateLocal(endDate))
      const customRows = dates.reverse().map((date) => {
        return (
          effectiveByDate.get(date) ?? {
            date,
            entry: null,
            originalEntry: null,
            editedBy: null,
            editedAt: null,
            editedReason: null,
            editHistory: [],
          }
        )
      })

      executePrint(
        customRows,
        `${formatDate(toIsoDateLocal(startCursor))} – ${formatDate(printStartDate)} (${printDaysCount} days)`,
      )
    }
    setPrintModalOpen(false)
  }, [
    printMode,
    filteredRows,
    rowsPerPage,
    executePrint,
    printStartDate,
    printDaysCount,
    includeDb,
    dbSearchResults,
    entries,
    userNameMap,
  ])

  const ROWS_PER_PAGE_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50]

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            Dashboard
          </a>
          <span className="separator">/</span>
          <a
            href="/registers"
            onClick={(e) => {
              e.preventDefault()
              navigate('/registers')
            }}
          >
            Registers
          </a>
          <span className="separator">/</span>
          <span>RP Log</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--ps-space-md)',
          }}
        >
          <div>
            <h1>👤 RP Log</h1>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: '2px' }}>
              Click any row cell to edit inline.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeLedger && (
              <div className="ledger-balance-badge">
                <span>Entries</span>
                <strong>{uniqueEntryCount}</strong>
              </div>
            )}

            <button className="ps-btn ps-btn-ghost no-print" onClick={() => setCertModalOpen(true)}>
              🪪 RP Certificate
            </button>
            <button className="ps-btn ps-btn-ghost no-print" onClick={() => setPrintModalOpen(true)}>
              🖨️ Print Log
            </button>
            <button className="ps-btn ps-btn-primary no-print" onClick={() => setDrawerOpen(true)}>
              + Add RP Entry
            </button>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="ps-input"
          style={{ maxWidth: '260px' }}
          placeholder="Search RP entries..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        {searchFilter.trim() && (
          <button
            className={`ps-btn ${includeDb ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
            onClick={() => setIncludeDb((prev) => !prev)}
            title="Search all database entries, not just the current view"
          >
            {dbSearching ? 'Searching...' : includeDb ? 'Database ✓' : 'Include Database'}
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)' }}>
          <label style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', whiteSpace: 'nowrap' }}>
            Rows per page:
          </label>
          <select
            className="ps-input"
            value={rowsPerPage}
            onChange={(e) => setRowsPerPage(Number(e.target.value))}
            style={{ width: '80px' }}
          >
            {ROWS_PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <RegisterTable
        data={filteredRows}
        columns={columns}
        loading={entriesLoading}
        emptyMessage="No RP rows found."
        pageSize={rowsPerPage}
        rowClassName={todayRowClassName}
        alwaysShowPagination
        printId="rp-log-print-area"
      />

      {editingRowDate && (
        <div style={{ marginTop: 'var(--ps-space-sm)', display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end' }}>
          <button type="button" className="ps-btn ps-btn-ghost" onClick={cancelRowEdit} disabled={editSaving}>
            Cancel
          </button>
          <button type="button" className="ps-btn ps-btn-primary" onClick={saveRowEdit} disabled={editSaving}>
            {editSaving ? 'Saving...' : editingTargetEntry ? 'Save Edit' : 'Save'}
          </button>
        </div>
      )}

      {editError && (
        <div className="auth-error" style={{ marginTop: 'var(--ps-space-sm)', maxWidth: '520px' }}>
          {editError}
        </div>
      )}

      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title="👤 New RP Log Entry" width="540px">
        <RPEntryForm
          mode="create"
          initialValues={{ date_of_transaction: toIsoDateLocal(new Date()) }}
          onSuccess={handleEntrySuccess}
          onCancel={() => setDrawerOpen(false)}
        />
      </Drawer>

      {/* Edit History Modal */}
      <Modal
        isOpen={!!historyModalRow}
        onClose={() => setHistoryModalRow(null)}
        title={`Edit History — ${historyModalRow ? formatDate(historyModalRow.date) : ''}`}
        width="820px"
      >
        {historyModalRow && (() => {
          const original = historyModalRow.originalEntry
          if (!original) return <p style={{ color: 'var(--ps-slate)' }}>No edit history for this entry.</p>

          const versions: {
            version: number
            label: string
            by: string
            at: string
            name: string
            gphc: string
            started: string
            ended: string
            notes: string
          }[] = []

          versions.push({
            version: 1,
            label: 'Original',
            by: original.authorised_by || userNameMap[original.entered_by] || 'Unknown',
            at: original.entered_at,
            name: original.pharmacist_name || '—',
            gphc: original.gphc_number || '—',
            started: formatTime(original.rp_signed_in_at),
            ended: formatTime(original.rp_signed_out_at),
            notes: original.notes || '—',
          })

          for (const item of historyModalRow.editHistory) {
            const c = item.correctionEntry
            versions.push({
              version: versions.length + 1,
              label: `Edit ${versions.length}`,
              by: item.editedBy,
              at: item.editedAt,
              name: c.pharmacist_name || '—',
              gphc: c.gphc_number || '—',
              started: formatTime(c.rp_signed_in_at),
              ended: formatTime(c.rp_signed_out_at),
              notes: c.notes || '—',
            })
          }

          return (
            <div style={{ overflowX: 'auto' }}>
              <table className="register-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>By</th>
                    <th style={{ whiteSpace: 'nowrap' }}>When</th>
                    <th>Name</th>
                    <th>GPhC</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version} style={v.version === versions.length ? { fontWeight: 600 } : undefined}>
                      <td>
                        <span className={`ps-badge ${v.version === 1 ? 'ps-badge-blue' : 'ps-badge-amber'}`}>
                          {v.label}
                        </span>
                      </td>
                      <td>{v.by}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(v.at)}</td>
                      <td>{v.name}</td>
                      <td>{v.gphc}</td>
                      <td>{v.started}</td>
                      <td>{v.ended}</td>
                      <td style={{ whiteSpace: 'pre-wrap', minWidth: '160px', maxWidth: '260px', lineHeight: 1.5 }}>{v.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </Modal>

      {/* Notes Modal */}
      <Modal
        isOpen={!!notesModalRow}
        onClose={() => setNotesModalRow(null)}
        title={`Notes — ${notesModalRow ? formatDate(notesModalRow.date) : ''}`}
        width="520px"
      >
        {notesModalRow && (
          <div>
            {notesModalRow.entry?.pharmacist_name && (
              <p style={{ marginBottom: 'var(--ps-space-sm)', color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                <strong>{notesModalRow.entry.pharmacist_name}</strong> — {formatDate(notesModalRow.date)}
              </p>
            )}
            <div
              style={{
                background: 'var(--ps-cloud)',
                borderRadius: 'var(--ps-radius-md)',
                padding: 'var(--ps-space-md)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                color: 'var(--ps-midnight)',
              }}
            >
              {notesModalRow.entry?.notes || 'No notes.'}
            </div>
          </div>
        )}
      </Modal>

      {/* Print Options Modal */}
      <Modal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        title="🖨️ Print RP Log"
        width="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              type="button"
              className={`ps-btn ${printMode === 'current' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              onClick={() => setPrintMode('current')}
              style={{ flex: 1 }}
            >
              Current View
            </button>
            <button
              type="button"
              className={`ps-btn ${printMode === 'custom' ? 'ps-btn-primary' : 'ps-btn-ghost'}`}
              onClick={() => setPrintMode('custom')}
              style={{ flex: 1 }}
            >
              Custom Range
            </button>
          </div>

          {printMode === 'current' ? (
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
              Print all {filteredRows.length} rows currently displayed
              {searchFilter.trim() ? ' (filtered)' : ''}.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
              <div>
                <label
                  style={{ display: 'block', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: '4px' }}
                >
                  End date (most recent)
                </label>
                <input
                  type="date"
                  className="ps-input"
                  value={printStartDate}
                  onChange={(e) => setPrintStartDate(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label
                  style={{ display: 'block', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: '4px' }}
                >
                  Number of days
                </label>
                <input
                  type="number"
                  className="ps-input"
                  min={1}
                  max={365}
                  value={printDaysCount}
                  onChange={(e) => setPrintDaysCount(Math.max(1, Math.min(365, Number(e.target.value))))}
                  style={{ width: '100%' }}
                />
              </div>
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
                Will print {printDaysCount} days ending on {formatDate(printStartDate)}.
              </p>
            </div>
          )}

          <button
            type="button"
            className="ps-btn ps-btn-primary"
            onClick={handlePrintFromModal}
            style={{ alignSelf: 'flex-end' }}
          >
            🖨️ Print
          </button>
        </div>
      </Modal>

      {/* RP Certificate Modal */}
      <Modal
        isOpen={certModalOpen}
        onClose={() => setCertModalOpen(false)}
        title="Responsible Pharmacist Certificate"
        width="700px"
      >
        <RPCertificate
          name={activeUser?.full_name ?? ''}
          gphcNumber={activeUser?.gphc_number ?? ''}
          onPrint={(orientation) => {
            const el = document.getElementById('rp-certificate-print')
            if (!el) return
            const printWindow = window.open('', '_blank')
            if (!printWindow) return
            printWindow.document.write(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>RP Certificate — ${activeUser?.full_name ?? ''}</title>
                <style>
                  * { margin: 0; padding: 0; box-sizing: border-box; }
                  body {
                    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                  }
                  @page {
                    size: A4 ${orientation};
                    margin: ${orientation === 'landscape' ? '5mm 10mm' : '10mm 15mm'};
                  }
                  @media print {
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .rp-cert-card {
                      max-width: none !important;
                      width: 100% !important;
                      height: 100vh !important;
                      display: flex !important;
                      flex-direction: column !important;
                      align-items: center !important;
                      justify-content: center !important;
                      padding: ${orientation === 'landscape' ? '24px 48px' : '40px 32px'} !important;
                      border-radius: 0 !important;
                      border: 3px solid #257BB4 !important;
                      margin: 0 !important;
                    }
                    .rp-cert-card h1 { font-size: ${orientation === 'landscape' ? '42px' : '36px'} !important; }
                    .rp-cert-card .rp-cert-name { font-size: ${orientation === 'landscape' ? '40px' : '34px'} !important; }
                    .rp-cert-card .rp-cert-reg { font-size: ${orientation === 'landscape' ? '22px' : '20px'} !important; }
                    .rp-cert-card p { font-size: ${orientation === 'landscape' ? '17px' : '16px'} !important; }
                  }
                </style>
              </head>
              <body>${el.innerHTML}</body>
              </html>
            `)
            printWindow.document.close()
            printWindow.focus()
            printWindow.print()
            printWindow.close()
          }}
        />
      </Modal>
    </div>
  )
}
