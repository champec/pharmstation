import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@pharmstation/core'
import { getUserClient, listTotpFactors, logAuthEvent, removeTotpFactor, type TotpFactor } from '@pharmstation/supabase-client'
import { TotpSetup } from './TotpSetup'

/** My profile: turn two-step sign-in on or off. */
export function TwoStepCard() {
  const { membership, refreshMfaSetup } = useAuthStore()
  const [factors, setFactors] = useState<TotpFactor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adminNeedsMfa, setAdminNeedsMfa] = useState(false)
  const required = membership?.role === 'owner' || membership?.role === 'manager'

  const load = useCallback(() => {
    listTotpFactors().then(setFactors).catch(() => setFactors([]))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    // Platform admin tools only work after two-step sign-in.
    getUserClient().rpc('ps_platform_admin_needs_mfa').then(({ data }) => setAdminNeedsMfa(data === true))
  }, [factors])

  const remove = async (id: string) => {
    if (!window.confirm('Turn off two-step sign-in? Your account will only be protected by your password.')) return
    setError(null)
    try {
      await removeTotpFactor(id)
      void logAuthEvent(membership?.organisation_id, 'two_step_off')
      load()
      await refreshMfaSetup()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it.')
    }
  }

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">Two-step sign-in</h2></div>
      <div className="ps-card-body">
        <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          After your password, you&rsquo;ll also type a code from an authenticator app on your phone. Someone who
          learns your password still can&rsquo;t get in.
          {required && ' Owners and managers must use it.'}
        </p>
        {adminNeedsMfa && (
          <div className="ps-alert ps-alert-info" style={{ marginBottom: '1rem' }}>
            {factors && factors.length > 0
              ? 'Sign out and back in with your code to use the platform admin tools.'
              : 'Turn on two-step sign-in to use the platform admin tools.'}
          </div>
        )}
        {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        {factors === null ? (
          <p className="text-muted">Loading…</p>
        ) : factors.length > 0 ? (
          <>
            <div className="ps-alert ps-alert-success" style={{ marginBottom: '0.75rem' }}>Two-step sign-in is on.</div>
            {factors.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.875rem' }}>
                  Authenticator app, added {new Date(f.createdAt).toLocaleDateString('en-GB')}
                </span>
                {!required && (
                  <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" onClick={() => remove(f.id)}>
                    Turn off
                  </button>
                )}
              </div>
            ))}
          </>
        ) : (
          <TotpSetup onDone={() => { load(); void refreshMfaSetup(); void logAuthEvent(membership?.organisation_id, 'two_step_on') }} />
        )}
      </div>
    </div>
  )
}
