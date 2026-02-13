import { useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'

export function OrgLoginPage() {
  const { orgLogin } = useAuthStore()
  const [email, setEmail] = useState('testpharmacy@pharmstation.dev')
  const [password, setPassword] = useState('TestPharmacy123!')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await orgLogin(email, password)
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Login failed. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <h1>Pharmacy Login</h1>
      <p className="subtitle">Sign in to your pharmacy workstation</p>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="org-email">Pharmacy Email</label>
          <input
            id="org-email"
            type="email"
            className="ps-input"
            placeholder="pharmacy@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="org-password">Password</label>
          <input
            id="org-password"
            type="password"
            className="ps-input"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="ps-btn ps-btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: '8px' }}
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign In to Pharmacy'}
        </button>
      </form>
    </div>
  )
}
