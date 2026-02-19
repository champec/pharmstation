import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatientStore } from '@pharmstation/core'
import { getPatientClient } from '@pharmstation/supabase-client'

export function PatientProfilePage() {
  const navigate = useNavigate()
  const { patient, isLoggedIn, loading: authLoading, logout } = usePatientStore()
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

  const handleLogout = async () => {
    await logout()
    navigate('/patient/login')
  }

  if (authLoading || !patient) {
    return <div style={{ textAlign: 'center', padding: 'var(--ps-space-2xl)', color: 'var(--ps-slate)' }}>Loading…</div>
  }

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '0 var(--ps-space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--ps-space-lg)' }}>
        <h1>👤 My Profile</h1>
        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)' }}>
          <button className="ps-btn ps-btn-secondary ps-btn-sm" onClick={() => navigate('/patient/appointments')}>📅 Appointments</button>
          <button className="ps-btn ps-btn-ghost ps-btn-sm" onClick={handleLogout} style={{ color: 'var(--ps-red)' }}>Sign Out</button>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

      <div className="ps-card" style={{ padding: 'var(--ps-space-xl)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
          <strong>Name:</strong> <span>{patient.first_name} {patient.last_name}</span>
          <strong>Email:</strong> <span>{patient.email || '—'}</span>
          <strong>NHS Number:</strong> <span>{patient.nhs_number || '—'}</span>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--ps-off-white)', margin: 'var(--ps-space-md) 0' }} />

        {!editing ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
              <strong>Phone:</strong> <span>{patient.phone || '—'}</span>
              <strong>DOB:</strong> <span>{patient.dob ? new Date(patient.dob).toLocaleDateString('en-GB') : '—'}</span>
              <strong>Address:</strong> <span>{patient.address_line_1 || '—'}</span>
              {patient.address_line_2 && <><strong></strong> <span>{patient.address_line_2}</span></>}
              <strong>City:</strong> <span>{patient.city || '—'}</span>
              <strong>Postcode:</strong> <span>{patient.postcode || '—'}</span>
            </div>
            <button className="ps-btn ps-btn-secondary" onClick={() => setEditing(true)} style={{ marginTop: 'var(--ps-space-lg)' }}>✏️ Edit Details</button>
          </>
        ) : (
          <>
            <div className="form-group">
              <label>Phone</label>
              <input className="ps-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Date of Birth</label>
              <input className="ps-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Address Line 1</label>
              <input className="ps-input" value={addr1} onChange={(e) => setAddr1(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Address Line 2</label>
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
    </div>
  )
}
