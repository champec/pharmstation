import { useRef, useImperativeHandle, forwardRef, useEffect } from 'react'

export interface SignatureCaptureRef {
  clear: () => void
  getDataUrl: () => string | null
  isEmpty: () => boolean
}

interface SignatureCaptureProps {
  width?: number
  height?: number
  lineColor?: string
  lineWidth?: number
}

export const SignatureCapture = forwardRef<SignatureCaptureRef, SignatureCaptureProps>(
  ({ width = 376, height = 160, lineColor = '#000', lineWidth = 2 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawing = useRef(false)
    const lastPos = useRef({ x: 0, y: 0 })
    const hasStrokes = useRef(false)

    useEffect(() => {
      clearCanvas()
    }, [])

    const clearCanvas = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      hasStrokes.current = false
    }

    useImperativeHandle(ref, () => ({
      clear: clearCanvas,
      getDataUrl: () => canvasRef.current?.toDataURL('image/png') ?? null,
      isEmpty: () => !hasStrokes.current,
    }))

    const getPos = (e: React.TouchEvent | React.MouseEvent) => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onStart = (e: React.TouchEvent | React.MouseEvent) => {
      e.preventDefault()
      isDrawing.current = true
      lastPos.current = getPos(e)
    }

    const onMove = (e: React.TouchEvent | React.MouseEvent) => {
      if (!isDrawing.current) return
      e.preventDefault()
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      const pos = getPos(e)
      ctx.beginPath()
      ctx.moveTo(lastPos.current.x, lastPos.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.strokeStyle = lineColor
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.stroke()
      lastPos.current = pos
      hasStrokes.current = true
    }

    const onEnd = () => { isDrawing.current = false }

    return (
      <div style={{ border: '2px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
          onMouseDown={onStart}
          onMouseMove={onMove}
          onMouseUp={onEnd}
          onMouseLeave={onEnd}
          onTouchStart={onStart}
          onTouchMove={onMove}
          onTouchEnd={onEnd}
        />
      </div>
    )
  }
)

SignatureCapture.displayName = 'SignatureCapture'
