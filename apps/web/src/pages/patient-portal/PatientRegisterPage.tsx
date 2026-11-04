import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'
import { usePatientStore } from '@pharmstation/core'
import { getUserClient, passwordProblem } from '@pharmstation/supabase-client'
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
  const [sentTo, setSentTo] = useState<string | null>(null)

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
    const pwProblem = passwordProblem(password)
    if (pwProblem) { setError(`${pwProblem} in your password.`); return }
    if (!orgId) { setError('Please select your pharmacy.'); return }
    setLoading(true)
    setError('')
    try {
      const out = await register(email.trim(), password, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        organisation_id: orgId,
      })
      if (out.needsConfirmation) setSentTo(email.trim())
      else navigate('/patient/appointments')
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
    }
    setLoading(false)
  }

  return (
    <PublicSiteShell variant="narrow" headerActions={<Link to="/login/org" className="landing-btn landing-btn-ghost">Pharmacy sign in</Link>}>
      <div className="ps-card public-form-card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <span className="landing-eyebrow">For patients</span>
          <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>Create a patient account</h1>
          <p style={{ color: 'var(--ps-slate)' }}>Create an account to book and manage appointments</p>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

        {sentTo ? (
          <div style={{ textAlign: 'center' }}>
            <p>We've sent a link to <strong>{sentTo}</strong>. Click it to confirm your email, then sign in.</p>
            <p style={{ color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>Any bookings you've already made with this email will appear in your account once it's confirmed.</p>
            <Link to="/patient/login" className="ps-btn ps-btn-primary">Go to sign in</Link>
          </div>
        ) : (
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
            <input className="ps-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="10+ characters, letters and numbers" />
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
        )}

        <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          Already have an account?{' '}
          <a href="/patient/login" onClick={(e) => { e.preventDefault(); navigate('/patient/login') }} style={{ color: 'var(--ps-deep-blue)' }}>Sign in</a>
        </div>
      </div>
    </PublicSiteShell>
  )
}
