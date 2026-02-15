// ============================================
// ScanReviewModal — Side-by-side scan review
// Left: scanned image
// Right: extracted drugs with approve/edit/reject
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { ScanDrugItem, ScanQueueItem, CDDrug, ScanConfidence } from '@pharmstation/types'

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

              {/* Document details */}
              <div className="scan-review-doc-info">
                <h3>Document Details</h3>
                {activeScan.document_type === 'invoice' ? (
                  <>
                    {activeScan.supplier_name && <p><strong>Supplier:</strong> {activeScan.supplier_name}</p>}
                    {activeScan.invoice_number && <p><strong>Invoice #:</strong> {activeScan.invoice_number}</p>}
                    {activeScan.invoice_date && <p><strong>Invoice Date:</strong> {activeScan.invoice_date}</p>}
                  </>
                ) : (
                  <>
                    {activeScan.patient_name && <p><strong>Patient:</strong> {activeScan.patient_name}</p>}
                    {activeScan.patient_address && <p><strong>Address:</strong> {activeScan.patient_address}</p>}
                    {activeScan.prescriber_name && <p><strong>Prescriber:</strong> {activeScan.prescriber_name}</p>}
                    {activeScan.prescriber_address && <p><strong>Prescriber Address:</strong> {activeScan.prescriber_address}</p>}
                    {activeScan.prescriber_registration && <p><strong>Registration #:</strong> {activeScan.prescriber_registration}</p>}
                    {activeScan.is_partial_supply && <p className="scan-partial-supply">⚡ Partial Supply</p>}
                  </>
                )}
                {activeScan.handwritten_notes && (
                  <div className="scan-handwritten">
                    <strong>Handwritten notes:</strong>
                    <p>{activeScan.handwritten_notes}</p>
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

function ScanItemCard({ item, scan, userId, onApprove, onReject, onEdit }: ScanItemCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)

  // For editing
  const [drugSearch, setDrugSearch] = useState('')
  const [drugResults, setDrugResults] = useState<CDDrug[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedDrugId, setSelectedDrugId] = useState(item.matched_drug_id ?? '')
  const [editQuantity, setEditQuantity] = useState(item.quantity ?? 0)

  const confidenceInfo = item.confidence !== null
    ? CONFIDENCE_LABELS[item.confidence] ?? CONFIDENCE_LABELS[0]
    : CONFIDENCE_LABELS[0]

  const isDone = item.status === 'approved' || item.status === 'rejected'
  const effectiveDrugId = item.edited_drug_id ?? item.matched_drug_id
  const effectiveQuantity = item.edited_quantity ?? item.quantity ?? 0

  // Drug search
  const searchDrugs = useCallback(async (query: string) => {
    if (query.length < 2) {
      setDrugResults([])
      return
    }
    setSearching(true)
    try {
      const { data } = await getUserClient()
        .from('cdr_drugs_unique')
        .select('*')
        .or(`drug_brand.ilike.%${query}%,drug_class.ilike.%${query}%`)
        .limit(20)
      setDrugResults((data as CDDrug[]) ?? [])
    } catch {
      setDrugResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (drugSearch) searchDrugs(drugSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [drugSearch, searchDrugs])

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

  const handleSaveEdit = async () => {
    if (!selectedDrugId) return
    await onEdit(item.id, selectedDrugId, editQuantity)
    setIsEditing(false)
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
          <span><strong>Name:</strong> {item.drug_name_raw ?? '—'}</span>
          <span><strong>Class:</strong> {item.drug_class_raw ?? '—'}</span>
          <span><strong>Form:</strong> {item.drug_form_raw ?? '—'}</span>
          <span><strong>Strength:</strong> {item.drug_strength_raw ?? '—'}</span>
          <span><strong>Qty:</strong> {item.quantity ?? '—'}</span>
        </div>
        {item.confidence_notes && (
          <p className="scan-item-confidence-notes">{item.confidence_notes}</p>
        )}
      </div>

      {/* Matched drug */}
      {item.matched_drug_id && !isEditing && (
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

      {!item.matched_drug_id && !isEditing && (
        <div className="scan-item-no-match">
          ⚠️ No drug match found — please search and select manually
        </div>
      )}

      {/* Edit mode */}
      {isEditing && (
        <div className="scan-item-edit">
          <h4>Search Drug Database:</h4>
          <input
            type="text"
            className="ps-input"
            placeholder="Search by drug name or class..."
            value={drugSearch}
            onChange={(e) => setDrugSearch(e.target.value)}
            autoFocus
          />
          {searching && <p className="scan-searching">Searching...</p>}
          {drugResults.length > 0 && (
            <div className="scan-drug-results">
              {drugResults.map((drug) => (
                <button
                  key={drug.id}
                  className={`scan-drug-result ${drug.id === selectedDrugId ? 'selected' : ''}`}
                  onClick={() => setSelectedDrugId(drug.id)}
                >
                  <span className="scan-drug-name">{drug.drug_brand}</span>
                  <span className="scan-drug-detail">
                    {drug.drug_form} – {drug.drug_strength}
                  </span>
                  <span className="scan-drug-class">{drug.drug_class}</span>
                </button>
              ))}
            </div>
          )}
          <div className="scan-edit-qty">
            <label>Quantity:</label>
            <input
              type="number"
              className="ps-input"
              value={editQuantity}
              onChange={(e) => setEditQuantity(Number(e.target.value))}
              min={0.01}
              step="any"
            />
          </div>
          <div className="scan-edit-actions">
            <button className="ps-btn ps-btn-primary" onClick={handleSaveEdit} disabled={!selectedDrugId}>
              Save
            </button>
            <button className="ps-btn ps-btn-ghost" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="scan-item-actions">
          {!isEditing && (
            <>
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
                    disabled={approving || !effectiveDrugId}
                    title={!effectiveDrugId ? 'Select a drug match first' : ''}
                  >
                    ✅ Approve
                  </button>
                  <button
                    className="ps-btn ps-btn-ghost"
                    onClick={() => setIsEditing(true)}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
