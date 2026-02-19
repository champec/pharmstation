# Agent 2 — Appointments (Internal Calendar + Public Booking)

> **Wave:** 2 (runs in PARALLEL with Agents 1, 3, 4, 5 — after Agent 0 completes)
> **Prerequisite:** Agent 0 (Foundation) must be complete
> **Base plan:** `documentation/expansion/expansion-plan.md` — Phase 2
> **Assumes:** All types already exist in `@pharmstation/types`, all routes already wired in `App.tsx`, all nav items already in `SideNav.tsx`, all placeholder pages already created by Agent 0.

This agent builds the **Appointments** feature: the database tables, the Zustand store, the internal staff calendar UI, the patient management pages, and the public booking flow.

---

## Scope Summary

1. Create the appointments database migration (2 tables)
2. Install FullCalendar packages
3. Create `useAppointmentStore` Zustand store
4. Implement `AppointmentsCalendarPage` — FullCalendar-based staff calendar
5. Implement `AppointmentSlotsPage` — availability slot management
6. Implement `NewAppointmentPage` — create appointment modal/page
7. Implement `AppointmentDetailPage` — single appointment view
8. Implement `PatientsPage` — patient list for the org
9. Implement `PatientDetailPage` — patient profile + history
10. Implement public booking pages: `PublicBookingHomePage`, `PublicOrgPage`, `PublicServicePage`, `PublicBookingConfirmPage`
11. Implement patient portal pages: `PatientLoginPage`, `PatientRegisterPage`, `PatientAppointmentsPage`

---

## 1. Database Migration

Create: `supabase/migrations/20260219_appointments.sql`

