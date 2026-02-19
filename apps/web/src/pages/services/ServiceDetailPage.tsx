import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useServiceStore } from '@pharmstation/core'
import { Modal } from '../../components/Modal'

export function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>()
  const navigate = useNavigate()
  const {
    activeService,
    activeForms,
    loading,
    error,
    fetchServiceDetail,
    updateService,
    deleteService,
    createForm,
    deleteForm,
    clearError,
  } = useServiceStore()

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDuration, setEditDuration] = useState(15)
  const [saving, setSaving] = useState(false)

  const [newFormModalOpen, setNewFormModalOpen] = useState(false)
  const [newFormName, setNewFormName] = useState('')

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteFormId, setDeleteFormId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (serviceId) fetchServiceDetail(serviceId)
  }, [serviceId, fetchServiceDetail])

  useEffect(() => { load() }, [load])

  // Populate edit modal with current values
  const openEditModal = () => {
    if (activeService) {
      setEditName(activeService.name)
      setEditDescription(activeService.description)
      setEditDuration(activeService.duration_minutes)
    }
    setEditModalOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!serviceId) return
    setSaving(true)
    try {
      await updateService(serviceId, {
        name: editName.trim(),
        description: editDescription.trim(),
        duration_minutes: editDuration,
      })
      setEditModalOpen(false)
    } catch { /* error handled by store */ }
    setSaving(false)
  }

  const handleToggleActive = async () => {
    if (!serviceId || !activeService) return
    await updateService(serviceId, { is_active: !activeService.is_active })
  }

  const handleTogglePublic = async () => {
    if (!serviceId || !activeService) return
    await updateService(serviceId, { is_public: !activeService.is_public })
  }

  const handleDelete = async () => {
    if (!serviceId) return
    try {
      await deleteService(serviceId)
      navigate('/services')
    } catch { /* error handled by store */ }
  }

  const handleCreateForm = async () => {
    if (!serviceId || !newFormName.trim()) return
    setSaving(true)
    try {
      const created = await createForm(serviceId, newFormName.trim())
      setNewFormModalOpen(false)
      setNewFormName('')
      navigate(`/services/${serviceId}/form/${created.id}`)
    } catch { /* error handled by store */ }
    setSaving(false)
  }

  const handleDeleteForm = async () => {
    if (!deleteFormId) return
    try {
      await deleteForm(deleteFormId)
      setDeleteFormId(null)
    } catch { /* error handled by store */ }
  }

  if (loading && !activeService) {
    return (
      <div>
        <div className="page-header">
          <div className="breadcrumbs">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
            <span className="separator">/</span>
            <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
            <span className="separator">/</span>
            <span>Loading…</span>
          </div>
          <h1>Loading…</h1>
        </div>
      </div>
    )
  }

  if (!activeService) {
    return (
      <div>
        <div className="page-header">
          <h1>Service not found</h1>
        </div>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
          ← Back to Services
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/services" onClick={(e) => { e.preventDefault(); navigate('/services') }}>Services</a>
          <span className="separator">/</span>
          <span>{activeService.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>🩺 {activeService.name}</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className="ps-btn ps-btn-success"
              onClick={() => navigate(`/services/${serviceId}/deliver`)}
            >
              ▶ Deliver Service
            </button>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services')}>
              ← Back
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Service info card */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--ps-space-md)' }}>
          <div>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginBottom: 'var(--ps-space-sm)' }}>
              {activeService.description || 'No description'}
            </p>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="ps-badge ps-badge-blue">⏱ {activeService.duration_minutes} min</span>
              <span className={`ps-badge ${activeService.is_active ? 'ps-badge-green' : 'ps-badge-red'}`}>
                {activeService.is_active ? 'Active' : 'Inactive'}
              </span>
              {activeService.is_public && <span className="ps-badge ps-badge-amber">🌐 Public</span>}
            </div>
          </div>
          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={openEditModal}>
            ✏️ Edit
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
            <input
              type="checkbox"
              checked={activeService.is_active}
              onChange={handleToggleActive}
            />
            Active
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
            <input
              type="checkbox"
              checked={activeService.is_public}
              onChange={handleTogglePublic}
            />
            Publicly Bookable
          </label>
        </div>
      </div>

      {/* Forms section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-md)' }}>
        <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
          📝 Service Forms
        </h2>
        <button
          className="ps-btn ps-btn-primary ps-btn-sm"
          onClick={() => { setNewFormName(''); setNewFormModalOpen(true) }}
        >
          + Add Form
        </button>
      </div>

      {activeForms.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            No forms yet. Add a form to collect patient information during this service.
          </p>
          <button
            className="ps-btn ps-btn-primary"
            onClick={() => { setNewFormName(''); setNewFormModalOpen(true) }}
          >
            + Create First Form
          </button>
        </div>
      ) : (
        <div className="dashboard-grid">
          {activeForms.map((form) => (
            <div
              key={form.id}
              className="ps-card"
              style={{
                padding: 'var(--ps-space-lg)',
                cursor: 'pointer',
                transition: 'all var(--ps-transition-fast)',
              }}
              onClick={() => navigate(`/services/${serviceId}/form/${form.id}`)}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ps-electric-cyan)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor = ''
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-xs)' }}>
                <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
                  {form.name}
                </h3>
                <div style={{ display: 'flex', gap: 'var(--ps-space-xs)' }}>
                  {form.is_default && <span className="ps-badge ps-badge-blue">Default</span>}
                  <span className="ps-badge">v{form.version}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--ps-space-sm)' }}>
                <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
                  Click to edit fields
                </span>
                {activeForms.length > 1 && (
                  <button
                    className="ps-btn ps-btn-ghost ps-btn-sm"
                    style={{ color: 'var(--ps-error)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteFormId(form.id)
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete service */}
      <div style={{ marginTop: 'var(--ps-space-2xl)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-lg)' }}>
        <button
          className="ps-btn ps-btn-danger"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          🗑 Delete Service
        </button>
      </div>

      {/* Edit modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Service">
        <div>
          <div className="form-group">
            <label>Service Name</label>
            <input className="ps-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea className="ps-input" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
          </div>
          <div className="form-group">
            <label>Duration (minutes)</label>
            <input className="ps-input" type="number" min={5} max={120} step={5} value={editDuration} onChange={(e) => setEditDuration(Number(e.target.value))} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setEditModalOpen(false)} disabled={saving}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* New form modal */}
      <Modal isOpen={newFormModalOpen} onClose={() => setNewFormModalOpen(false)} title="Add Form Variant">
        <div>
          <div className="form-group">
            <label>Form Name</label>
            <input
              className="ps-input"
              value={newFormName}
              onChange={(e) => setNewFormName(e.target.value)}
              placeholder="e.g. Adult, Paediatric, Follow-up"
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setNewFormModalOpen(false)} disabled={saving}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreateForm} disabled={saving || !newFormName.trim()}>
              {saving ? 'Creating…' : 'Create Form'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete service confirm */}
      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Delete Service?">
        <div>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Permanently delete <strong>{activeService.name}</strong> and all its forms? This cannot be undone.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
            <button className="ps-btn ps-btn-danger" onClick={handleDelete}>Delete Service</button>
          </div>
        </div>
      </Modal>

      {/* Delete form confirm */}
      <Modal isOpen={!!deleteFormId} onClose={() => setDeleteFormId(null)} title="Delete Form?">
        <div>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Permanently delete this form variant and all its fields?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setDeleteFormId(null)}>Cancel</button>
            <button className="ps-btn ps-btn-danger" onClick={handleDeleteForm}>Delete Form</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
