// ============================================
// ScanUploadModal — Capture or upload image
// Closes immediately after confirm — processing happens in background
// ============================================

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAuthStore, useScanStore } from '@pharmstation/core'
import { Modal } from '../Modal'

interface ScanUploadModalProps {
  isOpen: boolean
  onClose: () => void
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function ScanUploadModal({ isOpen, onClose }: ScanUploadModalProps) {
  const { organisation, userSession } = useAuthStore()
  const { fireAndForgetScan } = useScanStore()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Camera state
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    setCameraError(null)
  }, [])

  useEffect(() => {
    if (!isOpen) stopCamera()
    return () => stopCamera()
  }, [isOpen, stopCamera])

  const resetState = () => {
    setPreviewUrl(null)
    setSelectedFile(null)
    setError(null)
    setIsDragOver(false)
    stopCamera()
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const processFile = useCallback((file: File) => {
    setError(null)

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type}. Use JPEG, PNG, or WebP.`)
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`)
      return
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setSelectedFile({ base64, mimeType: file.type, name: file.name })
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

  // ============================================
  // Camera — WebRTC
  // ============================================
  const openCamera = async () => {
    setError(null)
    setCameraError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported in this browser. Use the file browser instead.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      setCameraActive(true)

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setCameraError('Camera permission denied. Allow camera access in your browser settings.')
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setCameraError('No camera found. Use the file browser instead.')
      } else {
        setCameraError(`Could not open camera: ${msg}`)
      }
    }
  }

  const capturePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const base64 = dataUrl.split(',')[1]

    setPreviewUrl(dataUrl)
    setSelectedFile({ base64, mimeType: 'image/jpeg', name: `scan-${Date.now()}.jpg` })
    stopCamera()
  }

  // ============================================
  // Submit — fire and forget, close immediately
  // ============================================
  const handleSubmit = () => {
    if (!selectedFile || !organisation?.id || !userSession?.access_token) return

    // Fire the scan in background — don't await
    fireAndForgetScan({
      organisationId: organisation.id,
      imageBase64: selectedFile.base64,
      mimeType: selectedFile.mimeType,
      filename: selectedFile.name,
      supabaseUrl,
      accessToken: userSession.access_token,
    })

    // Close immediately
    resetState()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="📸 Scan Document" width="480px">
      <div className="scan-upload-modal">
        {error && <div className="auth-error">{error}</div>}
        {cameraError && <div className="auth-error">{cameraError}</div>}

        {/* Camera active — show live video feed */}
        {cameraActive ? (
          <div className="scan-camera-area">
            <video ref={videoRef} autoPlay playsInline muted className="scan-camera-video" />
            <div className="scan-camera-controls">
              <button className="ps-btn ps-btn-ghost" onClick={stopCamera}>✕ Cancel</button>
              <button className="scan-camera-shutter" onClick={capturePhoto} title="Take photo">📸</button>
              <div style={{ width: 80 }} />
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        ) : !selectedFile ? (
          /* Drop zone */
          <div
            className={`scan-drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="scan-drop-icon">📄</div>
            <p className="scan-drop-text">Drag & drop an image here, or click to browse</p>
            <p className="scan-drop-hint">JPEG, PNG, WebP — max 10MB</p>
            <div className="scan-drop-actions">
              <button
                className="ps-btn ps-btn-primary"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
              >
                📁 Browse Files
              </button>
              <button
                className="ps-btn ps-btn-ghost"
                onClick={(e) => { e.stopPropagation(); openCamera() }}
              >
                📷 Camera
              </button>
            </div>
          </div>
        ) : (
          /* Compact preview with retake / send */
          <div className="scan-capture-preview">
            <div className="scan-capture-thumb">
              <img src={previewUrl ?? ''} alt="Captured" />
            </div>
            <div className="scan-capture-actions">
              <button className="ps-btn ps-btn-ghost" onClick={resetState}>↩ Retake</button>
              <button className="ps-btn ps-btn-primary" onClick={handleSubmit}>✨ Send to AI</button>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>
    </Modal>
  )
}
