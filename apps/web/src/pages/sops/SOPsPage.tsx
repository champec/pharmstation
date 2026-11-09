import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useSOPStore, canManageSOPs } from '@pharmstation/core'
import type { SOPDocument } from '@pharmstation/types'
import { Modal } from '../../components/Modal'
import { SOPReviewBadge } from '../../components/sop/SOPReviewBar'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { BookOpen, Trash2 } from 'lucide-react'
import { SOP_TEMPLATES } from '../../components/sop/sopTemplates'
import { alertDialog, confirmDialog } from '../../components/ui/dialog'

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
    createNode,
    updateNode,
    deleteDocument,
    clearError,
  } = useSOPStore()

  const isManager = canManageSOPs(membership)
  const [tab, setTab] = useState<Tab>(isManager ? 'manage' : 'my-sops')
  // Membership can arrive after the first render; staff never stay on the manage tab.
  useEffect(() => {
    if (membership && !isManager && tab === 'manage') setTab('my-sops')
  }, [membership, isManager, tab])
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('')
  const template = SOP_TEMPLATES.find((t) => t.id === templateId) ?? null

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
      if (template) {
        for (const [i, section] of template.sections.entries()) {
          const node = await createNode({ document_id: doc.id, parent_id: null, title: section.title, sort_order: i })
          await updateNode(node.id, { content_type: 'rich_text', rich_content: section.html })
        }
      }
      setShowCreate(false)
      setNewTitle('')
      setNewDesc('')
      setTemplateId('')
      navigate(`/sops/${doc.id}/edit`)
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (doc: SOPDocument) => {
    if (!await confirmDialog(`Delete "${doc.title}"? This removes all its sections, files and assignments. An SOP that anyone has signed can't be deleted; archive it instead so its sign-off history is kept.`)) return
    try {
      await deleteDocument(doc.id)
    } catch (e: any) {
      alertDialog(e.message)
    }
  }

  const getCompletionStatus = (doc: SOPDocument) => {
    if (!doc.my_completion) return { label: 'Not started', color: 'var(--ps-text-muted)', icon: '○' }
    if (doc.my_completion.document_version === doc.version)
      return { label: 'Completed', color: 'var(--ps-success)', icon: '✓' }
    return { label: 'New version: re-read required', color: 'var(--ps-warning)', icon: '⚠' }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'SOPs' }]}
        title="SOP library"
        subtitle={isManager
          ? 'Write your standard operating procedures, assign them to staff and keep a record of who has signed each version.'
          : 'Read and sign the SOPs your pharmacy has assigned to you.'}
        actions={isManager && tab === 'manage' ? (
          <button className="ps-btn ps-btn-primary" onClick={() => setShowCreate(true)}>
            + New SOP
          </button>
        ) : undefined}
      />

      {/* Tabs */}
      <div className="ps-tabs" style={{ marginBottom: 24 }}>
        <button
          className={`ps-tab ${tab === 'my-sops' ? 'active' : ''}`}
          onClick={() => setTab('my-sops')}
        >
          My SOPs
        </button>
        {isManager && (
          <button
            className={`ps-tab ${tab === 'manage' ? 'active' : ''}`}
            onClick={() => setTab('manage')}
          >
            Manage SOPs
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
        <EmptyState
          icon={BookOpen}
          title={tab === 'manage' ? 'No SOPs yet' : 'No SOPs assigned to you'}
          actions={isManager && tab === 'manage' ? (
            <>
              <button className="ps-btn ps-btn-secondary" onClick={() => { setTemplateId(SOP_TEMPLATES[0].id); setNewTitle(SOP_TEMPLATES[0].title); setNewDesc(SOP_TEMPLATES[0].description); setShowCreate(true) }}>
                Start from a template
              </button>
              <button className="ps-btn ps-btn-primary" onClick={() => setShowCreate(true)}>
                Create SOP
              </button>
            </>
          ) : undefined}
        >
          {tab === 'manage'
            ? 'Start from one of our templates (dispensing, RP, controlled drugs, fridge, complaints, incidents) or write your own. Publish it, then assign it to staff to read and sign.'
            : 'When your pharmacy assigns you an SOP it will appear here for you to read and sign.'}
        </EmptyState>
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
                    {tab === 'manage' && doc.published_at && doc.has_unpublished_changes && (
                      <span style={{ color: 'var(--ps-warning)', fontWeight: 600 }}>Changes not published</span>
                    )}
                    {tab === 'manage' && <SOPReviewBadge doc={doc} />}
                    {doc.published_at && (
                      <span>Published {new Date(doc.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
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
                      Edit
                    </button>
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => navigate(`/sops/${doc.id}/assign`)}
                    >
                      Assign
                    </button>
                    <button
                      className="ps-btn ps-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => navigate(`/sops/${doc.id}/progress`)}
                    >
                      Progress
                    </button>
                    <button
                      className="ps-btn"
                      style={{ fontSize: 12, padding: '4px 12px', marginLeft: 'auto', color: 'var(--ps-danger)' }}
                      onClick={() => handleDelete(doc)}
                      aria-label={`Delete ${doc.title}`}
                      title="Delete"
                    >
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); setNewTitle(''); setNewDesc(''); setTemplateId(''); setCreateError(null) }} title="New SOP">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ps-form-group">
            <label className="ps-label" htmlFor="sop-template">Start from</label>
            <select
              id="sop-template"
              className="ps-input"
              value={templateId}
              onChange={(e) => {
                const t = SOP_TEMPLATES.find((x) => x.id === e.target.value)
                setTemplateId(e.target.value)
                if (t) { setNewTitle(t.title); setNewDesc(t.description) }
              }}
            >
              <option value="">Blank SOP</option>
              {SOP_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>Template: {t.title}</option>
              ))}
            </select>
            {template && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ps-text-muted)' }}>
                {template.sections.length} sections to get you started. Review and adapt them to your pharmacy before you publish.
              </p>
            )}
          </div>
          <div className="ps-form-group">
            <label className="ps-label">Title *</label>
            <input
              className="ps-input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Dispensing process"
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
              {saving ? 'Creating…' : 'Create and edit'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
