import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientPortalShell } from './PatientPortalShell'
import { usePatientStore } from '@pharmstation/core'
import { getPatientClient } from '@pharmstation/supabase-client'

export function PatientProfilePage() {
  const navigate = useNavigate()
  const { patient, isLoggedIn, loading: authLoading, initialize } = usePatientStore()

  // Restore the patient session on a direct visit or page refresh
  useEffect(() => {
    if (authLoading) initialize()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [addr1, setAddr1] = useState('')
  const [addr2, setAddr2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!authLoading && !isLoggedIn) navigate('/patient/login')
  }, [authLoading, isLoggedIn, navigate])

  useEffect(() => {
    if (patient) {
      setPhone(patient.phone || '')
      setDob(patient.dob || '')
      setAddr1(patient.address_line_1 || '')
      setAddr2(patient.address_line_2 || '')
      setCity(patient.city || '')
      setPostcode(patient.postcode || '')
    }
  }, [patient])

  const handleSave = async () => {
    if (!patient) return
    setSaving(true)
    setError('')
    try {
      const { error: err } = await getPatientClient()
        .from('ps_patients')
        .update({
          phone: phone.trim() || null,
          dob: dob || null,
          address_line_1: addr1.trim() || null,
          address_line_2: addr2.trim() || null,
          city: city.trim() || null,
          postcode: postcode.trim() || null,
        })
        .eq('id', patient.id)
      if (err) throw err
      setEditing(false)
    } catch (e: any) {
      setError(e.message || 'Failed to update profile.')
    }
    setSaving(false)
  }

  if (authLoading || !patient) {
    return <PatientPortalShell title="My details"><p style={{ color: 'var(--ps-slate)' }}>Loading…</p></PatientPortalShell>
  }

  return (
    <PatientPortalShell title="My details" subtitle="Keep these up to date so your pharmacy can reach you.">
      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card" style={{ padding: 'var(--ps-space-xl)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
          <strong>Name:</strong> <span>{patient.first_name} {patient.last_name}</span>
          <strong>Email:</strong> <span>{patient.email || 'Not recorded'}</span>
          <strong>NHS number:</strong> <span>{patient.nhs_number || 'Not recorded'}</span>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />

        {!editing ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
              <strong>Phone:</strong> <span>{patient.phone || 'Not recorded'}</span>
              <strong>Date of birth:</strong> <span>{patient.dob ? new Date(patient.dob).toLocaleDateString('en-GB') : 'Not recorded'}</span>
              <strong>Address:</strong> <span>{patient.address_line_1 || 'Not recorded'}</span>
              {patient.address_line_2 && <><strong></strong> <span>{patient.address_line_2}</span></>}
              <strong>City:</strong> <span>{patient.city || 'Not recorded'}</span>
              <strong>Postcode:</strong> <span>{patient.postcode || 'Not recorded'}</span>
            </div>
            <button className="ps-btn ps-btn-secondary" onClick={() => setEditing(true)} style={{ marginTop: 'var(--ps-space-lg)' }}>Edit details</button>
          </>
        ) : (
          <>
            <div className="form-group">
              <label>Phone</label>
              <input className="ps-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date of birth</label>
              <input className="ps-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Address line 1</label>
              <input className="ps-input" value={addr1} onChange={(e) => setAddr1(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Address line 2</label>
              <input className="ps-input" value={addr2} onChange={(e) => setAddr2(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
              <div className="form-group">
                <label>City</label>
                <input className="ps-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Postcode</label>
                <input className="ps-input" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
              <button className="ps-btn ps-btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </>
        )}
      </div>
    </PatientPortalShell>
  )
}
