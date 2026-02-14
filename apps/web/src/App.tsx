import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { AuthLayout } from './layouts/AuthLayout'
import { DashboardLayout } from './layouts/DashboardLayout'
import { OrgLoginPage } from './pages/auth/OrgLoginPage'
import { UserLoginPage } from './pages/auth/UserLoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { RegistersPage } from './pages/registers/RegistersPage'
import { CDRegisterPage } from './pages/registers/CDRegisterPage'
import { CDLedgerPage } from './pages/registers/CDLedgerPage'
import { RPLogPage } from './pages/registers/RPLogPage'
import { ReturnsPage } from './pages/registers/ReturnsPage'
import { SettingsPage } from './pages/SettingsPage'
import { RPCertificatePage } from './pages/public/RPCertificatePage'

export function App() {
  const { initialize, orgLoading, userLoading, isOrgLoggedIn, isUserLoggedIn } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  // Show loading while restoring sessions
  if (orgLoading || userLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading PharmStation...</p>
      </div>
    )
  }

  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/rp" element={<RPCertificatePage />} />

      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route
          path="/login/org"
          element={isOrgLoggedIn ? <Navigate to="/login/user" replace /> : <OrgLoginPage />}
        />
        <Route
          path="/login/user"
          element={
            !isOrgLoggedIn ? (
              <Navigate to="/login/org" replace />
            ) : isUserLoggedIn ? (
              <Navigate to="/" replace />
            ) : (
              <UserLoginPage />
            )
          }
        />
      </Route>

      {/* Protected routes */}
      <Route
        element={
          !isOrgLoggedIn ? (
            <Navigate to="/login/org" replace />
          ) : !isUserLoggedIn ? (
            <Navigate to="/login/user" replace />
          ) : (
            <DashboardLayout />
          )
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/registers" element={<RegistersPage />} />
        <Route path="/registers/cd" element={<CDRegisterPage />} />
        <Route path="/registers/cd/:drugId" element={<CDLedgerPage />} />
        <Route path="/registers/rp" element={<RPLogPage />} />
        <Route path="/registers/returns" element={<ReturnsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
