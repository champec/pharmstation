# Agent 0 — Foundation & Scaffolding

> **Wave:** 1 (MUST run first — all other agents depend on this)
> **Prerequisite:** None
> **Base plan:** `documentation/expansion/expansion-plan.md`

This agent sets up all cross-cutting infrastructure: new database tables, patient auth, shared types, and the route/nav scaffolding that other agents will fill in. **No feature UI is built here** — only the skeleton that unblocks all downstream agents.

---

## Scope Summary

1. Create the `ps_patients` table migration
2. Add `slug`, `is_public`, `public_description`, `public_logo_url` columns to `ps_organisations`
3. Update the auth trigger to handle `account_type = 'patient'`
4. Create the patient Supabase client (`patientClient`) in `@pharmstation/supabase-client`
5. Create the `usePatientStore` Zustand store in `@pharmstation/core`
6. Add **ALL** new types for **ALL** phases to `@pharmstation/types` (so downstream agents never conflict on this file)
7. Scaffold **ALL** new routes in `App.tsx` pointing to placeholder page components
8. Scaffold **ALL** new SideNav sections
9. Create placeholder page components for every new route (empty shells that say "Coming soon")

---

## 1. Database Migration: `ps_patients`

Create file: `supabase/migrations/20260219_patients.sql`

```sql
-- ===========================================
-- PharmStation: Patients table
-- ===========================================

CREATE TABLE ps_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date,
  nhs_number text,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT ps_patients_nhs_unique UNIQUE NULLS NOT DISTINCT (nhs_number, organisation_id)
);

-- Indexes
CREATE INDEX idx_patients_org ON ps_patients(organisation_id);
CREATE INDEX idx_patients_auth ON ps_patients(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX idx_patients_name ON ps_patients(organisation_id, last_name, first_name);
CREATE INDEX idx_patients_phone ON ps_patients(organisation_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_patients_nhs ON ps_patients(nhs_number) WHERE nhs_number IS NOT NULL;

-- RLS
ALTER TABLE ps_patients ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's patients
CREATE POLICY "org_members_read_patients"
  ON ps_patients FOR SELECT
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Org members can insert patients for their org
CREATE POLICY "org_members_insert_patients"
  ON ps_patients FOR INSERT
  WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Org members can update their org's patients
CREATE POLICY "org_members_update_patients"
  ON ps_patients FOR UPDATE
  USING (organisation_id IN (SELECT ps_get_user_org_ids()));

-- Patients can read their own record
CREATE POLICY "patients_read_own"
  ON ps_patients FOR SELECT
  USING (auth_user_id = auth.uid());

-- Patients can update their own record
CREATE POLICY "patients_update_own"
  ON ps_patients FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER ps_patients_updated_at
  BEFORE UPDATE ON ps_patients
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

## 2. Database Migration: Org Public Profile

Create file: `supabase/migrations/20260219_org_public_profile.sql`

```sql
-- ===========================================
-- PharmStation: Organisation public profile columns
-- ===========================================

ALTER TABLE ps_organisations
  ADD COLUMN slug text,
  ADD COLUMN is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN public_description text,
  ADD COLUMN public_logo_url text;

-- Slug must be unique and URL-safe where set
CREATE UNIQUE INDEX idx_org_slug ON ps_organisations(slug) WHERE slug IS NOT NULL;

-- Public orgs are queryable by anon users
CREATE POLICY "anon_read_public_orgs"
  ON ps_organisations FOR SELECT
  USING (is_public = true);
```

> **Note:** The existing RLS on `ps_organisations` only allows org members to read their own org. This new policy adds anon read for public orgs. Check existing RLS doesn't conflict — the existing policy uses `auth_user_id = auth.uid()` which is for the org's own auth user. The new policy is additive (OR logic in Postgres RLS).

---

## 3. Update Auth Trigger

Edit `supabase/migrations/20260213_002_auth_trigger.sql` — or better, create an additive migration:

Create file: `supabase/migrations/20260219_patient_auth_trigger.sql`

```sql
-- ===========================================
-- PharmStation: Extend auth trigger for patient accounts
-- ===========================================

