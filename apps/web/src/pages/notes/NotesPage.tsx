import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useAuthStore, useStickyNoteStore } from '@pharmstation/core'
import type { StickyNote } from '@pharmstation/types'
import { StickyNoteCard } from './StickyNoteCard'
import { NoteSettingsModal } from './NoteSettingsModal'
import { NoteFullModal } from './NoteFullModal'

export function NotesPage() {
  const { organisation, activeUser } = useAuthStore()
  const { notes, loading, error, fetchNotes, createNote, deleteNote, updateContent, updatePosition, setPositionLocal, clearError } = useStickyNoteStore()

  const [settingsNote, setSettingsNote] = useState<StickyNote | null>(null)
  const [fullNote, setFullNote] = useState<StickyNote | null>(null)
  const [filterMine, setFilterMine] = useState(false)
  const [filterPriority, setFilterPriority] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (organisation?.id) fetchNotes(organisation.id)
  }, [organisation?.id, fetchNotes])

  /* ---------- create note on double-click ---------- */
  const handleCanvasDblClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!organisation?.id || !activeUser?.id) return
    // Only create if the click target is the canvas itself (not a child note)
    if ((e.target as HTMLElement).closest('.sticky-note')) return

    const rect = canvasRef.current!.getBoundingClientRect()
    const pos_x = e.clientX - rect.left - 100 // centre the 200px note
    const pos_y = e.clientY - rect.top - 60

    await createNote({
      org_id: organisation.id,
      author_id: activeUser.id,
      content: '',
      pos_x: Math.max(0, pos_x),
      pos_y: Math.max(0, pos_y),
      priority: 1,
    })
  }, [organisation?.id, activeUser?.id, createNote])

  /* ---------- dragging ---------- */
  const handleDragStart = useCallback((id: string, e: React.MouseEvent) => {
    const note = notes.find((n) => n.id === id)
    if (!note) return
    setDragging({ id, startX: e.clientX, startY: e.clientY, startPosX: note.pos_x, startPosY: note.pos_y })
  }, [notes])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragging.startX
    const dy = e.clientY - dragging.startY
    setPositionLocal(dragging.id, Math.max(0, dragging.startPosX + dx), Math.max(0, dragging.startPosY + dy))
  }, [dragging, setPositionLocal])

  const handleMouseUp = useCallback(() => {
    if (!dragging) return
    const note = notes.find((n) => n.id === dragging.id)
    if (note) updatePosition(dragging.id, note.pos_x, note.pos_y)
    setDragging(null)
  }, [dragging, notes, updatePosition])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  /* ---------- filtering ---------- */
  const filtered = useMemo(() => {
    let list = notes
    if (filterMine && activeUser?.id) {
      list = list.filter((n) => n.assigned_to === activeUser.id)
    }
    if (filterPriority !== null) {
      list = list.filter((n) => n.priority === filterPriority)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((n) => n.content.toLowerCase().includes(q))
    }
    return list
  }, [notes, filterMine, filterPriority, search, activeUser?.id])

  return (
    <div className="notes-page">
      {/* ── Toolbar ── */}
      <div className="notes-toolbar">
        <div className="notes-toolbar-left">
          <h1 className="notes-title">📌 Notes</h1>
          <span className="notes-hint">Double-click the canvas to add a note</span>
        </div>
        <div className="notes-toolbar-right">
          <span className="notes-filter-label">Filters:</span>
          <label className="notes-filter-checkbox">
            <input
              type="checkbox"
              checked={filterMine}
              onChange={(e) => setFilterMine(e.target.checked)}
            />
            Assigned to me
          </label>
          <input
            className="ps-input notes-search"
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="auth-error" style={{ margin: 'var(--ps-space-sm) var(--ps-space-lg)', cursor: 'pointer' }} onClick={clearError}>
          {error} — click to dismiss
        </div>
      )}

      {/* ── Legend / Priority Filter ── */}
      <div className="notes-legend">
        <span className="notes-legend-label">Priority:</span>
        {[
          { p: 1, label: 'Low', color: 'var(--sticky-p1)' },
          { p: 2, label: 'Medium', color: 'var(--sticky-p2)' },
          { p: 3, label: 'High', color: 'var(--sticky-p3)' },
          { p: 4, label: 'Urgent', color: 'var(--sticky-p4)' },
        ].map(({ p, label, color }) => (
          <button
            key={p}
            className={`notes-legend-item ${filterPriority === p ? 'notes-legend-item--active' : ''}`}
            onClick={() => setFilterPriority(filterPriority === p ? null : p)}
            title={filterPriority === p ? `Remove ${label} filter` : `Filter by ${label}`}
          >
            <span className="notes-legend-dot" style={{ background: color }} />
            {label}
            {filterPriority === p && <span className="notes-legend-clear">✕</span>}
          </button>
        ))}
        {filterPriority !== null && (
          <button className="notes-legend-reset" onClick={() => setFilterPriority(null)}>
            Clear
          </button>
        )}
      </div>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        className="notes-canvas"
        onDoubleClick={handleCanvasDblClick}
        style={{ cursor: dragging ? 'grabbing' : 'default' }}
      >
        {loading && notes.length === 0 && (
          <div className="notes-empty">
            <div className="loading-spinner" />
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="notes-empty">
            <p>Double-click anywhere to add your first note</p>
          </div>
        )}

        {filtered.map((note) => (
          <StickyNoteCard
            key={note.id}
            note={note}
            currentUserId={activeUser?.id ?? ''}
            isDragging={dragging?.id === note.id}
            onDragStart={(e: React.MouseEvent) => handleDragStart(note.id, e)}
            onSaveContent={(content: string) => updateContent(note.id, content)}
            onDelete={() => deleteNote(note.id)}
            onOpenSettings={() => setSettingsNote(note)}
            onShowFull={() => setFullNote(note)}
          />
        ))}
      </div>

      {/* ── Modals ── */}
      {settingsNote && (
        <NoteSettingsModal
          note={settingsNote}
          orgId={organisation?.id ?? ''}
          currentUserId={activeUser?.id ?? ''}
          onClose={() => setSettingsNote(null)}
        />
      )}
      {fullNote && (
        <NoteFullModal
          note={fullNote}
          currentUserId={activeUser?.id ?? ''}
          onClose={() => setFullNote(null)}
          onSave={(content: string) => updateContent(fullNote.id, content)}
        />
      )}
    </div>
  )
}
