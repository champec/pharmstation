import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useVideoStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { VideoConsultation, VideoConsultationStatus } from '@pharmstation/types'
import { Modal } from '../../components/Modal'
import { Drawer } from '../../components/Drawer'

/* ---- Status badge styling ---- */
const STATUS_CONFIG: Record<VideoConsultationStatus, { label: string; cssClass: string }> = {
  scheduled: { label: 'Scheduled', cssClass: 'ps-badge ps-badge-blue' },
  active: { label: 'Active', cssClass: 'ps-badge ps-badge-green' },
  completed: { label: 'Completed', cssClass: 'ps-badge' },
  cancelled: { label: 'Cancelled', cssClass: 'ps-badge ps-badge-red' },
}

type TabFilter = 'upcoming' | 'active' | 'past'

interface PatientOption {
  id: string
  first_name: string
  last_name: string
  phone: string | null
}

export function VideoConsultsPage() {
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    consultations,
    loading,
    error,
    fetchConsultations,
    createConsultation,
    cancelConsultation,
    clearError,
  } = useVideoStore()

  const [tab, setTab] = useState<TabFilter>('upcoming')
  const [showNewDrawer, setShowNewDrawer] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [createdConsultation, setCreatedConsultation] = useState<VideoConsultation | null>(null)
  const [createdPatientLink, setCreatedPatientLink] = useState('')

  // New consultation form state
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<PatientOption[]>([])
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)
  const [patientName, setPatientName] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Cancel confirmation
  const [cancelTarget, setCancelTarget] = useState<VideoConsultation | null>(null)

  const load = useCallback(() => {
    if (organisation?.id) fetchConsultations(organisation.id, tab)
  }, [organisation?.id, tab, fetchConsultations])

  useEffect(() => { load() }, [load])

  /* ---- Patient search ---- */
  const searchPatients = useCallback(async (query: string) => {
    if (!organisation?.id || query.trim().length < 2) { setPatientResults([]); return }
    try {
      const { data } = await getUserClient()
        .from('ps_patients')
        .select('id, first_name, last_name, phone')
        .eq('organisation_id', organisation.id)
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(8)
      setPatientResults((data as PatientOption[]) || [])
    } catch { setPatientResults([]) }
  }, [organisation?.id])

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300)
    return () => clearTimeout(timer)
  }, [patientSearch, searchPatients])

  const selectPatient = (p: PatientOption) => {
    setSelectedPatient(p)
    setPatientName(`${p.first_name} ${p.last_name}`)
    setPatientPhone(p.phone || '')
    setPatientSearch('')
    setPatientResults([])
  }

  /* ---- Create consultation ---- */
  const handleCreate = async () => {
    if (!organisation?.id || !patientName.trim() || !scheduledFor) {
      setFormError('Patient name and scheduled time are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const result = await createConsultation({
        org_id: organisation.id,
        patient_name: patientName.trim(),
        patient_phone: patientPhone.trim() || undefined,
        patient_id: selectedPatient?.id,
        scheduled_for: new Date(scheduledFor).toISOString(),
      })
      setCreatedConsultation(result.consultation)
      setCreatedPatientLink(result.patient_link)
      setShowNewDrawer(false)
      setShowSuccessModal(true)
      resetForm()
      load()
    } catch (e: any) {
      setFormError(e.message)
    }
    setSaving(false)
  }

  const resetForm = () => {
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
    setPatientName('')
    setPatientPhone('')
    setScheduledFor('')
    setFormError(null)
  }

  /* ---- Cancel consultation ---- */
  const handleCancel = async () => {
    if (!cancelTarget) return
    try {
      await cancelConsultation(cancelTarget.id)
      setCancelTarget(null)
      load()
    } catch {
      setCancelTarget(null)
    }
  }

  /* ---- Copy helpers ---- */
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getPatientLink = (c: VideoConsultation) => {
    return `${window.location.origin}/consult/${c.id}`
  }

  /* ---- Format date ---- */
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const fmtTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <span>Video Consultations</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--ps-space-md)' }}>
          <h1>📹 Video Consultations</h1>
          <button className="ps-btn ps-btn-primary" onClick={() => setShowNewDrawer(true)}>
            + New Consultation
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>
          <span>{error}</span>
          <button className="ps-btn ps-btn-ghost" onClick={clearError}>✕</button>
        </div>
      )}

      {/* Tab filter */}
      <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginBottom: 'var(--ps-space-lg)' }}>
        {(['upcoming', 'active', 'past'] as TabFilter[]).map((t) => (
          <button
            key={t}
            className={`ps-btn ${tab === t ? 'ps-btn-primary' : 'ps-btn-secondary'}`}
            onClick={() => setTab(t)}
          >
            {t === 'upcoming' ? '📅 Upcoming' : t === 'active' ? '🟢 Active' : '📋 Past'}
          </button>
        ))}
      </div>

      {/* Consultations table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
          <div className="loading-spinner" />
          <p>Loading consultations...</p>
        </div>
      ) : consultations.length === 0 ? (
        <div className="ps-card" style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)' }}>
          <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-lg)' }}>
            {tab === 'upcoming' ? 'No upcoming consultations.' : tab === 'active' ? 'No active consultations.' : 'No past consultations in the last 30 days.'}
          </p>
          {tab === 'upcoming' && (
            <button className="ps-btn ps-btn-primary" style={{ marginTop: 'var(--ps-space-md)' }} onClick={() => setShowNewDrawer(true)}>
              Schedule Your First Consultation
            </button>
          )}
        </div>
      ) : (
        <div className="ps-card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Patient</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Phone</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Scheduled</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Status</th>
                <th style={{ textAlign: 'left', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Access Code</th>
                <th style={{ textAlign: 'right', padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 600, fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {consultations.map((c) => {
                const status = STATUS_CONFIG[c.status]
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--ps-off-white)' }}>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', fontWeight: 500 }}>
                      {c.patient_name}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', color: 'var(--ps-slate)' }}>
                      {c.patient_phone || '—'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                      {fmtDate(c.scheduled_for)} {fmtTime(c.scheduled_for)}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                      <span className={status.cssClass}>{status.label}</span>
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)' }}>
                      {c.status !== 'completed' && c.status !== 'cancelled' ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ps-space-xs)' }}>
                          <code style={{ fontFamily: 'var(--ps-font-mono)', fontSize: 'var(--ps-font-base)', letterSpacing: '0.15em' }}>
                            {c.patient_access_code}
                          </code>
                          <button
                            className="ps-btn ps-btn-ghost"
                            style={{ padding: '2px 6px', fontSize: 'var(--ps-font-xs)' }}
                            onClick={() => copyToClipboard(c.patient_access_code)}
                            title="Copy code"
                          >📋</button>
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: 'var(--ps-space-sm) var(--ps-space-md)', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 'var(--ps-space-xs)', justifyContent: 'flex-end' }}>
                        {(c.status === 'scheduled' || c.status === 'active') && (
                          <>
                            <button
                              className="ps-btn ps-btn-primary"
                              style={{ padding: '4px 12px', fontSize: 'var(--ps-font-sm)' }}
                              onClick={() => navigate(`/video/${c.id}`)}
                            >
                              Join
                            </button>
                            <button
                              className="ps-btn ps-btn-secondary"
                              style={{ padding: '4px 12px', fontSize: 'var(--ps-font-sm)' }}
                              onClick={() => copyToClipboard(getPatientLink(c))}
                              title="Copy patient link"
                            >
                              🔗 Link
                            </button>
                            <button
                              className="ps-btn ps-btn-danger"
                              style={{ padding: '4px 12px', fontSize: 'var(--ps-font-sm)' }}
                              onClick={() => setCancelTarget(c)}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Consultation Drawer */}
      <Drawer isOpen={showNewDrawer} onClose={() => { setShowNewDrawer(false); resetForm() }} title="New Video Consultation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
          {formError && (
            <div className="auth-error">{formError}</div>
          )}

          {/* Patient search */}
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--ps-space-xs)', fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>
              Search Patient (optional)
            </label>
            <input
              className="ps-input"
              type="text"
              placeholder="Search by name or phone..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              style={{ width: '100%' }}
            />
            {patientResults.length > 0 && (
              <div style={{
                border: '1px solid var(--ps-mist)',
                borderRadius: '8px',
                marginTop: '4px',
                maxHeight: '160px',
                overflow: 'auto',
                background: 'var(--ps-white)',
              }}>
                {patientResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPatient(p)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: 'var(--ps-space-sm) var(--ps-space-md)',
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: 'var(--ps-font-sm)',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = 'var(--ps-off-white)')}
                    onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <strong>{p.first_name} {p.last_name}</strong>
                    {p.phone && <span style={{ color: 'var(--ps-slate)', marginLeft: '8px' }}>{p.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Patient name */}
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--ps-space-xs)', fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>
              Patient Name *
            </label>
            <input
              className="ps-input"
              type="text"
              placeholder="Enter patient name"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>

          {/* Patient phone */}
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--ps-space-xs)', fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>
              Patient Phone
            </label>
            <input
              className="ps-input"
              type="tel"
              placeholder="e.g. 07700 900000"
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Scheduled time */}
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--ps-space-xs)', fontWeight: 500, fontSize: 'var(--ps-font-sm)' }}>
              Date & Time *
            </label>
            <input
              className="ps-input"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end', marginTop: 'var(--ps-space-md)' }}>
            <button className="ps-btn ps-btn-secondary" onClick={() => { setShowNewDrawer(false); resetForm() }}>
              Cancel
            </button>
            <button className="ps-btn ps-btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Creating...' : 'Create Consultation'}
            </button>
          </div>
        </div>
      </Drawer>

      {/* Success Modal */}
      <Modal isOpen={showSuccessModal} onClose={() => setShowSuccessModal(false)} title="Consultation Created">
        {createdConsultation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ps-space-md)' }}>
            <p>Video consultation scheduled for <strong>{createdConsultation.patient_name}</strong>.</p>

            <div className="ps-card" style={{ textAlign: 'center', padding: 'var(--ps-space-lg)', background: 'var(--ps-off-white)' }}>
              <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginBottom: 'var(--ps-space-xs)' }}>
                Patient Access Code
              </p>
              <p style={{
                fontFamily: 'var(--ps-font-mono)',
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '0.3em',
                color: 'var(--ps-deep-blue)',
              }}>
                {createdConsultation.patient_access_code}
              </p>
            </div>

            <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
              Share this code with the patient. They will visit the link below and enter this code to join the call.
            </p>

            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
              <button
                className="ps-btn ps-btn-secondary"
                style={{ flex: 1 }}
                onClick={() => copyToClipboard(createdConsultation.patient_access_code)}
              >
                📋 Copy Code
              </button>
              <button
                className="ps-btn ps-btn-primary"
                style={{ flex: 1 }}
                onClick={() => copyToClipboard(`${window.location.origin}${createdPatientLink}`)}
              >
                🔗 Copy Patient Link
              </button>
            </div>

            <button
              className="ps-btn ps-btn-secondary"
              onClick={() => setShowSuccessModal(false)}
              style={{ marginTop: 'var(--ps-space-sm)' }}
            >
              Done
            </button>
          </div>
        )}
      </Modal>

      {/* Cancel Confirmation Modal */}
      <Modal isOpen={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Consultation?" width="480px">
        <p>Are you sure you want to cancel the consultation with <strong>{cancelTarget?.patient_name}</strong>?</p>
        <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)', marginTop: 'var(--ps-space-sm)' }}>
          The patient will no longer be able to join using their access code.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', justifyContent: 'flex-end', marginTop: 'var(--ps-space-lg)' }}>
          <button className="ps-btn ps-btn-secondary" onClick={() => setCancelTarget(null)}>Keep</button>
          <button className="ps-btn ps-btn-danger" onClick={handleCancel}>Cancel Consultation</button>
        </div>
      </Modal>
    </div>
  )
}
