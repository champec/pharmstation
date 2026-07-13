// ============================================
// ScanQueuePage — Single flat queue of unprocessed scans
// Items disappear once fully approved/rejected
// Click any item to open review modal
// ============================================

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import type { ScanQueueItem } from '@pharmstation/types'
import { ScanUploadModal } from '../../components/scan/ScanUploadModal'
import { ScanReviewModal } from '../../components/scan/ScanReviewModal'
import { BarcodeScanModal } from '../../components/scan/BarcodeScanModal'

const CONFIDENCE_CONFIG: Record<number, { label: string; dot: string; border: string }> = {
  0: { label: 'Rejected', dot: '#6b7280', border: '#d1d5db' },
  1: { label: 'Low', dot: '#dc2626', border: '#fca5a5' },
  2: { label: 'Partial', dot: '#d97706', border: '#fcd34d' },
  3: { label: 'High', dot: '#16a34a', border: '#86efac' },
}

export function ScanQueuePage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    queue, queueLoading, uploadsInProgress, latestUploadError,
    loadQueue, deleteScan, clearUploadError,
  } = useScanStore()

  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false)
  const [reviewScanId, setReviewScanId] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (organisation?.id) loadQueue(organisation.id)
  }, [organisation?.id, loadQueue])

  // Always poll while on this page — other terminals may be scanning too
  // Poll faster (3s) when items are processing, slower (8s) otherwise
  useEffect(() => {
    if (!organisation?.id) return
    const hasProcessing = queue.some(s => s.status === 'processing' || s.status === 'uploading')
    const interval = hasProcessing || uploadsInProgress > 0 ? 3000 : 8000
    pollRef.current = setInterval(() => loadQueue(organisation.id), interval)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [queue, organisation?.id, loadQueue, uploadsInProgress])

  const handleReviewClose = () => {
    setReviewScanId(null)
    if (organisation?.id) loadQueue(organisation.id)
  }

  const handleDelete = async (scanId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this scan? This cannot be undone.')) return
    await deleteScan(scanId)
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // Filter: only show items that are NOT fully_approved (those are done)
  const activeQueue = queue.filter(s => s.status !== 'fully_approved')

  const processingCount = activeQueue.filter(s => s.status === 'processing' || s.status === 'uploading').length
  const readyCount = activeQueue.filter(s => s.status === 'ready' || s.status === 'partially_approved').length

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <div>
            <h1 style={{ margin: 0 }}>📸 Scan Queue</h1>
            {(processingCount > 0 || readyCount > 0) && (
              <p style={{ margin: '4px 0 0', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                {processingCount > 0 && <span>⏳ {processingCount} processing</span>}
                {processingCount > 0 && readyCount > 0 && ' · '}
                {readyCount > 0 && <span>📋 {readyCount} ready for review</span>}
              </p>
            )}
          </div>
          <div className="sq-header-actions">
            <button className="ps-btn ps-btn-ghost" onClick={() => setBarcodeModalOpen(true)}>
              ▦ Barcode Scan
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => setUploadModalOpen(true)}>
              📷 Scan Document
            </button>
          </div>
        </div>
      </div>

      {/* Queue */}
      {uploadsInProgress > 0 && (
        <div className="sq-uploading-banner">
          <span className="sq-uploading-spinner" />
          Uploading {uploadsInProgress === 1 ? 'scan' : `${uploadsInProgress} scans`}...
        </div>
      )}
      {latestUploadError && (
        <div className="sq-background-error" role="alert">
          <div>
            <strong>Scan processing needs attention</strong>
            <span>{latestUploadError}</span>
          </div>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearUploadError}>Dismiss</button>
        </div>
      )}
      {queueLoading && activeQueue.length === 0 && uploadsInProgress === 0 ? (
        <p style={{ color: 'var(--ps-slate)', padding: 'var(--ps-space-lg)' }}>Loading...</p>
      ) : activeQueue.length === 0 ? (
        <div className="cd-empty-state">
          <div className="cd-empty-icon">📸</div>
          <h3>Queue is empty</h3>
          <p>All scans have been processed. Take a photo of a prescription or invoice to start.</p>
          <div className="sq-empty-actions">
            <button className="ps-btn ps-btn-ghost" onClick={() => setBarcodeModalOpen(true)}>
              ▦ Barcode Scan
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => setUploadModalOpen(true)}>
              📷 Scan Document
            </button>
          </div>
        </div>
      ) : (
        <div className="sq-list">
          {activeQueue.map((scan) => (
            <ScanQueueRow
              key={scan.id}
              scan={scan}
              onReview={() => setReviewScanId(scan.id)}
              onDelete={(e) => handleDelete(scan.id, e)}
              formatTime={formatTime}
            />
          ))}
        </div>
      )}

      <ScanUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
      />

      <BarcodeScanModal
        isOpen={barcodeModalOpen}
        onClose={() => setBarcodeModalOpen(false)}
      />

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
// Single queue row
// ============================================

function ScanQueueRow({
  scan,
  onReview,
  onDelete,
  formatTime,
}: {
  scan: ScanQueueItem
  onReview: () => void
  onDelete: (e: React.MouseEvent) => void
  formatTime: (d: string) => string
}) {
  const isProcessing = scan.status === 'processing' || scan.status === 'uploading'
  const isError = scan.status === 'error'
  const isRejected = scan.status === 'rejected'
  const isReady = scan.status === 'ready' || scan.status === 'partially_approved'

  const conf = scan.overall_confidence !== null && scan.overall_confidence !== undefined
    ? CONFIDENCE_CONFIG[scan.overall_confidence] ?? CONFIDENCE_CONFIG[0]
    : null

  // Left border color based on confidence
  const borderColor = isProcessing ? '#60a5fa' : isError ? '#dc2626' : conf?.border ?? '#e5e7eb'

  // Summary text
  let summaryText = ''
  if (scan.document_type === 'invoice') {
    summaryText = scan.supplier_name
      ? `Invoice — ${scan.supplier_name}${scan.invoice_number ? ` #${scan.invoice_number}` : ''}`
      : 'Invoice'
  } else if (scan.document_type === 'prescription') {
    summaryText = scan.patient_name ? `Prescription — ${scan.patient_name}` : 'Prescription'
  }

  return (
    <div
      className={`sq-row ${isProcessing ? 'sq-processing' : ''} ${isError ? 'sq-error' : ''} ${isRejected ? 'sq-rejected' : ''} ${isReady ? 'sq-ready' : ''}`}
      style={{ borderLeftColor: borderColor }}
      onClick={isProcessing ? undefined : onReview}
    >
      {/* Thumbnail */}
      <div className="sq-thumb">
        <ScanQueueThumbnail scan={scan} isProcessing={isProcessing} />
      </div>

      {/* Content */}
      <div className="sq-content">
        <div className="sq-top-row">
          {isProcessing && <span className="sq-status-pill sq-pill-processing">⏳ Processing...</span>}
          {isError && <span className="sq-status-pill sq-pill-error">⚠️ Error</span>}
          {isRejected && <span className="sq-status-pill sq-pill-rejected">🚫 Rejected</span>}
          {isReady && conf && (
            <span className="sq-confidence-dot" style={{ background: conf.dot }} title={`Confidence: ${conf.label}`} />
          )}
          {summaryText && <span className="sq-summary">{summaryText}</span>}
          {!summaryText && !isProcessing && <span className="sq-summary sq-summary-dim">Document scan</span>}
        </div>

        {/* AI notes preview or error */}
        {isError && scan.error_message && (
          <p className="sq-detail sq-detail-error">{scan.error_message.slice(0, 100)}</p>
        )}
        {!isError && !isProcessing && scan.ai_notes && (
          <p className="sq-detail">{scan.ai_notes.length > 80 ? scan.ai_notes.slice(0, 80) + '...' : scan.ai_notes}</p>
        )}

        <div className="sq-meta">
          <span>{formatTime(scan.created_at)}</span>
          {scan.model_used && <span>{scan.model_used}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="sq-actions">
        {isReady && (
          <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={(e) => { e.stopPropagation(); onReview() }}>
            Review
          </button>
        )}
        {(isRejected || isError) && (
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={(e) => { e.stopPropagation(); onReview() }}>
            View
          </button>
        )}
        <button
          className="ps-btn ps-btn-ghost ps-btn-sm sq-delete-btn"
          onClick={onDelete}
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  )
}

function ScanQueueThumbnail({
  scan,
  isProcessing,
}: {
  scan: ScanQueueItem
  isProcessing: boolean
}) {
  const { refreshImageUrl } = useScanStore()
  const [imageUrl, setImageUrl] = useState<string | null>(scan.image_url)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setImageFailed(false)

    if (isProcessing || !scan.image_path) {
      setImageUrl(null)
      return
    }

    if (scan.image_url) {
      setImageUrl(scan.image_url)
      return
    }

    refreshImageUrl(scan.id).then((url) => {
      if (!cancelled) setImageUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [isProcessing, scan.id, scan.image_path, scan.image_url, refreshImageUrl])

  if (!imageUrl || imageFailed) {
    return <span className="sq-thumb-icon">{isProcessing ? '⏳' : '📄'}</span>
  }

  return (
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      onError={() => setImageFailed(true)}
    />
  )
}
