import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PublicSiteShell } from '../../components/public/PublicSiteShell'
import { usePatientStore } from '@pharmstation/core'

export function PatientLoginPage() {
  const navigate = useNavigate()
  const { login } = usePatientStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      await login(email.trim(), password)
      navigate('/patient/appointments')
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.')
    }
    setLoading(false)
  }

  return (
    <PublicSiteShell variant="narrow" headerActions={<Link to="/login/org" className="landing-btn landing-btn-ghost">Pharmacy sign in</Link>}>
      <div className="ps-card public-form-card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--ps-space-xl)' }}>
          <span className="landing-eyebrow">For patients</span>
          <h1 style={{ marginBottom: 'var(--ps-space-xs)' }}>Patient sign in</h1>
          <p style={{ color: 'var(--ps-slate)' }}>Sign in to view your appointments</p>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 'var(--ps-space-md)' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input className="ps-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="ps-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
          </div>
          <button className="ps-btn ps-btn-primary" type="submit" disabled={loading || !email.trim() || !password} style={{ width: '100%', marginTop: 'var(--ps-space-md)' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-lg)', fontSize: 'var(--ps-font-sm)', color: 'var(--ps-slate)' }}>
          Don't have an account?{' '}
          <a href="/patient/register" onClick={(e) => { e.preventDefault(); navigate('/patient/register') }} style={{ color: 'var(--ps-deep-blue)' }}>Register</a>
        </div>
        <div style={{ textAlign: 'center', marginTop: 'var(--ps-space-sm)', fontSize: 'var(--ps-font-sm)' }}>
          <a href="/book" onClick={(e) => { e.preventDefault(); navigate('/book') }} style={{ color: 'var(--ps-slate)' }}>← Book without an account</a>
        </div>
      </div>
    </PublicSiteShell>
  )
}
