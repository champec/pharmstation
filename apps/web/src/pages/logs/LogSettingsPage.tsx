import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useLogStore } from '@pharmstation/core'
import type { LogCategory } from '@pharmstation/types'

const CATEGORY_CONFIG: Record<LogCategory, { label: string; emoji: string }> = {
  fridge: { label: 'Fridge', emoji: '🌡️' },
  cleaning: { label: 'Cleaning', emoji: '🧹' },
  cd: { label: 'CD', emoji: '💊' },
  visitor: { label: 'Visitor', emoji: '👤' },
  date_check: { label: 'Date Check', emoji: '📅' },
  custom: { label: 'Custom', emoji: '📋' },
}

export function LogSettingsPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    subscriptions,
    activeTemplate,
    activeFields,
    loading,
    error,
    fetchSubscriptions,
    fetchTemplateDetail,
    updateSubscription,
    deactivateSubscription,
    clearError,
  } = useLogStore()

  const [customTitle, setCustomTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const subscription = subscriptions.find((s) => s.id === subscriptionId)

  const load = useCallback(() => {
    if (organisation?.id) fetchSubscriptions(organisation.id)
  }, [organisation?.id, fetchSubscriptions])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (subscription?.template_id) {
      fetchTemplateDetail(subscription.template_id)
    }
  }, [subscription?.template_id, fetchTemplateDetail])

  useEffect(() => {
    setCustomTitle(subscription?.custom_title || '')
  }, [subscription])

  const handleSaveTitle = async () => {
    if (!subscriptionId) return
    setSaving(true)
    setSaved(false)
    try {
      await updateSubscription(subscriptionId, {
        custom_title: customTitle.trim() || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // error handled by store
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async () => {
    if (!subscriptionId) return
    if (!confirm('Are you sure you want to deactivate this log? Existing entries will be preserved.')) return
    setDeactivating(true)
    try {
      await deactivateSubscription(subscriptionId)
      navigate('/logs')
    } catch {
      setDeactivating(false)
    }
  }

  const isOrgOwned = activeTemplate?.org_id === organisation?.id
  const cat = activeTemplate?.category || 'custom'
  const catConfig = CATEGORY_CONFIG[cat as LogCategory] || CATEGORY_CONFIG.custom

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/logs" onClick={(e) => { e.preventDefault(); navigate('/logs') }}>Logs</a>
          <span className="separator">/</span>
          {subscriptionId && (
            <>
              <a href={`/logs/${subscriptionId}`} onClick={(e) => { e.preventDefault(); navigate(`/logs/${subscriptionId}`) }}>View</a>
              <span className="separator">/</span>
            </>
          )}
          <span>Settings</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>⚙️ Log Settings</h1>
          <button className="ps-btn ps-btn-secondary" onClick={() => navigate(subscriptionId ? `/logs/${subscriptionId}` : '/logs')}>
            ← Back
          </button>
        </div>
      </div>

      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          {error}
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={clearError} style={{ marginLeft: 'var(--ps-space-sm)' }}>Dismiss</button>
        </div>
      )}

      {loading && !activeTemplate && (
        <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', opacity: 0.5 }}>
          <div style={{ height: 20, background: 'var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', width: '40%' }} />
        </div>
      )}

      {activeTemplate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-lg)' }}>
          {/* Template info */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h2 style={{ fontSize: 'var(--ps-font-lg)', color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>
              {catConfig.emoji} {activeTemplate.title}
            </h2>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', margin: '0 0 var(--ps-space-md)' }}>
              {activeTemplate.description}
            </p>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
              <span className="ps-badge ps-badge-blue" style={{ fontSize: 'var(--ps-font-xs)' }}>
                {activeTemplate.schedule_type}
              </span>
              <span className="ps-badge" style={{ fontSize: 'var(--ps-font-xs)' }}>
                {activeFields.length} fields
              </span>
              {activeTemplate.is_library && (
                <span className="ps-badge ps-badge-amber" style={{ fontSize: 'var(--ps-font-xs)' }}>📚 Library</span>
              )}
            </div>
          </div>

          {/* Custom title */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ fontSize: 'var(--ps-font-md)', color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>Custom Title</h3>
            <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
              Override the display title for this log in your workspace.
            </p>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', alignItems: 'center' }}>
              <input
                className="ps-input"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={activeTemplate.title}
                style={{ maxWidth: 400 }}
              />
              <button
                className="ps-btn ps-btn-primary ps-btn-sm"
                onClick={handleSaveTitle}
                disabled={saving}
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/* Fields (read-only) */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
            <h3 style={{ fontSize: 'var(--ps-font-md)', color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-md)' }}>Fields</h3>
            {activeFields.length === 0 ? (
              <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>No fields configured.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-xs)' }}>
                {activeFields.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--ps-space-sm)',
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      background: 'var(--ps-off-white)',
                      borderRadius: 'var(--ps-radius-md)',
                      fontSize: 'var(--ps-font-sm)',
                    }}
                  >
                    <span style={{ fontWeight: 500, color: 'var(--ps-midnight)' }}>{f.label}</span>
                    <span className="ps-badge" style={{ fontSize: 'var(--ps-font-xs)' }}>{f.field_type}</span>
                    {f.is_required && <span className="ps-badge ps-badge-red" style={{ fontSize: 'var(--ps-font-xs)' }}>Required</span>}
                    {f.column_width && <span style={{ color: 'var(--ps-slate)' }}>({f.column_width})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit template link (org-owned only) */}
          {isOrgOwned && (
            <div className="ps-card" style={{ padding: 'var(--ps-space-lg)' }}>
              <h3 style={{ fontSize: 'var(--ps-font-md)', color: 'var(--ps-midnight)', marginBottom: 'var(--ps-space-sm)' }}>Edit Template</h3>
              <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
                This is a custom log owned by your organisation. You can edit its template.
              </p>
              <button
                className="ps-btn ps-btn-secondary"
                onClick={() => navigate(`/logs/new?edit=${activeTemplate.id}`)}
              >
                ✏️ Edit Template
              </button>
            </div>
          )}

          {/* Danger zone */}
          <div className="ps-card" style={{ padding: 'var(--ps-space-lg)', borderColor: '#ef4444' }}>
            <h3 style={{ fontSize: 'var(--ps-font-md)', color: '#ef4444', marginBottom: 'var(--ps-space-sm)' }}>Danger Zone</h3>
            <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-md)' }}>
              Deactivating this log will remove it from your dashboard. Existing entries are preserved and can be reactivated later.
            </p>
            <button
              className="ps-btn ps-btn-sm"
              style={{ background: '#ef4444', color: '#fff', border: 'none' }}
              onClick={handleDeactivate}
              disabled={deactivating}
            >
              {deactivating ? 'Deactivating…' : '🗑 Deactivate Log'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
