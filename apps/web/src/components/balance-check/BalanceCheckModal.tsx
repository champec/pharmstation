// ============================================
// BalanceCheckModal — CD Balance Check workflow
// Shows all CD registers for the pharmacy with their
// stated balances. User enters actual counts to verify.
// Creates a balance check entry in each CD register.
// ============================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type {
  SubscribedRegister,
  RegisterLedger,
  BalanceCheckSession,
  BalanceCheckItem,
  BalanceCheckStatus,
} from '@pharmstation/types'
import { Modal } from '../Modal'

// ============================================
// Types
// ============================================

interface BalanceCheckRegister extends SubscribedRegister {
  ledger?: RegisterLedger
  checkItem?: BalanceCheckItem
}

interface BalanceCheckModalProps {
  isOpen: boolean
  onClose: () => void
}

// ============================================
// Component
// ============================================

export function BalanceCheckModal({ isOpen, onClose }: BalanceCheckModalProps) {
  const { organisation, activeUser } = useAuthStore()

  // ---- Data ----
  const [registers, setRegisters] = useState<BalanceCheckRegister[]>([])
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<BalanceCheckSession | null>(null)
  const [pastSessions, setPastSessions] = useState<BalanceCheckSession[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // ---- Filters ----
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClass, setSelectedClass] = useState<string>('')
  const [selectedBrand, setSelectedBrand] = useState<string>('')
  const [selectedStrength, setSelectedStrength] = useState<string>('')

  // ---- Sort ----
  const [sortBy, setSortBy] = useState<'name' | 'lastCheck'>('name')

  // ---- Saving state ----
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)

  // ---- Lifted row state: counts & notes per drug_id ----
  const [rowCounts, setRowCounts] = useState<Record<string, string>>({})
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({})
  const [rowAdjAmounts, setRowAdjAmounts] = useState<Record<string, string>>({})
  const [rowAdjReasons, setRowAdjReasons] = useState<Record<string, string>>({})
  const [rowShowAdj, setRowShowAdj] = useState<Record<string, boolean>>({})

  // ============================================
  // Load registers + ledgers on open
  // ============================================
  const loadData = useCallback(async () => {
    if (!organisation) return
    setLoading(true)
    setError(null)

    // Fetch subscribed registers
    const { data: regs } = await getUserClient()
      .from('ps_subscribed_registers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .order('drug_class')
      .order('drug_brand')

    if (!regs) {
      setLoading(false)
      return
    }

    // Fetch all CD ledgers for this org
    const { data: ledgers } = await getUserClient()
      .from('ps_register_ledgers')
      .select('*')
      .eq('organisation_id', organisation.id)
      .eq('register_type', 'CD')

    // Merge ledger data into registers
    const merged: BalanceCheckRegister[] = (regs as SubscribedRegister[]).map((reg) => {
      const ledger = (ledgers as RegisterLedger[] | null)?.find(
        (l) => l.drug_id === reg.drug_id,
      )
      return { ...reg, ledger }
    })

    setRegisters(merged)
    setLoading(false)
  }, [organisation])

  // Load past sessions
  const loadPastSessions = useCallback(async () => {
    if (!organisation) return
    const { data } = await getUserClient()
      .from('ps_balance_check_sessions')
      .select('*')
      .eq('organisation_id', organisation.id)
      .order('started_at', { ascending: false })
      .limit(20)

    if (data) setPastSessions(data as BalanceCheckSession[])
  }, [organisation])

  useEffect(() => {
    if (isOpen) {
      loadData()
      loadPastSessions()
      setSession(null)
      setShowHistory(false)
      setSearchQuery('')
      setSelectedClass('')
      setSelectedBrand('')
      setSelectedStrength('')
    }
  }, [isOpen, loadData, loadPastSessions])

  // ============================================
  // Start a new balance check session
  // ============================================
  const startSession = async () => {
    if (!organisation || !activeUser) return
    setError(null)

    // Create session
    const { data: newSession, error: sessionErr } = await getUserClient()
      .from('ps_balance_check_sessions')
      .insert({
        organisation_id: organisation.id,
        started_by: activeUser.id,
        total_registers: registers.filter((r) => r.ledger).length,
      })
      .select()
      .single()

    if (sessionErr || !newSession) {
      setError(sessionErr?.message ?? 'Failed to create session')
      return
    }

    // Create check items for each register that has a ledger
    const items = registers
      .filter((r) => r.ledger)
      .map((r) => ({
        session_id: newSession.id,
        organisation_id: organisation.id,
        drug_id: r.drug_id,
        ledger_id: r.ledger!.id,
        drug_brand: r.drug_brand,
        drug_form: r.drug_form,
        drug_strength: r.drug_strength,
        drug_class: r.drug_class,
        expected_balance: r.ledger!.current_balance,
      }))

    const { data: checkItems, error: itemsErr } = await getUserClient()
      .from('ps_balance_check_items')
      .insert(items)
      .select()

    if (itemsErr) {
      setError(itemsErr.message)
      return
    }

    // Merge check items back into registers
    const itemMap = new Map((checkItems as BalanceCheckItem[]).map((i) => [i.drug_id, i]))
    setRegisters((prev) =>
      prev.map((r) => ({
        ...r,
        checkItem: itemMap.get(r.drug_id) ?? r.checkItem,
      })),
    )

    setSession(newSession as BalanceCheckSession)
  }

  // ============================================
  // Resume an in-progress session
  // ============================================
  const resumeSession = async (sessionToResume: BalanceCheckSession) => {
    if (!organisation) return
    setError(null)

    // Load the check items for this session
    const { data: items } = await getUserClient()
      .from('ps_balance_check_items')
      .select('*')
      .eq('session_id', sessionToResume.id)
      .order('drug_class')
      .order('drug_brand')

    if (items) {
      const itemMap = new Map((items as BalanceCheckItem[]).map((i) => [i.drug_id, i]))
      setRegisters((prev) =>
        prev.map((r) => ({
          ...r,
          checkItem: itemMap.get(r.drug_id) ?? r.checkItem,
        })),
      )
    }

    setSession(sessionToResume)
    setShowHistory(false)
  }

  // ============================================
  // Submit a single item check
  // ============================================
  const submitCheck = async (
    item: BalanceCheckItem,
    actualCount: number,
    notes: string,
    adjustmentAmount?: number,
    adjustmentReason?: string,
  ) => {
    if (!activeUser || !session) return
    setSavingItemId(item.id)
    setError(null)

    const matched = actualCount === item.expected_balance
    const hasAdjustment = adjustmentAmount !== undefined && adjustmentAmount !== 0
    let status: BalanceCheckStatus = matched ? 'matched' : 'discrepancy'

    if (hasAdjustment) {
      status = 'adjusted'
    }

    // If there's a note saying pending reconciliation
    if (notes.toLowerCase().includes('pending reconciliation')) {
      status = 'pending_reconciliation'
    }

    // ============================================
    // ALWAYS create a register entry for the balance check
    // This is the digital equivalent of writing across the
    // register: "Balance checked and verified by [Name] [GPhC]"
    // ============================================
    const ledger = registers.find((r) => r.drug_id === item.drug_id)?.ledger
    let registerEntryId: string | null = null

    if (ledger) {
      const gphcNum = activeUser.gphc_number ?? ''
      const checkerName = activeUser.full_name
      const checkedBy = `${checkerName}${gphcNum ? ` (GPhC: ${gphcNum})` : ''}`
      const balanceNote = matched
        ? `Balance checked and verified — ${checkedBy}`
        : hasAdjustment
        ? `Balance check — Adjusted by ${adjustmentAmount! > 0 ? '+' : ''}${adjustmentAmount}. ${adjustmentReason || 'Balance adjustment'}. ${checkedBy}`
        : status === 'pending_reconciliation'
        ? `Balance check — Pending reconciliation.${notes ? ` ${notes}.` : ''} ${checkedBy}`
        : `Balance check — Discrepancy of ${actualCount - item.expected_balance}.${notes ? ` ${notes}.` : ''} ${checkedBy}`

      try {
        // For adjustments, include the qty change. Otherwise entry has no qty (balance stays same).
        const isAdjIncrease = hasAdjustment && adjustmentAmount! > 0
        const isAdjDecrease = hasAdjustment && adjustmentAmount! < 0

        const { data: entry, error: entryErr } = await getUserClient().rpc('ps_make_register_entry', {
          p_ledger_id: ledger.id,
          p_register_type: 'CD',
          p_entry_type: 'balance_check',
          p_date_of_transaction: new Date().toISOString().split('T')[0],
          p_notes: balanceNote,
          p_source: 'manual',
          p_expected_lock_version: ledger.lock_version,
          p_transaction_type: 'balance_check',
          p_quantity_received: isAdjIncrease ? Math.abs(adjustmentAmount!) : null,
          p_quantity_deducted: isAdjDecrease ? Math.abs(adjustmentAmount!) : null,
          p_entered_by: activeUser.id,
          p_authorised_by: checkerName,
          p_was_id_requested: false,
          p_was_id_provided: false,
        })

        if (entry && !entryErr) {
          registerEntryId = (entry as { id: string }).id
        }
        if (entryErr) {
          console.error('Failed to create balance check register entry:', entryErr)
        }
      } catch (e) {
        console.error('Failed to create balance check register entry:', e)
      }
    }

    // Update the balance check item record
    const { error: updateErr } = await getUserClient()
      .from('ps_balance_check_items')
      .update({
        actual_count: actualCount,
        status,
        notes: notes || null,
        adjustment_amount: hasAdjustment ? adjustmentAmount : null,
        adjustment_reason: hasAdjustment ? adjustmentReason : null,
        checked_by: activeUser.id,
        checked_at: new Date().toISOString(),
        register_entry_id: registerEntryId,
      })
      .eq('id', item.id)

    if (updateErr) {
      setError(updateErr.message)
      setSavingItemId(null)
      return
    }

    // Update local state — bump ledger lock_version since register entry was created
    setRegisters((prev) =>
      prev.map((r) => {
        if (r.checkItem?.id === item.id) {
          return {
            ...r,
            ledger: r.ledger
              ? { ...r.ledger, lock_version: r.ledger.lock_version + 1 }
              : r.ledger,
            checkItem: {
              ...r.checkItem,
              actual_count: actualCount,
              status,
              notes: notes || null,
              adjustment_amount: hasAdjustment ? (adjustmentAmount ?? null) : null,
              adjustment_reason: hasAdjustment ? (adjustmentReason ?? null) : null,
              checked_by: activeUser.id,
              checked_at: new Date().toISOString(),
              register_entry_id: registerEntryId,
            },
          }
        }
        return r
      }),
    )

    // Update session counts
    const allItems = registers.map((r) =>
      r.checkItem?.id === item.id
        ? { ...r.checkItem, status, actual_count: actualCount }
        : r.checkItem,
    ).filter(Boolean) as BalanceCheckItem[]

    const checkedCount = allItems.filter((i) => i.status !== 'pending').length
    const discrepancyCount = allItems.filter(
      (i) => i.status === 'discrepancy' || i.status === 'pending_reconciliation',
    ).length

    await getUserClient()
      .from('ps_balance_check_sessions')
      .update({ checked_count: checkedCount, discrepancy_count: discrepancyCount })
      .eq('id', session.id)

    setSavingItemId(null)
  }

  // ============================================
  // Complete session — batch-process ALL rows with entered counts
  // then mark the session as completed
  // ============================================
  const completeSession = async () => {
    if (!session || !activeUser) return
    setCompleting(true)
    setError(null)

    // Find all items that haven't been submitted yet but have a count entered
    const pendingItems = registers.filter((r) => {
      if (!r.checkItem || r.checkItem.status !== 'pending') return false
      const countStr = rowCounts[r.drug_id]
      if (!countStr || countStr.trim() === '') return false
      const count = parseFloat(countStr)
      return !isNaN(count) && count >= 0
    })

    // Process each pending item sequentially (register entries must be serial per ledger)
    for (const reg of pendingItems) {
      const item = reg.checkItem!
      const count = parseFloat(rowCounts[reg.drug_id])
      const notes = rowNotes[reg.drug_id] || ''
      const hasAdj = rowShowAdj[reg.drug_id] && rowAdjAmounts[reg.drug_id]
      const adjAmount = hasAdj ? parseFloat(rowAdjAmounts[reg.drug_id]) : undefined
      const adjReason = hasAdj ? rowAdjReasons[reg.drug_id] : undefined

      await submitCheck(item, count, notes, adjAmount, adjReason)
    }

    // Now mark the session as completed
    const allItems = registers.map((r) => r.checkItem).filter(Boolean) as BalanceCheckItem[]
    // Re-read from current state (which was updated by submitCheck calls)
    const updatedItems = registers.map((r) => {
      if (r.checkItem && pendingItems.some((p) => p.drug_id === r.drug_id)) {
        const countStr = rowCounts[r.drug_id]
        const count = parseFloat(countStr)
        return { ...r.checkItem, status: count === r.checkItem.expected_balance ? 'matched' : 'discrepancy', actual_count: count }
      }
      return r.checkItem
    }).filter(Boolean) as BalanceCheckItem[]

    const checkedCount = updatedItems.filter((i) => i.status !== 'pending').length
    const discrepancyCount = updatedItems.filter(
      (i) => i.status === 'discrepancy' || i.status === 'pending_reconciliation',
    ).length

    await getUserClient()
      .from('ps_balance_check_sessions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: activeUser.id,
        checked_count: checkedCount,
        discrepancy_count: discrepancyCount,
      })
      .eq('id', session.id)

    setCompleting(false)
    setSession(null)
    // Clear row state
    setRowCounts({})
    setRowNotes({})
    setRowAdjAmounts({})
    setRowAdjReasons({})
    setRowShowAdj({})
    loadPastSessions()
  }

  // ============================================
  // Print list
  // ============================================
  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const itemsToShow = filteredRegisters
    const rows = itemsToShow
      .map(
        (r) => `
        <tr>
          <td>${r.drug_class}</td>
          <td>${r.drug_brand}</td>
          <td>${r.drug_form} — ${r.drug_strength}</td>
          <td style="text-align:right">${r.ledger?.current_balance ?? '—'}</td>
          <td style="width:100px"></td>
          <td style="width:150px"></td>
          <td style="width:120px"></td>
        </tr>`,
      )
      .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>CD Balance Check — ${organisation?.name ?? 'Pharmacy'}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f5f5f5; font-weight: 600; }
          td:nth-child(4) { text-align: right; font-family: monospace; }
        </style>
      </head>
      <body>
        <h1>CD Balance Check</h1>
        <div class="meta">
          ${organisation?.name ?? ''} &bull; ${new Date().toLocaleDateString('en-GB')} &bull; Printed by: ${activeUser?.full_name ?? ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Brand</th>
              <th>Form / Strength</th>
              <th>Register Balance</th>
              <th>Actual Count</th>
              <th>Notes</th>
              <th>Checked By</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.print()
  }

  // ============================================
  // Filtering logic — sequential: class → brand → strength
  // ============================================
  const classes = useMemo(() => {
    const set = new Set(registers.map((r) => r.drug_class))
    return Array.from(set).sort()
  }, [registers])

  const brands = useMemo(() => {
    const filtered = selectedClass
      ? registers.filter((r) => r.drug_class === selectedClass)
      : registers
    const set = new Set(filtered.map((r) => r.drug_brand))
    return Array.from(set).sort()
  }, [registers, selectedClass])

  const strengths = useMemo(() => {
    let filtered = registers
    if (selectedClass) filtered = filtered.filter((r) => r.drug_class === selectedClass)
    if (selectedBrand) filtered = filtered.filter((r) => r.drug_brand === selectedBrand)
    const set = new Set(filtered.map((r) => r.drug_strength))
    return Array.from(set).sort()
  }, [registers, selectedClass, selectedBrand])

  // Reset downstream filters when upstream changes
  useEffect(() => {
    setSelectedBrand('')
    setSelectedStrength('')
  }, [selectedClass])

  useEffect(() => {
    setSelectedStrength('')
  }, [selectedBrand])

  const filteredRegisters = useMemo(() => {
    let result = registers

    // Dropdown filters
    if (selectedClass) result = result.filter((r) => r.drug_class === selectedClass)
    if (selectedBrand) result = result.filter((r) => r.drug_brand === selectedBrand)
    if (selectedStrength) result = result.filter((r) => r.drug_strength === selectedStrength)

    // Text search (filters current view)
    if (searchQuery.trim()) {
      const tokens = searchQuery.toLowerCase().trim().split(/\s+/)
      result = result.filter((r) => {
        const searchable = `${r.drug_class} ${r.drug_brand} ${r.drug_form} ${r.drug_strength}`.toLowerCase()
        return tokens.every((t) => searchable.includes(t))
      })
    }

    // Sort
    if (sortBy === 'lastCheck') {
      result = [...result].sort((a, b) => {
        const aDate = a.checkItem?.checked_at ?? ''
        const bDate = b.checkItem?.checked_at ?? ''
        if (!aDate && !bDate) return 0
        if (!aDate) return -1 // unchecked first
        if (!bDate) return 1
        return aDate.localeCompare(bDate)
      })
    } else {
      result = [...result].sort((a, b) => {
        const classCompare = a.drug_class.localeCompare(b.drug_class)
        if (classCompare !== 0) return classCompare
        const brandCompare = a.drug_brand.localeCompare(b.drug_brand)
        if (brandCompare !== 0) return brandCompare
        return a.drug_strength.localeCompare(b.drug_strength)
      })
    }

    return result
  }, [registers, selectedClass, selectedBrand, selectedStrength, searchQuery, sortBy])

  // ============================================
  // Session stats
  // ============================================
  const sessionStats = useMemo(() => {
    if (!session) return null
    const items = registers.map((r) => r.checkItem).filter(Boolean) as BalanceCheckItem[]
    return {
      total: items.length,
      checked: items.filter((i) => i.status !== 'pending').length,
      matched: items.filter((i) => i.status === 'matched').length,
      discrepancies: items.filter(
        (i) => i.status === 'discrepancy' || i.status === 'pending_reconciliation',
      ).length,
      adjusted: items.filter((i) => i.status === 'adjusted').length,
    }
  }, [registers, session])

  // ============================================
  // Render
  // ============================================
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📋 CD Balance Check" width="960px">
      <div className="bc-modal">
        {loading ? (
          <p style={{ color: 'var(--ps-slate)' }}>Loading registers...</p>
        ) : !session && !showHistory ? (
          /* ---- Landing: start new or view history ---- */
          <div className="bc-landing">
            <p className="bc-description">
              Perform a physical stock count of all controlled drugs and verify against register balances.
              Results are recorded in each drug's CD register.
            </p>

            <div className="bc-landing-actions">
              <button className="ps-btn ps-btn-primary bc-start-btn" onClick={startSession}>
                ✅ Start New Balance Check
              </button>
              <button className="ps-btn ps-btn-ghost" onClick={handlePrint}>
                🖨️ Print Check List
              </button>
              {pastSessions.some((s) => s.status === 'in_progress') && (
                <button
                  className="ps-btn ps-btn-ghost"
                  style={{ color: 'var(--ps-electric-cyan)' }}
                  onClick={() => {
                    const inProgress = pastSessions.find((s) => s.status === 'in_progress')
                    if (inProgress) resumeSession(inProgress)
                  }}
                >
                  ▶ Resume In-Progress Check
                </button>
              )}
            </div>

            {/* Past sessions summary */}
            {pastSessions.length > 0 && (
              <div className="bc-history-section">
                <button
                  className="bc-history-toggle"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  📜 Past Balance Checks ({pastSessions.length})
                  <span>{showHistory ? '▲' : '▼'}</span>
                </button>
              </div>
            )}

            {/* Quick preview of registers */}
            <div className="bc-register-preview">
              <h4>Registers to check ({registers.filter((r) => r.ledger).length})</h4>
              <div className="bc-preview-grid">
                {registers
                  .filter((r) => r.ledger)
                  .slice(0, 8)
                  .map((r) => (
                    <div key={r.drug_id} className="bc-preview-item">
                      <span className="bc-preview-name">{r.drug_brand}</span>
                      <span className="bc-preview-detail">
                        {r.drug_strength} — Bal: {r.ledger?.current_balance ?? 0}
                      </span>
                    </div>
                  ))}
                {registers.filter((r) => r.ledger).length > 8 && (
                  <div className="bc-preview-item bc-preview-more">
                    +{registers.filter((r) => r.ledger).length - 8} more
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : showHistory ? (
          /* ---- History view ---- */
          <div className="bc-history">
            <div className="bc-history-header">
              <button className="ps-btn ps-btn-ghost" onClick={() => setShowHistory(false)}>
                ← Back
              </button>
              <h3>Balance Check History</h3>
            </div>
            <div className="bc-history-list">
              {pastSessions.map((s) => (
                <div key={s.id} className="bc-history-row">
                  <div className="bc-history-date">
                    {new Date(s.started_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    <span className="bc-history-time">
                      {new Date(s.started_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="bc-history-stats">
                    <span>Checked: {s.checked_count}/{s.total_registers}</span>
                    {s.discrepancy_count > 0 && (
                      <span className="bc-history-disc">⚠️ {s.discrepancy_count} discrepancies</span>
                    )}
                  </div>
                  <span
                    className={`ps-badge ${
                      s.status === 'completed'
                        ? 'ps-badge-green'
                        : s.status === 'in_progress'
                        ? 'ps-badge-amber'
                        : 'ps-badge-red'
                    }`}
                  >
                    {s.status === 'completed' ? 'Completed' : s.status === 'in_progress' ? 'In Progress' : 'Cancelled'}
                  </span>
                  {s.status === 'in_progress' && (
                    <button
                      className="ps-btn ps-btn-ghost ps-btn-sm"
                      onClick={() => resumeSession(s)}
                    >
                      Resume
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ---- Active session: the main check table ---- */
          <div className="bc-active">
            {/* Session stats bar */}
            {sessionStats && (
              <div className="bc-stats-bar">
                <div className="bc-stat">
                  <span className="bc-stat-label">Total</span>
                  <span className="bc-stat-value">{sessionStats.total}</span>
                </div>
                <div className="bc-stat">
                  <span className="bc-stat-label">Checked</span>
                  <span className="bc-stat-value bc-stat-checked">{sessionStats.checked}</span>
                </div>
                <div className="bc-stat">
                  <span className="bc-stat-label">Matched</span>
                  <span className="bc-stat-value bc-stat-ok">{sessionStats.matched}</span>
                </div>
                <div className="bc-stat">
                  <span className="bc-stat-label">Discrepancies</span>
                  <span className="bc-stat-value bc-stat-warn">{sessionStats.discrepancies}</span>
                </div>
                <div className="bc-stat">
                  <span className="bc-stat-label">Adjusted</span>
                  <span className="bc-stat-value bc-stat-adj">{sessionStats.adjusted}</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={handlePrint}>
                    🖨️ Print
                  </button>
                  {(() => {
                    const pendingWithCounts = registers.filter((r) => {
                      if (!r.checkItem || r.checkItem.status !== 'pending') return false
                      const countStr = rowCounts[r.drug_id]
                      return countStr && countStr.trim() !== '' && !isNaN(parseFloat(countStr))
                    }).length
                    const totalPending = registers.filter((r) => r.checkItem?.status === 'pending').length
                    return (
                      <button
                        className="ps-btn ps-btn-primary ps-btn-sm"
                        onClick={completeSession}
                        disabled={completing || pendingWithCounts === 0 && sessionStats?.checked === 0}
                        title={pendingWithCounts > 0 ? `Will process ${pendingWithCounts} pending checks and create register entries` : 'Enter counts for drugs first'}
                      >
                        {completing
                          ? `Processing ${pendingWithCounts} items...`
                          : pendingWithCounts > 0
                          ? `✅ Complete Check (${pendingWithCounts}/${totalPending + (sessionStats?.checked ?? 0)} entered)`
                          : '✅ Complete Check'}
                      </button>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="bc-filters">
              <input
                className="ps-input bc-search"
                placeholder="Search current view..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="ps-input bc-filter-select"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              >
                <option value="">All Classes</option>
                {classes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                className="ps-input bc-filter-select"
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                disabled={!selectedClass}
              >
                <option value="">All Brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                className="ps-input bc-filter-select"
                value={selectedStrength}
                onChange={(e) => setSelectedStrength(e.target.value)}
                disabled={!selectedBrand}
              >
                <option value="">All Strengths</option>
                {strengths.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                className={`ps-btn ps-btn-ghost ps-btn-sm ${sortBy === 'lastCheck' ? 'bc-sort-active' : ''}`}
                onClick={() => setSortBy(sortBy === 'name' ? 'lastCheck' : 'name')}
                title={sortBy === 'name' ? 'Sort by last check' : 'Sort by name'}
              >
                {sortBy === 'name' ? '🔤 Name' : '🕐 Last Check'}
              </button>
            </div>

            {error && (
              <div className="auth-error" style={{ marginBottom: 'var(--ps-space-sm)' }}>
                {error}
              </div>
            )}

            {/* Check table */}
            <div className="bc-table-wrap">
              <table className="bc-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Drug</th>
                    <th>Form / Strength</th>
                    <th className="bc-col-num">Register Balance</th>
                    <th className="bc-col-num">Actual Count</th>
                    <th>Notes</th>
                    <th className="bc-col-status">Status</th>
                    <th className="bc-col-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegisters.map((reg) => (
                    <BalanceCheckRow
                      key={reg.drug_id}
                      register={reg}
                      onSubmit={submitCheck}
                      saving={savingItemId === reg.checkItem?.id}
                      countValue={rowCounts[reg.drug_id] ?? ''}
                      onCountChange={(v) => setRowCounts((p) => ({ ...p, [reg.drug_id]: v }))}
                      notesValue={rowNotes[reg.drug_id] ?? ''}
                      onNotesChange={(v) => setRowNotes((p) => ({ ...p, [reg.drug_id]: v }))}
                      adjAmount={rowAdjAmounts[reg.drug_id] ?? ''}
                      onAdjAmountChange={(v) => setRowAdjAmounts((p) => ({ ...p, [reg.drug_id]: v }))}
                      adjReason={rowAdjReasons[reg.drug_id] ?? ''}
                      onAdjReasonChange={(v) => setRowAdjReasons((p) => ({ ...p, [reg.drug_id]: v }))}
                      showAdj={rowShowAdj[reg.drug_id] ?? false}
                      onShowAdjChange={(v) => setRowShowAdj((p) => ({ ...p, [reg.drug_id]: v }))}
                    />
                  ))}
                  {filteredRegisters.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ps-mist)', padding: '24px' }}>
                        No registers match your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ============================================
// BalanceCheckRow — Individual row for check
// State is lifted to parent so completeSession can batch-process
// ============================================

interface BalanceCheckRowProps {
  register: BalanceCheckRegister
  onSubmit: (
    item: BalanceCheckItem,
    actualCount: number,
    notes: string,
    adjustmentAmount?: number,
    adjustmentReason?: string,
  ) => Promise<void>
  saving: boolean
  countValue: string
  onCountChange: (value: string) => void
  notesValue: string
  onNotesChange: (value: string) => void
  adjAmount: string
  onAdjAmountChange: (value: string) => void
  adjReason: string
  onAdjReasonChange: (value: string) => void
  showAdj: boolean
  onShowAdjChange: (value: boolean) => void
}

function BalanceCheckRow({
  register,
  onSubmit,
  saving,
  countValue,
  onCountChange,
  notesValue,
  onNotesChange,
  adjAmount,
  onAdjAmountChange,
  adjReason,
  onAdjReasonChange,
  showAdj,
  onShowAdjChange,
}: BalanceCheckRowProps) {
  const item = register.checkItem
  const isCompleted = item && item.status !== 'pending'
  const isLiquid = register.drug_form?.toLowerCase().includes('liquid') ||
    register.drug_form?.toLowerCase().includes('oral solution') ||
    register.drug_form?.toLowerCase().includes('mixture') ||
    register.drug_form?.toLowerCase().includes('linctus') ||
    register.drug_form?.toLowerCase().includes('syrup')

  const inputRef = useRef<HTMLInputElement>(null)

  // Pre-fill if already completed (e.g. resuming a session)
  useEffect(() => {
    if (item && isCompleted) {
      onCountChange(String(item.actual_count ?? ''))
      onNotesChange(item.notes ?? '')
      if (item.adjustment_amount) {
        onShowAdjChange(true)
        onAdjAmountChange(String(item.adjustment_amount))
        onAdjReasonChange(item.adjustment_reason ?? '')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.status])

  const handleSubmit = () => {
    if (!item) return
    const count = parseFloat(countValue)
    if (isNaN(count) || count < 0) return

    const adj = showAdj ? parseFloat(adjAmount) : undefined
    const reason = showAdj ? adjReason : undefined
    onSubmit(item, count, notesValue, adj, reason)
  }

  const handleCountChange = (value: string) => {
    onCountChange(value)
    const count = parseFloat(value)
    if (!isNaN(count) && item) {
      const diff = count - item.expected_balance
      if (diff !== 0 && isLiquid) {
        onShowAdjChange(true)
        onAdjAmountChange(String(diff))
        onAdjReasonChange(diff > 0 ? 'Overage' : 'Underfill/spillage')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Status badge
  const statusBadge = () => {
    if (!item) return null
    switch (item.status) {
      case 'matched':
        return <span className="ps-badge ps-badge-green">✓ Match</span>
      case 'discrepancy':
        return <span className="ps-badge ps-badge-red">✗ Discrepancy</span>
      case 'adjusted':
        return <span className="ps-badge ps-badge-amber">↕ Adjusted</span>
      case 'pending_reconciliation':
        return <span className="ps-badge ps-badge-red">⏳ Pending</span>
      default:
        return <span className="ps-badge">—</span>
    }
  }

  if (!item) {
    return (
      <tr className="bc-row bc-row-no-ledger">
        <td>{register.drug_class}</td>
        <td>{register.drug_brand}</td>
        <td>{register.drug_form} — {register.drug_strength}</td>
        <td className="bc-col-num" style={{ color: 'var(--ps-mist)' }}>No ledger</td>
        <td colSpan={4} style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-xs)' }}>
          Register has no active ledger
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className={`bc-row ${isCompleted ? 'bc-row-done' : ''}`}>
        <td className="bc-cell-class">{register.drug_class}</td>
        <td className="bc-cell-brand">
          <strong>{register.drug_brand}</strong>
        </td>
        <td className="bc-cell-strength">
          {register.drug_form} — {register.drug_strength}
        </td>
        <td className="bc-col-num">
          <strong style={{ fontFamily: 'var(--ps-font-mono)' }}>
            {item.expected_balance}
          </strong>
        </td>
        <td className="bc-col-num">
          {isCompleted ? (
            <strong
              style={{
                fontFamily: 'var(--ps-font-mono)',
                color:
                  item.actual_count === item.expected_balance
                    ? 'var(--ps-success)'
                    : 'var(--ps-error)',
              }}
            >
              {item.actual_count}
            </strong>
          ) : (
            <input
              ref={inputRef}
              type="number"
              className="ps-input bc-count-input"
              placeholder="Count"
              value={countValue}
              onChange={(e) => handleCountChange(e.target.value)}
              onKeyDown={handleKeyDown}
              step="any"
              min="0"
              disabled={saving}
            />
          )}
        </td>
        <td>
          {isCompleted ? (
            <span className="bc-note-text">{item.notes || '—'}</span>
          ) : (
            <input
              type="text"
              className="ps-input bc-note-input"
              placeholder={isLiquid ? 'e.g. overage, spillage...' : 'Notes...'}
              value={notesValue}
              onChange={(e) => onNotesChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={saving}
            />
          )}
        </td>
        <td className="bc-col-status">
          {statusBadge()}
        </td>
        <td className="bc-col-action">
          {!isCompleted ? (
            <button
              className="ps-btn ps-btn-primary ps-btn-sm"
              onClick={handleSubmit}
              disabled={saving || !countValue.trim()}
              title="Confirm count"
            >
              {saving ? '...' : '✓'}
            </button>
          ) : (
            <span style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-xs)' }}>Done</span>
          )}
        </td>
      </tr>
      {/* Adjustment row for liquids or discrepancies */}
      {showAdj && !isCompleted && (
        <tr className="bc-adjustment-row">
          <td colSpan={2}></td>
          <td colSpan={6}>
            <div className="bc-adjustment">
              <span className="bc-adjustment-label">
                {isLiquid ? '💧 Liquid adjustment:' : '⚠️ Discrepancy adjustment:'}
              </span>
              <input
                type="number"
                className="ps-input bc-adj-input"
                placeholder="±"
                value={adjAmount}
                onChange={(e) => onAdjAmountChange(e.target.value)}
                step="any"
              />
              <input
                type="text"
                className="ps-input bc-adj-reason"
                placeholder="Reason (e.g. overage, spillage)"
                value={adjReason}
                onChange={(e) => onAdjReasonChange(e.target.value)}
              />
              <button
                className="ps-btn ps-btn-ghost ps-btn-sm"
                onClick={() => {
                  onShowAdjChange(false)
                  onAdjAmountChange('')
                  onAdjReasonChange('')
                }}
              >
                ✕
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
