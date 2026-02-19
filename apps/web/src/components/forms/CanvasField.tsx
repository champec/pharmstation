// ============================================
// CanvasField — Reusable HTML5 canvas for signatures/drawing
// Works with field_type: 'signature' | 'canvas'
// ============================================

import { useRef, useEffect, useState, useCallback } from 'react'

interface CanvasFieldProps {
  value?: string
  onChange: (base64: string) => void
  width?: number
  height?: number
  disabled?: boolean
  label?: string
}

interface Stroke {
  points: { x: number; y: number }[]
}

export function CanvasField({
  value,
  onChange,
  width = 400,
  height = 200,
  disabled,
  label,
}: CanvasFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const currentStroke = useRef<Stroke | null>(null)

  // Redraw all strokes onto the canvas
  const redraw = useCallback(
    (ctx: CanvasRenderingContext2D, strokeList: Stroke[]) => {
      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = '#0a0f1a'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const stroke of strokeList) {
        if (stroke.points.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
        }
        ctx.stroke()
      }
    },
    [width, height],
  )

  // Load initial value image onto canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0)
      }
      img.src = value
    } else {
      ctx.clearRect(0, 0, width, height)
    }
  }, [value, width, height, disabled])

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (width / rect.width),
      y: (e.clientY - rect.top) * (height / rect.height),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.preventDefault()
    const pos = getPointerPos(e)
    currentStroke.current = { points: [pos] }
    setIsDrawing(true)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke.current || disabled) return
    const pos = getPointerPos(e)
    currentStroke.current.points.push(pos)

    // Draw incrementally
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const pts = currentStroke.current.points
    if (pts.length >= 2) {
      ctx.strokeStyle = '#0a0f1a'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y)
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      ctx.stroke()
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentStroke.current || disabled) return
    setIsDrawing(false)
    const newStrokes = [...strokes, currentStroke.current]
    setStrokes(newStrokes)
    currentStroke.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)

    // Emit base64
    const dataUrl = canvasRef.current?.toDataURL('image/png') || ''
    onChange(dataUrl)
  }

  const handleUndo = () => {
    if (strokes.length === 0) return
    const newStrokes = strokes.slice(0, -1)
    setStrokes(newStrokes)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      redraw(ctx, newStrokes)
      const dataUrl = canvasRef.current?.toDataURL('image/png') || ''
      onChange(dataUrl)
    }
  }

  const handleClear = () => {
    setStrokes([])
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, width, height)
      onChange('')
    }
  }

  // Disabled mode: show static image
  if (disabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {label && (
          <label style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', fontWeight: 500 }}>
            {label}
          </label>
        )}
        {value ? (
          <img
            src={value}
            alt={label || 'Signature'}
            style={{
              maxWidth: '100%',
              width,
              height,
              border: '1px solid var(--ps-border)',
              borderRadius: 'var(--ps-radius-md)',
              background: '#fff',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div
            style={{
              width,
              height,
              maxWidth: '100%',
              border: '1px dashed var(--ps-border)',
              borderRadius: 'var(--ps-radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ps-slate)',
              fontSize: 'var(--ps-font-sm)',
              background: 'var(--ps-off-white)',
            }}
          >
            No signature
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {label && (
        <label style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          maxWidth: '100%',
          border: '1px solid var(--ps-border)',
          borderRadius: 'var(--ps-radius-md)',
          cursor: 'crosshair',
          touchAction: 'none',
          background: '#fff',
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--ps-space-xs)' }}>
        <button
          type="button"
          className="ps-btn ps-btn-ghost ps-btn-sm"
          onClick={handleUndo}
          disabled={strokes.length === 0}
        >
          ↩ Undo
        </button>
        <button
          type="button"
          className="ps-btn ps-btn-ghost ps-btn-sm"
          onClick={handleClear}
          disabled={strokes.length === 0}
        >
          ✕ Clear
        </button>
      </div>
    </div>
  )
}
