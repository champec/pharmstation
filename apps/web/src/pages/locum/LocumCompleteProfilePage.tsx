import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore } from '@pharmstation/core'

interface ServiceOption {
  id: string
  name: string
  category: string
}

const CATEGORY_LABELS: Record<string, string> = {
  consultation: 'Consultations',
  nhs_advanced_service: 'NHS Advanced Services',
  pharmacy_first: 'Pharmacy First',
}

type Step = 'compliance' | 'services'

export function LocumCompleteProfilePage() {
  const navigate = useNavigate()
  const { activeUser: userProfile, locumProfile, refreshLocumProfile: refreshProfile, userLogout: logout } = useAuthStore()
  const [step, setStep] = useState<Step>('compliance')

  /* Redirect away if profile already exists */
  useEffect(() => {
    if (locumProfile) navigate('/locum/dashboard', { replace: true })
  }, [locumProfile, navigate])

  /* Compliance */
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

  /* Services */
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [loadingServices, setLoadingServices] = useState(false)

  /* Submission */
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Pre-fill from localStorage if registration data is still there */
  useEffect(() => {
    const pending = localStorage.getItem('locum_pending_profile')
    if (!pending) return
    try {
      const p = JSON.parse(pending)
      if (p.gphcNumber) setGphcNumber(p.gphcNumber)
      if (p.indemnityProvider) setIndemnityProvider(p.indemnityProvider)
      if (p.indemnityExpiry) setIndemnityExpiry(p.indemnityExpiry)
      if (p.dbsNumber) setDbsNumber(p.dbsNumber)
      if (p.dbsExpiry) setDbsExpiry(p.dbsExpiry)
      if (p.niNumber) setNiNumber(p.niNumber)
      if (p.nhsEmail) setNhsEmail(p.nhsEmail)
      if (p.smartCardHeld) setSmartCardHeld(p.smartCardHeld)
      if (p.addressLine1) setAddressLine1(p.addressLine1)
      if (p.addressLine2) setAddressLine2(p.addressLine2)
      if (p.city) setCity(p.city)
      if (p.postcode) setPostcode(p.postcode)
      if (p.selectedServiceIds?.length) setSelectedServiceIds(p.selectedServiceIds)
    } catch { /* ignore */ }
  }, [])

  /* Load services */
  useEffect(() => {
    if (step !== 'services' || serviceOptions.length > 0) return
    setLoadingServices(true)
    getUserClient()
      .from('ps_service_library')
      .select('id, name, category')
      .order('category').order('name')
      .then(({ data }) => {
        setServiceOptions((data as ServiceOption[]) ?? [])
        setLoadingServices(false)
      })
  }, [step, serviceOptions.length])

  function canAdvance(): boolean {
    if (step === 'compliance') return gphcNumber.trim().length >= 7
    return true
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  async function handleSubmit() {
    if (!userProfile?.id) return
    setError(null)
    setSubmitting(true)
    try {
      const client = getUserClient()

      const { error: lpErr } = await client.from('ps_locum_profiles').insert({
        user_id: userProfile.id,
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

      if (selectedServiceIds.length > 0) {
        const { data: lp } = await client
          .from('ps_locum_profiles')
          .select('id')
          .eq('user_id', userProfile.id)
          .single()
        if (lp) {
          await client.from('ps_locum_services').insert(
            selectedServiceIds.map((sid) => ({ locum_id: lp.id, service_library_id: sid }))
          )
        }
      }

      localStorage.removeItem('locum_pending_profile')
      await refreshProfile()
      navigate('/locum/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const grouped = serviceOptions.reduce<Record<string, ServiceOption[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  const displayName = userProfile?.first_name
    ? `${userProfile.first_name}${userProfile.last_name ? ' ' + userProfile.last_name : ''}`
    : userProfile?.full_name ?? userProfile?.email ?? 'there'

  return (
    <div className="auth-layout">
      <div className="auth-card locum-register-card">
        <div className="auth-header">
          <div className="auth-logo">
            Pharm<span>Station</span>
            <span className="locum-badge">Locum</span>
          </div>
          <h1 className="auth-title">Complete Your Locum Profile</h1>
          <p className="wizard-step-desc" style={{ marginTop: '0.5rem' }}>
            Hi {displayName}, just a few more details to activate your locum account.
          </p>
        </div>

        {/* Step tabs */}
        <div className="wizard-stepper">
          {(['compliance', 'services'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`wizard-step${step === s ? ' active' : ''}${
                (step === 'services' && s === 'compliance') ? ' completed' : ''
              }`}
            >
              <div className="wizard-step-dot">
                {step === 'services' && s === 'compliance' ? '✓' : i + 1}
              </div>
              <div className="wizard-step-label">
                {s === 'compliance' ? 'Compliance' : 'Services'}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* ── Compliance step ── */}
        {step === 'compliance' && (
          <div className="wizard-body">
            <h3 className="wizard-section-heading">
              GPhC Registration <span className="wizard-required">*</span>
            </h3>
            <div className="form-group">
              <label className="form-label">GPhC Number</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. 2012345"
                value={gphcNumber}
                onChange={(e) => setGphcNumber(e.target.value)}
                autoFocus
              />
            </div>

            <div className="wizard-optional-notice">
              The fields below can be added now or later from your Profile. They may be required before booking certain shifts.
            </div>

            <h3 className="wizard-section-heading">
              Professional Indemnity <span className="wizard-optional-tag">(optional)</span>
            </h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. MDDUS, Aviva"
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

            <h3 className="wizard-section-heading">
              DBS Check <span className="wizard-optional-tag">(optional)</span>
            </h3>
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

            <h3 className="wizard-section-heading">
              Payroll &amp; NHS <span className="wizard-optional-tag">(optional)</span>
            </h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">NI Number</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="AB 12 34 56 C"
                  value={niNumber}
                  onChange={(e) => setNiNumber(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">NHS Email</label>
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

            <h3 className="wizard-section-heading">
              Home Address <span className="wizard-optional-tag">(optional)</span>
            </h3>
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
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">City</label>
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

        {/* ── Services step ── */}
        {step === 'services' && (
          <div className="wizard-body">
            <p className="wizard-step-desc">
              Which services are you qualified to provide? Pharmacies use this to match you to shifts.
              You can update this anytime from your profile.
            </p>
            {loadingServices ? (
              <div className="loading-indicator">Loading services…</div>
            ) : (
              <div className="service-checklist">
                {Object.entries(grouped).map(([cat, svcs]) => (
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

        {/* Footer */}
        <div className="wizard-footer">
          {step === 'services' && (
            <button
              className="ps-btn ps-btn-ghost"
              onClick={() => setStep('compliance')}
              disabled={submitting}
            >
              Back
            </button>
          )}
          {step === 'compliance' ? (
            <button
              className="ps-btn ps-btn-primary"
              onClick={() => setStep('services')}
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
              {submitting ? 'Activating…' : 'Activate Locum Account'}
            </button>
          )}
        </div>

        <div className="auth-footer">
          <button
            className="ps-btn ps-btn-ghost ps-btn-sm"
            onClick={async () => { await logout(); navigate('/me/login', { replace: true }) }}
            style={{ color: 'var(--ps-mist)' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
