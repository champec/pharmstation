import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Link } from 'react-router-dom'
import {
  adminListDeletionRequests,
  adminCompleteAccountDeletion,
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

  const [error, setError] = useState<string | null>(null)

  // The request being deleted or declined, shown in a modal.
  const [pending, setPending] = useState<{ r: DeletionRequest; status: 'done' | 'declined' } | null>(null)
  const [note, setNote] = useState('')

  const open = (r: DeletionRequest, status: 'done' | 'declined') => {
    setNote('')
    setError(null)
    setPending({ r, status })
  }

  const confirm = async () => {
    if (!pending) return
    const { r, status } = pending
    if (status === 'declined' && !note.trim()) return setError('Say why, so the person knows.')
    setBusyId(r.id)
    setError(null)
    try {
      if (status === 'done') await adminCompleteAccountDeletion(r.id, note.trim() || undefined)
      else await adminSetDeletionRequest(r.id, status, note.trim())
      setPending(null)
      loadRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.')
    } finally {
      setBusyId(null)
    }
  }

  if (!isAdmin) return null

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">PharmStation admin</h2></div>
      <div className="ps-card-body">
        <Link to="/me/admin/pharmacies" className="ps-btn ps-btn-primary ps-btn-sm">
          Verify new pharmacies
        </Link>
        <Link to="/me/admin/announcements" className="ps-btn ps-btn-secondary ps-btn-sm" style={{ marginLeft: '0.5rem' }}>
          App announcements
        </Link>
        <Link to="/me/admin/support" className="ps-btn ps-btn-secondary ps-btn-sm" style={{ marginLeft: '0.5rem' }}>
          Support inbox
        </Link>
        <Link to="/me/admin/monitoring" className="ps-btn ps-btn-secondary ps-btn-sm" style={{ marginLeft: '0.5rem' }}>
          Monitoring
        </Link>
        <Link to="/me/admin/activity" className="ps-btn ps-btn-secondary ps-btn-sm" style={{ marginLeft: '0.5rem' }}>
          Activity log
        </Link>

        <h3 style={{ margin: '1.25rem 0 0.5rem', fontSize: '1rem' }}>Account deletion requests</h3>
        {error && <div className="ps-alert ps-alert-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
        {requests.length === 0 ? (
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>None waiting.</p>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
              Deleting removes the person&rsquo;s sign-in and personal details. Registers and logs they made stay,
              under &ldquo;Deleted user&rdquo;. Aim for within 30 days.
            </p>
            {requests.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.4rem 0', borderBottom: '1px solid var(--ps-border, #e2e8f0)', fontSize: '0.875rem' }}>
                <span style={{ flex: '1 1 14rem' }}>
                  <strong>{r.email}</strong> · {new Date(r.created_at).toLocaleDateString('en-GB')}
                  {r.reason && <span className="text-muted"> · “{r.reason}”</span>}
                </span>
                <button type="button" className="ps-btn ps-btn-secondary ps-btn-sm" disabled={busyId === r.id} onClick={() => open(r, 'done')}>
                  Delete account
                </button>
                <button type="button" className="ps-btn ps-btn-ghost ps-btn-sm" disabled={busyId === r.id} onClick={() => open(r, 'declined')}>
                  Decline
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      <Modal
        isOpen={!!pending}
        onClose={() => setPending(null)}
        title={pending?.status === 'done' ? 'Delete this account?' : 'Decline this request?'}
        width="480px"
      >
        {pending && (
          <>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {pending.status === 'done'
                ? <>The sign-in and personal details of <strong>{pending.r.email ?? 'this person'}</strong> are removed for good. Registers and logs they made stay, under &ldquo;Deleted user&rdquo;.</>
                : <>Tell <strong>{pending.r.email ?? 'the person'}</strong> why their account can&rsquo;t be deleted. They&rsquo;ll see this note.</>}
            </p>
            <label htmlFor="deletion-note" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              {pending.status === 'done' ? 'Note for the record (optional)' : 'Reason'}
            </label>
            <textarea id="deletion-note" className="ps-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', marginTop: '0.25rem' }} />
            {error && <div className="ps-alert ps-alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="ps-btn ps-btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              <button
                type="button"
                className={pending.status === 'done' ? 'ps-btn ps-btn-danger' : 'ps-btn ps-btn-primary'}
                disabled={busyId === pending.r.id}
                onClick={confirm}
              >
                {busyId === pending.r.id ? 'Working…' : pending.status === 'done' ? 'Delete account' : 'Decline request'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
