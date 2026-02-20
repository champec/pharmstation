import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore } from '@pharmstation/core'
import type { SOPDocument } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

type Tab = 'my-sops' | 'manage'

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--ps-warning)' },
  published: { label: 'Published', color: 'var(--ps-success)' },
  archived: { label: 'Archived', color: 'var(--ps-text-muted)' },
}

export function SOPsPage() {
  const navigate = useNavigate()
  const { organisation, membership, activeUser } = useAuthStore()
  const {
    documents,
    loading,
    error,
    fetchDocuments,
    fetchMyDocuments,
    createDocument,
    deleteDocument,
    clearError,
  } = useSOPStore()

  const isManager = ['owner', 'manager', 'pharmacist'].includes(membership?.role ?? '')
  const [tab, setTab] = useState<Tab>(isManager ? 'manage' : 'my-sops')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!organisation?.id || !membership?.id) return
    if (tab === 'manage') {
      fetchDocuments(organisation.id)
    } else {
      fetchMyDocuments(organisation.id, membership.id)
    }
  }, [organisation?.id, membership?.id, tab, fetchDocuments, fetchMyDocuments])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!organisation?.id || !newTitle.trim() || !activeUser?.id) return
    setSaving(true)
    setCreateError(null)
    try {
      const doc = await createDocument({
        org_id: organisation.id,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        created_by: activeUser.id,
      })
      setShowCreate(false)
      setNewTitle('')
      setNewDesc('')
      navigate(`/sops/${doc.id}/edit`)
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (doc: SOPDocument) => {
    if (!confirm(`Delete "${doc.title}"? This will remove all nodes and assignments.`)) return
    try {
      await deleteDocument(doc.id)
    } catch (e: any) {
      alert(e.message)
    }
  }

  const getCompletionStatus = (doc: SOPDocument) => {
    if (!doc.my_completion) return { label: 'Not started', color: 'var(--ps-text-muted)', icon: '○' }
    if (doc.my_completion.document_version === doc.version)
      return { label: 'Completed', color: 'var(--ps-success)', icon: '✓' }
    return { label: 'New version — re-read required', color: 'var(--ps-warning)', icon: '⚠' }
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>SOPs</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📋 SOP Library</h1>
          {isManager && tab === 'manage' && (
            <button className="ps-btn ps-btn-primary" onClick={() => setShowCreate(true)}>
              + New SOP
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="ps-tabs" style={{ marginBottom: 24 }}>
        <button
          className={`ps-tab ${tab === 'my-sops' ? 'active' : ''}`}
          onClick={() => setTab('my-sops')}
        >
          📖 My SOPs
        </button>
        {isManager && (
          <button
            className={`ps-tab ${tab === 'manage' ? 'active' : ''}`}
            onClick={() => setTab('manage')}
          >
            ⚙️ Manage SOPs
          </button>
        )}
      </div>

      {error && (
        <div className="ps-alert ps-alert-error" style={{ marginBottom: 16 }}>
          {error}
          <button onClick={clearError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--ps-text-muted)' }}>
          Loading SOPs…
        </div>
      ) : documents.length === 0 ? (
        <div className="ps-empty-state">
          <div style={{ fontSize: 48 }}>📋</div>
          <h3>
            {tab === 'manage'
              ? 'No SOPs yet — create your first one'
              : 'No SOPs have been assigned to you yet'}
          </h3>
          {isManager && tab === 'manage' && (
            <button className="ps-btn ps-btn-primary" onClick={() => setShowCreate(true)}>
              Create SOP
            </button>
          )}
        </div>
      ) : (
        <div className="ps-card-grid">
          {documents.map((doc) => {
            const statusBadge = STATUS_BADGE[doc.status] ?? STATUS_BADGE.draft
            const completion = tab === 'my-sops' ? getCompletionStatus(doc) : null

            return (
              <div key={doc.id} className="ps-card" style={{ cursor: 'pointer' }}>
                <div
                  style={{ flex: 1 }}
                  onClick={() =>
                    navigate(tab === 'manage' ? `/sops/${doc.id}/edit` : `/sops/${doc.id}/read`)
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{doc.title}</h3>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: `${statusBadge.color}20`,
                        color: statusBadge.color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {statusBadge.label}
                    </span>
                  </div>

                  {doc.description && (
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ps-text-muted)', lineHeight: 1.5 }}>
                      {doc.description}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--ps-text-muted)', flexWrap: 'wrap' }}>
                    <span>v{doc.version}</span>
                    {doc.published_at && (
                      <span>Published {new Date(doc.published_at).toLocaleDateString()}</span>
                    )}
                    {completion && (
                      <span style={{ color: completion.color, fontWeight: 600 }}>
                        {completion.icon} {completion.label}
                      </span>
                    )}
                  </div>
                </div>

                {tab === 'manage' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ps-border)' }}>
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => navigate(`/sops/${doc.id}/edit`)}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => navigate(`/sops/${doc.id}/assign`)}
                    >
                      👥 Assign
                    </button>
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => navigate(`/sops/${doc.id}/progress`)}
                    >
                      📊 Progress
                    </button>
                    <button
                      className="ps-btn"
                      style={{ fontSize: 12, padding: '4px 12px', marginLeft: 'auto', color: 'var(--ps-danger)' }}
                      onClick={() => handleDelete(doc)}
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); setNewTitle(''); setNewDesc(''); setCreateError(null) }} title="New SOP Document">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ps-form-group">
            <label className="ps-label">Title *</label>
            <input
              className="ps-input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Dispensing Procedures"
              autoFocus
            />
          </div>
          <div className="ps-form-group">
            <label className="ps-label">Description</label>
            <textarea
              className="ps-input"
              rows={3}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Brief description of this SOP document…"
            />
          </div>
          {createError && <div className="ps-alert ps-alert-error">{createError}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreate} disabled={saving || !newTitle.trim()}>
              {saving ? 'Creating…' : 'Create & Edit'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
