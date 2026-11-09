import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { friendlyAuthError, getUserClient, passwordProblem } from '@pharmstation/supabase-client'
import { PasswordInput } from '../../components/PasswordInput'

type Kind = 'locum' | 'staff'

/**
 * Create a personal PharmStation account. For locums (who then add their
 * documents and find shifts) and for staff whose pharmacy hasn't sent an
 * invite yet. Pharmacies sign up at /signup; invited staff use their link.
 */
export function PersonalSignupPage() {
  const [kind, setKind] = useState<Kind>('locum')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [gphc, setGphc] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) return setError('Enter your full name.')
    if (gphc && !/^\d{7}$/.test(gphc.trim())) return setError('A GPhC registration number is 7 digits.')
    const pw = passwordProblem(password)
    if (pw) return setError(`${pw} in your password.`)
    if (!agree) return setError('Please confirm you’ve read the privacy notice.')
    setBusy(true)
    try {
      const clean = email.trim().toLowerCase()
      const { data, error: signUpError } = await getUserClient().auth.signUp({
        email: clean,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/me/login?confirmed=1`,
          data: {
            account_type: 'user',
            full_name: fullName.trim(),
            gphc_number: gphc.trim() || null,
            default_role: kind === 'locum' ? 'locum' : 'dispenser',
          },
        },
      })
      if (signUpError) throw signUpError
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('That email already has a PharmStation account. Sign in instead, or reset your password.')
      }
      if (data.session) await getUserClient().auth.signOut({ scope: 'local' })
      setSentTo(clean)
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div className="auth-card">
        <div className="logo">Pharm<span>Station</span></div>
        <h1>Check your email</h1>
        <p className="subtitle">
          We&rsquo;ve sent a confirmation link to <strong>{sentTo}</strong>. Click it, then sign in with your email and
          password, on this website or in the PharmStation app.
        </p>
        <Link to="/me/login" className="ps-btn ps-btn-primary" style={{ width: '100%', padding: '12px', display: 'block', textAlign: 'center' }}>
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <div className="logo">Pharm<span>Station</span></div>
      <h1>Create your account</h1>
      <p className="subtitle">Your own PharmStation login. It stays with you when you move between pharmacies.</p>

      <div className="form-group" role="radiogroup" aria-label="I am">
        <label>I am</label>
        <div style={{ display: 'grid', gap: '8px' }}>
          <label className="ps-radio-card" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={kind === 'locum'} onChange={() => setKind('locum')} />
            <span><strong>A locum</strong><br /><small>Find and book shifts, and keep your documents in one place.</small></span>
          </label>
          <label className="ps-radio-card" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={kind === 'staff'} onChange={() => setKind('staff')} />
            <span><strong>Pharmacy staff</strong><br /><small>Your manager can then add you to the pharmacy. If they sent you an invite link, use that instead.</small></span>
          </label>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="su-name">Full name</label>
          <input id="su-name" className="ps-input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="su-email">Email</label>
          <input id="su-email" type="email" className="ps-input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="su-gphc">GPhC registration number {kind === 'staff' && <small>(if you have one)</small>}</label>
          <input id="su-gphc" className="ps-input" inputMode="numeric" maxLength={7} value={gphc} onChange={(e) => setGphc(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="form-group">
          <label htmlFor="su-password">Password</label>
          <PasswordInput id="su-password" className="ps-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <small className="text-muted">At least 10 characters, with letters and numbers.</small>
        </div>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--ps-font-sm)', margin: '8px 0' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I&rsquo;ve read the <Link to="/privacy" target="_blank">privacy notice</Link>.
          </span>
        </label>
        <button type="submit" className="ps-btn ps-btn-primary" style={{ width: '100%', padding: '12px', marginTop: '8px' }} disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: 'var(--ps-font-sm)' }}>
        <Link to="/me/login">Already have an account? Sign in</Link>
        <Link to="/signup">Signing up a pharmacy? Start here</Link>
      </div>
    </div>
  )
}
