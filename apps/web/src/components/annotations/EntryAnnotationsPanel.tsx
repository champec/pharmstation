// ============================================
// EntryAnnotationsPanel — Append-only notes underneath a register entry.
// Register entries are legally immutable, so any after-the-fact context
// (corrections context, balance check notes, errors, part supply tracking)
// is appended here as annotations — never edited into the entry itself.
//
// Part supply lifecycle:
//   'part_supply'        → entry flagged as part supply (balance owed)
//   'part_supply_closed' → outstanding part supply closed (balance supplied
//                           via later entries, or Rx expired / out of stock)
// ============================================

import { useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'
import type { EntryAnnotation, EntryAnnotationType, RegisterEntry } from '@pharmstation/types'

// --- Shared helpers ---

export function hasOpenPartSupply(entry: RegisterEntry): boolean {
  const anns = entry.annotations ?? []
  return (
    anns.some((a) => a.annotation_type === 'part_supply') &&
    !anns.some((a) => a.annotation_type === 'part_supply_closed')
  )
}

export function hasClosedPartSupply(entry: RegisterEntry): boolean {
  const anns = entry.annotations ?? []
  return (
    anns.some((a) => a.annotation_type === 'part_supply') &&
    anns.some((a) => a.annotation_type === 'part_supply_closed')
  )
}

/** Insert an annotation row. Reusable from entry forms (e.g. part supply at entry time). */
export async function addEntryAnnotation(params: {
  entryId: string
  organisationId: string
  userId: string
  text: string
  type: EntryAnnotationType
}): Promise<{ annotation: EntryAnnotation | null; error: string | null }> {
  const { data, error } = await getUserClient()
    .from('ps_entry_annotations')
    .insert({
      entry_id: params.entryId,
      organisation_id: params.organisationId,
      annotation_text: params.text,
      annotation_type: params.type,
      created_by: params.userId,
    })
    .select('*, created_by_profile:created_by(full_name)')
    .single()

  if (error) return { annotation: null, error: error.message }
  return { annotation: data as EntryAnnotation, error: null }
}

const ANNOTATION_META: Record<EntryAnnotationType, { label: string; className: string; icon: string }> = {
  note: { label: 'Note', className: 'annotation-badge-note', icon: '📝' },
  flag: { label: 'Flag', className: 'annotation-badge-flag', icon: '🚩' },
  query: { label: 'Query', className: 'annotation-badge-flag', icon: '❓' },
  resolution: { label: 'Resolution', className: 'annotation-badge-closed', icon: '✔' },
  part_supply: { label: 'Part supply', className: 'annotation-badge-part', icon: '⏳' },
  part_supply_closed: { label: 'Part supply closed', className: 'annotation-badge-closed', icon: '✔' },
}

interface EntryAnnotationsPanelProps {
  entry: RegisterEntry
  onAnnotationAdded: (entryId: string, annotation: EntryAnnotation) => void
}

export function EntryAnnotationsPanel({ entry, onAnnotationAdded }: EntryAnnotationsPanelProps) {
  const { organisation, activeUser } = useAuthStore()
  const [activeAction, setActiveAction] = useState<EntryAnnotationType | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const annotations = [...(entry.annotations ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const isSupplyEntry = entry.transaction_type === 'supply'
  const flagged = annotations.some((a) => a.annotation_type === 'part_supply')
  const closed = annotations.some((a) => a.annotation_type === 'part_supply_closed')

  const openAction = (type: EntryAnnotationType) => {
    setActiveAction(type)
    setText('')
    setError(null)
  }

  const cancelAction = () => {
    setActiveAction(null)
    setText('')
    setError(null)
  }

  const submit = async () => {
    if (!organisation || !activeUser || !activeAction) return
    const defaultText =
      activeAction === 'part_supply'
        ? 'Part supply — balance owed to patient'
        : activeAction === 'part_supply_closed'
        ? 'Part supply closed'
        : ''
    const finalText = text.trim() || defaultText
    if (!finalText) {
      setError('Please enter a note')
      return
    }
    setSaving(true)
    setError(null)
    const { annotation, error: err } = await addEntryAnnotation({
      entryId: entry.id,
      organisationId: organisation.id,
      userId: activeUser.id,
      text: finalText,
      type: activeAction,
    })
    setSaving(false)
    if (err || !annotation) {
      setError(err ?? 'Failed to add note')
      return
    }
    setText('')
    setActiveAction(null)
    onAnnotationAdded(entry.id, annotation)
  }

  return (
    <div className="annotation-panel">
      {/* Existing annotations */}
      {annotations.length === 0 ? (
        <p className="annotation-empty">No notes on this entry yet.</p>
      ) : (
        <ul className="annotation-list">
          {annotations.map((a) => {
            const meta = ANNOTATION_META[a.annotation_type] ?? ANNOTATION_META.note
            return (
              <li key={a.id} className="annotation-item">
                <span className={`annotation-badge ${meta.className}`}>
                  {meta.icon} {meta.label}
                </span>
                <span className="annotation-text">{a.annotation_text}</span>
                <span className="annotation-meta">
                  {a.created_by_profile?.full_name ?? 'Unknown'}
                  {' — '}
                  {new Date(a.created_at).toLocaleString('en-GB', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {activeAction === null ? (
        /* Collapsed: small action buttons only */
        <div className="annotation-actions">
          <button
            type="button"
            className="ps-btn ps-btn-ghost annotation-btn"
            onClick={() => openAction('note')}
          >
            📝 Add note
          </button>
          {isSupplyEntry && !flagged && (
            <button
              type="button"
              className="ps-btn ps-btn-ghost annotation-btn annotation-btn-part"
              onClick={() => openAction('part_supply')}
              title="Mark this entry as a part supply (balance owed to patient)"
            >
              ⏳ Mark part supply
            </button>
          )}
          {flagged && !closed && (
            <button
              type="button"
              className="ps-btn ps-btn-ghost annotation-btn annotation-btn-close"
              onClick={() => openAction('part_supply_closed')}
              title="Close this part supply — e.g. balance supplied (see later entry) or prescription expired"
            >
              ✔ Close part supply
            </button>
          )}
        </div>
      ) : (
        /* Expanded: input for the chosen action */
        <div className="annotation-add-form">
          <input
            className="ps-input annotation-input"
            placeholder={
              activeAction === 'note'
                ? 'Write a note… (entries can\u2019t be edited — notes are appended underneath)'
                : activeAction === 'part_supply'
                ? 'Optional detail, e.g. "Supplied 50 of 100 — balance owed"'
                : 'Optional reason, e.g. "Balance supplied — see entry #12" or "Rx expired"'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') cancelAction()
            }}
            disabled={saving}
            autoFocus
          />
          <button
            type="button"
            className={`ps-btn ps-btn-ghost annotation-btn ${
              activeAction === 'part_supply'
                ? 'annotation-btn-part'
                : activeAction === 'part_supply_closed'
                ? 'annotation-btn-close'
                : ''
            }`}
            onClick={submit}
            disabled={saving || (activeAction === 'note' && !text.trim())}
          >
            {saving
              ? 'Saving…'
              : activeAction === 'note'
              ? '📝 Save note'
              : activeAction === 'part_supply'
              ? '⏳ Mark part supply'
              : '✔ Close part supply'}
          </button>
          <button
            type="button"
            className="ps-btn ps-btn-ghost annotation-btn"
            onClick={cancelAction}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
    </div>
  )
}