CREATE OR REPLACE FUNCTION public.ps_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  acct_type text;
BEGIN
  acct_type := COALESCE(NEW.raw_user_meta_data->>'account_type', 'user');

  IF acct_type = 'organisation' THEN
    INSERT INTO ps_organisations (auth_user_id, name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'org_name', 'New Pharmacy'));
  ELSIF acct_type = 'patient' THEN
    INSERT INTO ps_patients (auth_user_id, organisation_id, first_name, last_name, email, phone)
    VALUES (
      NEW.id,
      (NEW.raw_user_meta_data->>'organisation_id')::uuid,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email,
      NEW.phone
    );
  ELSE
    INSERT INTO ps_user_profiles (id, full_name, email)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  END IF;

  RETURN NEW;
END;
$$;
```

> **Important:** Read the existing trigger function in `20260213_002_auth_trigger.sql` first. This `CREATE OR REPLACE` overwrites it. Ensure you preserve ALL existing logic (org branch, user branch) and just add the patient branch. The above is a reference — adapt to match the actual existing trigger body exactly.

---

## 4. Patient Supabase Client

Edit: `packages/supabase-client/src/index.ts`

Add alongside the existing `orgClient` and `userClient`:

```typescript
// --- Patient client (third session, for patient-facing auth) ---
let patientClient: SupabaseClient | null = null

export function getPatientClient(): SupabaseClient {
  if (!patientClient) throw new Error('Supabase not initialised')
  return patientClient
}

// Add to initSupabase():
patientClient = createClient(url, anonKey, {
  auth: {
    storageKey: 'ps-patient-session',
    autoRefreshToken: true,
    persistSession: true,
  },
})

// New exports
export async function patientSignIn(email: string, password: string) {
  const { data, error } = await getPatientClient().auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function patientSignUp(
  email: string,
  password: string,
  metadata: { first_name: string; last_name: string; organisation_id: string; account_type: 'patient' }
) {
  const { data, error } = await getPatientClient().auth.signUp({
    email,
    password,
    options: { data: metadata },
  })
  if (error) throw error
  return data
}

export async function patientSignOut() {
  const { error } = await getPatientClient().auth.signOut()
  if (error) throw error
}

export async function fetchPatientProfile(authUserId: string) {
  const { data, error } = await getPatientClient()
    .from('ps_patients')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single()
  if (error) throw error
  return data
}
```

---

## 5. Zustand Store: `usePatientStore`

Create: `packages/core/src/stores/patient-store.ts`

```typescript
import { create } from 'zustand'
import type { Patient } from '@pharmstation/types'
import {
  getPatientClient,
  patientSignIn,
  patientSignUp,
  patientSignOut,
  fetchPatientProfile,
} from '@pharmstation/supabase-client'

export interface PatientState {
  patient: Patient | null
  loading: boolean
  isLoggedIn: boolean

  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, metadata: {
    first_name: string
    last_name: string
    organisation_id: string
  }) => Promise<void>
  logout: () => Promise<void>
}

