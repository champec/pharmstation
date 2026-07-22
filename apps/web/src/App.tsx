import { useEffect } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { AuthLayout } from './layouts/AuthLayout'
import { DashboardLayout } from './layouts/DashboardLayout'
import { LocumLayout } from './layouts/LocumLayout'
import { OrgLoginPage } from './pages/auth/OrgLoginPage'
import { UserLoginPage } from './pages/auth/UserLoginPage'
import { PersonalLoginPage } from './pages/auth/PersonalLoginPage'
import { PersonalProfilePage } from './pages/PersonalProfilePage'
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
import { AppointmentsListPage } from './pages/appointments/AppointmentsListPage'
import { AppointmentsCalendarPage } from './pages/appointments/AppointmentsCalendarPage'
import { AppointmentSlotsPage } from './pages/appointments/AppointmentSlotsPage'
import { AppointmentServiceSlotsPage } from './pages/appointments/AppointmentServiceSlotsPage'
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
import { NHSClaimsPage } from './pages/nhs/NHSClaimsPage'
import { NHSClaimDetailPage } from './pages/nhs/NHSClaimDetailPage'
// Expansion — NHS 111 Referrals
import { ReferralQueuePage } from './pages/nhs111/ReferralQueuePage'
import { ReferralDetailPage } from './pages/nhs111/ReferralDetailPage'
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
import { PaymentResultPage } from './pages/public/PaymentResultPage'
import { PaymentsPage } from './pages/payments/PaymentsPage'
import { AboutPage } from './pages/public/AboutPage'
import { PublicPharmacyMapPage } from './pages/public/PublicPharmacyMapPage'
import { PrivacyNoticePage } from './pages/public/PrivacyNoticePage'
import { ResourcesPage } from './pages/resources/ResourcesPage'
import { ServiceFormsPage } from './pages/resources/ServiceFormsPage'
import { PrintableFormPage } from './pages/resources/PrintableFormPage'
import { PilFinderPage } from './pages/resources/PilFinderPage'
import { PrintableLogsPage } from './pages/resources/PrintableLogsPage'
import { PrintableLogPage } from './pages/resources/PrintableLogPage'
import { OperationalToolsPage } from './pages/resources/OperationalToolsPage'
import { UsefulContactsPage } from './pages/resources/UsefulContactsPage'
import { ClosureNoticePage } from './pages/resources/ClosureNoticePage'
import { SildenafilCardsPage } from './pages/resources/SildenafilCardsPage'
// Locum Portal (external — no org context required)
import { LocumCompleteProfilePage } from './pages/locum/LocumCompleteProfilePage'
import { LocumDashboardPage } from './pages/locum/LocumDashboardPage'
import { LocumShiftsBrowsePage } from './pages/locum/LocumShiftsBrowsePage'
import { LocumBookingsPage } from './pages/locum/LocumBookingsPage'
import { LocumProfilePage } from './pages/locum/LocumProfilePage'
import { LocumInvoicesPage } from './pages/locum/LocumInvoicesPage'
import { LocumSOPsPage } from './pages/locum/LocumSOPsPage'
// PEPS — Private Electronic Prescription Service
import { PEPSQueuePage } from './pages/peps/PEPSQueuePage'
import { PEPSWritePage } from './pages/peps/PEPSWritePage'
import { PEPSMyPrescriptionsPage } from './pages/peps/PEPSMyPrescriptionsPage'
import { PEPSPrescriberSetupPage } from './pages/peps/PEPSPrescriberSetupPage'
import { PEPSPrescriptionDetailPage } from './pages/peps/PEPSPrescriptionDetailPage'
import { PEPSPrintablePrescriptionPage } from './pages/peps/PEPSPrintablePrescriptionPage'
// Shifts — Org mini-app (inside main dashboard)
import { ShiftsDashboardPage } from './pages/shifts/ShiftsDashboardPage'
import { ShiftsCalendarPage } from './pages/shifts/ShiftsCalendarPage'
import { NewShiftPage } from './pages/shifts/NewShiftPage'
import { ShiftDetailPage } from './pages/shifts/ShiftDetailPage'
import { ShiftLocumDirectoryPage } from './pages/shifts/ShiftLocumDirectoryPage'
import { ShiftSOPsPage } from './pages/shifts/ShiftSOPsPage'
import { ShiftPaymentsPage } from './pages/shifts/ShiftPaymentsPage'
// Care home management
import { CareHomeDashboardPage } from './pages/care-homes/CareHomeDashboardPage'
import { CareHomeManagePage } from './pages/care-homes/CareHomeManagePage'
import { CareHomeGroupPage } from './pages/care-homes/CareHomeGroupPage'
import { CareHomeBagPage } from './pages/care-homes/CareHomeBagPage'
import { CareHomeRequestsManagerPage } from './pages/care-homes/CareHomeRequestsManagerPage'
import { CareHomeResidentPage } from './pages/care-homes/CareHomeResidentPage'
import { CareHomeMarChartPage } from './pages/care-homes/CareHomeMarChartPage'
import { CareHomeSupplyBatchPage } from './pages/care-homes/CareHomeSupplyBatchPage'
import { CareHomePrescriptionRequestPage } from './pages/care-homes/CareHomePrescriptionRequestPage'
// Pharmacy outreach CRM
import { PharmacyOutreachPage } from './pages/outreach/PharmacyOutreachPage'

