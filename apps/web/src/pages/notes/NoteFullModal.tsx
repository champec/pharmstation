import { useState } from 'react'
import type { StickyNote } from '@pharmstation/types'

const PRIORITY_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: 'Low', color: 'var(--sticky-p1)' },
  2: { label: 'Medium', color: 'var(--sticky-p2)' },
  3: { label: 'High', color: 'var(--sticky-p3)' },
  4: { label: 'Urgent', color: 'var(--sticky-p4)' },
}

interface Props {
  note: StickyNote
  currentUserId: string
  onClose: () => void
  onSave: (content: string) => void
}

export function NoteFullModal({ note, currentUserId, onClose, onSave }: Props) {
  const isAuthor = note.author_id === currentUserId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.content)
  const p = PRIORITY_LABEL[note.priority] ?? PRIORITY_LABEL[1]

  const handleSave = () => {
    onSave(draft)
    setEditing(false)
    onClose()
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-container">
        <div className="modal-dialog" style={{ maxWidth: '560px' }}>
          <div className="modal-header">
            <div className="note-full-header-meta">
              <span
                className="note-full-priority-badge"
                style={{ background: p.color }}
              >
                {p.label}
              </span>
              {note.assignee && (
                <span className="note-full-badge">👤 {note.assignee.full_name}</span>
              )}
              {note.target_date && (
                <span className="note-full-badge">
                  📅 {new Date(note.target_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
              {note.is_completed && (
                <span className="note-full-badge note-full-badge--done">✅ Completed</span>
              )}
            </div>
            <button className="ps-btn ps-btn-ghost modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="modal-body">
            {editing ? (
              <textarea
                className="note-full-textarea ps-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                autoFocus
              />
            ) : (
              <div className="note-full-content">
                {note.content || <span style={{ color: 'var(--ps-mist)' }}>No content</span>}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <span className="note-full-author">
              {note.author?.full_name} · {new Date(note.created_at).toLocaleDateString('en-GB')}
            </span>
            <div className="note-full-actions">
              {!editing && isAuthor && (
                <button className="ps-btn ps-btn-ghost" onClick={() => setEditing(true)}>✏️ Edit</button>
              )}
              {editing && (
                <>
                  <button className="ps-btn ps-btn-ghost" onClick={() => { setEditing(false); setDraft(note.content) }}>Cancel</button>
                  <button className="ps-btn ps-btn-primary" onClick={handleSave}>Save</button>
                </>
              )}
              {!editing && (
                <button className="ps-btn ps-btn-primary" onClick={onClose}>Close</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