export const usePatientStore = create<PatientState>((set) => ({
  patient: null,
  loading: true,
  isLoggedIn: false,

  initialize: async () => {
    try {
      const { data: { session } } = await getPatientClient().auth.getSession()
      if (session?.user) {
        const profile = await fetchPatientProfile(session.user.id)
        set({ patient: profile as Patient, isLoggedIn: true, loading: false })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  login: async (email, password) => {
    const data = await patientSignIn(email, password)
    if (data.user) {
      const profile = await fetchPatientProfile(data.user.id)
      set({ patient: profile as Patient, isLoggedIn: true })
    }
  },

  register: async (email, password, metadata) => {
    await patientSignUp(email, password, { ...metadata, account_type: 'patient' })
    // After signup, auto-login
    const data = await patientSignIn(email, password)
    if (data.user) {
      const profile = await fetchPatientProfile(data.user.id)
      set({ patient: profile as Patient, isLoggedIn: true })
    }
  },

  logout: async () => {
    await patientSignOut()
    set({ patient: null, isLoggedIn: false })
  },
}))
```

Export from `packages/core/src/index.ts`:

```typescript
export { usePatientStore, type PatientState } from './stores/patient-store'
```

---

## 6. ALL New Types

Add the following to `packages/types/src/index.ts` at the bottom. **All types for all phases** go here so that downstream agents never touch this file.

```typescript
// ============================================
// Expansion Types — Patients
// ============================================

export interface Patient {
  id: string
  auth_user_id: string | null
  organisation_id: string
  first_name: string
  last_name: string
  dob: string | null
  nhs_number: string | null
  email: string | null
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  postcode: string | null
  created_at: string
  updated_at: string
}

// ============================================
// Expansion Types — Services & Service Forms
// ============================================

export interface ServiceLibraryItem {
  id: string
  name: string
  description: string
  category: string
  is_active: boolean
  created_at: string
}

export interface Service {
  id: string
  org_id: string
  library_service_id: string | null
  name: string
  description: string
  is_active: boolean
  is_public: boolean
  duration_minutes: number
  created_at: string
}

export interface ServiceForm {
  id: string
  service_id: string
  name: string
  is_default: boolean
  version: number
  created_at: string
  fields?: ServiceFormField[]
}

export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'textarea'
  | 'signature'
  | 'canvas'

export interface ServiceFormField {
  id: string
  form_id: string
  label: string
  field_key: string
  field_type: FieldType
  options: Record<string, unknown> | null
  is_required: boolean
  display_order: number
}

// ============================================
// Expansion Types — Appointments
// ============================================

export interface AppointmentSlot {
  id: string
  org_id: string
  service_id: string
  start_time: string
  end_time: string
  max_bookings: number
  booked_count: number
  is_recurring: boolean
  recurrence_rule: string | null
  is_active: boolean
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

export interface Appointment {
  id: string
  slot_id: string
  org_id: string
  service_id: string
  patient_id: string
  form_id: string
  form_data: Record<string, unknown>
  status: AppointmentStatus
  notes: string | null
  booked_by_user_id: string | null
  created_at: string
  // Joined
  patient?: Patient
  service?: Service
  slot?: AppointmentSlot
}

// ============================================
// Expansion Types — Logs
// ============================================

export type LogCategory = 'cleaning' | 'fridge' | 'cd' | 'visitor' | 'date_check' | 'custom'
export type LogScheduleType = 'daily' | 'custom_days' | 'sporadic'

export interface LogTemplate {
  id: string
  org_id: string | null
  title: string
  description: string
  category: LogCategory
  schedule_type: LogScheduleType
  required_days: number[]
  is_library: boolean
  version: number
  created_at: string
  fields?: LogField[]
}

export interface LogField {
  id: string
  template_id: string
  label: string
  field_key: string
  field_type: FieldType  // reuses the same FieldType from service forms
  options: Record<string, unknown> | null
  is_required: boolean
  display_order: number
  column_width: string | null
}

export interface LogSubscription {
  id: string
  org_id: string
  template_id: string
  custom_title: string | null
  custom_fields: Record<string, unknown> | null
  is_active: boolean
  subscribed_at: string
  template?: LogTemplate
}

export interface LogEntry {
  id: string
  subscription_id: string
  org_id: string
  entry_date: string
  data: Record<string, unknown>
  entered_by_user_id: string
  created_at: string
  entered_by_profile?: UserProfile
}

// ============================================
// Expansion Types — Video Consultations
// ============================================

export type VideoConsultationStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export interface VideoConsultation {
  id: string
  org_id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string | null
  daily_room_name: string
  daily_room_url: string
  org_token: string
  patient_token: string
  patient_access_code: string
  status: VideoConsultationStatus
  appointment_id: string | null
  scheduled_for: string
  started_at: string | null
  ended_at: string | null
  created_at: string
  // Joined
  patient?: Patient
  appointment?: Appointment
}

// ============================================
// Expansion Types — Messaging (NHS Notify)
// ============================================

export type MessageChannel = 'sms' | 'letter' | 'email'
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed'
export type BroadcastStatus = 'draft' | 'sending' | 'sent' | 'failed'

export interface NotifySettings {
  id: string
  org_id: string
  api_key: string  // server-side only — client should never receive this
  sms_template_ids: Record<string, string>
  letter_template_ids: Record<string, string>
  is_active: boolean
  created_at: string
}

export interface Message {
  id: string
  org_id: string
  patient_id: string | null
  recipient_phone: string | null
  recipient_address: Record<string, string> | null
  channel: MessageChannel
  template_id: string
  personalisation: Record<string, unknown>
  status: MessageStatus
  notify_message_id: string | null
  sent_at: string | null
  created_by_user_id: string
  created_at: string
  // Joined
  patient?: Patient
}

export interface Broadcast {
  id: string
  org_id: string
  name: string
  channel: MessageChannel
  template_id: string
  personalisation_template: Record<string, unknown>
  recipient_filter: Record<string, unknown>
  status: BroadcastStatus
  total_count: number
  sent_count: number
  created_at: string
  created_by_user_id: string
}
```

---

## 7. Route Scaffolding in `App.tsx`

**CRITICAL:** This agent adds ALL new routes to `App.tsx` with placeholder components. Downstream agents then replace the placeholder implementations with real ones. This prevents multiple agents from editing `App.tsx`.

Add these imports and routes. The structure must be:

```tsx
// New imports (add after existing imports)
import { ServicesPage } from './pages/services/ServicesPage'
import { ServiceLibraryPage } from './pages/services/ServiceLibraryPage'
import { ServiceDetailPage } from './pages/services/ServiceDetailPage'
import { FormBuilderPage } from './pages/services/FormBuilderPage'
import { AppointmentsCalendarPage } from './pages/appointments/AppointmentsCalendarPage'
import { AppointmentSlotsPage } from './pages/appointments/AppointmentSlotsPage'
import { NewAppointmentPage } from './pages/appointments/NewAppointmentPage'
import { AppointmentDetailPage } from './pages/appointments/AppointmentDetailPage'
import { PatientsPage } from './pages/patients/PatientsPage'
import { PatientDetailPage } from './pages/patients/PatientDetailPage'
import { LogsPage } from './pages/logs/LogsPage'
import { LogLibraryPage } from './pages/logs/LogLibraryPage'
import { LogViewPage } from './pages/logs/LogViewPage'
import { LogSettingsPage } from './pages/logs/LogSettingsPage'
import { LogBuilderPage } from './pages/logs/LogBuilderPage'
import { VideoConsultsPage } from './pages/video/VideoConsultsPage'
import { VideoRoomPage } from './pages/video/VideoRoomPage'
import { MessagingHubPage } from './pages/messaging/MessagingHubPage'
import { ComposeMessagePage } from './pages/messaging/ComposeMessagePage'
import { BroadcastsPage } from './pages/messaging/BroadcastsPage'
import { NewBroadcastPage } from './pages/messaging/NewBroadcastPage'
import { MessageHistoryPage } from './pages/messaging/MessageHistoryPage'
// Public routes
import { PatientLoginPage } from './pages/patient-portal/PatientLoginPage'
import { PatientRegisterPage } from './pages/patient-portal/PatientRegisterPage'
import { PatientAppointmentsPage } from './pages/patient-portal/PatientAppointmentsPage'
import { PatientProfilePage } from './pages/patient-portal/PatientProfilePage'
import { PatientVideoPage } from './pages/public/PatientVideoPage'
import { PublicBookingHomePage } from './pages/public/PublicBookingHomePage'
import { PublicOrgPage } from './pages/public/PublicOrgPage'
import { PublicServicePage } from './pages/public/PublicServicePage'
import { PublicBookingConfirmPage } from './pages/public/PublicBookingConfirmPage'
```

Add these route blocks inside `<Routes>`:

```tsx
{/* Public routes — no auth required */}
<Route path="/rp" element={<RPCertificatePage />} />
<Route path="/consult/:consultationId" element={<PatientVideoPage />} />
<Route path="/book" element={<PublicBookingHomePage />} />
<Route path="/book/:orgSlug" element={<PublicOrgPage />} />
<Route path="/book/:orgSlug/:serviceId" element={<PublicServicePage />} />
<Route path="/book/:orgSlug/:serviceId/confirm" element={<PublicBookingConfirmPage />} />

{/* Patient portal auth routes */}
<Route path="/patient/login" element={<PatientLoginPage />} />
<Route path="/patient/register" element={<PatientRegisterPage />} />

{/* Patient portal protected routes (TODO: add PatientLayout with patient auth guard) */}
<Route path="/patient/appointments" element={<PatientAppointmentsPage />} />
<Route path="/patient/profile" element={<PatientProfilePage />} />

{/* Protected routes (staff) */}
<Route element={/* existing auth guard */}>
  {/* ... existing routes ... */}
  
  {/* Services */}
  <Route path="/services" element={<ServicesPage />} />
  <Route path="/services/library" element={<ServiceLibraryPage />} />
  <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
  <Route path="/services/:serviceId/form/:formId" element={<FormBuilderPage />} />
  
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
  
  {/* Messaging */}
  <Route path="/messaging" element={<MessagingHubPage />} />
  <Route path="/messaging/compose" element={<ComposeMessagePage />} />
  <Route path="/messaging/broadcasts" element={<BroadcastsPage />} />
  <Route path="/messaging/broadcasts/new" element={<NewBroadcastPage />} />
  <Route path="/messaging/history" element={<MessageHistoryPage />} />
</Route>
```

---

## 8. SideNav Scaffolding

Edit `apps/web/src/components/layout/SideNav.tsx`. Replace the `menuSections` array with the full expanded version:

```typescript
const menuSections: NavSection[] = [
  {
    title: '',
    items: [{ to: '/', icon: '📊', label: 'Dashboard' }],
  },
  {
    title: 'Registers',
    icon: '📑',
    to: '/registers',
    expandable: true,
    items: [
      { to: '/registers/cd', icon: '💊', label: 'CD Register' },
      { to: '/registers/scan', icon: '📸', label: 'AI Scan' },
      { to: '/registers/rp', icon: '👤', label: 'RP Log' },
      { to: '/registers/returns', icon: '↩', label: 'Returns' },
    ],
  },
  {
    title: 'Services',
    icon: '🩺',
    expandable: true,
    items: [
      { to: '/services', icon: '📋', label: 'Services' },
      { to: '/services/library', icon: '📚', label: 'Library' },
    ],
  },
  {
    title: 'Appointments',
    icon: '📅',
    expandable: true,
    items: [
      { to: '/appointments', icon: '📅', label: 'Calendar' },
      { to: '/appointments/slots', icon: '⏰', label: 'Slots' },
      { to: '/patients', icon: '👥', label: 'Patients' },
    ],
  },
  {
    title: 'Logs',
    icon: '📓',
    expandable: true,
    items: [
      { to: '/logs', icon: '📓', label: 'My Logs' },
      { to: '/logs/library', icon: '📚', label: 'Log Library' },
    ],
  },
  {
    title: 'Video',
    icon: '📹',
    expandable: false,
    items: [
      { to: '/video', icon: '📹', label: 'Video Consults' },
    ],
  },
  {
    title: 'Messaging',
    icon: '💬',
    expandable: true,
    items: [
      { to: '/messaging', icon: '💬', label: 'Hub' },
      { to: '/messaging/compose', icon: '✏️', label: 'Compose' },
      { to: '/messaging/broadcasts', icon: '📢', label: 'Broadcasts' },
    ],
  },
  {
    title: 'Utilities',
    icon: '🛠',
    expandable: true,
    items: [
      { to: '/handover', icon: '📌', label: 'Handover Notes' },
      { to: '/sops', icon: '📋', label: 'SOPs' },
    ],
  },
]
```

---

## 9. Placeholder Page Components

Create the following files, each containing a minimal placeholder component. Format for each:

```tsx
export function ComponentName() {
  return (
    <div className="page-container">
      <h1>Page Title</h1>
      <p>Coming soon — this page is under development.</p>
    </div>
  )
}
```

Files to create:

### Services (`apps/web/src/pages/services/`)
- `ServicesPage.tsx`
- `ServiceLibraryPage.tsx`
- `ServiceDetailPage.tsx`
- `FormBuilderPage.tsx`

### Appointments (`apps/web/src/pages/appointments/`)
- `AppointmentsCalendarPage.tsx`
- `AppointmentSlotsPage.tsx`
- `NewAppointmentPage.tsx`
- `AppointmentDetailPage.tsx`

### Patients (`apps/web/src/pages/patients/`)
- `PatientsPage.tsx`
- `PatientDetailPage.tsx`

### Logs (`apps/web/src/pages/logs/`)
- `LogsPage.tsx`
- `LogLibraryPage.tsx`
- `LogViewPage.tsx`
- `LogSettingsPage.tsx`
- `LogBuilderPage.tsx`

### Video (`apps/web/src/pages/video/`)
- `VideoConsultsPage.tsx`
- `VideoRoomPage.tsx`

### Messaging (`apps/web/src/pages/messaging/`)
- `MessagingHubPage.tsx`
- `ComposeMessagePage.tsx`
- `BroadcastsPage.tsx`
- `NewBroadcastPage.tsx`
- `MessageHistoryPage.tsx`

### Patient Portal (`apps/web/src/pages/patient-portal/`)
- `PatientLoginPage.tsx`
- `PatientRegisterPage.tsx`
- `PatientAppointmentsPage.tsx`
- `PatientProfilePage.tsx`

### Public (`apps/web/src/pages/public/`) — add to existing folder
- `PatientVideoPage.tsx`
- `PublicBookingHomePage.tsx`
- `PublicOrgPage.tsx`
- `PublicServicePage.tsx`
- `PublicBookingConfirmPage.tsx`

---

## Verification Checklist

After completing all work:

- [ ] `pnpm install` succeeds
- [ ] `pnpm build` succeeds (all packages + web app)
- [ ] All new routes resolve without 404
- [ ] SideNav shows all new sections
- [ ] Supabase migrations can be applied in order (`supabase db push` or via dashboard)
- [ ] Types compile — run `cd packages/types && pnpm tsc --noEmit`
- [ ] Patient client initialises without error
- [ ] `usePatientStore` can be imported from `@pharmstation/core`
- [ ] No existing functionality is broken

---

## Files Modified (summary)

| File | Action |
|---|---|
| `supabase/migrations/20260219_patients.sql` | **CREATE** |
| `supabase/migrations/20260219_org_public_profile.sql` | **CREATE** |
| `supabase/migrations/20260219_patient_auth_trigger.sql` | **CREATE** |
| `packages/supabase-client/src/index.ts` | **EDIT** — add patient client |
| `packages/core/src/stores/patient-store.ts` | **CREATE** |
| `packages/core/src/index.ts` | **EDIT** — add patient store export |
| `packages/types/src/index.ts` | **EDIT** — add ALL expansion types |
| `apps/web/src/App.tsx` | **EDIT** — add ALL new routes |
| `apps/web/src/components/layout/SideNav.tsx` | **EDIT** — add ALL new nav sections |
| `apps/web/src/pages/services/*.tsx` | **CREATE** (4 files) |
| `apps/web/src/pages/appointments/*.tsx` | **CREATE** (4 files) |
| `apps/web/src/pages/patients/*.tsx` | **CREATE** (2 files) |
| `apps/web/src/pages/logs/*.tsx` | **CREATE** (5 files) |
| `apps/web/src/pages/video/*.tsx` | **CREATE** (2 files) |
| `apps/web/src/pages/messaging/*.tsx` | **CREATE** (5 files) |
| `apps/web/src/pages/patient-portal/*.tsx` | **CREATE** (4 files) |
| `apps/web/src/pages/public/*.tsx` | **CREATE** (5 files) |

**Total: ~35 files created/modified**
