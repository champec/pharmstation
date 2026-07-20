import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore, useDeliveryRoundStore, useAppointmentStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Patient } from '@pharmstation/types'

export function RoundTemplateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { organisation } = useAuthStore()
  const {
    activeTemplate: template,
    loading,
    error,
    fetchTemplate,
    updateTemplate,
    clearError,
  } = useDeliveryRoundStore()
  const { searchPatients, patients: searchedPatients } = useAppointmentStore()

  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [patientSearch, setPatientSearch] = useState('')

  const load = useCallback(() => {
    if (id) fetchTemplate(id)
  }, [id, fetchTemplate])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (template) {
      setName(template.name)
      setNotes(template.notes || '')
    }
  }, [template])

  const handlePatientSearch = useCallback(async () => {
    if (!organisation?.id || patientSearch.length < 2) return
    await searchPatients(organisation.id, patientSearch)
  }, [organisation?.id, patientSearch, searchPatients])

  useEffect(() => {
    const timer = setTimeout(handlePatientSearch, 300)
    return () => clearTimeout(timer)
  }, [handlePatientSearch])

  const handleAddPatient = async (patient: Patient) => {
    if (!id) return
    // Check not already in template
    if (template?.patients?.find((tp) => tp.patient_id === patient.id)) return
    setSaving(true)
    try {
      const nextOrder = (template?.patients?.length ?? 0) + 1
      await getUserClient()
        .from('ps_delivery_round_template_patients')
        .insert({
          template_id: id,
          patient_id: patient.id,
          delivery_order: nextOrder,
          include_all_active_meds: true,
        })
      setPatientSearch('')
      fetchTemplate(id)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleRemovePatient = async (tpId: string) => {
    if (!id || !confirm('Remove patient from template?')) return
    setSaving(true)
    try {
      await getUserClient().from('ps_delivery_round_template_patients').delete().eq('id', tpId)
      fetchTemplate(id)
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    try {
      await updateTemplate(id, { name: name.trim(), notes: notes.trim() || null } as any)
      navigate('/deliveries/templates')
    } catch (e: any) {
      alert(e.message)
    }
    setSaving(false)
  }

  if (loading && !template) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
  }
  if (!template) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Template not found</div>
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Dashboard</a>
          <span className="separator">/</span>
          <a href="/deliveries" onClick={(e) => { e.preventDefault(); navigate('/deliveries') }}>Deliveries</a>
          <span className="separator">/</span>
          <a href="/deliveries/templates" onClick={(e) => { e.preventDefault(); navigate('/deliveries/templates') }}>Templates</a>
          <span className="separator">/</span>
          <span>{template.name}</span>
        </div>
        <h1>📋 {template.name}</h1>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>Template Name *</label>
            <input className="ps-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input className="ps-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="ps-card" style={{ padding: 'var(--ps-space-md)', marginBottom: 'var(--ps-space-md)' }}>
        <h3 style={{ marginBottom: 'var(--ps-space-sm)' }}>Patients ({template.patients?.length ?? 0})</h3>

        <input
          className="ps-input"
          placeholder="Search to add patient..."
          value={patientSearch}
          onChange={(e) => setPatientSearch(e.target.value)}
          style={{ maxWidth: 400, marginBottom: 'var(--ps-space-sm)' }}
        />

        {patientSearch.length >= 2 && searchedPatients.length > 0 && (
          <div style={{ border: '1px solid var(--ps-off-white)', borderRadius: 'var(--ps-radius-md)', maxHeight: 160, overflowY: 'auto', marginBottom: 'var(--ps-space-sm)' }}>
            {searchedPatients
              .filter((p) => !template.patients?.find((tp) => tp.patient_id === p.id))
              .map((p) => (
                <div
                  key={p.id}
                  style={{ padding: '6px var(--ps-space-md)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                  onClick={() => handleAddPatient(p)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ps-off-white)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                >
                  <span>{p.first_name} {p.last_name} — {p.postcode}</span>
                  <span style={{ color: 'var(--ps-primary)', fontSize: 'var(--ps-font-sm)' }}>+ Add</span>
                </div>
              ))}
          </div>
        )}

        {template.patients && template.patients.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {template.patients
              .sort((a, b) => a.delivery_order - b.delivery_order)
              .map((tp) => (
                <div key={tp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--ps-off-white)' }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>#{tp.delivery_order} {(tp.patient as any)?.first_name} {(tp.patient as any)?.last_name}</span>
                    <span style={{ color: 'var(--ps-slate)', marginLeft: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
                      {tp.include_all_active_meds ? 'All active meds' : `${tp.medications?.length ?? 0} specific med(s)`}
                    </span>
                  </div>
                  <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => handleRemovePatient(tp.id)} style={{ color: 'var(--ps-red)' }}>Remove</button>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>No patients in template yet.</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/deliveries/templates')}>Cancel</button>
        <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>
    </div>
  )
}
