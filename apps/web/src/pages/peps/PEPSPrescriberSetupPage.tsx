import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, usePepsStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import {
  PEPS_PRESCRIBER_TYPE_LABELS,
  PEPS_REGISTER_LINKS,
  type PepsPrescriberType,
} from '@pharmstation/types'
import { CanvasField } from '../../components/forms/CanvasField'
import { PageHeader } from '../../components/ui'

export function PEPSPrescriberSetupPage() {
  const navigate = useNavigate()
  const { activeUser } = useAuthStore()
  const { myPrescriber, prescriberLoaded, fetchMyPrescriber, saveMyPrescriber, hasSigningPin, setSigningPin } = usePepsStore()

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

  // Signing PIN
  const [pinSet, setPinSet] = useState<boolean | null>(null)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSaved, setPinSaved] = useState(false)

  const load = useCallback(async () => {
    const p = await fetchMyPrescriber()
    if (p) {
      try {
        setPinSet(await hasSigningPin())
      } catch {
        setPinSet(false)
      }
    }
  }, [fetchMyPrescriber, hasSigningPin])

  const handleSavePin = async () => {
    setPinError(null)
    if (!/^\d{6}$/.test(newPin)) {
      setPinError('Your signing PIN must be 6 digits.')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('The two new PINs do not match.')
      return
    }
    if (pinSet && !/^\d{6}$/.test(currentPin)) {
      setPinError('Enter your current 6-digit PIN.')
      return
    }
    setPinSaving(true)
    try {
      await setSigningPin(newPin, pinSet ? currentPin : null)
      setPinSet(true)
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setPinSaved(true)
      setTimeout(() => setPinSaved(false), 3000)
    } catch (e: any) {
      setPinError(e.message ?? 'Could not save your PIN.')
    } finally {
      setPinSaving(false)
    }
  }

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
    } else {
      if (activeUser?.full_name && !fullName) setFullName(activeUser.full_name)
      if (!email) {
        getUserClient().auth.getUser().then(({ data }) => { if (data.user?.email) setEmail((e) => e || data.user!.email!) })
      }
      if (!regBody) setRegBody(PEPS_REGISTER_LINKS[type]?.body ?? '')
    }
  }, [myPrescriber, activeUser]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setError(null)
    if (!fullName.trim() || !registration.trim()) {
      setError('Full name and registration number are required.')
      return
    }
    if (address.trim().length < 5) {
      setError('Your practice address is required. It is printed on every prescription you write.')
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
        // Status is server-controlled: new prescribers start 'pending' and a
        // PharmStation admin activates them after checking the register.
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
      <PageHeader
        breadcrumbs={[{ label: 'My account', to: '/me' }, { label: 'Prescriber setup' }]}
        title="Prescriber setup"
        subtitle="Your prescriber identity works across PharmStation, so any pharmacy can check your registration."
      />

      {myPrescriber && (
        <div className="ps-card" style={{ marginBottom: 'var(--ps-space-md)', display: 'flex', alignItems: 'center', gap: 'var(--ps-space-sm)' }}>
          <span className={`ps-badge ${myPrescriber.status === 'active' ? 'ps-badge-success' : ''}`}>
            {myPrescriber.status.toUpperCase()}
          </span>
          <span style={{ color: 'var(--ps-slate)' }}>
            {myPrescriber.status === 'active'
              ? 'You are authorised to write private prescriptions.'
              : myPrescriber.status === 'pending'
                ? 'Awaiting verification. We check your registration number with your regulator before you can write prescriptions. Changing your name, type or registration sends it back for verification.'
                : 'Your prescriber account is not active. Contact PharmStation support.'}
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
          <select className="ps-input" value={type} onChange={(e) => {
            const t = e.target.value as PepsPrescriberType
            const oldBody = PEPS_REGISTER_LINKS[type]?.body ?? ''
            setType(t)
            // Fill the register from the type unless the prescriber typed something else
            if (!regBody.trim() || regBody.trim() === oldBody) setRegBody(PEPS_REGISTER_LINKS[t]?.body ?? '')
          }}>
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
          <label>Practice address *</label>
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
          <button className="ps-btn ps-btn-ghost" onClick={() => navigate('/me')}>
            Back to My Account
          </button>
          {myPrescriber?.status === 'active' && (
            <button className="ps-btn ps-btn-secondary" onClick={() => navigate('/peps/write')}>
              Write a prescription →
            </button>
          )}
        </div>
      </div>

      {myPrescriber && (
        <div className="ps-card" style={{ maxWidth: 640, marginTop: 'var(--ps-space-md)' }}>
          <h3 style={{ marginTop: 0 }}>Signing PIN</h3>
          <p style={{ fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)', marginTop: 0 }}>
            You enter this 6-digit PIN each time you send a prescription. It is your electronic signature:
            PharmStation records that you signed and seals the prescription so any later change can be detected.
            Do not share it. After 5 wrong tries it locks for 15 minutes.
            {pinSet === true && ' If you forget it, contact PharmStation support to reset it.'}
          </p>
          {pinError && <div className="ps-alert ps-alert-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{pinError}</div>}
          {pinSaved && <div className="ps-alert ps-alert-success" style={{ marginBottom: 'var(--ps-space-md)' }}>Signing PIN saved.</div>}
          {pinSet === false && (
            <div className="ps-alert ps-alert-warning" style={{ marginBottom: 'var(--ps-space-md)' }}>
              You have not set a signing PIN yet. You need one to send prescriptions.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: pinSet ? '1fr 1fr 1fr' : '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            {pinSet && (
              <div className="form-group">
                <label>Current PIN</label>
                <input className="ps-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                  value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} />
              </div>
            )}
            <div className="form-group">
              <label>New PIN</label>
              <input className="ps-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
                value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="form-group">
              <label>Repeat new PIN</label>
              <input className="ps-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6}
                value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <button className="ps-btn ps-btn-primary" onClick={handleSavePin} disabled={pinSaving}>
            {pinSaving ? 'Saving…' : pinSet ? 'Change PIN' : 'Set signing PIN'}
          </button>
        </div>
      )}
    </div>
  )
}
