import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminListDeletionRequests,
  adminSetDeletionRequest,
  getUserClient,
  type DeletionRequest,
} from '@pharmstation/supabase-client'

/** Shown on My Account only to PharmStation platform admins. The database
 *  enforces admin access on every ps_admin_* call; this just hides the link. */
export function PlatformAdminCard() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [requests, setRequests] = useState<DeletionRequest[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadRequests = useCallback(() => {
    adminListDeletionRequests().then(setRequests).catch(() => setRequests([]))
  }, [])

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data === true) loadRequests()
    })
  }, [loadRequests])

  const handle = async (r: DeletionRequest, status: 'done' | 'declined') => {
    const note = status === 'declined'
      ? window.prompt('Why can’t this be done? The person will see this.')
      : window.prompt('Optional note (e.g. what was removed or kept)') ?? ''
    if (status === 'declined' && !note) return
    setBusyId(r.id)
    try {
      await adminSetDeletionRequest(r.id, status, note ?? undefined)
      loadRequests()
    } finally {
      setBusyId(null)
    }
  }

  if (!isAdmin) return null

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">🛡️ PharmStation admin</h2></div>
      <div className="ps-card-body">
        <Link to="/me/admin/pharmacies" className="ps-btn ps-btn-primary ps-btn-sm">
          Verify new pharmacies
        </Link>
        <Link to="/me/admin/announcements" className="ps-btn ps-btn-secondary ps-btn-sm" style={{ marginLeft: '0.5rem' }}>
          App announcements
        </Link>

        <h3 style={{ margin: '1.25rem 0 0.5rem', fontSize: '1rem' }}>Account deletion requests</h3>
        {requests.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>None waiting.</p>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
              Delete the person in Supabase Auth, keeping CD register and RP log entries (they stay attributed),
              then mark it done. Aim for within 30 days.
            </p>
            {requests.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.4rem 0', borderBottom: '1px solid var(--ps-border, #e2e8f0)', fontSize: '0.875rem' }}>
                <span style={{ flex: '1 1 14rem' }}>
                  <strong>{r.email}</strong> · {new Date(r.created_at).toLocaleDateString('en-GB')}
                  {r.reason && <span className="text-muted"> · “{r.reason}”</span>}
                </span>
                <button type="button" className="ps-btn ps-btn-secondary ps-btn-sm" disabled={busyId === r.id} onClick={() => handle(r, 'done')}>
                  Mark done
                </button>
                <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === r.id} onClick={() => handle(r, 'declined')}>
                  Decline
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
