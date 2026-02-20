import { useEffect, useState } from 'react'
import type { StickyNote, StickyPriority, UserProfile } from '@pharmstation/types'
import { useStickyNoteStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'

interface OrgMember {
  user_id: string
  user_profile: UserProfile | null
}

const PRIORITIES: { value: StickyPriority; label: string; color: string }[] = [
  { value: 1, label: 'Low', color: 'var(--sticky-p1)' },
  { value: 2, label: 'Medium', color: 'var(--sticky-p2)' },
  { value: 3, label: 'High', color: 'var(--sticky-p3)' },
  { value: 4, label: 'Urgent', color: 'var(--sticky-p4)' },
]

interface Props {
  note: StickyNote
  orgId: string
  currentUserId: string
  onClose: () => void
}

export function NoteSettingsModal({ note, orgId, currentUserId, onClose }: Props) {
  const { updatePriority, updateAssignment, updateTargetDate } = useStickyNoteStore()

  const [priority, setPriority] = useState<StickyPriority>(note.priority)
  const [assignedTo, setAssignedTo] = useState<string>(note.assigned_to ?? '')
  const [targetDate, setTargetDate] = useState<string>(note.target_date ?? '')
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [saving, setSaving] = useState(false)

  // Fetch org members for assignee dropdown
  useEffect(() => {
    async function load() {
      setLoadingMembers(true)
      const { data } = await getUserClient()
        .from('ps_organisation_members')
        .select('user_id, user_profile:ps_user_profiles(id, full_name)')
        .eq('organisation_id', orgId)
        .eq('status', 'active')
        .order('user_id')
      setMembers((data ?? []) as unknown as OrgMember[])
      setLoadingMembers(false)
    }
    load()
  }, [orgId])

  const handleSave = async () => {
    setSaving(true)
    await Promise.all([
      priority !== note.priority ? updatePriority(note.id, priority) : Promise.resolve(),
      assignedTo !== (note.assigned_to ?? '') ? updateAssignment(note.id, assignedTo || null) : Promise.resolve(),
      targetDate !== (note.target_date ?? '') ? updateTargetDate(note.id, targetDate || null) : Promise.resolve(),
    ])
    setSaving(false)
    onClose()
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-container">
        <div className="modal-dialog" style={{ maxWidth: '420px' }}>
          <div className="modal-header">
            <h2>Note Settings</h2>
            <button className="ps-btn ps-btn-ghost modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="modal-body">
            {/* Priority */}
            <div className="form-group">
              <label>Priority</label>
              <div className="sticky-priority-selector">
                {PRIORITIES.map(({ value, label, color }) => (
                  <button
                    key={value}
                    className={`sticky-priority-btn ${priority === value ? 'sticky-priority-btn--active' : ''}`}
                    style={{ '--priority-color': color } as React.CSSProperties}
                    onClick={() => setPriority(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assign to */}
            <div className="form-group">
              <label>Assign to</label>
              {loadingMembers ? (
                <p style={{ color: 'var(--ps-mist)', fontSize: 'var(--ps-font-sm)' }}>Loading members…</p>
              ) : (
                <select
                  className="ps-input"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.user_profile?.full_name ?? m.user_id}
                      {m.user_id === currentUserId ? ' (me)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Target date */}
            <div className="form-group">
              <label>Target date</label>
              <input
                type="date"
                className="ps-input"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button className="ps-btn ps-btn-ghost" onClick={onClose}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
