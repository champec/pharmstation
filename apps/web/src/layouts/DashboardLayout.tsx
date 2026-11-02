import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useUIStore, useAuthStore, useSubscriptionStore } from '@pharmstation/core'
import { TopNav } from '../components/layout/TopNav'
import { SideNav } from '../components/layout/SideNav'
import { RightPanel } from '../components/layout/RightPanel'
import { GeniePanel } from '../components/genie/GeniePanel'
import { PlanGate } from '../components/billing/PlanGate'

export function DashboardLayout() {
  const { sideNavMode, rightPanelOpen } = useUIStore()
  const orgId = useAuthStore((s) => s.organisation?.id)
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription)

  // Load the organisation's plan once per org, for feature gating.
  useEffect(() => {
    if (orgId) fetchSubscription(orgId)
  }, [orgId, fetchSubscription])

  return (
    <div className="dashboard-layout">
      <SideNav />

      <div className="dashboard-main" data-sidenav={sideNavMode}>
        <TopNav />
        <div className="dashboard-content">
          <PlanGate>
            <Outlet />
          </PlanGate>
        </div>
      </div>

      {rightPanelOpen && <RightPanel />}
      <GeniePanel />
    </div>
  )
}
