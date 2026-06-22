import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import {
  PEPS_PRESCRIBER_TYPE_LABELS,
  type PepsPrescriberType,
} from '@pharmstation/types'
import { CanvasField } from '../../components/forms/CanvasField'

export function PEPSPrescriberSetupPage() {
  const navigate = useNavigate()
  const { activeUser } = useAuthStore()
  const { myPrescriber, prescriberLoaded, fetchMyPrescriber, saveMyPrescriber } = usePepsStore()

  const [fullName, setFullName] = useState('')
  const [type, setType] = useState<PepsPrescriberType>('doctor')
  const [registration, setRegistration] = useState('')
  const [regBody, setRegBody] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [signature, setSignature] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    await fetchMyPrescriber()
  }, [fetchMyPrescriber])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (myPrescriber) {
      setFullName(myPrescriber.full_name)
      setType(myPrescriber.prescriber_type)
      setRegistration(myPrescriber.registration_number)
      setRegBody(myPrescriber.registration_body ?? '')
      setEmail(myPrescriber.email ?? '')
      setPhone(myPrescriber.phone ?? '')
      setAddress(myPrescriber.address ?? '')
      setSignature(myPrescriber.signature_data ?? '')
    } else if (activeUser?.full_name && !fullName) {
      setFullName(activeUser.full_name)
    }
  }, [myPrescriber, activeUser]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setError(null)
    if (!fullName.trim() || !registration.trim()) {
      setError('Full name and registration number are required.')
      return
    }
    if (!signature) {
      setError('Please draw your electronic signature — it is attached to every prescription you write.')
      return
    }
    setSaving(true)
    try {
      await saveMyPrescriber({
        full_name: fullName.trim(),
        prescriber_type: type,
        registration_number: registration.trim(),
        registration_body: regBody.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        signature_data: signature,
        // v1: self-asserted active. Central vetting/approval is a planned follow-up.
        status: 'active',
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message?.includes('duplicate') || e.message?.includes('unique')
        ? 'That registration number is already registered to another prescriber.'
        : e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!prescriberLoaded) {
    return <div style={{ padding: 'var(--ps-space-lg)' }}>Loading…</div>
  }

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumbs">
          <a href="/peps" onClick={(e) => { e.preventDefault(); navigate('/peps') }}>PEPS</a>
          <span className="separator">/</span>
          <span>Prescriber Setup</span>
        </div>
        <h1>🪪 Prescriber Setup</h1>
        <p style={{ color: 'var(--ps-slate)', marginTop: '4px' }}>
          Your prescriber identity is global across PharmStation — any pharmacy can verify your registration.
        </p>
      </div>

      {myPrescriber && (
        <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
          <span className={`ps-badge ${myPrescriber.status === 'active' ? 'ps-badge-success' : ''}`}>
            {myPrescriber.status.toUpperCase()}
          </span>
          <span style={{ color: 'var(--ps-slate)' }}>
            {myPrescriber.status === 'active'
              ? 'You are authorised to write private prescriptions.'
              : 'Your prescriber account is awaiting approval.'}
          </span>
        </div>
      )}

      <div className="ps-card" style={{ maxWidth: 640 }}>
        {error && (
          <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>
        )}
        {saved && (
          <div className="ps-alert ps-alert-success" style={{ marginBottom: 'var(--ps-space-md)' }}>Saved.</div>
        )}

        <div className="form-group">
          <label>Full name *</label>
          <input className="ps-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dr Jane Smith" />
        </div>

        <div className="form-group">
          <label>Prescriber type *</label>
          <select className="ps-input" value={type} onChange={(e) => setType(e.target.value as PepsPrescriberType)}>
            {Object.entries(PEPS_PRESCRIBER_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>Registration number *</label>
            <input className="ps-input" value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="e.g. GMC 1234567" />
          </div>
          <div className="form-group">
            <label>Registration body</label>
            <input className="ps-input" value={regBody} onChange={(e) => setRegBody(e.target.value)} placeholder="GMC / GDC / GPhC / RCVS…" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
          <div className="form-group">
            <label>Email</label>
            <input className="ps-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="ps-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>Default prescribing address</label>
          <textarea className="ps-input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Electronic signature *</label>
          <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', margin: '0 0 8px' }}>
            Draw your signature below. It is securely stored and attached to every prescription you write.
          </p>
          <CanvasField value={signature || undefined} onChange={setSignature} width={400} height={150} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--ps-space-sm)', marginTop: 'var(--ps-space-md)' }}>
          <button className="ps-btn ps-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : myPrescriber ? 'Update prescriber details' : 'Register as prescriber'}
          </button>
          {myPrescriber?.status === 'active' && (
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/peps/write')}>
              Write a prescription →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
