// ============================================
// ScanReviewModal — Side-by-side scan review
// Left: scanned image
// Right: extracted drugs with approve/edit/reject
// ============================================

import { useState, useEffect } from 'react'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { ScanDrugItem, ScanQueueItem, CDDrug } from '@pharmstation/types'
import { EditDrugModal } from './EditDrugModal'

interface ScanReviewModalProps {
  isOpen: boolean
  scanId: string
  onClose: () => void
}

const CONFIDENCE_LABELS: Record<number, { label: string; icon: string; className: string }> = {
  0: { label: 'Rejected', icon: '🚫', className: 'confidence-0' },
  1: { label: 'Low', icon: '🔴', className: 'confidence-1' },
  2: { label: 'Partial', icon: '🟡', className: 'confidence-2' },
  3: { label: 'High', icon: '🟢', className: 'confidence-3' },
}

export function ScanReviewModal({ isOpen, scanId, onClose }: ScanReviewModalProps) {
  const { activeUser } = useAuthStore()
  const {
    activeScan, activeScanItems, activeScanLoading,
    loadScan, approveScanItem, rejectScanItem, editScanItem, refreshImageUrl,
  } = useScanStore()

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(true)

  // Editable document details
  const [editingDetails, setEditingDetails] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [docFields, setDocFields] = useState({
    supplier_name: '',
    invoice_number: '',
    invoice_date: '',
    patient_name: '',
    patient_address: '',
    prescriber_name: '',
    prescriber_address: '',
    prescriber_registration: '',
    is_partial_supply: false,
    handwritten_notes: '',
  })

  // Load scan data on open
  useEffect(() => {
    if (isOpen && scanId) {
      loadScan(scanId)
    }
  }, [isOpen, scanId, loadScan])

  // Load image URL
  useEffect(() => {
    if (activeScan?.image_url) {
      setImageUrl(activeScan.image_url)
      setImageLoading(false)
    } else if (activeScan?.id) {
      setImageLoading(true)
      refreshImageUrl(activeScan.id).then((url) => {
        setImageUrl(url)
        setImageLoading(false)
      })
    }
  }, [activeScan?.id, activeScan?.image_url, refreshImageUrl])

  // Sync doc fields when scan loads
  useEffect(() => {
    if (activeScan) {
      setDocFields({
        supplier_name: activeScan.supplier_name ?? '',
        invoice_number: activeScan.invoice_number ?? '',
        invoice_date: activeScan.invoice_date ?? '',
        patient_name: activeScan.patient_name ?? '',
        patient_address: activeScan.patient_address ?? '',
        prescriber_name: activeScan.prescriber_name ?? '',
        prescriber_address: activeScan.prescriber_address ?? '',
        prescriber_registration: activeScan.prescriber_registration ?? '',
        is_partial_supply: activeScan.is_partial_supply ?? false,
        handwritten_notes: activeScan.handwritten_notes ?? '',
      })
    }
  }, [activeScan])

  const handleSaveDetails = async () => {
    if (!activeScan) return
    setSavingDetails(true)
    try {
      const updates: Record<string, unknown> = {}
      if (activeScan.document_type === 'invoice') {
        updates.supplier_name = docFields.supplier_name || null
        updates.invoice_number = docFields.invoice_number || null
        updates.invoice_date = docFields.invoice_date || null
      } else {
        updates.patient_name = docFields.patient_name || null
        updates.patient_address = docFields.patient_address || null
        updates.prescriber_name = docFields.prescriber_name || null
        updates.prescriber_address = docFields.prescriber_address || null
        updates.prescriber_registration = docFields.prescriber_registration || null
        updates.is_partial_supply = docFields.is_partial_supply
      }
      updates.handwritten_notes = docFields.handwritten_notes || null

      await getUserClient()
        .from('ps_ai_scan_queue')
        .update(updates)
        .eq('id', activeScan.id)

      // Reload scan to reflect changes
      await loadScan(activeScan.id)
      setEditingDetails(false)
    } catch (err) {
      console.error('Failed to save details:', err)
    } finally {
      setSavingDetails(false)
    }
  }

  const handleCancelEdit = () => {
    if (activeScan) {
      setDocFields({
        supplier_name: activeScan.supplier_name ?? '',
        invoice_number: activeScan.invoice_number ?? '',
        invoice_date: activeScan.invoice_date ?? '',
        patient_name: activeScan.patient_name ?? '',
        patient_address: activeScan.patient_address ?? '',
        prescriber_name: activeScan.prescriber_name ?? '',
        prescriber_address: activeScan.prescriber_address ?? '',
        prescriber_registration: activeScan.prescriber_registration ?? '',
        is_partial_supply: activeScan.is_partial_supply ?? false,
        handwritten_notes: activeScan.handwritten_notes ?? '',
      })
    }
    setEditingDetails(false)
  }

  if (!isOpen) return null

  const allItemsDone = activeScanItems.length > 0 &&
    activeScanItems.every((i) => i.status === 'approved' || i.status === 'rejected')

  return (
    <div className="scan-review-overlay" onClick={onClose}>
      <div className="scan-review-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="scan-review-header">
          <h2>📋 Review Scan</h2>
          <div className="scan-review-header-info">
            {activeScan && (
              <>
                <span className="ps-badge ps-badge-blue">
                  {activeScan.document_type === 'invoice' ? '📥 Invoice' : '📤 Prescription'}
                </span>
                {activeScan.overall_confidence !== null && (
                  <span className={`scan-confidence-badge ${CONFIDENCE_LABELS[activeScan.overall_confidence]?.className ?? ''}`}>
                    {CONFIDENCE_LABELS[activeScan.overall_confidence]?.icon}{' '}
                    Overall: {CONFIDENCE_LABELS[activeScan.overall_confidence]?.label}
                  </span>
                )}
                {allItemsDone && (
                  <span className="ps-badge ps-badge-green">✅ All items reviewed</span>
                )}
              </>
            )}
          </div>
          <button className="scan-review-close" onClick={onClose}>✕</button>
        </div>

        {activeScanLoading ? (
          <div className="scan-review-loading">
            <p>Loading scan data...</p>
          </div>
        ) : !activeScan ? (
          <div className="scan-review-loading">
            <p>Scan not found</p>
          </div>
        ) : (
          <div className="scan-review-body">
            {/* Left panel — image */}
            <div className="scan-review-image-panel">
              {imageLoading ? (
                <div className="scan-review-image-placeholder">Loading image...</div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Scanned document"
                  className="scan-review-image"
                />
              ) : (
                <div className="scan-review-image-placeholder">
                  Unable to load image
                </div>
              )}

              {/* Document details — editable */}
              <div className="scan-review-doc-info">
                <div className="scan-doc-header">
                  <h3>Document Details</h3>
                  {!editingDetails ? (
                    <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => setEditingDetails(true)}>
                      ✏️ Edit
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleSaveDetails} disabled={savingDetails}>
                        {savingDetails ? 'Saving...' : '💾 Save'}
                      </button>
                      <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={handleCancelEdit} disabled={savingDetails}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {!editingDetails ? (
                  /* --- Read-only view --- */
                  <>
                    {activeScan.document_type === 'invoice' ? (
                      <>
                        <DocField label="Supplier" value={activeScan.supplier_name} />
                        <DocField label="Invoice #" value={activeScan.invoice_number} />
                        <DocField label="Invoice Date" value={activeScan.invoice_date} />
                      </>
                    ) : (
                      <>
                        <DocField label="Patient" value={activeScan.patient_name} />
                        <DocField label="Patient Address" value={activeScan.patient_address} />
                        <DocField label="Prescriber" value={activeScan.prescriber_name} />
                        <DocField label="Prescriber Address" value={activeScan.prescriber_address} />
                        <DocField label="Registration #" value={activeScan.prescriber_registration} />
                        {activeScan.is_partial_supply && <p className="scan-partial-supply">⚡ Partial Supply</p>}
                      </>
                    )}
                    {activeScan.handwritten_notes && (
                      <div className="scan-handwritten">
                        <strong>Handwritten notes:</strong>
                        <p>{activeScan.handwritten_notes}</p>
                      </div>
                    )}
                  </>
                ) : (
                  /* --- Edit mode --- */
                  <div className="scan-doc-edit-fields">
                    {activeScan.document_type === 'invoice' ? (
                      <>
                        <DocInput label="Supplier" value={docFields.supplier_name} onChange={(v) => setDocFields(f => ({ ...f, supplier_name: v }))} />
                        <DocInput label="Invoice #" value={docFields.invoice_number} onChange={(v) => setDocFields(f => ({ ...f, invoice_number: v }))} />
                        <DocInput label="Invoice Date" value={docFields.invoice_date} onChange={(v) => setDocFields(f => ({ ...f, invoice_date: v }))} type="date" />
                      </>
                    ) : (
                      <>
                        <DocInput label="Patient Name" value={docFields.patient_name} onChange={(v) => setDocFields(f => ({ ...f, patient_name: v }))} />
                        <DocInput label="Patient Address" value={docFields.patient_address} onChange={(v) => setDocFields(f => ({ ...f, patient_address: v }))} multiline />
                        <DocInput label="Prescriber" value={docFields.prescriber_name} onChange={(v) => setDocFields(f => ({ ...f, prescriber_name: v }))} />
                        <DocInput label="Prescriber Address" value={docFields.prescriber_address} onChange={(v) => setDocFields(f => ({ ...f, prescriber_address: v }))} multiline />
                        <DocInput label="Registration #" value={docFields.prescriber_registration} onChange={(v) => setDocFields(f => ({ ...f, prescriber_registration: v }))} />
                        <label className="scan-doc-checkbox">
                          <input
                            type="checkbox"
                            checked={docFields.is_partial_supply}
                            onChange={(e) => setDocFields(f => ({ ...f, is_partial_supply: e.target.checked }))}
                          />
                          Partial supply
                        </label>
                      </>
                    )}
                    <DocInput label="Handwritten Notes" value={docFields.handwritten_notes} onChange={(v) => setDocFields(f => ({ ...f, handwritten_notes: v }))} multiline />
                  </div>
                )}

                {activeScan.ai_notes && (
                  <div className="scan-ai-notes">
                    <strong>AI Notes:</strong>
                    <p>{activeScan.ai_notes}</p>
                  </div>
                )}
                {activeScan.error_message && (
                  <div className="scan-error-block">
                    <strong>Error:</strong>
                    <p>{activeScan.error_message}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel — extracted drugs */}
            <div className="scan-review-items-panel">
              <h3>
                Extracted Drugs ({activeScanItems.length})
              </h3>
              {activeScanItems.length === 0 ? (
                <p className="scan-no-items">No drugs were extracted from this scan.</p>
              ) : (
                <div className="scan-items-list">
                  {activeScanItems.map((item) => (
                    <ScanItemCard
                      key={item.id}
                      item={item}
                      scan={activeScan}
                      userId={activeUser?.id ?? ''}
                      onApprove={approveScanItem}
                      onReject={rejectScanItem}
                      onEdit={editScanItem}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Individual Drug Item Card
// ============================================

interface ScanItemCardProps {
  item: ScanDrugItem
  scan: ScanQueueItem
  userId: string
  onApprove: (params: {
    item: ScanDrugItem
    drugId: string
    quantity: number
    scan: ScanQueueItem
    userId: string
  }) => Promise<boolean>
  onReject: (itemId: string) => Promise<boolean>
  onEdit: (itemId: string, drugId: string, quantity: number) => Promise<boolean>
}

// ============================================
// Helpers — read-only field display + edit input
// ============================================

function DocField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <p className="scan-doc-field">
      <strong>{label}:</strong> {value}
    </p>
  )
}

function DocInput({
  label, value, onChange, type = 'text', multiline = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  multiline?: boolean
}) {
  return (
    <div className="scan-doc-input-group">
      <label className="scan-doc-input-label">{label}</label>
      {multiline ? (
        <textarea
          className="ps-input scan-doc-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
        />
      ) : (
        <input
          className="ps-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

// ============================================
// Individual Drug Item Card
// ============================================

function ScanItemCard({ item, scan, userId, onApprove, onReject, onEdit }: ScanItemCardProps) {
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)

  // Auto-selected brand info toggle
  const [showAutoSelectInfo, setShowAutoSelectInfo] = useState(false)

  // Register existence check
  const [registerExists, setRegisterExists] = useState<boolean | null>(null)
  const [creatingRegister, setCreatingRegister] = useState(false)
  const [registerCreated, setRegisterCreated] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [openingBalance, setOpeningBalance] = useState('0')

  // Matched drug display details (fetched on demand)
  const [matchedDrugDetails, setMatchedDrugDetails] = useState<CDDrug | null>(null)

  const confidenceInfo = item.confidence !== null
    ? CONFIDENCE_LABELS[item.confidence] ?? CONFIDENCE_LABELS[0]
    : CONFIDENCE_LABELS[0]

  const isDone = item.status === 'approved' || item.status === 'rejected'
  const effectiveDrugId = item.edited_drug_id || item.matched_drug_id || ''
  const effectiveQuantity = item.edited_quantity ?? item.quantity ?? 0

  // Fetch matched drug details for display
  useEffect(() => {
    if (!effectiveDrugId || isDone) {
      setMatchedDrugDetails(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await getUserClient()
          .from('cdr_drugs_unique')
          .select('*')
          .eq('id', effectiveDrugId)
          .single()
        if (!cancelled && data) setMatchedDrugDetails(data as CDDrug)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [effectiveDrugId, isDone])

  // Detect if this was a generic prescription that got auto-matched to a brand
  const isAutoSelectedBrand = !!(effectiveDrugId && item.drug_name_raw && item.drug_class_raw
    && item.drug_name_raw.toLowerCase().trim() === item.drug_class_raw.toLowerCase().trim())

  // Detect form mismatch between AI reading and matched drug
  const hasFormMismatch = !isDone && item.matched_drug_form && item.drug_form_raw
    && item.matched_drug_form.toLowerCase() !== item.drug_form_raw.toLowerCase()

  // Check if register exists for the matched drug
  useEffect(() => {
    if (!effectiveDrugId || isDone) {
      setRegisterExists(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await getUserClient()
          .from('ps_subscribed_registers')
          .select('id')
          .eq('organisation_id', scan.organisation_id)
          .eq('drug_id', effectiveDrugId)
          .maybeSingle()
        if (!cancelled) setRegisterExists(!!data)
      } catch {
        if (!cancelled) setRegisterExists(null)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveDrugId, scan.organisation_id, isDone, registerCreated])

  // Create register inline
  const handleCreateRegister = async () => {
    if (!effectiveDrugId) return
    setCreatingRegister(true)
    setRegisterError(null)

    try {
      // Fetch the drug details
      const { data: drugData, error: drugError } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .eq('id', effectiveDrugId)
        .single()

      if (drugError || !drugData) {
        setRegisterError('Could not find the drug in the database.')
        setCreatingRegister(false)
        return
      }

      const drug = drugData as CDDrug
      const balance = parseFloat(openingBalance) || 0

      // Create subscribed register
      const { error: subError } = await getUserClient()
        .from('ps_subscribed_registers')
        .insert({
          organisation_id: scan.organisation_id,
          drug_id: drug.id,
          drug_brand: drug.drug_brand,
          drug_form: drug.drug_form,
          drug_strength: drug.drug_strength,
          drug_class: drug.drug_class,
          drug_type: drug.drug_type,
          created_by: userId,
        })

      if (subError) {
        if (subError.message.includes('duplicate') || subError.message.includes('unique')) {
          // Already exists — that's fine
        } else {
          setRegisterError(subError.message)
          setCreatingRegister(false)
          return
        }
      }

      // Create ledger
      const { error: ledgerError } = await getUserClient()
        .from('ps_register_ledgers')
        .insert({
          organisation_id: scan.organisation_id,
          register_type: 'CD',
          drug_id: drug.id,
          drug_name: drug.drug_brand,
          drug_form: drug.drug_form,
          drug_strength: drug.drug_strength,
          drug_class: drug.drug_class,
          current_balance: balance,
          created_by: userId,
        })

      if (ledgerError) {
        if (ledgerError.message.includes('duplicate') || ledgerError.message.includes('unique')) {
          // Already exists
        } else {
          setRegisterError(ledgerError.message)
          setCreatingRegister(false)
          return
        }
      }

      setRegisterCreated(true)
      setRegisterExists(true)
    } catch (err) {
      setRegisterError((err as Error).message)
    } finally {
      setCreatingRegister(false)
    }
  }

  const handleApprove = async () => {
    if (!confirmApprove) {
      setConfirmApprove(true)
      return
    }
    const drugId = effectiveDrugId
    if (!drugId) return

    setApproving(true)
    try {
      await onApprove({
        item,
        drugId,
        quantity: effectiveQuantity,
        scan,
        userId,
      })
    } finally {
      setApproving(false)
      setConfirmApprove(false)
    }
  }

  const handleReject = async () => {
    if (!confirm('Reject this drug item? It will not create a register entry.')) return
    setRejecting(true)
    try {
      await onReject(item.id)
    } finally {
      setRejecting(false)
    }
  }

  const handleEditSave = async (drugId: string, quantity: number) => {
    await onEdit(item.id, drugId, quantity)
    setEditModalOpen(false)
  }

  return (
    <div className={`scan-item-card ${isDone ? 'done' : ''} ${item.status === 'rejected' ? 'rejected' : ''}`}>
      {/* Status indicator */}
      <div className="scan-item-status-bar">
        <span className={`scan-confidence-badge ${confidenceInfo.className}`}>
          {confidenceInfo.icon} {confidenceInfo.label}
        </span>
        {item.status === 'approved' && <span className="ps-badge ps-badge-green">✅ Approved</span>}
        {item.status === 'rejected' && <span className="ps-badge ps-badge-red">❌ Rejected</span>}
        {item.status === 'edited' && <span className="ps-badge ps-badge-amber">✏️ Edited</span>}
        {item.entry_id && <span className="ps-badge ps-badge-blue">📝 Entry created</span>}
      </div>

      {/* AI extraction */}
      <div className="scan-item-ai-data">
        <h4>AI Read:</h4>
        <div className="scan-item-raw">
          <span><strong>Brand:</strong> {item.drug_name_raw ?? '—'}</span>
          <span><strong>Class:</strong> {item.drug_class_raw ?? '—'}</span>
          <span><strong>Form:</strong> {item.drug_form_raw ?? '—'}</span>
          <span><strong>Strength:</strong> {item.drug_strength_raw ?? '—'}</span>
          <span><strong>Qty:</strong> {item.quantity ?? '—'}</span>
        </div>
        {item.confidence_notes && (
          <p className="scan-item-confidence-notes">{item.confidence_notes}</p>
        )}
      </div>

      {/* Matched drug display */}
      {!isDone && effectiveDrugId && matchedDrugDetails && (
        <div className="scan-item-match">
          <h4>Matched To:</h4>
          <div className="scan-item-matched-drug">
            <span className="scan-drug-name">{matchedDrugDetails.drug_brand}</span>
            <span className="scan-drug-detail">
              {matchedDrugDetails.drug_form} – {matchedDrugDetails.drug_strength}
            </span>
            <span className="scan-drug-class">{matchedDrugDetails.drug_class}</span>
          </div>
          {isAutoSelectedBrand && (
            <div className="scan-auto-select-note">
              <span>Auto-selected brand</span>
              <button
                className="scan-auto-select-info-btn"
                onClick={() => setShowAutoSelectInfo(v => !v)}
                title="How was this determined?"
              >ℹ️</button>
              {showAutoSelectInfo && (
                <p className="scan-auto-select-detail">
                  No brand was specified on the prescription. <strong>{matchedDrugDetails.drug_brand}</strong> is
                  the only registered brand matching {item.drug_class_raw} {item.drug_form_raw} {item.drug_strength_raw} in the database.
                  Click <strong>Edit</strong> if this is not the brand dispensed.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!isDone && effectiveDrugId && !matchedDrugDetails && item.matched_drug_brand && (
        <div className="scan-item-match">
          <h4>Matched To:</h4>
          <div className="scan-item-matched-drug">
            <span className="scan-drug-name">{item.matched_drug_brand}</span>
            <span className="scan-drug-detail">
              {item.matched_drug_form} – {item.matched_drug_strength}
            </span>
            <span className="scan-drug-class">{item.matched_drug_class}</span>
          </div>
        </div>
      )}

      {isDone && (
        <div className="scan-item-match">
          <h4>Matched To:</h4>
          <div className="scan-item-matched-drug">
            <span className="scan-drug-name">{item.matched_drug_brand ?? '—'}</span>
            <span className="scan-drug-detail">
              {item.matched_drug_form} – {item.matched_drug_strength}
            </span>
            <span className="scan-drug-class">{item.matched_drug_class}</span>
          </div>
        </div>
      )}

      {!isDone && !effectiveDrugId && (
        <div className="scan-item-no-match">
          {item.drug_name_raw && item.drug_class_raw &&
           item.drug_name_raw.toLowerCase().trim() === item.drug_class_raw.toLowerCase().trim() ? (
            <>
              <p>📋 <strong>Generic prescription</strong> — no brand specified</p>
              <p className="scan-no-match-hint">
                Click <strong>Edit</strong> to select the brand you actually dispensed
              </p>
            </>
          ) : (
            <>
              <p>⚠️ No exact match found — click <strong>Edit</strong> to select the correct drug</p>
              {item.drug_class_raw && (
                <p className="scan-no-match-hint">
                  AI read: {item.drug_class_raw} {item.drug_form_raw} {item.drug_strength_raw}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Form mismatch warning — AI read a different formulation than what was matched */}
      {hasFormMismatch && (
        <div className="scan-form-mismatch-warning">
          ⚠️ <strong>Form mismatch:</strong> AI read <em>"{item.drug_form_raw}"</em> but matched
          to <em>"{item.matched_drug_form}"</em>. These may be different drugs.
          Click <strong>Edit</strong> to verify.
        </div>
      )}

      {/* Register existence warning — only show when drug is confirmed (no form mismatch) */}
      {!isDone && !hasFormMismatch && effectiveDrugId && registerExists === false && !registerCreated && (
        <div className="scan-no-register-warning">
          <div className="scan-no-register-header">
            <span className="scan-no-register-icon">⚠️</span>
            <div>
              <strong>No register exists for this drug</strong>
              <p>
                {item.matched_drug_brand ?? item.drug_name_raw} needs a CD register
                before an entry can be made.
              </p>
            </div>
          </div>
          <div className="scan-create-register-inline">
            <div className="scan-create-register-row">
              <label>Opening Balance:</label>
              <input
                type="number"
                className="ps-input scan-balance-input"
                placeholder="0"
                step="any"
                min="0"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <button
                className="ps-btn ps-btn-primary ps-btn-sm"
                onClick={handleCreateRegister}
                disabled={creatingRegister}
              >
                {creatingRegister ? 'Creating...' : '📋 Create Register'}
              </button>
            </div>
            <p className="scan-create-register-hint">
              Enter the current stock balance (0 if starting fresh), then create the register.
            </p>
            {registerError && (
              <p className="scan-create-register-error">❌ {registerError}</p>
            )}
          </div>
        </div>
      )}

      {/* Register just created confirmation */}
      {registerCreated && (
        <div className="scan-register-created">
          ✅ Register created for <strong>{item.matched_drug_brand ?? item.drug_name_raw}</strong>
          {parseFloat(openingBalance) > 0 && (
            <span> (opening balance: {openingBalance})</span>
          )}
        </div>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="scan-item-actions">
          {confirmApprove ? (
            <div className="scan-confirm-approve">
              <span>⚠️ This will create an <strong>irreversible</strong> CD register entry. Confirm?</span>
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleApprove}
                disabled={approving || !effectiveDrugId}
              >
                {approving ? 'Creating...' : '✅ Confirm Entry'}
              </button>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={() => setConfirmApprove(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleApprove}
                disabled={approving || !effectiveDrugId || registerExists === false}
                title={!effectiveDrugId ? 'Select a drug match first' : registerExists === false ? 'Create a register for this drug first' : ''}
              >
                ✅ Approve
              </button>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={() => setEditModalOpen(true)}
              >
                ✏️ Edit
              </button>
              <button
                className="ps-btn ps-btn-danger"
                onClick={handleReject}
                disabled={rejecting}
              >
                ❌ Reject
              </button>
            </>
          )}
        </div>
      )}

      {/* Edit Drug Modal */}
      <EditDrugModal
        isOpen={editModalOpen}
        item={item}
        initialDrugId={effectiveDrugId}
        initialQuantity={effectiveQuantity}
        onSave={handleEditSave}
        onCancel={() => setEditModalOpen(false)}
      />
    </div>
  )
}
