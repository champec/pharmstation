// ============================================
// ScanUploadModal — Upload or capture prescription/invoice image
// Sends to AI for processing, shows progress
// ============================================

import { useState, useRef, useCallback } from 'react'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import { Modal } from '../Modal'

interface ScanUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onScanComplete?: (scanId: string) => void
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function ScanUploadModal({ isOpen, onClose, onScanComplete }: ScanUploadModalProps) {
  const { organisation, userSession } = useAuthStore()
  const { uploadAndScan, isUploading, uploadProgress } = useScanStore()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const resetState = () => {
    setPreviewUrl(null)
    setSelectedFile(null)
    setError(null)
    setIsDragOver(false)
  }

  const handleClose = () => {
    if (isUploading) return // prevent close during upload
    resetState()
    onClose()
  }

  const processFile = useCallback((file: File) => {
    setError(null)

    // Validate type
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type}. Please use JPEG, PNG, or WebP.`)
      return
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`)
      return
    }

    // Create preview URL
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    // Read as base64
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip data:image/xxx;base64, prefix
      const base64 = result.split(',')[1]
      setSelectedFile({
        base64,
        mimeType: file.type,
        name: file.name,
      })
    }
    reader.readAsDataURL(file)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleSubmit = async () => {
    if (!selectedFile || !organisation?.id || !userSession?.access_token) return
    setError(null)

    try {
      const result = await uploadAndScan({
        organisationId: organisation.id,
        imageBase64: selectedFile.base64,
        mimeType: selectedFile.mimeType,
        filename: selectedFile.name,
        supabaseUrl,
        accessToken: userSession.access_token,
      })

      if (result) {
        resetState()
        onScanComplete?.(result.id)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed. Please try again.')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="📸 Scan Document" width="560px">
      <div className="scan-upload-modal">
        {/* Instructions */}
        <div className="scan-upload-info">
          <p>
            Upload a photo of a <strong>prescription</strong> or <strong>invoice</strong> containing
            Schedule 2 Controlled Drugs. The AI will identify the document type and extract drug details.
          </p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {/* Preview area / Drop zone */}
        {!selectedFile ? (
          <div
            className={`scan-drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="scan-drop-icon">📄</div>
            <p className="scan-drop-text">
              Drag & drop an image here, or click to browse
            </p>
            <p className="scan-drop-hint">
              JPEG, PNG, WebP — max 10MB
            </p>
            <div className="scan-drop-actions">
              <button
                className="ps-btn ps-btn-primary"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                📁 Browse Files
              </button>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click() }}
              >
                📷 Camera
              </button>
            </div>
          </div>
        ) : (
          <div className="scan-preview-area">
            <div className="scan-preview-image">
              <img src={previewUrl ?? ''} alt="Document preview" />
            </div>
            <div className="scan-preview-info">
              <span className="scan-preview-name">{selectedFile.name}</span>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={resetState}
                disabled={isUploading}
              >
                ✕ Remove
              </button>
            </div>
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {/* Progress bar */}
        {isUploading && (
          <div className="scan-progress">
            <div className="scan-progress-bar">
              <div
                className="scan-progress-fill"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="scan-progress-text">
              {uploadProgress < 30 ? 'Uploading image...' :
               uploadProgress < 80 ? 'AI is analyzing your document...' :
               'Reconciling drugs...'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="form-actions" style={{ marginTop: 'var(--ps-space-md)' }}>
          <button
            className="ps-btn ps-btn-ghost"
            onClick={handleClose}
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            className="ps-btn ps-btn-primary"
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? 'Processing...' : '✨ Scan with AI'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
