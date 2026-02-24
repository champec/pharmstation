import { useState, type FormEvent } from 'react'
import { useAuthStore } from '@pharmstation/core'

export function UserLoginPage() {
  const { organisation, userLogin, orgLogout } = useAuthStore()
  const [email, setEmail] = useState('testuser@pharmstation.dev')
  const [password, setPassword] = useState('TestUser123!')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Load saved staff emails from localStorage
  const savedStaff = JSON.parse(localStorage.getItem('ps-saved-staff') || '[]') as string[]

  const handleStaffSelect = (staffEmail: string) => {
    // If already selected, clicking again just keeps the selection (cancel = don't submit)
    setEmail(staffEmail)
    setPassword('') // Clear password so they need to re-enter it
    setError(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await userLogin(email, password)
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

      <h1>Staff Sign In</h1>
      <p className="subtitle">
        Signed in to <strong>{organisation?.name ?? 'Unknown Pharmacy'}</strong>
      </p>

      {error && <div className="auth-error">{error}</div>}

      {/* Saved staff quick-select */}
      {savedStaff.length > 0 && (
        <>
          <div className="saved-staff-list">
            {savedStaff.map((staffEmail) => (
              <button
                key={staffEmail}
                type="button"
                className={`saved-staff-item ${email === staffEmail ? 'selected' : ''}`}
                onClick={() => handleStaffSelect(staffEmail)}
              >
                👤 {staffEmail}
              </button>
            ))}
          </div>
          <div className="divider-text">or enter email manually</div>
        </>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="user-email">Email</label>
          <input
            id="user-email"
            type="email"
            className="ps-input"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="user-password">Password</label>
          <input
            id="user-password"
            type="password"
            className="ps-input"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus={savedStaff.length > 0}
          />
        </div>

        <button
          type="submit"
          className="ps-btn ps-btn-primary"
          style={{ width: '100%', padding: '12px', marginTop: '8px' }}
          disabled={loading || !email}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button
          className="ps-btn ps-btn-ghost"
          onClick={orgLogout}
          style={{ fontSize: 'var(--ps-font-sm)' }}
        >
          ← Switch Pharmacy
        </button>
      </div>
    </div>
  )
}
