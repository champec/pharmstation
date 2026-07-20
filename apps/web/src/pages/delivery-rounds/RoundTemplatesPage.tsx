import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore } from '@pharmstation/core'
import { Modal } from '../../components/Modal'

export function RoundTemplatesPage() {
  const navigate = useNavigate()
  const { organisation, membership } = useAuthStore()
  const {
    templates,
    loading,
    error,
    fetchTemplates,
    createTemplate,
    deleteTemplate,
    createRoundFromTemplate,
    clearError,
  } = useDeliveryRoundStore()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (organisation?.id) fetchTemplates(organisation.id)
  }, [organisation?.id, fetchTemplates])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!organisation?.id || !membership?.user_id || !newName.trim()) return
    setSaving(true)
    try {
      await createTemplate({
        organisation_id: organisation.id,
        name: newName.trim(),
        notes: newNotes.trim() || undefined,
        created_by: membership.user_id,
      })
      setShowCreateModal(false)
      setNewName('')
      setNewNotes('')
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template? This cannot be undone.')) return
    try { await deleteTemplate(id) } catch (e: any) { alert(e.message) }
  }

  const handleCreateRound = async (templateId: string) => {
    if (!organisation?.id || !membership?.user_id) return
    setSaving(true)
    try {
      const round = await createRoundFromTemplate(templateId, organisation.id, membership.user_id)
      navigate(`/deliveries/${round.id}`)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/deliveries" onClick={(e) => { e.preventDefault(); navigate('/deliveries') }}>Deliveries</a>
          <span className="separator">/</span>
          <span>Templates</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>📋 Round Templates</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => { setNewName(''); setNewNotes(''); setShowCreateModal(true) }}>
            + New Template
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {loading && templates.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
      )}

      {!loading && templates.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>📋</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No templates yet</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Create a template for regular delivery rounds (e.g. weekly care home deliveries).
          </p>
          <button className="ps-btn ps-btn-primary" onClick={() => setShowCreateModal(true)}>+ New Template</button>
        </div>
      )}

      {templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-sm)' }}>
          {templates.map((tpl) => (
            <div key={tpl.id} className="ps-card" style={{ padding: 'var(--ps-space-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ps-midnight)' }}>{tpl.name}</div>
                {tpl.notes && <div style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 2 }}>{tpl.notes}</div>}
                <div style={{ fontSize: 'var(--ps-font-xs)', color: 'var(--ps-slate)', marginTop: 4 }}>
                  Created: {new Date(tpl.created_at).toLocaleDateString('en-GB')}
                  {/* Patient count if available */}
                  {(tpl as any).patients && Array.isArray((tpl as any).patients) && (
                    <> · {(tpl as any).patients.length} patient{(tpl as any).patients.length !== 1 ? 's' : ''}</>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
                <button
                  className="ps-btn ps-btn-primary ps-btn-sm"
                  onClick={() => handleCreateRound(tpl.id)}
                  disabled={saving}
                >
                  Use Template
                </button>
                <button
                  className="ps-btn ps-btn-secondary ps-btn-sm"
                  onClick={() => navigate(`/deliveries/templates/${tpl.id}`)}
                >
                  Edit
                </button>
                <button
                  className="ps-btn ps-btn-ghost ps-btn-sm"
                  onClick={() => handleDelete(tpl.id)}
                  style={{ color: 'var(--ps-red)' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="New Template" width="480px">
        <div>
          <div className="form-group">
            <label>Template Name *</label>
            <input className="ps-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Oakwood Care Home — Weekly" autoFocus />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea className="ps-input" rows={3} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Optional notes…" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving ? 'Creating…' : 'Create Template'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
