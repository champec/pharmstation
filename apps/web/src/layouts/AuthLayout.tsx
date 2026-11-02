import { Outlet } from 'react-router-dom'
import { PublicSiteShell } from '../components/public/PublicSiteShell'

// Pharmacy, staff and personal sign-in screens sit inside the public website's header and footer.
export function AuthLayout() {
  return (
    <PublicSiteShell variant="narrow" headerActions={<></>}>
      <Outlet />
    </PublicSiteShell>
  )
}
