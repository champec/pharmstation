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
import { ScanQueuePage } from './pages/registers/ScanQueuePage'
// Expansion — Services
import { ServicesPage } from './pages/services/ServicesPage'
import { ServiceLibraryPage } from './pages/services/ServiceLibraryPage'
import { ServiceDetailPage } from './pages/services/ServiceDetailPage'
import { FormBuilderPage } from './pages/services/FormBuilderPage'
import { ServiceDeliveryPage } from './pages/services/ServiceDeliveryPage'
import { ServiceDeliveriesPage } from './pages/services/ServiceDeliveriesPage'
// Expansion — Appointments
import { AppointmentsCalendarPage } from './pages/appointments/AppointmentsCalendarPage'
import { AppointmentSlotsPage } from './pages/appointments/AppointmentSlotsPage'
import { NewAppointmentPage } from './pages/appointments/NewAppointmentPage'
import { AppointmentDetailPage } from './pages/appointments/AppointmentDetailPage'
// Expansion — Patients
import { PatientsPage } from './pages/patients/PatientsPage'
import { PatientDetailPage } from './pages/patients/PatientDetailPage'
// Expansion — Logs
import { LogsPage } from './pages/logs/LogsPage'
import { LogLibraryPage } from './pages/logs/LogLibraryPage'
import { LogViewPage } from './pages/logs/LogViewPage'
import { LogSettingsPage } from './pages/logs/LogSettingsPage'
import { LogBuilderPage } from './pages/logs/LogBuilderPage'
// Expansion — Video
import { VideoConsultsPage } from './pages/video/VideoConsultsPage'
import { VideoRoomPage } from './pages/video/VideoRoomPage'
// Expansion — Messaging
import { MessagingHubPage } from './pages/messaging/MessagingHubPage'
import { ComposeMessagePage } from './pages/messaging/ComposeMessagePage'
import { BroadcastsPage } from './pages/messaging/BroadcastsPage'
import { NewBroadcastPage } from './pages/messaging/NewBroadcastPage'
import { MessageHistoryPage } from './pages/messaging/MessageHistoryPage'
// Pharmacy Network (P2P)
import { NetworkHubPage } from './pages/messaging/network/NetworkHubPage'
import { NetworkComposePage } from './pages/messaging/network/NetworkComposePage'
import { NetworkMessageDetailPage } from './pages/messaging/network/NetworkMessageDetailPage'
import { NetworkOnboardingPage } from './pages/messaging/network/NetworkOnboardingPage'
import { NetworkSettingsPage } from './pages/messaging/network/NetworkSettingsPage'
// Expansion — Patient Portal
import { PatientLoginPage } from './pages/patient-portal/PatientLoginPage'
import { PatientRegisterPage } from './pages/patient-portal/PatientRegisterPage'
import { PatientAppointmentsPage } from './pages/patient-portal/PatientAppointmentsPage'
import { PatientProfilePage } from './pages/patient-portal/PatientProfilePage'
// Sticky Notes
import { NotesPage } from './pages/notes/NotesPage'
// SOP Library
import { SOPsPage } from './pages/sops/SOPsPage'
import { SOPEditorPage } from './pages/sops/SOPEditorPage'
import { SOPReadPage } from './pages/sops/SOPReadPage'
import { SOPAssignPage } from './pages/sops/SOPAssignPage'
import { SOPProgressPage } from './pages/sops/SOPProgressPage'
// Expansion — NHS
import { NHSHubPage } from './pages/nhs/NHSHubPage'
import { NHSClaimsPage } from './pages/nhs/NHSClaimsPage'
import { NHSClaimDetailPage } from './pages/nhs/NHSClaimDetailPage'
import { NHSClaimFormPage } from './pages/nhs/NHSClaimFormPage'
// Expansion — Delivery Rounds
import { DeliveryRoundDashboardPage } from './pages/delivery-rounds/DeliveryRoundDashboardPage'
import { NewDeliveryRoundPage } from './pages/delivery-rounds/NewDeliveryRoundPage'
import { DeliveryRoundDetailPage } from './pages/delivery-rounds/DeliveryRoundDetailPage'
import { EditDeliveryRoundPage } from './pages/delivery-rounds/EditDeliveryRoundPage'
import { RedeliveryQueuePage } from './pages/delivery-rounds/RedeliveryQueuePage'
import { RoundTemplatesPage } from './pages/delivery-rounds/RoundTemplatesPage'
import { RoundTemplateDetailPage } from './pages/delivery-rounds/RoundTemplateDetailPage'
// Expansion — Driver
import { DriverDashboardPage } from './pages/driver/DriverDashboardPage'
import { DriverRoutePage } from './pages/driver/DriverRoutePage'
// Expansion — Public
import { PatientVideoPage } from './pages/public/PatientVideoPage'
import { PublicBookingHomePage } from './pages/public/PublicBookingHomePage'
import { PublicOrgPage } from './pages/public/PublicOrgPage'
import { PublicServicePage } from './pages/public/PublicServicePage'
import { PublicBookingConfirmPage } from './pages/public/PublicBookingConfirmPage'
import { AboutPage } from './pages/public/AboutPage'
import { PublicPharmacyMapPage } from './pages/public/PublicPharmacyMapPage'

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
      <Route path="/maps" element={<PublicPharmacyMapPage />} />
      <Route path="/consult/:consultationId" element={<PatientVideoPage />} />
      <Route path="/book" element={<PublicBookingHomePage />} />
      <Route path="/book/:orgSlug" element={<PublicOrgPage />} />
      <Route path="/book/:orgSlug/:serviceId" element={<PublicServicePage />} />
      <Route path="/book/:orgSlug/:serviceId/confirm" element={<PublicBookingConfirmPage />} />
      <Route path="/about" element={<AboutPage />} />

      {/* Patient portal auth routes */}
      <Route path="/patient/login" element={<PatientLoginPage />} />
      <Route path="/patient/register" element={<PatientRegisterPage />} />

      {/* Patient portal protected routes */}
      <Route path="/patient/appointments" element={<PatientAppointmentsPage />} />
      <Route path="/patient/profile" element={<PatientProfilePage />} />

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

      {/* Protected routes (staff) */}
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
        <Route path="/registers/scan" element={<ScanQueuePage />} />
        <Route path="/registers/rp" element={<RPLogPage />} />
        <Route path="/registers/returns" element={<ReturnsPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Services */}
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/library" element={<ServiceLibraryPage />} />
        <Route path="/services/deliveries" element={<ServiceDeliveriesPage />} />
        <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
        <Route path="/services/:serviceId/form/:formId" element={<FormBuilderPage />} />
        <Route path="/services/:serviceId/deliver" element={<ServiceDeliveryPage />} />

        {/* NHS Services */}
        <Route path="/nhs" element={<NHSHubPage />} />
        <Route path="/nhs/claims" element={<NHSClaimsPage />} />
        <Route path="/nhs/claims/:claimId" element={<NHSClaimDetailPage />} />
        <Route path="/nhs/claim/:serviceType" element={<NHSClaimFormPage />} />

        {/* Appointments */}
        <Route path="/appointments" element={<AppointmentsCalendarPage />} />
        <Route path="/appointments/slots" element={<AppointmentSlotsPage />} />
        <Route path="/appointments/new" element={<NewAppointmentPage />} />
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />

        {/* Patients */}
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:patientId" element={<PatientDetailPage />} />

        {/* Logs */}
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/logs/library" element={<LogLibraryPage />} />
        <Route path="/logs/new" element={<LogBuilderPage />} />
        <Route path="/logs/:subscriptionId" element={<LogViewPage />} />
        <Route path="/logs/:subscriptionId/settings" element={<LogSettingsPage />} />

        {/* Video */}
        <Route path="/video" element={<VideoConsultsPage />} />
        <Route path="/video/:consultationId" element={<VideoRoomPage />} />

        {/* Messaging — Patient */}
        <Route path="/messaging" element={<MessagingHubPage />} />
        <Route path="/messaging/compose" element={<ComposeMessagePage />} />
        <Route path="/messaging/broadcasts" element={<BroadcastsPage />} />
        <Route path="/messaging/broadcasts/new" element={<NewBroadcastPage />} />
        <Route path="/messaging/history" element={<MessageHistoryPage />} />
        {/* Pharmacy Network */}
        <Route path="/messaging/network" element={<NetworkHubPage />} />
        <Route path="/messaging/network/compose" element={<NetworkComposePage />} />
        <Route path="/messaging/network/thread/:threadId" element={<NetworkMessageDetailPage />} />
        <Route path="/messaging/network/onboarding" element={<NetworkOnboardingPage />} />
        <Route path="/messaging/network/settings" element={<NetworkSettingsPage />} />

        {/* Notes */}
        <Route path="/notes" element={<NotesPage />} />

        {/* SOP Library */}
        <Route path="/sops" element={<SOPsPage />} />
        <Route path="/sops/:docId/edit" element={<SOPEditorPage />} />
        <Route path="/sops/:docId/read" element={<SOPReadPage />} />
        <Route path="/sops/:docId/assign" element={<SOPAssignPage />} />
        <Route path="/sops/:docId/progress" element={<SOPProgressPage />} />

        {/* Delivery Rounds */}
        <Route path="/delivery-rounds" element={<DeliveryRoundDashboardPage />} />
        <Route path="/delivery-rounds/new" element={<NewDeliveryRoundPage />} />
        <Route path="/delivery-rounds/redelivery" element={<RedeliveryQueuePage />} />
        <Route path="/delivery-rounds/templates" element={<RoundTemplatesPage />} />
        <Route path="/delivery-rounds/templates/:id" element={<RoundTemplateDetailPage />} />
        <Route path="/delivery-rounds/:id" element={<DeliveryRoundDetailPage />} />
        <Route path="/delivery-rounds/:id/edit" element={<EditDeliveryRoundPage />} />

        {/* Driver */}
        <Route path="/driver" element={<DriverDashboardPage />} />
        <Route path="/driver/:roundId" element={<DriverRoutePage />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
