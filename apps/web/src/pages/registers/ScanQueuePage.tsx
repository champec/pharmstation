// ============================================
// ScanQueuePage — View and manage AI scan queue
// Shows all uploaded scans with status, confidence, actions
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import type { ScanQueueItem, ScanQueueStatus } from '@pharmstation/types'
import { ScanUploadModal } from '../../components/scan/ScanUploadModal'
import { ScanReviewModal } from '../../components/scan/ScanReviewModal'

const STATUS_LABELS: Record<string, { label: string; icon: string; className: string }> = {
  uploading: { label: 'Uploading', icon: '⬆️', className: 'ps-badge-blue' },
  processing: { label: 'Processing', icon: '⏳', className: 'ps-badge-blue' },
  ready: { label: 'Ready for Review', icon: '📋', className: 'ps-badge-amber' },
  partially_approved: { label: 'Partially Approved', icon: '⚡', className: 'ps-badge-amber' },
  fully_approved: { label: 'Approved', icon: '✅', className: 'ps-badge-green' },
  rejected: { label: 'Rejected', icon: '❌', className: 'ps-badge-red' },
  error: { label: 'Error', icon: '⚠️', className: 'ps-badge-red' },
}

const CONFIDENCE_LABELS: Record<number, { label: string; icon: string; className: string }> = {
  0: { label: 'Rejected', icon: '🚫', className: 'confidence-0' },
  1: { label: 'Low', icon: '🔴', className: 'confidence-1' },
  2: { label: 'Partial', icon: '🟡', className: 'confidence-2' },
  3: { label: 'High', icon: '🟢', className: 'confidence-3' },
}

