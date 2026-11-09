import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'

/** Shown on My Account only to PharmStation platform admins. The database
 *  enforces admin access on every ps_admin_* call; this just hides the link. */
export function LocumReviewAdminCard() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => setIsAdmin(data === true))
  }, [])

  if (!isAdmin) return null

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">Locum checks</h2></div>
      <div className="ps-card-body">
        <p style={{ marginTop: 0, color: 'var(--ps-slate)', fontSize: 'var(--ps-font-sm)' }}>
          New locums can browse shifts but can't book until you approve their documents.
        </p>
        <Link to="/me/admin/locums" className="ps-btn ps-btn-primary ps-btn-sm">
          Review locums
        </Link>
      </div>
    </div>
  )
}
