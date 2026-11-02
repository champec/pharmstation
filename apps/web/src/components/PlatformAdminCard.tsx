import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUserClient } from '@pharmstation/supabase-client'

/** Shown on My Account only to PharmStation platform admins. The database
 *  enforces admin access on every ps_admin_* call; this just hides the link. */
export function PlatformAdminCard() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    getUserClient().rpc('ps_is_platform_admin').then(({ data }) => setIsAdmin(data === true))
  }, [])

  if (!isAdmin) return null

  return (
    <div className="ps-card" style={{ marginBottom: '1.25rem' }}>
      <div className="ps-card-header"><h2 className="ps-card-title">🛡️ PharmStation admin</h2></div>
      <div className="ps-card-body">
        <Link to="/me/admin/pharmacies" className="ps-btn ps-btn-primary ps-btn-sm">
          Verify new pharmacies
        </Link>
      </div>
    </div>
  )
}