const FILTER_OPTIONS: { value: ScanQueueStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Scans' },
  { value: 'ready', label: 'Ready for Review' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'fully_approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'error', label: 'Errors' },
]

export function ScanQueuePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    queue, queueLoading, activeQueueFilter,
    loadQueue, setQueueFilter, deleteScan,
  } = useScanStore()

  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [reviewScanId, setReviewScanId] = useState<string | null>(null)

  // Load queue on mount and when filter changes
  useEffect(() => {
    if (organisation?.id) {
      loadQueue(organisation.id)
    }
  }, [organisation?.id, activeQueueFilter, loadQueue])

  const handleScanComplete = useCallback((scanId: string) => {
    // Open the review modal for the completed scan
    setReviewScanId(scanId)
  }, [])

  const handleReviewClose = () => {
    setReviewScanId(null)
    if (organisation?.id) loadQueue(organisation.id)
  }

  const handleDelete = async (scanId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this scan? This cannot be undone.')) return
    await deleteScan(scanId)
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Counts for filter badges
  const readyCount = queue.filter(s => s.status === 'ready' || s.status === 'partially_approved').length

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/registers" onClick={(e) => { e.preventDefault(); navigate('/registers') }}>Registers</a>
          <span className="separator">/</span>
          <span>AI Scan Queue</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📸 AI Scan Queue</h1>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => setUploadModalOpen(true)}
          >
            📷 Scan Document
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="scan-filter-bar">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`scan-filter-btn ${activeQueueFilter === opt.value ? 'active' : ''}`}
            onClick={() => setQueueFilter(opt.value)}
          >
            {opt.label}
            {opt.value === 'ready' && readyCount > 0 && (
              <span className="scan-filter-badge">{readyCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Queue list */}
      {queueLoading ? (
        <p style={{ color: 'var(--ps-slate)', padding: 'var(--ps-space-lg)' }}>Loading scan queue...</p>
      ) : queue.length === 0 ? (
        <div className="cd-empty-state">
          <div className="cd-empty-icon">📸</div>
          <h3>No scans yet</h3>
          <p>
            Upload a photo of a prescription or invoice to get started.
            The AI will extract Schedule 2 CD details for you to review and approve.
          </p>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => setUploadModalOpen(true)}
          >
            📷 Scan Your First Document
          </button>
        </div>
      ) : (
        <div className="scan-queue-list">
          {queue.map((scan) => (
            <ScanQueueCard
              key={scan.id}
              scan={scan}
              onReview={() => setReviewScanId(scan.id)}
              onDelete={(e) => handleDelete(scan.id, e)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <ScanUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onScanComplete={handleScanComplete}
      />

      {/* Review Modal */}
      {reviewScanId && (
        <ScanReviewModal
          isOpen={!!reviewScanId}
          scanId={reviewScanId}
          onClose={handleReviewClose}
        />
      )}
    </div>
  )
}

// ============================================
// Scan Queue Card
// ============================================

function ScanQueueCard({
  scan,
  onReview,
  onDelete,
  formatDate,
}: {
  scan: ScanQueueItem
  onReview: () => void
  onDelete: (e: React.MouseEvent) => void
  formatDate: (d: string) => string
}) {
  const statusInfo = STATUS_LABELS[scan.status] ?? STATUS_LABELS.error
  const confidenceInfo = scan.overall_confidence !== null
    ? CONFIDENCE_LABELS[scan.overall_confidence] ?? CONFIDENCE_LABELS[0]
    : null

  const isActionable = scan.status === 'ready' || scan.status === 'partially_approved'

  return (
    <div
      className={`scan-queue-card ${isActionable ? 'actionable' : ''}`}
      onClick={onReview}
    >
      {/* Thumbnail */}
      <div className="scan-card-thumb">
        {scan.image_url ? (
          <img src={scan.image_url} alt="Scan" loading="lazy" />
        ) : (
          <div className="scan-card-thumb-placeholder">📄</div>
        )}
      </div>

      {/* Info */}
      <div className="scan-card-info">
        <div className="scan-card-row">
          <span className={`ps-badge ${statusInfo.className}`}>
            {statusInfo.icon} {statusInfo.label}
          </span>
          {confidenceInfo && (
            <span className={`scan-confidence-badge ${confidenceInfo.className}`}>
              {confidenceInfo.icon} Confidence: {confidenceInfo.label}
            </span>
          )}
          {scan.document_type && (
            <span className="ps-badge ps-badge-blue">
              {scan.document_type === 'invoice' ? '📥 Invoice' : '📤 Prescription'}
            </span>
          )}
        </div>

        <div className="scan-card-row">
          {scan.document_type === 'invoice' && scan.supplier_name && (
            <span className="scan-card-detail">
              <strong>Supplier:</strong> {scan.supplier_name}
              {scan.invoice_number && ` (${scan.invoice_number})`}
            </span>
          )}
          {scan.document_type === 'prescription' && scan.patient_name && (
            <span className="scan-card-detail">
              <strong>Patient:</strong> {scan.patient_name}
            </span>
          )}
          {scan.document_type === 'prescription' && scan.prescriber_name && (
            <span className="scan-card-detail">
              <strong>Prescriber:</strong> {scan.prescriber_name}
            </span>
          )}
        </div>

        {scan.ai_notes && (
          <div className="scan-card-notes">
            {scan.ai_notes.length > 120 ? scan.ai_notes.slice(0, 120) + '...' : scan.ai_notes}
          </div>
        )}

        <div className="scan-card-meta">
          <span>{formatDate(scan.created_at)}</span>
          {scan.model_used && <span>Model: {scan.model_used}</span>}
          {scan.error_message && (
            <span className="scan-card-error">Error: {scan.error_message.slice(0, 60)}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="scan-card-actions">
        {isActionable && (
          <button
            className="ps-btn ps-btn-primary"
            onClick={(e) => { e.stopPropagation(); onReview() }}
          >
            Review
          </button>
        )}
        <button
          className="ps-btn ps-btn-ghost"
          onClick={onDelete}
          title="Delete scan"
        >
          🗑
        </button>
      </div>
    </div>
  )
}
