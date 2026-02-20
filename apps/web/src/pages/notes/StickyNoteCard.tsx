import { useState, useRef, useEffect } from 'react'
import type { StickyNote } from '@pharmstation/types'
import { useStickyNoteStore } from '@pharmstation/core'

const PRIORITY_COLORS: Record<number, string> = {
  1: 'var(--sticky-p1)',
  2: 'var(--sticky-p2)',
  3: 'var(--sticky-p3)',
  4: 'var(--sticky-p4)',
}

const PRIORITY_SHADOW: Record<number, string> = {
  1: 'var(--sticky-p1-shadow)',
  2: 'var(--sticky-p2-shadow)',
  3: 'var(--sticky-p3-shadow)',
  4: 'var(--sticky-p4-shadow)',
}

const MAX_PREVIEW = 160

interface Props {
  note: StickyNote
  currentUserId: string
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onSaveContent: (content: string) => void
  onDelete: () => void
  onOpenSettings: () => void
  onShowFull: () => void
}

export function StickyNoteCard({ note, currentUserId, isDragging, onDragStart, onSaveContent, onDelete, onOpenSettings, onShowFull }: Props) {
  const { toggleCompleted } = useStickyNoteStore()

  const isAuthor = note.author_id === currentUserId
  const isAssignee = note.assigned_to === currentUserId
  const canDelete = note.assigned_to === null || isAssignee || isAuthor

  const [editing, setEditing] = useState(note.content === '') // new empty notes go straight into edit
  const [draft, setDraft] = useState(note.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when editing starts
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editing])

  // If the note content changes externally (e.g. after creation), sync draft
  useEffect(() => {
    if (!editing) setDraft(note.content)
  }, [note.content, editing])

  const handleBlur = () => {
    setEditing(false)
    if (draft !== note.content) {
      onSaveContent(draft)
    }
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isAuthor) {
      setEditing(true)
    }
  }

  const isOverflow = note.content.length > MAX_PREVIEW
  const preview = isOverflow ? note.content.slice(0, MAX_PREVIEW) + '…' : note.content

  const bg = PRIORITY_COLORS[note.priority] ?? PRIORITY_COLORS[1]
  const shadow = PRIORITY_SHADOW[note.priority] ?? PRIORITY_SHADOW[1]

  return (
    <div
      className={`sticky-note priority-${note.priority} ${note.is_completed ? 'sticky-note--completed' : ''} ${isDragging ? 'sticky-note--dragging' : ''}`}
      style={{
        left: note.pos_x,
        top: note.pos_y,
        background: bg,
        boxShadow: `3px 3px 10px ${shadow}`,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: editing ? 'text' : 'none',
      }}
      onMouseDown={(e) => {
        // Don't start drag if clicking interactive elements
        if ((e.target as HTMLElement).closest('button, textarea, .sticky-note-action')) return
        onDragStart(e)
      }}
    >
      {/* ── Top bar: priority stripe ── */}
      <div className="sticky-note-stripe" />

      {/* ── Content area ── */}
      <div className="sticky-note-body">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="sticky-note-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Type your note…"
            rows={5}
          />
        ) : (
          <div
            className="sticky-note-text"
            onDoubleClick={handleEditClick}
          >
            {note.content ? preview : <span className="sticky-note-placeholder">Tap to edit…</span>}
            {isOverflow && (
              <button
                className="sticky-note-more"
                onClick={(e) => { e.stopPropagation(); onShowFull() }}
              >
                more
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Meta ── */}
      <div className="sticky-note-meta">
        {note.assignee && (
          <span className="sticky-note-assignee" title={`Assigned to ${note.assignee.full_name}`}>
            👤 {note.assignee.full_name}
          </span>
        )}
        {note.target_date && (
          <span className="sticky-note-date">
            📅 {new Date(note.target_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>

      {/* ── Action bar ── */}
      <div className="sticky-note-actions">
        {/* Complete toggle */}
        <button
          className={`sticky-note-action ${note.is_completed ? 'sticky-note-action--done' : ''}`}
          title={note.is_completed ? 'Mark incomplete' : 'Mark complete'}
          onClick={(e) => { e.stopPropagation(); toggleCompleted(note.id, note.is_completed) }}
        >
          {note.is_completed ? '✅' : '⬜'}
        </button>

        {/* Edit (author only) */}
        {isAuthor && (
          <button
            className="sticky-note-action"
            title="Edit note"
            onClick={handleEditClick}
          >
            ✏️
          </button>
        )}

        {/* Settings (author only) */}
        {isAuthor && (
          <button
            className="sticky-note-action"
            title="Note settings"
            onClick={(e) => { e.stopPropagation(); onOpenSettings() }}
          >
            ⚙️
          </button>
        )}

        {/* Delete */}
        {canDelete && (
          <button
            className="sticky-note-action sticky-note-action--delete"
            title="Delete note"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            🗑️
          </button>
        )}
      </div>

      {/* ── Author + timestamp footer ── */}
      <div className="sticky-note-footer">
        <span className="sticky-note-author">{note.author?.full_name ?? 'Unknown'}</span>
        <span className="sticky-note-time">
          {new Date(note.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
      </div>
    </div>
  )
}
