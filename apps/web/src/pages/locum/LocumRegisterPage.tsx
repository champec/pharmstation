import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getLocumClient, locumSignUp } from '@pharmstation/supabase-client'

/* ─── Service library row ─── */
interface ServiceOption {
  id: string
  name: string
  category: string
}

/* ─── Step types ─── */
type Step = 'account' | 'compliance' | 'services' | 'review' | 'done'

const STEP_LABELS: Record<Step, string> = {
  account: 'Account',
  compliance: 'Compliance',
  services: 'Services',
  review: 'Review',
  done: 'Done',
}

const STEPS: Step[] = ['account', 'compliance', 'services', 'review', 'done']

/* ─── Category labels ─── */
const CATEGORY_LABELS: Record<string, string> = {
  consultation: 'Consultations',
  nhs_advanced_service: 'NHS Advanced Services',
  pharmacy_first: 'Pharmacy First',
}

export function LocumRegisterPage() {
  const navigate = useNavigate()

  /* Step */
  const [step, setStep] = useState<Step>('account')
  const stepIndex = STEPS.indexOf(step)

  /* Step 1 — Account */
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  /* Step 2 — Compliance */
  const [gphcNumber, setGphcNumber] = useState('')
  const [indemnityProvider, setIndemnityProvider] = useState('')
  const [indemnityExpiry, setIndemnityExpiry] = useState('')
  const [dbsNumber, setDbsNumber] = useState('')
  const [dbsExpiry, setDbsExpiry] = useState('')
  const [niNumber, setNiNumber] = useState('')
  const [nhsEmail, setNhsEmail] = useState('')
  const [smartCardHeld, setSmartCardHeld] = useState(false)
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')

  /* Step 3 — Services */
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [loadingServices, setLoadingServices] = useState(false)

  /* Submission */
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailPending, setEmailPending] = useState(false)

  /* Load service library when reaching step 3 */
  useEffect(() => {
    if (step !== 'services' || serviceOptions.length > 0) return
    setLoadingServices(true)
    getLocumClient()
      .from('ps_service_library')
      .select('id, name, category')
      .order('category')
      .order('name')
      .then(({ data }) => {
        setServiceOptions((data as ServiceOption[]) || [])
        setLoadingServices(false)
      })
  }, [step, serviceOptions.length])

  /* Validation per step */
  function canAdvance(): boolean {
    if (step === 'account') {
      return (
        firstName.trim().length >= 1 &&
        lastName.trim().length >= 1 &&
        email.includes('@') &&
        password.length >= 8 &&
        password === confirmPassword
      )
    }
    if (step === 'compliance') {
      return (
        gphcNumber.trim().length >= 7 &&
        addressLine1.trim().length > 0 &&
        city.trim().length > 0 &&
        postcode.trim().length > 0
      )
    }
    if (step === 'services') return true
    return true
  }

  function nextStep() {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  function prevStep() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  /* Final submission */
  async function handleSubmit() {
    setError(null)
    setSubmitting(true)

    try {
      // 1. Create auth user
      const { user, session } = await locumSignUp(email.trim(), password)

      if (!user) throw new Error('Signup failed — no user returned.')

      // Supabase returns user with empty identities array when the email already exists
      if (user.identities?.length === 0) {
        setError('This email already has an account. Sign in at /locum/login — your locum profile will be set up automatically.')
        setSubmitting(false)
        return
      }

      const userId = user.id
      const client = getLocumClient()
      const fullName = `${firstName.trim()} ${lastName.trim()}`

      // Helper to insert with retry (handles cases where session arrives async)
      const insertProfiles = async () => {
        // ps_user_profiles
        const { error: upErr } = await client.from('ps_user_profiles').insert({
          id: userId,
          email: email.trim(),
          full_name: fullName,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          default_role: 'locum',
        })
        if (upErr && upErr.code !== '23505') throw upErr // ignore unique conflict

        // ps_locum_profiles
        const { error: lpErr } = await client.from('ps_locum_profiles').insert({
          user_id: userId,
          gphc_number: gphcNumber.trim() || null,
          indemnity_provider: indemnityProvider.trim() || null,
          indemnity_expiry: indemnityExpiry || null,
          dbs_number: dbsNumber.trim() || null,
          dbs_expiry: dbsExpiry || null,
          ni_number: niNumber.trim() || null,
          nhs_email: nhsEmail.trim() || null,
          smart_card_held: smartCardHeld,
          address_line_1: addressLine1.trim() || null,
          address_line_2: addressLine2.trim() || null,
          city: city.trim() || null,
          postcode: postcode.trim().toUpperCase() || null,
          onboarding_complete: false,
          stripe_onboarded: false,
        })
        if (lpErr && lpErr.code !== '23505') throw lpErr

        // ps_locum_profiles id lookup
        const { data: lp } = await client
          .from('ps_locum_profiles')
          .select('id')
          .eq('user_id', userId)
          .single()

        if (lp && selectedServiceIds.length > 0) {
          const svcRows = selectedServiceIds.map((sid) => ({
            locum_id: lp.id,
            service_library_id: sid,
          }))
          await client.from('ps_locum_services').insert(svcRows)
        }
      }

      if (session) {
        // Email confirmation disabled — session returned immediately
        await insertProfiles()
        setStep('done')
      } else {
        // Email confirmation required — profiles will be created via a resumption page
        // For now, mark email as pending and show confirmation message
        setEmailPending(true)
        // Store profile data in localStorage for post-confirm completion
        localStorage.setItem(
          'locum_pending_profile',
          JSON.stringify({
            userId,
            firstName,
            lastName,
            email,
            gphcNumber,
            indemnityProvider,
            indemnityExpiry,
            dbsNumber,
            dbsExpiry,
            niNumber,
            nhsEmail,
            smartCardHeld,
            addressLine1,
            addressLine2,
            city,
            postcode,
            selectedServiceIds,
          })
        )
        setStep('done')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ─── Grouped services ─── */
  const groupedServices = serviceOptions.reduce<Record<string, ServiceOption[]>>((acc, svc) => {
    const cat = svc.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(svc)
    return acc
  }, {})

  /* ─── Render ─── */
  return (
    <div className="auth-layout">
      <div className="auth-card locum-register-card">
        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo">
            Pharm<span>Station</span>
            <span className="locum-badge">Locum</span>
          </div>
          <h1 className="auth-title">Create Locum Account</h1>
        </div>

        {/* Stepper */}
        {step !== 'done' && (
          <div className="wizard-stepper">
            {STEPS.filter((s) => s !== 'done').map((s, i) => (
              <div
                key={s}
                className={`wizard-step${STEPS.indexOf(step) > i ? ' completed' : ''}${step === s ? ' active' : ''}`}
              >
                <div className="wizard-step-dot">{STEPS.indexOf(step) > i ? '✓' : i + 1}</div>
                <div className="wizard-step-label">{STEP_LABELS[s]}</div>
              </div>
            ))}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Account ── */}
        {step === 'account' && (
          <div className="wizard-body">
            <p className="wizard-step-desc">Set up your login credentials.</p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                className="form-input"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="form-hint form-hint-error">Passwords do not match.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Compliance ── */}
        {step === 'compliance' && (
          <div className="wizard-body">
            <p className="wizard-step-desc">
              Your regulatory details. All information is stored securely and verified periodically.
            </p>

            <h3 className="wizard-section-heading">GPhC Registration <span className="wizard-required">*</span></h3>
            <div className="form-group">
              <label className="form-label">GPhC Number</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. 2012345"
                value={gphcNumber}
                onChange={(e) => setGphcNumber(e.target.value)}
              />
              <p className="form-hint">Your 7-digit GPhC registration number. We verify this via the GPhC register.</p>
            </div>

            <div className="wizard-optional-notice">
              The fields below can be completed now or added later from your Profile. They are required before booking shifts.
            </div>

            <h3 className="wizard-section-heading">Professional Indemnity Insurance <span className="wizard-optional-tag">(optional now)</span></h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. MDDUS, Aviva, Zurich"
                  value={indemnityProvider}
                  onChange={(e) => setIndemnityProvider(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Expiry Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={indemnityExpiry}
                  onChange={(e) => setIndemnityExpiry(e.target.value)}
                />
              </div>
            </div>

            <h3 className="wizard-section-heading">DBS Check <span className="wizard-optional-tag">(optional now)</span></h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">DBS Certificate Number</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Leave blank if not yet obtained"
                  value={dbsNumber}
                  onChange={(e) => setDbsNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">DBS Issue Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={dbsExpiry}
                  onChange={(e) => setDbsExpiry(e.target.value)}
                />
              </div>
            </div>

            <h3 className="wizard-section-heading">Payroll &amp; NHS Details</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">National Insurance Number <span className="wizard-optional-tag">(optional now)</span></label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="AB 12 34 56 C"
                  value={niNumber}
                  onChange={(e) => setNiNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">NHS Email <span className="wizard-optional-tag">(optional)</span></label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@nhs.net"
                  value={nhsEmail}
                  onChange={(e) => setNhsEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="ps-checkbox-label">
                <input
                  type="checkbox"
                  checked={smartCardHeld}
                  onChange={(e) => setSmartCardHeld(e.target.checked)}
                />
                I hold an NHS Smartcard
              </label>
            </div>

            <h3 className="wizard-section-heading">Home Address</h3>
            <div className="form-group">
              <label className="form-label">Address Line 1</label>
              <input
                className="form-input"
                type="text"
                placeholder="123 High Street"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Address Line 2 (optional)</label>
              <input
                className="form-input"
                type="text"
                placeholder="Flat / Apartment"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">City / Town</label>
                <input
                  className="form-input"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Postcode</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="SW1A 1AA"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Services ── */}
        {step === 'services' && (
          <div className="wizard-body">
            <p className="wizard-step-desc">
              Which services are you qualified and confident to provide? Select all that apply.
              Pharmacies use this to match you to appropriate shifts.
            </p>
            {loadingServices ? (
              <div className="loading-indicator">Loading services…</div>
            ) : (
              <div className="service-checklist">
                {Object.entries(groupedServices).map(([cat, svcs]) => (
                  <div key={cat} className="service-checklist-group">
                    <h4 className="service-checklist-heading">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </h4>
                    {svcs.map((svc) => (
                      <label key={svc.id} className="ps-checkbox-label service-checklist-item">
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.includes(svc.id)}
                          onChange={() => toggleService(svc.id)}
                        />
                        {svc.name}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {selectedServiceIds.length === 0 && (
              <p className="form-hint">No services selected — you can add these later from your profile.</p>
            )}
          </div>
        )}

        {/* ── Step 4: Review ── */}
        {step === 'review' && (
          <div className="wizard-body">
            <p className="wizard-step-desc">
              Please review your information before submitting. You can go back to make changes.
            </p>

            <div className="review-section">
              <h3 className="review-section-heading">Account</h3>
              <div className="review-row"><span>First Name</span><strong>{firstName}</strong></div>
              <div className="review-row"><span>Last Name</span><strong>{lastName}</strong></div>
              <div className="review-row"><span>Email</span><strong>{email}</strong></div>
            </div>

            <div className="review-section">
              <h3 className="review-section-heading">Compliance</h3>
              {gphcNumber && <div className="review-row"><span>GPhC Number</span><strong>{gphcNumber}</strong></div>}
              {indemnityProvider && <div className="review-row"><span>Indemnity</span><strong>{indemnityProvider}{indemnityExpiry ? ` — expires ${indemnityExpiry}` : ''}</strong></div>}
              {dbsNumber && <div className="review-row"><span>DBS</span><strong>{dbsNumber}</strong></div>}
              {niNumber && <div className="review-row"><span>NI Number</span><strong>{niNumber}</strong></div>}
              <div className="review-row"><span>Smartcard</span><strong>{smartCardHeld ? 'Yes' : 'No'}</strong></div>
              <div className="review-row"><span>Address</span><strong>{addressLine1}, {city}, {postcode}</strong></div>
            </div>

            <div className="review-section">
              <h3 className="review-section-heading">Services ({selectedServiceIds.length})</h3>
              <div className="review-service-list">
                {serviceOptions
                  .filter((s) => selectedServiceIds.includes(s.id))
                  .map((s) => (
                    <span key={s.id} className="ps-badge ps-badge-outline">{s.name}</span>
                  ))}
              </div>
            </div>

            <div className="review-section review-section-notice">
              <p>
                <strong>Documents:</strong> After registering, visit your Profile to upload your GPhC
                certificate, indemnity certificate, and DBS certificate. Shifts may require verified
                documents.
              </p>
              <p>
                <strong>Payments:</strong> You'll be prompted to connect a Stripe account from your
                dashboard to receive shift payments.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === 'done' && (
          <div className="wizard-body wizard-done">
            <div className="wizard-done-icon">✓</div>
            {emailPending ? (
              <>
                <h2>Check Your Email</h2>
                <p>
                  We've sent a confirmation link to <strong>{email}</strong>. Click the link to verify
                  your address, then sign in to complete your profile setup.
                </p>
              </>
            ) : (
              <>
                <h2>Welcome to PharmStation Locum!</h2>
                <p>
                  Your account has been created. Sign in to access your dashboard, browse shifts, and
                  connect your payment account.
                </p>
              </>
            )}
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => navigate('/locum/login')}
            >
              Go to Sign In
            </button>
          </div>
        )}

        {/* Navigation buttons */}
        {step !== 'done' && (
          <div className="wizard-footer">
            {stepIndex > 0 && (
              <button
                className="ps-btn ps-btn-ghost"
                onClick={prevStep}
                disabled={submitting}
              >
                Back
              </button>
            )}
            {step !== 'review' ? (
              <button
                className="ps-btn ps-btn-primary"
                onClick={nextStep}
                disabled={!canAdvance()}
              >
                Continue
              </button>
            ) : (
              <button
                className="ps-btn ps-btn-primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Creating account…' : 'Create Account'}
              </button>
            )}
          </div>
        )}

        {/* Footer links */}
        {step === 'account' && (
          <div className="auth-footer">
            Already have an account?{' '}
            <Link to="/locum/login">Sign in</Link>
          </div>
        )}
      </div>
    </div>
  )
}
