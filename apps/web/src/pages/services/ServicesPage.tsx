import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useServiceStore } from '@pharmstation/core'
import type { Service } from '@pharmstation/types'
import { Modal } from '../../components/Modal'

export function ServicesPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    services,
    loading,
    error,
    fetchServices,
    createService,
    clearError,
  } = useServiceStore()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDuration, setNewDuration] = useState(15)
  const [newIsPublic, setNewIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loadServices = useCallback(() => {
    if (organisation?.id) {
      fetchServices(organisation.id)
    }
  }, [organisation?.id, fetchServices])

  useEffect(() => {
    loadServices()
  }, [loadServices])

  const handleCreate = async () => {
    if (!organisation?.id || !newName.trim()) return
    setSaving(true)
    setCreateError(null)
    try {
      const created = await createService({
        org_id: organisation.id,
        name: newName.trim(),
        description: newDescription.trim(),
        duration_minutes: newDuration,
        is_public: newIsPublic,
      })
      setShowCreateModal(false)
      resetForm()
      navigate(`/services/${created.id}`)
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setNewName('')
    setNewDescription('')
    setNewDuration(15)
    setNewIsPublic(false)
    setCreateError(null)
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Services</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>🩺 Services</h1>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => navigate('/services/deliveries')}
            >
              📋 Delivery History
            </button>
            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => navigate('/services/library')}
            >
              📚 Browse Library
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => { resetForm(); setShowCreateModal(true) }}
            >
              + New Service
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && services.length === 0 && (
        <div className="dashboard-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
              <div style={{ height: 20, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-sm)', width: '60%' }} />
              <div style={{ height: 14, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', marginBottom: 'var(--ps-space-md)', width: '80%' }} />
              <div style={{ height: 14, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '40%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && services.length === 0 && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-2xl)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: 'var(--ps-space-md)' }}>🩺</div>
          <h2 style={{ color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>No services yet</h2>
          <p style={{ color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-lg)', maxWidth: 400, margin: '0 auto var(--ps-space-lg)' }}>
            Get started by browsing the service library or creating a custom service.
          </p>
          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'center' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/services/library')}>
              📚 Browse Library
            </button>
            <button className="ps-btn ps-btn-primary" onClick={() => { resetForm(); setShowCreateModal(true) }}>
              + New Service
            </button>
          </div>
        </div>
      )}

      {/* Services grid */}
      {services.length > 0 && (
        <div className="dashboard-grid">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onClick={() => navigate(`/services/${service.id}/deliver`)}
            />
          ))}
        </div>
      )}

      {/* Create service modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Service"
      >
        <div>
          {createError && (
            <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{createError}</div>
          )}

          <div className="form-group">
            <label>Service Name *</label>
            <input
              className="ps-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Blood Pressure Check"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              className="ps-input"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Brief description of the service"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Duration (minutes)</label>
            <input
              className="ps-input"
              type="number"
              min={5}
              max={120}
              step={5}
              value={newDuration}
              onChange={(e) => setNewDuration(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={newIsPublic}
                onChange={(e) => setNewIsPublic(e.target.checked)}
              />
              Make publicly bookable
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-lg)' }}>
            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => setShowCreateModal(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="ps-btn ps-btn-primary"
              onClick={handleCreate}
              disabled={saving || !newName.trim()}
            >
              {saving ? 'Creating…' : 'Create Service'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ---- Service Card sub-component ---- */

function ServiceCard({ service, onClick }: { service: Service; onClick: () => void }) {
  const navigate = useNavigate()
  const { membership } = useAuthStore()
  const isAdmin = membership?.role === 'owner' || membership?.role === 'manager'

  return (
    <div
      className="ps-card"
      onClick={onClick}
      style={{
        padding: 'var(--ps-space-lg)',
        cursor: 'pointer',
        transition: 'all var(--ps-transition-fast)',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--ps-electric-cyan)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--ps-shadow-md)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = ''
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = ''
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--ps-space-sm)' }}>
        <h3 style={{ fontSize: 'var(--ps-font-md)', fontWeight: 600, color: 'var(--ps-midnight)', margin: 0 }}>
          {service.name}
        </h3>
        <span className={`ps-badge ${service.is_active ? 'ps-badge-green' : 'ps-badge-red'}`}>
          {service.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <p style={{
        fontSize: 'var(--ps-font-sm)',
        color: 'var(--ps-slate)',
        margin: '0 0 var(--ps-space-md)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {service.description || 'No description'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
        <span className="ps-badge ps-badge-blue">⏱ {service.duration_minutes} min</span>
        {service.is_public && (
          <span className="ps-badge ps-badge-amber">🌐 Public</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--ps-space-xs)' }}>
          <button
            className="ps-btn ps-btn-success ps-btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/services/${service.id}/deliver`)
            }}
          >
            ▶ Deliver
          </button>
          {isAdmin && (
            <button
              className="ps-btn ps-btn-secondary ps-btn-sm"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/services/${service.id}`)
              }}
            >
              ✏️ Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
