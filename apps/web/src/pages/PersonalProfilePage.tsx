import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'
import { useAuthStore, useLocumAuthStore } from '@pharmstation/core'

interface LocumSummary {
  id: string
  onboarding_complete: boolean | null
  stripe_account_id: string | null
  stripe_onboarded: boolean | null
}

/**
 * Personal profile — the individual (user-tier) account page.
 * Reachable with just a user-layer session (/me/login), or from inside an
 * organisation session. Nothing here is org-specific.
 */
export function PersonalProfilePage() {
  const { activeUser, userSession, organisation, membership, isOrgLoggedIn, userLogout } = useAuthStore()
  const { refreshProfile: refreshLocumProfile } = useLocumAuthStore()
  const navigate = useNavigate()

  /* Personal details */
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [gphcNumber, setGphcNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  /* Locum status */
  const [locum, setLocum] = useState<LocumSummary | null>(null)
  const [locumChecked, setLocumChecked] = useState(false)

  useEffect(() => {
    setFirstName(activeUser?.first_name ?? '')
    setLastName(activeUser?.last_name ?? '')
    setPhone(activeUser?.phone ?? '')
    setGphcNumber(activeUser?.gphc_number ?? '')
  }, [activeUser])

  const loadLocum = useCallback(async () => {
    const authUid = userSession?.user?.id
    if (!authUid) return
    const { data } = await getUserClient()
      .from('ps_locum_profiles')
      .select('id, onboarding_complete, stripe_account_id, stripe_onboarded')
      .eq('user_id', authUid)
      .maybeSingle()
    setLocum((data as LocumSummary | null) ?? null)
    setLocumChecked(true)
  }, [userSession?.user?.id])

  useEffect(() => { loadLocum() }, [loadLocum])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeUser?.id) return
    setSaving(true)
    setMsg(null)
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
      const update = {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        full_name: fullName || activeUser.full_name,
        phone: phone.trim() || null,
        gphc_number: gphcNumber.trim() || null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await getUserClient()
        .from('ps_user_profiles')
        .update(update)
        .eq('id', activeUser.id)
      if (error) throw error
      // Keep the in-memory profile in sync
      useAuthStore.setState({ activeUser: { ...activeUser, ...update } })
      setMsg({ type: 'success', text: 'Profile updated.' })
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    await userLogout()
    navigate('/me/login', { replace: true })
  }

  /**
   * Locum is a role on this same account — the portal rides the current
   * user session. Ensure the locum store is fresh, then navigate; the
   * /locum route guards send new locums to complete-profile.
   */
  async function handleOpenLocumPortal() {
    await refreshLocumProfile()
    navigate('/locum/dashboard')
  }

  return (
    <div className="page-container" style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Account</h1>
          <p className="page-subtitle">
            {activeUser?.full_name ?? activeUser?.email ?? ''}
            {activeUser?.email ? ` · ${activeUser.email}` : ''}
          </p>
        </div>
        <button className="ps-btn ps-btn-ghost" onClick={handleSignOut}>Sign out</button>
      </div>

      {msg && <div className={`ps-alert ps-alert-${msg.type}`} style={{ marginBottom: '1rem' }}>{msg.text}</div>}

      {/* Personal details */}
      <form onSubmit={handleSave}>
        <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
          <div className="ps-card-header"><h2 className="ps-card-title">Personal Details</h2></div>
          <div className="ps-card-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">GPhC Number</label>
                <input className="form-input" type="text" value={gphcNumber} onChange={(e) => setGphcNumber(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="ps-btn ps-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>

      {/* Workplace */}
      <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ps-card-header"><h2 className="ps-card-title">🏥 Workplace</h2></div>
        <div className="ps-card-body">
          {isOrgLoggedIn && organisation ? (
            <>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                Signed in at <strong>{organisation.name}</strong>
                {membership ? ` as ${membership.role}` : ' (no active membership)'}
              </p>
              {membership && (
                <Link to="/" className="ps-btn ps-btn-primary ps-btn-sm">Go to pharmacy dashboard</Link>
              )}
            </>
          ) : (
            <>
              <p className="text-muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                Not signed in to a pharmacy. If you work at a pharmacy, sign in to its organisation account.
              </p>
              <Link to="/login/org" className="ps-btn ps-btn-ghost ps-btn-sm">Pharmacy sign in</Link>
            </>
          )}
        </div>
      </div>

      {/* Locum */}
      <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ps-card-header"><h2 className="ps-card-title">💼 Locum Work</h2></div>
        <div className="ps-card-body">
          {!locumChecked ? (
            <div className="loading-indicator">Checking…</div>
          ) : locum ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span className="ps-badge ps-badge-success">Locum profile active</span>
                {locum.stripe_onboarded ? (
                  <span className="ps-badge ps-badge-success">💰 Payments set up</span>
                ) : (
                  <span className="ps-badge ps-badge-warning">💰 Payments not set up</span>
                )}
              </div>
              <p className="text-muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                Manage shifts, invoices and payment setup in the locum portal.
                {!locum.stripe_onboarded && ' Set up payments there so pharmacies can pay you.'}
              </p>
              <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleOpenLocumPortal}>
                Open locum portal
              </button>
            </>
          ) : (
            <>
              <p className="text-muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                Work as a locum pharmacist? Locum is a role on your existing account —
                no separate sign-up. Complete a short locum profile (GPhC, indemnity,
                DBS) to browse shifts, invoice pharmacies and get paid.
              </p>
              <button className="ps-btn ps-btn-primary ps-btn-sm" onClick={handleOpenLocumPortal}>
                Become a locum
              </button>
            </>
          )}
        </div>
      </div>

      {/* Personal billing — future (Phase 6) */}
      <div className="ps-card">
        <div className="ps-card-header"><h2 className="ps-card-title">💳 Personal Billing</h2></div>
        <div className="ps-card-body">
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>
            Personal payment methods, invoices and receipts will appear here soon.
          </p>
        </div>
      </div>
    </div>
  )
}
