import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { getOrgClient, friendlyAuthError, passwordProblem } from '@pharmstation/supabase-client'
import { OwnerSetupForm } from './OwnerSetupForm'

type Step = 'pharmacy' | 'confirm-email' | 'owner'

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i

/**
 * Self-service pharmacy sign-up.
 *  1. Create the pharmacy (workstation) login. The auth trigger creates the
 *     ps_organisations row; it starts 'pending' verification.
 *  2. Create or sign in to the owner's personal account and link it as owner.
 * If email confirmation is on, step 1 pauses until the pharmacy email is
 * confirmed. Signing in to the pharmacy afterwards resumes at step 2.
 */
export function PharmacySignupPage() {
  const [step, setStep] = useState<Step>('pharmacy')
  const [name, setName] = useState('')
  const [premises, setPremises] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Enter the pharmacy’s name')
    if (!/^\d{7}$/.test(premises.trim())) return setError('The GPhC premises registration number is 7 digits. You can find it on the GPhC register.')
    if (!line1.trim() || !city.trim()) return setError('Enter the pharmacy’s address')
    if (!POSTCODE_RE.test(postcode.trim())) return setError('Enter a valid UK postcode')
    const pwProblem = passwordProblem(password)
    if (pwProblem) return setError(`${pwProblem} in the pharmacy password`)
    if (password !== confirm) return setError('The passwords don’t match')
    if (!agreed) return setError('Please confirm you’re authorised to register this pharmacy')

    setBusy(true)
    try {
      const { data, error: signUpError } = await getOrgClient().auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login/org`,
          data: {
            account_type: 'organisation',
            org_name: name.trim(),
            gphc_premises_number: premises.trim(),
            address: {
              line_1: line1.trim(),
              line_2: line2.trim() || undefined,
              city: city.trim(),
              postcode: postcode.trim().toUpperCase(),
              country: 'United Kingdom',
            },
          },
        },
      })
      if (signUpError) throw signUpError
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('That email already has a PharmStation account. Sign in to the pharmacy instead, or use a different email.')
      }
      setStep(data.session ? 'owner' : 'confirm-email')
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card onboarding-card">
      <div className="logo">
        Pharm<span>Station</span>
      </div>

      <ol className="onboarding-steps" aria-label="Sign-up progress">
        <li className={step === 'pharmacy' || step === 'confirm-email' ? 'active' : 'done'}>Your pharmacy</li>
        <li className={step === 'owner' ? 'active' : ''}>Your login</li>
      </ol>

      {step === 'pharmacy' && (
        <>
          <h1>Set up your pharmacy</h1>
          <p className="subtitle">
            Two quick steps. Your registers, logs and team are ready as soon as you finish.
          </p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="ph-name">Pharmacy name</label>
              <input id="ph-name" className="ps-input" autoComplete="organization" value={name}
                onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="ph-premises">GPhC premises number</label>
              <input id="ph-premises" className="ps-input" inputMode="numeric" maxLength={7} value={premises}
                onChange={(e) => setPremises(e.target.value.replace(/\D/g, ''))} required />
              <small className="onboarding-hint">
                We check this against the{' '}
                <a href="https://www.pharmacyregulation.org/registers" target="_blank" rel="noopener noreferrer">GPhC register</a>{' '}
                before your pharmacy can message the network or take public bookings.
              </small>
            </div>
            <div className="form-group">
              <label htmlFor="ph-line1">Address</label>
              <input id="ph-line1" className="ps-input" autoComplete="address-line1" placeholder="Street address" value={line1}
                onChange={(e) => setLine1(e.target.value)} required />
              <input className="ps-input onboarding-stack" autoComplete="address-line2" placeholder="Address line 2 (optional)"
                aria-label="Address line 2" value={line2} onChange={(e) => setLine2(e.target.value)} />
            </div>
            <div className="onboarding-row">
              <div className="form-group">
                <label htmlFor="ph-city">Town or city</label>
                <input id="ph-city" className="ps-input" autoComplete="address-level2" value={city}
                  onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="ph-postcode">Postcode</label>
                <input id="ph-postcode" className="ps-input" autoComplete="postal-code" value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())} required />
              </div>
            </div>

            <h2 className="onboarding-step-title">Pharmacy login</h2>
            <p className="onboarding-help">
              The shared login for the pharmacy&rsquo;s computers. Use the shop&rsquo;s email (for example
              your NHSmail shared mailbox). Staff then sign in as themselves on top of it.
            </p>
            <div className="form-group">
              <label htmlFor="ph-email">Pharmacy email</label>
              <input id="ph-email" type="email" className="ps-input" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="ph-password">Password</label>
              <input id="ph-password" type="password" className="ps-input" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="ph-confirm">Confirm password</label>
              <input id="ph-confirm" type="password" className="ps-input" autoComplete="new-password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} required />
            </div>

            <label className="onboarding-check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                I&rsquo;m the owner, superintendent or manager of this pharmacy and I&rsquo;m authorised to register it.
                I&rsquo;ve read the <Link to="/privacy" target="_blank">privacy notice</Link>.
              </span>
            </label>

            <button type="submit" className="ps-btn ps-btn-primary onboarding-submit" disabled={busy}>
              {busy ? 'Creating pharmacy…' : 'Continue'}
            </button>
          </form>

          <p className="onboarding-footer">
            Already on PharmStation? <Link to="/login/org">Sign in</Link>
          </p>
        </>
      )}

      {step === 'confirm-email' && (
        <>
          <h1>Confirm the pharmacy email</h1>
          <p className="subtitle">
            We&rsquo;ve sent a link to <strong>{email.trim().toLowerCase()}</strong>. Click it, then sign in to the
            pharmacy. We&rsquo;ll take you straight to the last step: adding your own login as owner.
          </p>
          <Link to="/login/org" className="ps-btn ps-btn-primary onboarding-submit">Go to pharmacy sign in</Link>
          <p className="onboarding-footer">
            No email after a few minutes? Check spam, or contact <a href="mailto:hello@pharmstation.co.uk">hello@pharmstation.co.uk</a>.
          </p>
        </>
      )}

      {step === 'owner' && <OwnerSetupForm pharmacyName={name.trim()} />}
    </div>
  )
}
