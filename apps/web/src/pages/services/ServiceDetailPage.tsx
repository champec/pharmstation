import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
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
    archiveService,
    createForm,
    archiveForm,
    clearError,
  } = useServiceStore()
  const { permissions } = useAuthStore()
  // Owners, managers and pharmacists by default (ps_member_has_services_permission)
  const canManage = !!permissions?.services_manage
  const [actionError, setActionError] = useState<string | null>(null)

  /** Run a change and show its error on the page instead of losing it */
  const run = async (fn: () => Promise<void>) => {
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The change could not be saved.')
    }
  }

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDuration, setEditDuration] = useState(15)
  const [saving, setSaving] = useState(false)

  const [newFormModalOpen, setNewFormModalOpen] = useState(false)
  const [newFormName, setNewFormName] = useState('')
  const [newFormError, setNewFormError] = useState<string | null>(null)

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteFormId, setDeleteFormId] = useState<string | null>(null)

  // Pricing state
  const [canTakePayments, setCanTakePayments] = useState<boolean | null>(null)
  const [priceInput, setPriceInput] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)

  const load = useCallback(() => {
    if (serviceId) fetchServiceDetail(serviceId)
  }, [serviceId, fetchServiceDetail])

  useEffect(() => { load() }, [load])

  // Paid services are hidden from the public booking site until the
  // pharmacy's Stripe account can take payments.
  useEffect(() => {
    if (!activeService?.org_id) return
    getUserClient().rpc('ps_org_can_take_payments', { p_org_id: activeService.org_id })
      .then(({ data }) => setCanTakePayments(data === true))
  }, [activeService?.org_id])

  // Keep price input in sync when service loads
  useEffect(() => {
    if (activeService?.price_pence != null) {
      setPriceInput((activeService.price_pence / 100).toFixed(2))
    } else {
      setPriceInput('')
    }
  }, [activeService?.price_pence])

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
    await run(async () => {
      await updateService(serviceId, {
        name: editName.trim(),
        description: editDescription.trim(),
        duration_minutes: editDuration,
      })
      setEditModalOpen(false)
    })
    setSaving(false)
  }

  const handleToggleActive = async () => {
    if (!serviceId || !activeService) return
    await run(() => updateService(serviceId, { is_active: !activeService.is_active }))
  }

  const handleTogglePublic = async () => {
    if (!serviceId || !activeService) return
    await run(() => updateService(serviceId, { is_public: !activeService.is_public }))
  }

  const handleToggleVideo = async () => {
    if (!serviceId || !activeService) return
    await run(() => updateService(serviceId, { is_video: !activeService.is_video }))
  }

  const handleToggleChargeable = async () => {
    if (!serviceId || !activeService) return
    await run(() => updateService(serviceId, { is_chargeable: !activeService.is_chargeable }))
  }

  const handleSavePrice = async () => {
    if (!serviceId) return
    const pounds = parseFloat(priceInput)
    if (isNaN(pounds) || pounds < 0) return
    setSavingPrice(true)
    await run(() => updateService(serviceId, { price_pence: Math.round(pounds * 100) }))
    setSavingPrice(false)
  }

  const handleArchive = async () => {
    if (!serviceId) return
    await run(async () => {
      await archiveService(serviceId)
      navigate('/services')
    })
    setDeleteConfirmOpen(false)
  }

  const handleCreateForm = async () => {
    if (!serviceId || !newFormName.trim()) return
    setSaving(true)
    setNewFormError(null)
    try {
      const created = await createForm(serviceId, newFormName.trim())
      setNewFormModalOpen(false)
      setNewFormName('')
      navigate(`/services/${serviceId}/form/${created.id}`)
    } catch (createError) {
      setNewFormError(createError instanceof Error ? createError.message : 'The form could not be created.')
    }
    setSaving(false)
  }

  const handleArchiveForm = async () => {
    if (!deleteFormId) return
    await run(() => archiveForm(deleteFormId))
    setDeleteFormId(null)
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
          <h1>{activeService.name}</h1>
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

      {!canManage && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', marginBottom: 'var(--ps-space-md)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          You can deliver this service. Only owners, managers and pharmacists can change its settings or forms.
        </div>
      )}
      {(error || actionError) && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error || actionError}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => { clearError(); setActionError(null) }} style={{ marginLeft: 'var(--ps-space-sm)' }}>
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
              <span className="ps-badge ps-badge-blue">{activeService.duration_minutes} min</span>
              <span className={`ps-badge ${activeService.is_active ? 'ps-badge-green' : 'ps-badge-red'}`}>
                {activeService.is_active ? 'Active' : 'Inactive'}
              </span>
              {activeService.is_public && <span className="ps-badge ps-badge-amber">Public</span>}
              {activeService.is_chargeable && activeService.price_pence != null && (
                <span className="ps-badge ps-badge-green">💳 £{(activeService.price_pence / 100).toFixed(2)}</span>
              )}
            </div>
          </div>
          {canManage && (
            <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={openEditModal}>
              Edit
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--ps-space-lg)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
            <input
              type="checkbox"
              checked={activeService.is_active}
              onChange={handleToggleActive}
              disabled={!canManage}
            />
            Active
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
            <input
              type="checkbox"
              checked={activeService.is_public}
              onChange={handleTogglePublic}
              disabled={!canManage}
            />
            Publicly Bookable
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }} title="Bookings get a video room and the patient is texted the link and code with their reminder">
            <input
              type="checkbox"
              checked={!!activeService.is_video}
              onChange={handleToggleVideo}
              disabled={!canManage}
            />
            Video appointment
          </label>
        </div>
      </div>

      {/* Payments card */}
      <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', marginBottom: 'var(--ps-space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)' }}>Payments</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)', cursor: 'pointer', fontSize: 'var(--ps-font-sm)' }}>
            <input
              type="checkbox"
              checked={!!activeService.is_chargeable}
              onChange={handleToggleChargeable}
              disabled={!canManage}
            />
            Charge patients for this service
          </label>
        </div>
        {activeService.is_chargeable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
            <span style={{ fontSize: 'var(--ps-font-md)', color: 'var(--ps-slate)' }}>£</span>
            <input
              className="ps-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              disabled={!canManage}
              style={{ width: '140px' }}
            />
            <button
              className="ps-btn ps-btn-primary ps-btn-sm"
              onClick={handleSavePrice}
              disabled={!canManage || savingPrice || !priceInput}
            >
              {savingPrice ? 'Saving…' : 'Save Price'}
            </button>
            <span style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              Patients pay online (Stripe) when booking.
            </span>
          </div>
        ) : null}
        {activeService.is_chargeable && canTakePayments === false ? (
          <div className="auth-error" style={{ marginTop: 'var(--ps-space-md)' }}>
            Patients can't book this service online yet: your pharmacy isn't set up to take card payments.{' '}
            <a href="/settings" onClick={(e) => { e.preventDefault(); navigate('/settings') }}>Finish payment setup in Settings</a>{' '}
            and it will appear on your booking page automatically.
          </div>
        ) : null}
        {activeService.is_chargeable ? null : (
          <p style={{ margin: 0, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
            This service is free — no payment is taken during booking.
          </p>
        )}
      </div>

      {/* Forms section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-md)' }}>
        <h2 style={{ fontSize: 'var(--ps-font-lg)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
          Service Forms
        </h2>
        {canManage && !activeService.is_nhs_service && (
          <button
            className="ps-btn ps-btn-primary ps-btn-sm"
            onClick={() => { setNewFormName(''); setNewFormError(null); setNewFormModalOpen(true) }}
          >
            + Add Form
          </button>
        )}
      </div>

      {activeForms.length === 0 ? (
        <div className="ps-card" style={{ padding: 'var(--ps-space-xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
            No forms yet. Add a form to collect patient information during this service.
          </p>
          {canManage && !activeService.is_nhs_service && (
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => { setNewFormName(''); setNewFormError(null); setNewFormModalOpen(true) }}
            >
              + Create First Form
            </button>
          )}
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
                  {canManage && !activeService.is_nhs_service ? 'Click to edit fields' : 'Click to view fields'}
                </span>
                {canManage && activeForms.length > 1 && (
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

      {/* Archive service */}
      {canManage && (
        <div style={{ marginTop: 'var(--ps-space-2xl)', borderTop: '1px solid var(--ps-off-white)', paddingTop: 'var(--ps-space-lg)' }}>
          <button
            className="ps-btn ps-btn-danger"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            Remove Service
          </button>
        </div>
      )}

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
          {newFormError && <div className="auth-error" role="alert">{newFormError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setNewFormModalOpen(false)} disabled={saving}>Cancel</button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreateForm} disabled={saving || !newFormName.trim()}>
              {saving ? 'Creating…' : 'Create Form'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete service confirm */}
      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Remove Service?">
        <div>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Remove <strong>{activeService.name}</strong> from your services? It will no longer be bookable or deliverable.
            Every record already made for it is kept and stays in Service History.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
            <button className="ps-btn ps-btn-danger" onClick={handleArchive}>Remove Service</button>
          </div>
        </div>
      </Modal>

      {/* Delete form confirm */}
      <Modal isOpen={!!deleteFormId} onClose={() => setDeleteFormId(null)} title="Remove Form?">
        <div>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)' }}>
            Remove this form variant? It won't be offered for new deliveries. Past records keep a copy of the form they used.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => setDeleteFormId(null)}>Cancel</button>
            <button className="ps-btn ps-btn-danger" onClick={handleArchiveForm}>Remove Form</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
