import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatientStore } from '@pharmstation/core'
import { getUserClient } from '@pharmstation/supabase-client'
import type { Organisation } from '@pharmstation/types'

export function PatientRegisterPage() {
  const navigate = useNavigate()
  const { register } = usePatientStore()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [orgId, setOrgId] = useState('')
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getUserClient()
      .from('ps_organisations')
      .select('id, name')
      .eq('is_public', true)
      .order('name')
      .then(({ data }) => setOrgs((data as Organisation[]) || []))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (!orgId) { setError('Please select your pharmacy.'); return }
    setLoading(true)
    setError('')
    try {
      await register(email.trim(), password, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        organisation_id: orgId,
      })
      navigate('/patient/appointments')
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
    }
    setLoading(false)
  }

  return (
    <div style={{ maxWidth: '480px', margin: '60px auto', padding: '0 var(--ps-space-lg)' }}>
      <div className="ps-card" style={{ padding: 'var(--ps-space-xl)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>📝 Patient Registration</h1>
          <p style={{ color: 'var(--ps-slate)' }}>Create an account to book and manage appointments</p>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ps-space-md)' }}>
            <div className="form-group">
              <label>First Name *</label>
              <input className="ps-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input className="ps-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input className="ps-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label>Your Pharmacy *</label>
            <select className="ps-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">Select pharmacy…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input className="ps-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="form-group">
            <label>Confirm Password *</label>
            <input className="ps-input" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
          <button
            className="ps-btn ps-btn-primary"
            type="submit"
            disabled={loading || !firstName.trim() || !lastName.trim() || !email.trim() || !orgId || !password}
            style={{ width: '100%', marginTop: 'var(--ps-space-md)' }}
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          Already have an account?{' '}
          <a href="/patient/login" onClick={(e) => { e.preventDefault(); navigate('/patient/login') }} style={{ color: 'var(--ps-deep-blue)' }}>Sign in</a>
        </div>
      </div>
    </div>
  )
}
