import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useUIStore } from '@pharmstation/core'
import { TopNav } from '../components/layout/TopNav'
import { SideNav } from '../components/layout/SideNav'
import { RightPanel } from '../components/layout/RightPanel'
import { GeniePanel } from '../components/genie/GeniePanel'
import { useIsMobile } from '../hooks/useIsMobile'

export function DashboardLayout() {
  const { sideNavMode, rightPanelOpen, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const isMobile = useIsMobile()
  const location = useLocation()

  // Close the mobile drawer after navigating, or when the screen grows past the breakpoint
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, location.search, isMobile, setMobileNavOpen])

  return (
    <div className="dashboard-layout">
      <SideNav />

      {isMobile && mobileNavOpen && (
        <div className="side-nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      <div className="dashboard-main" data-sidenav={sideNavMode}>
        <TopNav />
        <div className="dashboard-content">
          <Outlet />
        </div>
      </div>

      {rightPanelOpen && <RightPanel />}
      <GeniePanel />
    </div>
  )
}
