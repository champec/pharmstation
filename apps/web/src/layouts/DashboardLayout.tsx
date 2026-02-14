import { Outlet } from 'react-router-dom'
import { useUIStore } from '@pharmstation/core'
import { TopNav } from '../components/layout/TopNav'
import { SideNav } from '../components/layout/SideNav'
import { RightPanel } from '../components/layout/RightPanel'
import { GeniePanel } from '../components/genie/GeniePanel'

export function DashboardLayout() {
  const { sideNavMode, rightPanelOpen } = useUIStore()

  return (
    <div className="dashboard-layout">
      <SideNav />

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