```sql
-- ===========================================
-- PharmStation: Appointment Slots & Appointments
-- ===========================================

-- Org availability slots
CREATE TABLE ps_appointment_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  max_bookings int NOT NULL DEFAULT 1,
  booked_count int NOT NULL DEFAULT 0,
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_rule text, -- iCal RRULE string
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ps_slots_time_check CHECK (end_time > start_time),
  CONSTRAINT ps_slots_booking_check CHECK (booked_count >= 0 AND booked_count <= max_bookings)
);

CREATE INDEX idx_ps_slots_org ON ps_appointment_slots(org_id);
CREATE INDEX idx_ps_slots_service ON ps_appointment_slots(service_id);
CREATE INDEX idx_ps_slots_time ON ps_appointment_slots(org_id, start_time, end_time) WHERE is_active = true;

ALTER TABLE ps_appointment_slots ENABLE ROW LEVEL SECURITY;

-- Org members: full CRUD on their org's slots
CREATE POLICY "org_members_crud_slots"
  ON ps_appointment_slots FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Public (anon): read available slots for public, active services of public orgs
CREATE POLICY "anon_read_available_slots"
  ON ps_appointment_slots FOR SELECT
  USING (
    is_active = true
    AND booked_count < max_bookings
    AND service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Booked appointments
CREATE TABLE ps_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid REFERENCES ps_appointment_slots(id) ON DELETE SET NULL,
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES ps_patients(id) ON DELETE CASCADE,
  form_id uuid REFERENCES ps_service_forms(id) ON DELETE SET NULL,
  form_data jsonb DEFAULT '{}', -- filled-in form fields
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  booked_by_user_id uuid REFERENCES ps_user_profiles(id) ON DELETE SET NULL, -- null if patient self-booked
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ps_appointments_org ON ps_appointments(org_id);
CREATE INDEX idx_ps_appointments_patient ON ps_appointments(patient_id);
CREATE INDEX idx_ps_appointments_service ON ps_appointments(service_id);
CREATE INDEX idx_ps_appointments_status ON ps_appointments(org_id, status);
CREATE INDEX idx_ps_appointments_slot ON ps_appointments(slot_id) WHERE slot_id IS NOT NULL;

ALTER TABLE ps_appointments ENABLE ROW LEVEL SECURITY;

-- Org members: full CRUD on their org's appointments
CREATE POLICY "org_members_crud_appointments"
  ON ps_appointments FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Patients: read/cancel their own appointments
CREATE POLICY "patients_read_own_appointments"
  ON ps_appointments FOR SELECT
  USING (
    patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "patients_cancel_own_appointments"
  ON ps_appointments FOR UPDATE
  USING (
    patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    status = 'cancelled'
    AND patient_id IN (
      SELECT id FROM ps_patients WHERE auth_user_id = auth.uid()
    )
  );

-- Anon: can INSERT appointments for public services (guest booking)
CREATE POLICY "anon_insert_public_appointments"
  ON ps_appointments FOR INSERT
  WITH CHECK (
    service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Trigger: auto-increment booked_count on slot when appointment is inserted
CREATE OR REPLACE FUNCTION ps_increment_slot_booked_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL THEN
    UPDATE ps_appointment_slots
    SET booked_count = booked_count + 1
    WHERE id = NEW.slot_id
      AND booked_count < max_bookings;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slot is fully booked or does not exist';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ps_appointment_slot_increment
  AFTER INSERT ON ps_appointments
  FOR EACH ROW
  EXECUTE FUNCTION ps_increment_slot_booked_count();

-- Trigger: auto-decrement booked_count when appointment is cancelled
CREATE OR REPLACE FUNCTION ps_decrement_slot_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' AND NEW.slot_id IS NOT NULL THEN
    UPDATE ps_appointment_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ps_appointment_slot_decrement
  AFTER UPDATE ON ps_appointments
  FOR EACH ROW
  EXECUTE FUNCTION ps_decrement_slot_on_cancel();

-- Updated_at trigger
CREATE TRIGGER ps_appointments_updated_at
  BEFORE UPDATE ON ps_appointments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

## 2. Install FullCalendar

Add to `apps/web/package.json`:

```bash
cd apps/web && pnpm add @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction @fullcalendar/list @fullcalendar/core
```

---

## 3. Zustand Store: `useAppointmentStore`

Create: `packages/core/src/stores/appointment-store.ts`

```typescript
import { create } from 'zustand'
import type {
  AppointmentSlot,
  Appointment,
  AppointmentStatus,
  Patient,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface AppointmentState {
  // Data
  slots: AppointmentSlot[]
  appointments: Appointment[]
  patients: Patient[]
  activeAppointment: Appointment | null
  activePatient: Patient | null
  calendarView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'
  loading: boolean
  error: string | null

  // Slot actions
  fetchSlots: (orgId: string, range?: { start: string; end: string }) => Promise<void>
  createSlot: (slot: Partial<AppointmentSlot>) => Promise<AppointmentSlot>
  updateSlot: (slotId: string, updates: Partial<AppointmentSlot>) => Promise<void>
  deleteSlot: (slotId: string) => Promise<void>

  // Appointment actions
  fetchAppointments: (orgId: string, range?: { start: string; end: string }) => Promise<void>
  fetchAppointmentDetail: (appointmentId: string) => Promise<void>
  bookAppointment: (appointment: Partial<Appointment>) => Promise<Appointment>
  updateStatus: (appointmentId: string, status: AppointmentStatus) => Promise<void>
  cancelAppointment: (appointmentId: string) => Promise<void>

  // Patient actions
  fetchPatients: (orgId: string) => Promise<void>
  fetchPatientDetail: (patientId: string) => Promise<void>
  createPatient: (patient: Partial<Patient>) => Promise<Patient>
  updatePatient: (patientId: string, updates: Partial<Patient>) => Promise<void>
  searchPatients: (orgId: string, query: string) => Promise<Patient[]>

  // Public slot fetching (anon)
  fetchPublicSlots: (orgSlug: string, serviceId: string) => Promise<AppointmentSlot[]>

  // UI
  setCalendarView: (view: AppointmentState['calendarView']) => void
  clearError: () => void
}

export const useAppointmentStore = create<AppointmentState>((set, get) => ({
  slots: [],
  appointments: [],
  patients: [],
  activeAppointment: null,
  activePatient: null,
  calendarView: 'timeGridWeek',
  loading: false,
  error: null,

  // --- Slots ---

  fetchSlots: async (orgId, range) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_appointment_slots')
        .select('*, service:ps_services(id, name, duration_minutes)')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('start_time')

      if (range) {
        query = query.gte('start_time', range.start).lte('end_time', range.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ slots: data as AppointmentSlot[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createSlot: async (slot) => {
    const { data, error } = await getUserClient()
      .from('ps_appointment_slots')
      .insert(slot)
      .select()
      .single()
    if (error) throw error
    const created = data as AppointmentSlot
    set((s) => ({ slots: [...s.slots, created] }))
    return created
  },

  updateSlot: async (slotId, updates) => {
    const { error } = await getUserClient()
      .from('ps_appointment_slots')
      .update(updates)
      .eq('id', slotId)
    if (error) throw error
    set((s) => ({
      slots: s.slots.map((slot) =>
        slot.id === slotId ? { ...slot, ...updates } : slot
      ),
    }))
  },

  deleteSlot: async (slotId) => {
    const { error } = await getUserClient()
      .from('ps_appointment_slots')
      .update({ is_active: false })
      .eq('id', slotId)
    if (error) throw error
    set((s) => ({ slots: s.slots.filter((slot) => slot.id !== slotId) }))
  },

  // --- Appointments ---

  fetchAppointments: async (orgId, range) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_appointments')
        .select(`
          *,
          patient:ps_patients(id, first_name, last_name, phone, email),
          service:ps_services(id, name, duration_minutes),
          slot:ps_appointment_slots(id, start_time, end_time)
        `)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })

      if (range) {
        query = query
          .gte('slot.start_time', range.start)
          .lte('slot.end_time', range.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ appointments: data as Appointment[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchAppointmentDetail: async (appointmentId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_appointments')
        .select(`
          *,
          patient:ps_patients(*),
          service:ps_services(*),
          slot:ps_appointment_slots(*),
          form:ps_service_forms(*)
        `)
        .eq('id', appointmentId)
        .single()
      if (error) throw error
      set({ activeAppointment: data as Appointment, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  bookAppointment: async (appointment) => {
    const { data, error } = await getUserClient()
      .from('ps_appointments')
      .insert(appointment)
      .select()
      .single()
    if (error) throw error
    const created = data as Appointment
    set((s) => ({ appointments: [created, ...s.appointments] }))
    return created
  },

  updateStatus: async (appointmentId, status) => {
    const { error } = await getUserClient()
      .from('ps_appointments')
      .update({ status })
      .eq('id', appointmentId)
    if (error) throw error
    set((s) => ({
      appointments: s.appointments.map((a) =>
        a.id === appointmentId ? { ...a, status } : a
      ),
      activeAppointment:
        s.activeAppointment?.id === appointmentId
          ? { ...s.activeAppointment, status }
          : s.activeAppointment,
    }))
  },

  cancelAppointment: async (appointmentId) => {
    await get().updateStatus(appointmentId, 'cancelled')
  },

  // --- Patients ---

  fetchPatients: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_patients')
        .select('*')
        .eq('organisation_id', orgId)
        .order('last_name')
      if (error) throw error
      set({ patients: data as Patient[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchPatientDetail: async (patientId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_patients')
        .select('*')
        .eq('id', patientId)
        .single()
      if (error) throw error
      set({ activePatient: data as Patient, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createPatient: async (patient) => {
    const { data, error } = await getUserClient()
      .from('ps_patients')
      .insert(patient)
      .select()
      .single()
    if (error) throw error
    const created = data as Patient
    set((s) => ({ patients: [...s.patients, created] }))
    return created
  },

  updatePatient: async (patientId, updates) => {
    const { error } = await getUserClient()
      .from('ps_patients')
      .update(updates)
      .eq('id', patientId)
    if (error) throw error
    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId ? { ...p, ...updates } : p
      ),
      activePatient:
        s.activePatient?.id === patientId
          ? { ...s.activePatient, ...updates }
          : s.activePatient,
    }))
  },

  searchPatients: async (orgId, query) => {
    const { data, error } = await getUserClient()
      .from('ps_patients')
      .select('*')
      .eq('organisation_id', orgId)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,nhs_number.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(20)
    if (error) throw error
    return data as Patient[]
  },

  // --- Public ---

  fetchPublicSlots: async (_orgSlug, serviceId) => {
    // Uses anon client — no auth needed
    const { data, error } = await getUserClient()
      .from('ps_appointment_slots')
      .select('id, start_time, end_time, max_bookings, booked_count')
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .gt('start_time', new Date().toISOString())
      .order('start_time')
    if (error) throw error
    return data as AppointmentSlot[]
  },

  // --- UI ---

  setCalendarView: (view) => set({ calendarView: view }),
  clearError: () => set({ error: null }),
}))
```

Export from `packages/core/src/index.ts`:

```typescript
export { useAppointmentStore, type AppointmentState } from './stores/appointment-store'
```

---

## 4. AppointmentsCalendarPage

Replace placeholder at: `apps/web/src/pages/appointments/AppointmentsCalendarPage.tsx`

**Requirements:**

- On mount, call `useAppointmentStore.fetchAppointments(orgId)` and `fetchSlots(orgId)`.
- Full-width `<FullCalendar>` component taking up the content area.
- **Views:** Day (`timeGridDay`), Week (`timeGridWeek`), Month (`dayGridMonth`), List (`listWeek`). View toggle buttons in toolbar.
- **Events sourced from two data sets:**
  - **Appointments** (confirmed/pending): coloured by status — pending=amber, confirmed=blue, completed=grey, cancelled=red/strikethrough, no_show=orange.
  - **Slots** (available capacity): shown as background events or lighter-coloured blocks. Show remaining capacity as badge.
- **Click event** → opens `AppointmentDetailPage` in right panel via `useUIStore.setRightPanelContent(...)` or navigates to `/appointments/:id`.
- **"New Appointment"** button → opens a modal:
  - Service picker (dropdown of org's active services)
  - Patient search (typeahead, searches `ps_patients`)
  - Time slot selector (shows available slots for selected service)
  - Form fill (loads the service's default form fields, renders dynamically)
  - Confirm → `bookAppointment(...)`
- **Filters** toolbar: by service, by status, by staff member.
- **Date navigation**: prev/next/today buttons (FullCalendar built-in).
- Loading: show skeleton/spinner while fetching.
- Error: inline error banner.

**FullCalendar config:**

```tsx
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'

<FullCalendar
  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
  initialView="timeGridWeek"
  headerToolbar={{
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
  }}
  events={calendarEvents}
  eventClick={handleEventClick}
  dateClick={handleDateClick}
  editable={false}
  selectable={true}
  nowIndicator={true}
  slotMinTime="07:00:00"
  slotMaxTime="22:00:00"
  height="auto"
/>
```

**Mapping appointments → FullCalendar events:**

```typescript
const calendarEvents = appointments.map((appt) => ({
  id: appt.id,
  title: `${appt.patient?.first_name} ${appt.patient?.last_name} — ${appt.service?.name}`,
  start: appt.slot?.start_time,
  end: appt.slot?.end_time,
  backgroundColor: statusColours[appt.status],
  borderColor: statusColours[appt.status],
  extendedProps: { appointment: appt },
}))
```

---

## 5. AppointmentSlotsPage

Replace placeholder at: `apps/web/src/pages/appointments/AppointmentSlotsPage.tsx`

**Requirements:**

- Table of defined availability slots using `RegisterTable` component (existing TanStack Table wrapper) or a simpler table.
- Columns: Service, Start Time, End Time, Max Bookings, Booked, Recurring (yes/no), Status (active/inactive), Actions.
- **Create slot** button → modal/drawer form:
  - Service picker dropdown
  - Date + start time + end time pickers
  - Max bookings (number input, default 1)
  - Recurring toggle → shows RRULE builder (simple: daily/weekly/monthly + end date)
  - Save → `createSlot(...)`
- **Edit slot** → inline or modal, calls `updateSlot(...)`.
- **Deactivate/Delete slot** → calls `deleteSlot(...)` (soft delete — sets `is_active = false`).
- Filters: by service, by date range, active only toggle.

---

## 6. NewAppointmentPage

Replace placeholder at: `apps/web/src/pages/appointments/NewAppointmentPage.tsx`

**Requirements:**

- Can also be rendered as a modal from `AppointmentsCalendarPage`.
- Step-by-step flow:
  1. **Select service** — dropdown/card picker of org's active services
  2. **Select or create patient** — search existing patients or quick-create new patient inline
  3. **Select time slot** — date picker → shows available slots for that date/service
  4. **Fill form** — if the service has a default form, render its fields dynamically (text inputs, dropdowns, checkboxes, etc. based on `field_type`)
  5. **Confirm & book** — summary, confirm button → `bookAppointment({...})`
- After booking: success message + navigate to appointment detail or back to calendar.

---

## 7. AppointmentDetailPage

Replace placeholder at: `apps/web/src/pages/appointments/AppointmentDetailPage.tsx`

**Requirements:**

- URL param: `id` from `useParams()`.
- On mount: `fetchAppointmentDetail(id)`.
- Shows:
  - **Status badge** (pending/confirmed/cancelled/completed/no_show) — large, colour-coded.
  - **Patient info**: name, phone, email, NHS number (linked to patient detail page).
  - **Service info**: service name, duration.
  - **Appointment time**: date, start–end.
  - **Form data**: if `form_data` filled, render it read-only with labels from the form definition.
  - **Notes**: read-only display + edit button to add/update notes.
  - **Booked by**: staff name if `booked_by_user_id`, or "Self-booked" if null.
- **Actions**:
  - Confirm (if pending) → `updateStatus(id, 'confirmed')`
  - Complete → `updateStatus(id, 'completed')`
  - No-show → `updateStatus(id, 'no_show')`
  - Cancel (with confirmation modal) → `cancelAppointment(id)`

---

## 8. PatientsPage

Replace placeholder at: `apps/web/src/pages/patients/PatientsPage.tsx`

**Requirements:**

- On mount: `fetchPatients(orgId)`.
- Searchable, sortable table of `ps_patients` for the org.
- Columns: Name (first + last), DOB, NHS Number, Phone, Email, Postcode, Created.
- Search bar filters across name, NHS number, phone.
- **"Add Patient"** button → modal form with all patient fields (first_name, last_name, dob, nhs_number, email, phone, address fields). `createPatient(...)`.
- Click row → navigate to `/patients/:patientId`.
- Quick actions column: Edit, View appointments.

---

## 9. PatientDetailPage

Replace placeholder at: `apps/web/src/pages/patients/PatientDetailPage.tsx`

**Requirements:**

- URL param: `patientId` from `useParams()`.
- On mount: `fetchPatientDetail(patientId)`, also fetch the patient's appointments.
- **Profile section**: all patient fields, editable via inline edit or edit modal. Save → `updatePatient(...)`.
- **Tabs or sections:**
  - **Appointments** — table of this patient's appointments (past + upcoming), sortable by date.
  - **Messages** — (placeholder for now, Agent 5 will fill) — "Message history coming soon".
  - **Video Consults** — (placeholder for now, Agent 4 will fill) — "Video consultation history coming soon".
- **Linked account status**: if `auth_user_id` is set, show "Patient has an account" badge. Otherwise "No patient account linked".

---

## 10. Public Booking Pages

### `PublicBookingHomePage`

Replace placeholder at: `apps/web/src/pages/public/PublicBookingHomePage.tsx`

**Requirements:**

- No auth required. Clean, branded landing page.
- Search bar: "Find a pharmacy" — searches org name/location.
- Fetches public orgs from `ps_organisations` where `is_public = true`.
- Results: org cards (name, description, logo, postcode/city).
- Click card → navigate to `/book/:orgSlug`.
- Optional: filter by service category.

### `PublicOrgPage`

Replace placeholder at: `apps/web/src/pages/public/PublicOrgPage.tsx`

**Requirements:**

- URL param: `orgSlug`.
- Fetches org profile by slug from `ps_organisations`.
- Displays: org name, `public_description`, `public_logo_url`, address.
- Lists public services (from `ps_services` where `is_public = true` and `org_id` matches).
- Each service card: name, description, duration. Click → navigate to `/book/:orgSlug/:serviceId`.

### `PublicServicePage`

Replace placeholder at: `apps/web/src/pages/public/PublicServicePage.tsx`

**Requirements:**

- URL params: `orgSlug`, `serviceId`.
- Shows service description + duration.
- **Date picker** — patient selects a date.
- **Slot list** — fetches available slots for selected date from `ps_appointment_slots` (anon read policy). Shows time + availability.
- Patient selects a slot → navigate to `/book/:orgSlug/:serviceId/confirm?slotId=xxx`.

### `PublicBookingConfirmPage`

Replace placeholder at: `apps/web/src/pages/public/PublicBookingConfirmPage.tsx`

**Requirements:**

- URL params: `orgSlug`, `serviceId`. Query param: `slotId`.
- **If patient logged in** (check `usePatientStore.isLoggedIn`): pre-fill name, email, phone from patient profile.
- **If guest**: show login/register prompt OR allow guest flow with name + phone + email fields.
- **Service form** — if the service has a default form, render its fields dynamically.
- **Confirm button** → creates the appointment via `bookAppointment(...)`.
- On success: show confirmation message with appointment details, option to add to calendar (`.ics` download).

---

## 11. Patient Portal Pages

### `PatientLoginPage`

Replace placeholder at: `apps/web/src/pages/patient-portal/PatientLoginPage.tsx`

**Requirements:**

- Clean, minimal page with pharmacy branding.
- Email + password login form.
- On submit → `usePatientStore.login(email, password)`.
- Link to register page.
- On success → redirect to `/patient/appointments`.

### `PatientRegisterPage`

Replace placeholder at: `apps/web/src/pages/patient-portal/PatientRegisterPage.tsx`

**Requirements:**

- Registration form: first name, last name, email, phone, password.
- Organisation selection (search/select which pharmacy they're registering with).
- On submit → `usePatientStore.register(...)`.
- On success → redirect to `/patient/appointments`.

### `PatientAppointmentsPage`

Replace placeholder at: `apps/web/src/pages/patient-portal/PatientAppointmentsPage.tsx`

**Requirements:**

- Requires patient auth (`usePatientStore.isLoggedIn`). Redirect to `/patient/login` if not.
- Lists patient's own appointments (fetched via patient auth session).
- Tabs: Upcoming / Past.
- Each appointment card: service name, date, time, status badge.
- Cancel button (for pending/confirmed appointments, with confirmation).
- "Book new appointment" link → redirects to `/book`.

---

## Verification Checklist

After completing all work:

- [ ] Migration applies cleanly — both tables created, triggers work
- [ ] FullCalendar packages installed — `pnpm install` succeeds
- [ ] `useAppointmentStore` compiles and all actions work against Supabase
- [ ] `AppointmentsCalendarPage` renders calendar, shows events from appointments + slots
- [ ] `AppointmentSlotsPage` can create/edit/deactivate slots
- [ ] `NewAppointmentPage` walks through service → patient → slot → form → confirm flow
- [ ] `AppointmentDetailPage` shows appointment info, status actions work
- [ ] `PatientsPage` shows patient list, search works, add patient works
- [ ] `PatientDetailPage` shows patient profile + appointment history
- [ ] Public booking pages work without auth — can browse orgs, services, slots
- [ ] `PublicBookingConfirmPage` creates appointment correctly
- [ ] Patient portal login/register works via `usePatientStore`
- [ ] `PatientAppointmentsPage` shows patient's own appointments
- [ ] Slot `booked_count` increments/decrements correctly via triggers
- [ ] No typescript errors — `pnpm build` succeeds

---

## Files Modified

| File | Action |
|---|---|
| `supabase/migrations/20260219_appointments.sql` | **CREATE** |
| `packages/core/src/stores/appointment-store.ts` | **CREATE** |
| `packages/core/src/index.ts` | **EDIT** — add appointment store export |
| `apps/web/package.json` | **EDIT** — add FullCalendar dependencies |
| `apps/web/src/pages/appointments/AppointmentsCalendarPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/appointments/AppointmentSlotsPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/appointments/NewAppointmentPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/appointments/AppointmentDetailPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/patients/PatientsPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/patients/PatientDetailPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/public/PublicBookingHomePage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/public/PublicOrgPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/public/PublicServicePage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/public/PublicBookingConfirmPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/patient-portal/PatientLoginPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/patient-portal/PatientRegisterPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/patient-portal/PatientAppointmentsPage.tsx` | **REPLACE** placeholder |

**DO NOT modify** `App.tsx`, `SideNav.tsx`, or `packages/types/src/index.ts` — Agent 0 handles those.