// Redirect legacy /delivery-rounds/:id links to the new /deliveries/:id route
function LegacyDeliveryRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/deliveries/${id ?? ''}`} replace />
}

export function App() {
  const { initialize, orgLoading, userLoading, isOrgLoggedIn, isUserLoggedIn, locumProfile } = useAuthStore()

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
      <Route path="/book/:orgSlug/payment-result" element={<PaymentResultPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/privacy" element={<PrivacyNoticePage />} />
      <Route path="/resources" element={<ResourcesPage />} />
      <Route path="/resources/forms" element={<ServiceFormsPage />} />
      <Route path="/resources/forms/:formSlug" element={<PrintableFormPage />} />
      <Route path="/resources/pils" element={<PilFinderPage />} />
      <Route path="/resources/logs" element={<PrintableLogsPage />} />
      <Route path="/resources/logs/:logSlug" element={<PrintableLogPage />} />
      <Route path="/resources/tools" element={<OperationalToolsPage />} />
      <Route path="/resources/tools/contacts" element={<UsefulContactsPage />} />
      <Route path="/resources/tools/closure-notice" element={<ClosureNoticePage />} />
      <Route path="/resources/tools/sildenafil-cards" element={<SildenafilCardsPage />} />

      {/* Patient portal auth routes */}
      <Route path="/patient/login" element={<PatientLoginPage />} />
      <Route path="/patient/register" element={<PatientRegisterPage />} />

      {/* Locum portal — a role on the personal account, no separate login */}
      <Route path="/locum" element={<Navigate to="/locum/dashboard" replace />} />
      <Route
        path="/locum/complete-profile"
        element={!isUserLoggedIn ? <Navigate to="/me/login" replace /> : <LocumCompleteProfilePage />}
      />

      {/* Locum portal protected routes — wrapped in LocumLayout */}
      <Route
        element={
          !isUserLoggedIn
            ? <Navigate to="/me/login" replace />
            : !locumProfile
              ? <Navigate to="/locum/complete-profile" replace />
              : <LocumLayout />
        }
      >
        <Route path="/locum/dashboard" element={<LocumDashboardPage />} />
        <Route path="/locum/shifts" element={<LocumShiftsBrowsePage />} />
        <Route path="/locum/bookings" element={<LocumBookingsPage />} />
        <Route path="/locum/profile" element={<LocumProfilePage />} />
        <Route path="/locum/invoices" element={<LocumInvoicesPage />} />
        <Route path="/locum/sops" element={<LocumSOPsPage />} />
      </Route>

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
        {/* Personal (individual-tier) login — bypasses org entirely */}
        <Route
          path="/me/login"
          element={isUserLoggedIn ? <Navigate to="/me" replace /> : <PersonalLoginPage />}
        />
      </Route>

      {/* Personal profile — needs only a user-layer session (no org) */}
      <Route
        path="/me"
        element={isUserLoggedIn ? <PersonalProfilePage /> : <Navigate to="/me/login" replace />}
      />
      <Route
        path="/me/prescriber"
        element={isUserLoggedIn ? <PEPSPrescriberSetupPage /> : <Navigate to="/me/login" replace />}
      />
      <Route
        path="/peps/:id/print"
        element={
          !isOrgLoggedIn
            ? <Navigate to="/login/org" replace />
            : !isUserLoggedIn
              ? <Navigate to="/login/user" replace />
              : <PEPSPrintablePrescriptionPage />
        }
      />

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
        <Route path="/outreach" element={<PharmacyOutreachPage />} />

        {/* Payments */}
        <Route path="/payments" element={<PaymentsPage />} />

        {/* Services */}
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/library" element={<ServiceLibraryPage />} />
        <Route path="/services/deliveries" element={<ServiceDeliveriesPage />} />
        <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
        <Route path="/services/:serviceId/form/:formId" element={<FormBuilderPage />} />
        <Route path="/services/:serviceId/deliver" element={<ServiceDeliveryPage />} />

        {/* NHS Claims */}
        <Route path="/services/claims" element={<NHSClaimsPage />} />
        <Route path="/services/claims/:claimId" element={<NHSClaimDetailPage />} />

        {/* NHS 111 Referrals */}
        <Route path="/services/111-referrals" element={<ReferralQueuePage />} />
        <Route path="/services/111-referrals/:referralId" element={<ReferralDetailPage />} />

        {/* Appointments */}
        <Route path="/appointments" element={<AppointmentsListPage />} />
        <Route path="/appointments/calendar" element={<AppointmentsCalendarPage />} />
        <Route path="/appointments/slots" element={<AppointmentSlotsPage />} />
        <Route path="/appointments/slots/:serviceId" element={<AppointmentServiceSlotsPage />} />
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

        {/* Deliveries */}
        <Route path="/deliveries" element={<DeliveryRoundDashboardPage />} />
        <Route path="/deliveries/new" element={<NewDeliveryRoundPage />} />
        <Route path="/deliveries/redelivery" element={<RedeliveryQueuePage />} />
        <Route path="/deliveries/templates" element={<RoundTemplatesPage />} />
        <Route path="/deliveries/templates/:id" element={<RoundTemplateDetailPage />} />
        <Route path="/deliveries/:id" element={<DeliveryRoundDetailPage />} />
        <Route path="/deliveries/:id/edit" element={<EditDeliveryRoundPage />} />
        {/* Legacy redirects from the old "delivery-rounds" paths */}
        <Route path="/delivery-rounds" element={<Navigate to="/deliveries" replace />} />
        <Route path="/delivery-rounds/new" element={<Navigate to="/deliveries/new" replace />} />
        <Route path="/delivery-rounds/redelivery" element={<Navigate to="/deliveries/redelivery" replace />} />
        <Route path="/delivery-rounds/templates" element={<Navigate to="/deliveries/templates" replace />} />
        <Route path="/delivery-rounds/:id" element={<LegacyDeliveryRedirect />} />

        {/* Driver */}
        <Route path="/driver" element={<DriverDashboardPage />} />
        <Route path="/driver/:roundId" element={<DriverRoutePage />} />

        {/* PEPS — Private Electronic Prescription Service */}
        <Route path="/peps" element={<PEPSQueuePage />} />
        <Route path="/peps/write" element={<PEPSWritePage />} />
        <Route path="/peps/mine" element={<PEPSMyPrescriptionsPage />} />
        <Route path="/peps/prescriber" element={<Navigate to="/me/prescriber" replace />} />
        <Route path="/peps/:id" element={<PEPSPrescriptionDetailPage />} />

        {/* Shifts — org shift management mini-app */}
        <Route path="/shifts" element={<ShiftsDashboardPage />} />
        <Route path="/shifts/calendar" element={<ShiftsCalendarPage />} />
        <Route path="/shifts/new" element={<NewShiftPage />} />
        <Route path="/shifts/locums" element={<ShiftLocumDirectoryPage />} />
        <Route path="/shifts/sops" element={<ShiftSOPsPage />} />
        <Route path="/shifts/payments" element={<ShiftPaymentsPage />} />
        <Route path="/shifts/:id" element={<ShiftDetailPage />} />

        {/* Care home management */}
        <Route path="/care-homes" element={<CareHomeDashboardPage />} />
        <Route path="/care-homes/manage" element={<CareHomeManagePage />} />
        <Route path="/care-homes/manage/:linkId" element={<CareHomeManagePage />} />
        <Route path="/care-homes/:linkId/groups/:groupId" element={<CareHomeGroupPage />} />
        <Route path="/care-homes/:linkId/groups/:groupId/bags/:bagId" element={<CareHomeBagPage />} />
        <Route path="/care-homes/:linkId/requests" element={<CareHomeRequestsManagerPage />} />
        <Route path="/care-homes/:linkId/residents/:residentId" element={<CareHomeResidentPage />} />
        <Route path="/care-homes/:linkId/mar/:cycleId" element={<CareHomeMarChartPage />} />
        <Route path="/care-homes/:linkId/supplies/:batchId" element={<CareHomeSupplyBatchPage />} />
        <Route path="/care-homes/supplies/:batchId" element={<CareHomeSupplyBatchPage />} />
        <Route path="/care-homes/:linkId/prescriptions/:requestId" element={<CareHomePrescriptionRequestPage />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
