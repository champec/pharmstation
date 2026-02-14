// ============================================
// Drawer — Right-side slide-in panel for forms
// Dims background but doesn't fully block visibility
// ============================================

import { useEffect, type ReactNode } from 'react'

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
}

export function Drawer({ isOpen, onClose, title, children, width = '540px' }: DrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Prevent body scroll
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className="drawer-panel"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-header">
          <h2>{title}</h2>
          <button className="ps-btn ps-btn-ghost drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {children}
        </div>
      </div>
    </>
  )
}
