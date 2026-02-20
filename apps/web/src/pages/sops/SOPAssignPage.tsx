import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore } from '@pharmstation/core'
import type { OrganisationMember } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export function SOPAssignPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { organisation, activeUser } = useAuthStore()

  const {
    activeDocument,
    assignments,
    loading,
    fetchDocument,
    fetchAssignments,
    assignToAll,
    assignToMember,
    removeAssignment,
    removeAllAssignments,
  } = useSOPStore()

  const [members, setMembers] = useState<OrganisationMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAllAssignment = assignments.some((a) => a.member_id === null)
  const assignedMemberIds = new Set(
    assignments.filter((a) => a.member_id !== null).map((a) => a.member_id!)
  )

  useEffect(() => {
    if (docId) {
      fetchDocument(docId)
      fetchAssignments(docId)
    }
  }, [docId])

  useEffect(() => {
    if (!organisation?.id) return
    setMembersLoading(true)
    getUserClient()
      .from('ps_organisation_members')
      .select('*, user_profile:ps_user_profiles(*)')
      .eq('organisation_id', organisation.id)
      .eq('status', 'active')
      .order('created_at')
      .then(({ data, error: e }) => {
        setMembersLoading(false)
        if (e) { setError(e.message); return }
        setMembers(data as OrganisationMember[])
      })
  }, [organisation?.id])

  const handleToggleAll = async () => {
    if (!docId || !organisation?.id || !activeUser?.id) return
    setSaving(true)
    setError(null)
    try {
      if (isAllAssignment) {
        await removeAllAssignments(docId)
      } else {
        await assignToAll(docId, organisation.id, activeUser.id)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleMember = async (member: OrganisationMember) => {
    if (!docId || !organisation?.id || !activeUser?.id) return
    setSaving(true)
    setError(null)
    try {
      if (assignedMemberIds.has(member.id)) {
        // Remove this specific assignment
        const assignment = assignments.find((a) => a.member_id === member.id)
        if (assignment) await removeAssignment(assignment.id)
      } else {
        await assignToMember(docId, organisation.id, member.id, activeUser.id)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const doc = activeDocument

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/sops" onClick={(e) => { e.preventDefault(); navigate('/sops') }}>SOPs</a>
          <span className="separator">/</span>
          <a href={`/sops/${docId}/edit`} onClick={(e) => { e.preventDefault(); navigate(`/sops/${docId}/edit`) }}>
            {doc?.title ?? 'Editor'}
          </a>
          <span className="separator">/</span>
          <span>Assign</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1>👥 Assign SOP</h1>
            {doc && <p style={{ margin: '4px 0 0', color: 'var(--ps-text-muted)', fontSize: 13 }}>{doc.title} · v{doc.version}</p>}
          </div>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(`/sops/${docId}/edit`)}>
            ← Back to Editor
          </button>
        </div>
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div className="ps-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: '0 0 4px' }}>Assign to All Staff</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ps-text-muted)' }}>
              All current and future active members of this organisation will see this SOP.
            </p>
          </div>
          <label className="ps-toggle">
            <input
              type="checkbox"
              checked={isAllAssignment}
              onChange={handleToggleAll}
              disabled={saving}
            />
            <span className="ps-toggle-track" />
          </label>
        </div>
      </div>

      {!isAllAssignment && (
        <div className="ps-card">
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 4px' }}>Assign to Specific Members</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ps-text-muted)' }}>
              Toggle individual staff members who should have access to this SOP.
            </p>
          </div>

          {membersLoading ? (
            <div style={{ color: 'var(--ps-text-muted)', fontSize: 13 }}>Loading members…</div>
          ) : members.length === 0 ? (
            <div style={{ color: 'var(--ps-text-muted)', fontSize: 13 }}>No active members found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {members.map((m) => {
                const assigned = assignedMemberIds.has(m.id)
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderRadius: 8,
                      background: assigned ? 'var(--ps-accent-bg)' : 'var(--ps-surface-hover)',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--ps-accent)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {(m.user_profile?.full_name ?? '?')[0].toUpperCase()}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {m.user_profile?.full_name ?? m.user_id}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ps-text-muted)', textTransform: 'capitalize' }}>
                        {m.role}
                        {m.user_profile?.email ? ` · ${m.user_profile.email}` : ''}
                      </div>
                    </div>

                    <label className="ps-toggle">
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => handleToggleMember(m)}
                        disabled={saving}
                      />
                      <span className="ps-toggle-track" />
                    </label>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {saving && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ps-text-muted)' }}>Saving…</div>
      )}
    </div>
  )
}
