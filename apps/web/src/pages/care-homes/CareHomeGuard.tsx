import { Outlet, useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuthStore } from '@pharmstation/core'
import { EmptyState } from '../../components/ui/EmptyState'

/** Care home pages need the care_home_view permission (all care home logins have it). */
export function CareHomeGuard() {
  const navigate = useNavigate()
  const permissions = useAuthStore((s) => s.permissions)
  if (permissions && permissions.care_home_view !== true) {
    return (
      <EmptyState
        icon={Lock}
        title="You don't have access to care homes"
        actions={<button className="ps-btn ps-btn-primary" type="button" onClick={() => navigate('/')}>Back to dashboard</button>}
      >
        Ask your pharmacy owner or manager to turn on care home access for your account in Team settings.
      </EmptyState>
    )
  }
  return <Outlet />
}
