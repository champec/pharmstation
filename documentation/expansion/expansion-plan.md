# PharmStation Expansion Plan

> **Created:** 19 February 2026
> **Build order:** Services → Appointments → Logs → Video Consults → Messaging

Five interconnected feature domains added to the existing React 19 / Supabase / Zustand monorepo. All new code follows existing patterns: React Router 7, Zustand stores, Zod + react-hook-form, Supabase RLS. Public booking lives in the same web app under `/book/...`.

---

## Phase 0 — Foundation (cross-cutting prerequisites)

### 0.1 Patient Auth Client

Extend `@pharmstation/supabase-client` with a third client:

```ts
// packages/supabase-client/src/index.ts
const patientClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'ps-patient-session' },
});
```

The existing auth trigger (`20260213_002_auth_trigger.sql`) gains a third branch: `account_type = 'patient'` → INSERT into `ps_patients`.

### 0.2 New Migration: `ps_patients`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `auth_user_id` | uuid FK `auth.users` | nullable — not all patients will have accounts |
| `organisation_id` | uuid FK `ps_organisations` | primary pharmacy |
| `first_name` | text | |
| `last_name` | text | |
| `dob` | date | nullable |
| `nhs_number` | text | nullable, unique where not null |
| `email` | text | nullable |
| `phone` | text | nullable |
| `address_line_1` | text | nullable |
| `address_line_2` | text | nullable |
| `city` | text | nullable |
| `postcode` | text | nullable |
| `created_at` | timestamptz | default `now()` |

**RLS:** org members can read/write patients belonging to their org; patient can read/update their own row.

### 0.3 Org Slug + Public Profile

New migration adds to `ps_organisations`:

| Column | Type |
|---|---|
| `slug` | text UNIQUE NOT NULL |
| `is_public` | boolean DEFAULT false |
| `public_description` | text |
| `public_logo_url` | text |

The `slug` drives `/book/[slug]` URLs.

### 0.4 New Zustand Store: `usePatientStore`

In `packages/core/src/stores/patient-store.ts`:

- `patientLogin`, `patientLogout`, `patientProfile`, `initialize`
- Manages patient-side auth session using `patientClient`

### 0.5 New Types

Added to `@pharmstation/types`:

- `Patient`, `PatientAuthState`
- `Service`, `ServiceForm`, `ServiceFormField`, `FieldType`
- `AppointmentSlot`, `Appointment`, `AppointmentStatus`
- `LogTemplate`, `LogField`, `LogEntry`, `LogScheduleType`
- `VideoConsultation`, `VideoConsultationStatus`
- `NotifySettings`, `Message`, `Broadcast`, `MessageChannel`

---

## Phase 1 — Services & Service Forms

### 1.1 DB Migration: Services

**`ps_service_library`** — platform-curated service catalogue

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g. "Flu Vaccination" |
| `description` | text | |
| `category` | text | e.g. "vaccination", "screening", "consultation" |
| `is_active` | boolean | default true |
| `created_at` | timestamptz | |

Seeded defaults: Flu Vaccination, Blood Pressure Check, Medication Review, NMS, Smoking Cessation, Travel Vaccination, Emergency Contraception, UTI Consultation.

**`ps_services`** — org's active services

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK `ps_organisations` | |
| `library_service_id` | uuid FK `ps_service_library` | nullable — null = fully custom |
| `name` | text | |
| `description` | text | |
| `is_active` | boolean | default true |
| `is_public` | boolean | default false — appears in `/book` when true |
| `duration_minutes` | int | default 15 |
| `created_at` | timestamptz | |

**`ps_service_forms`** — form definition linked to a service

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `service_id` | uuid FK `ps_services` | |
| `name` | text | e.g. "Standard", "Under-18 Variant" |
| `is_default` | boolean | default false |
| `version` | int | default 1 |
| `created_at` | timestamptz | |

**`ps_service_form_fields`** — columns in a form

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `form_id` | uuid FK `ps_service_forms` | |
| `label` | text | human label |
| `field_key` | text | machine key |
| `field_type` | text | `text \| number \| boolean \| select \| multiselect \| date \| textarea \| signature` |
| `options` | jsonb | for select/multiselect choices |
| `is_required` | boolean | default false |
| `display_order` | int | |

**RLS:** org members can CRUD their own services/forms/fields; library is globally readable.

### 1.2 Routes

| Route | Component | Auth |
|---|---|---|
| `/services` | `ServicesPage` | Protected |
| `/services/library` | `ServiceLibraryPage` | Protected |
| `/services/:serviceId` | `ServiceDetailPage` | Protected |
| `/services/:serviceId/form/:formId` | `FormBuilderPage` | Protected |

### 1.3 UI Components

- **`ServicesPage`** — grid of org's active services + "Add service" + "Browse library" CTA.
- **`ServiceLibraryPage`** — card grid of platform services, "Subscribe" button per card.
- **`ServiceDetailPage`** — service info + forms list + "Add form variant".
- **`FormBuilderPage`** — form builder UI. Left panel: field type palette. Right panel: live field list, reorderable. Each field card: label input, type selector, required toggle, options editor (for select types), delete. Uses `react-hook-form`.

### 1.4 Zustand Store: `useServiceStore`

`packages/core/src/stores/service-store.ts`

State: `services`, `formTemplates`, `activeBuilder`
Actions: `fetchServices`, `createService`, `subscribeToLibraryService`, `saveForm`, `saveFields`

### 1.5 SideNav

New section **"Services"**:
- 📋 Services → `/services`
- 📚 Library → `/services/library`

---

## Phase 2 — Appointments (Internal Calendar + Public Booking)

### 2.1 DB Migration: Appointments

**`ps_appointment_slots`** — org availability

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `service_id` | uuid FK `ps_services` | |
| `start_time` | timestamptz | |
| `end_time` | timestamptz | |
| `max_bookings` | int | default 1 |
| `booked_count` | int | default 0 |
| `is_recurring` | boolean | default false |
| `recurrence_rule` | text | iCal RRULE string, nullable |
| `is_active` | boolean | default true |

**`ps_appointments`** — booked appointments

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slot_id` | uuid FK `ps_appointment_slots` | |
| `org_id` | uuid FK | |
| `service_id` | uuid FK | |
| `patient_id` | uuid FK `ps_patients` | |
| `form_id` | uuid FK `ps_service_forms` | |
| `form_data` | jsonb | filled-in form fields |
| `status` | text | `pending \| confirmed \| cancelled \| completed \| no_show` |
| `notes` | text | |
| `booked_by_user_id` | uuid FK `ps_user_profiles` | nullable — null if patient self-booked |
| `created_at` | timestamptz | |

**RLS:**
- Org members: full CRUD on their org's slots and appointments.
- Patients: read/cancel their own appointments.
- Public (anon): read available slots for public, active services of public orgs.

### 2.2 FullCalendar

Install in `apps/web/package.json`:

```
@fullcalendar/react
@fullcalendar/daygrid
@fullcalendar/timegrid
@fullcalendar/interaction
@fullcalendar/list
```

### 2.3 Routes

**Staff routes (protected):**

| Route | Component |
|---|---|
| `/appointments` | `AppointmentsCalendarPage` |
| `/appointments/slots` | `AppointmentSlotsPage` |
| `/appointments/new` | `NewAppointmentPage` |
| `/appointments/:id` | `AppointmentDetailPage` |
| `/patients` | `PatientsPage` |
| `/patients/:patientId` | `PatientDetailPage` |

**Patient routes (patient auth):**

| Route | Component |
|---|---|
| `/patient/login` | `PatientLoginPage` |
| `/patient/register` | `PatientRegisterPage` |
| `/patient/appointments` | `PatientAppointmentsPage` |

**Public routes (no auth):**

| Route | Component |
|---|---|
| `/book` | `PublicBookingHomePage` |
| `/book/:orgSlug` | `PublicOrgPage` |
| `/book/:orgSlug/:serviceId` | `PublicServicePage` |
| `/book/:orgSlug/:serviceId/confirm` | `PublicBookingConfirmPage` |

### 2.4 Internal Calendar UI

`AppointmentsCalendarPage`:
- `<FullCalendar>` with Day / Week / Month grid views + List view toggle.
- Events sourced from `ps_appointments` (confirmed/pending) and `ps_appointment_slots` (show available capacity differently).
- Click event → opens `AppointmentDetailPage` in right panel (`useUIStore.rightPanelContent`).
- "New appointment" → modal with service picker, patient search, time slot selector, form fill.
- Filters: by service, by status, by staff member.

`AppointmentSlotsPage`:
- Table of defined availability slots — create / edit / delete.
- Support for recurring slots via RRULE input.
- When creating a slot, attach a service.

### 2.5 Public Booking UI

**`PublicBookingHomePage`** — search bar for org name/location, filter by service category. Results: org cards. No auth required.

**`PublicOrgPage`** — org profile + list of public services.

**`PublicServicePage`** — service description + available slots (date picker → slot list). Patient selects a slot.

**`PublicBookingConfirmPage`** — if patient is logged in: pre-fill details, show service form, confirm. If guest: prompt to log in / register / allow guest OTP verification.

### 2.6 Zustand Store: `useAppointmentStore`

State: `slots`, `appointments`, `calendarView`
Actions: `fetchSlots`, `fetchAppointments`, `createSlot`, `bookAppointment`, `cancelAppointment`, `updateStatus`

### 2.7 SideNav

New section **"Appointments"**:
- 📅 Calendar → `/appointments`
- ⏰ Slots → `/appointments/slots`
- 👥 Patients → `/patients`

---

## Phase 3 — Logs (Flexible Electronic Documents)

### 3.1 DB Migration: Logs

**`ps_log_templates`** — a log definition

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid | nullable — null = platform library |
| `title` | text | e.g. "Fridge Temperature Log" |
| `description` | text | |
| `category` | text | `cleaning \| fridge \| cd \| visitor \| date_check \| custom` |
| `schedule_type` | text | `daily \| custom_days \| sporadic` |
| `required_days` | int[] | 0=Sun…6=Sat, relevant for `daily` / `custom_days` |
| `is_library` | boolean | platform-provided |
| `version` | int | default 1 |
| `created_at` | timestamptz | |

**`ps_log_fields`** — columns of a log template

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `template_id` | uuid FK | |
| `label` | text | e.g. "Fridge 1" |
| `field_key` | text | machine key |
| `field_type` | text | `text \| number \| boolean \| select \| multiselect \| date \| textarea \| signature \| canvas` |
| `options` | jsonb | for select/multiselect choices |
| `is_required` | boolean | default false |
| `display_order` | int | |
| `column_width` | text | optional layout hint |

**`ps_log_subscriptions`** — org activates/subscribes to a log

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `template_id` | uuid FK `ps_log_templates` | |
| `custom_title` | text | nullable override |
| `custom_fields` | jsonb | any field overrides |
| `is_active` | boolean | default true |
| `subscribed_at` | timestamptz | |

**`ps_log_entries`** — one row per log event

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subscription_id` | uuid FK `ps_log_subscriptions` | |
| `org_id` | uuid FK | |
| `entry_date` | date | |
| `data` | jsonb | keyed by `field_key` |
| `entered_by_user_id` | uuid FK | |
| `created_at` | timestamptz | |

**RLS:** org members can CRUD their subscriptions and entries; library templates are globally readable.

### 3.2 Platform Library Seeds

Seed `ps_log_templates` + `ps_log_fields` for:

| Log | Schedule | Fields |
|---|---|---|
| **Cleaning Log** | sporadic | area (text), cleaned_by (text), signed_off_by (text), notes (textarea) |
| **Visitor Log** | sporadic | visitor_name (text), address (text), reason (text), time_in (date), time_out (date), signature (canvas) |
| **Fridge Temperature Log** | daily (Mon–Sat, Sun exception) | fridge_1 (number), fridge_2 (number), ... customisable columns per fridge |
| **CD Keys Log** | sporadic | received_by (text), handed_over_by (text), time (date), signature (canvas) |
| **Date Checking Log** | sporadic | section (select A–Z), checked_by (text), notes (textarea) |

### 3.3 Routes

| Route | Component | Auth |
|---|---|---|
| `/logs` | `LogsPage` | Protected |
| `/logs/library` | `LogLibraryPage` | Protected |
| `/logs/:subscriptionId` | `LogViewPage` | Protected |
| `/logs/:subscriptionId/settings` | `LogSettingsPage` | Protected |
| `/logs/new` | `LogBuilderPage` | Protected |

### 3.4 UI Components

- **`LogsPage`** — org's active log subscriptions with schedule indicators (today's entry: pending / complete / not required).
- **`LogLibraryPage`** — cards of platform logs, "Subscribe" to activate.
- **`LogViewPage`** — the log itself:
  - **Daily logs:** date-on-rows, fields-as-columns grid (spreadsheet-like). Missing days highlighted. Blocked-out exception days greyed.
  - **Sporadic logs:** reverse-chronological entry list with "Add Entry" button.
  - "Add Entry" → modal/drawer form generated from the template's fields.
- **`LogBuilderPage`** — same UX as `FormBuilderPage` (Phase 1) with log-specific settings: title, description, category, schedule type, required days picker (day-of-week checkboxes).
- **`LogSettingsPage`** — edit custom title, field overrides, schedule exceptions.

### 3.5 Canvas / Signature Field

`components/forms/CanvasField.tsx` — reusable across logs and service forms.

- HTML5 `<canvas>` with mouse/touch/stylus drawing support.
- Undo, clear, colour (black only is fine initially).
- Stores as base64 PNG string in entry JSONB `data`.
- No external library needed.

### 3.6 Zustand Store: `useLogStore`

State: `templates`, `subscriptions`, `entries`, `activeTemplate`
Actions: `fetchLogs`, `createEntry`, `subscribeToLibrary`, `buildTemplate`, `fetchEntries`

### 3.7 SideNav

New section **"Logs"**:
- 📓 My Logs → `/logs`
- 📚 Log Library → `/logs/library`

---

## Phase 4 — Video Consultations (Daily Prebuilt)

### 4.1 Approach: Daily Prebuilt

We use [Daily Prebuilt](https://docs.daily.co/reference/daily-js/daily-iframe-class) — Daily's drop-in embedded video UI — rather than building custom video components. This gives us a fully functional video call (camera, mic, screen share, chat, recording) out of the box.

**What we control on our side:**
- **Access gating:** patient must enter a 6-digit access code on our page before the Daily Prebuilt iframe loads. The code is verified against `ps_video_consultations.patient_access_code` via a Supabase RPC.
- **Auto-join for patients:** patient iframe is configured with `showLeaveButton: true, showFullscreenButton: true` but **no pre-join/lobby UI** — they land directly in the call once the access code is verified. Achieved via Daily Prebuilt's `startVideoOff: false, prejoinUI: false` (or `DailyIframe.createFrame({ url, token, showLeaveButton: true })` with auto-join).
- **Patient name auto-fill:** the patient's name from the appointment/consultation record is passed as `userName` to Daily so they don't need to type it.
- **Staff-side controls:** staff see the standard Daily Prebuilt UI but with additional PharmStation controls around it: end consultation button (updates DB status), patient details sidebar, appointment/service context.
- **Room lifecycle:** rooms are created/destroyed via our edge function, not by users directly.

### 4.2 DB Migration: Video Consultations

**`ps_video_consultations`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `patient_id` | uuid FK `ps_patients` | nullable |
| `patient_name` | text | display name for the call |
| `patient_phone` | text | for SMS notification |
| `daily_room_name` | text UNIQUE | |
| `daily_room_url` | text | full URL to Daily room |
| `org_token` | text | Daily meeting token for staff (owner-level) |
| `patient_token` | text | Daily meeting token for patient (short-lived) |
| `patient_access_code` | text | 6-digit numeric code |
| `status` | text | `scheduled \| active \| completed \| cancelled` |
| `appointment_id` | uuid FK `ps_appointments` | nullable — link to appointment if booked via calendar |
| `scheduled_for` | timestamptz | |
| `started_at` | timestamptz | nullable |
| `ended_at` | timestamptz | nullable |
| `created_at` | timestamptz | |

### 4.3 Edge Function: `daily-video`

`supabase/functions/daily-video/index.ts`

Actions via POST body `{ action, ... }`:

**`create_room`:**
1. Calls `POST https://api.daily.co/v1/rooms` with `{ privacy: 'private', properties: { exp: <scheduled_time + 2h>, enable_prejoin_ui: false } }`.
2. Calls `POST https://api.daily.co/v1/meeting-tokens` twice — once for staff (owner, long expiry) and once for patient (participant, short expiry, `user_name` pre-set).
3. Generates random 6-digit `patient_access_code`.
4. Saves row to `ps_video_consultations`.
5. Optionally sends SMS to patient with the public URL + access code (if org has NHS Notify configured — uses the `nhs-notify` function from Phase 5, or skips if not configured).
6. Returns consultation record.

**`verify_access_code`:** (callable without auth — public RPC)
- Input: `consultation_id`, `access_code`.
- If match: returns `{ valid: true, room_url, patient_token, patient_name }`.
- If no match or expired/completed: returns `{ valid: false }`.
- Rate-limited: max 5 attempts per consultation.

**`end_consultation`:**
- Updates status to `completed`, sets `ended_at`.
- Optionally calls `DELETE https://api.daily.co/v1/rooms/{room_name}` to clean up.

**`get_staff_token`:**
- Auth required (staff). Returns fresh `org_token` for the consultation.

Daily API key: `Deno.env.get('DAILY_API_KEY')` (already stored in Supabase secrets).

### 4.4 Routes

| Route | Component | Auth |
|---|---|---|
| `/video` | `VideoConsultsPage` | Protected (staff) |
| `/video/:consultationId` | `VideoRoomPage` | Protected (staff) |
| `/consult/:consultationId` | `PatientVideoPage` | **Public** (no auth) |

### 4.5 UI Components

**`VideoConsultsPage`** (staff):
- Table: patient name, status, scheduled time, actions (Join / Cancel / Copy patient link).
- "New Consultation" → modal: search/select patient, pick date/time, optional appointment link. Creates room via edge function.
- Status badges: scheduled (blue), active (green pulse), completed (grey), cancelled (red).

**`VideoRoomPage`** (staff):
- Full-width Daily Prebuilt iframe embedded via `DailyIframe.createFrame()` or `DailyIframe.wrap()`.
- Staff token used for auth (`token` param).
- Sidebar/overlay with: patient details, appointment context, "End Consultation" button.
- On "End Consultation": calls `end_consultation` edge function, navigates back to `/video`.

**`PatientVideoPage`** (public, no auth):
- **Step 1 — Access Code:** clean minimal page with org branding. Large 6-digit code input (individual digit boxes). "Join Call" button. On submit → calls `verify_access_code` RPC.
- **Step 2 — Video Call:** on valid code, renders Daily Prebuilt iframe with:
  - `url`: `daily_room_url`
  - `token`: `patient_token` (from verify response)
  - `userName`: `patient_name` (auto-filled, patient doesn't type anything)
  - `showLeaveButton`: true
  - `showFullscreenButton`: true
  - No lobby / pre-join UI — patient goes straight into the call.
- Works on mobile browsers (Safari, Chrome) — no app install, no account creation.
- On call end (Daily `left-meeting` event): show "Call ended" screen with pharmacy contact info.

### 4.6 Install

Add to `apps/web/package.json`:

```
@daily-co/daily-js
```

No `@daily-co/daily-react` needed — Prebuilt handles all UI. We only use `daily-js` to create the iframe and listen to events.

### 4.7 SideNav

New item **"Video Consults"**: 📹 → `/video`

---

## Phase 5 — Messaging (NHS Notify / GOV.UK Notify)

### 5.1 DB Migration: Messaging

**`ps_notify_settings`** — per-org NHS Notify credentials

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK UNIQUE | |
| `api_key` | text | stored server-side only, never exposed to client |
| `sms_template_ids` | jsonb | map of template name → NHS Notify template ID |
| `letter_template_ids` | jsonb | map of template name → NHS Notify template ID |
| `is_active` | boolean | default false |
| `created_at` | timestamptz | |

**RLS:** only the owning org can read/update (and `api_key` column should be excluded from client-side select via a view or column-level security).

**`ps_messages`** — sent message log

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `patient_id` | uuid FK `ps_patients` | nullable |
| `recipient_phone` | text | nullable |
| `recipient_address` | jsonb | nullable — for letters |
| `channel` | text | `sms \| letter \| email` |
| `template_id` | text | NHS Notify template ID used |
| `personalisation` | jsonb | template variable values |
| `status` | text | `pending \| sent \| delivered \| failed` |
| `notify_message_id` | text | response ID from NHS Notify |
| `sent_at` | timestamptz | |
| `created_by_user_id` | uuid FK | |
| `created_at` | timestamptz | |

**`ps_broadcasts`** — bulk sends

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `name` | text | |
| `channel` | text | `sms \| letter` |
| `template_id` | text | |
| `personalisation_template` | jsonb | template with placeholders |
| `recipient_filter` | jsonb | criteria to select patients |
| `status` | text | `draft \| sending \| sent \| failed` |
| `total_count` | int | |
| `sent_count` | int | default 0 |
| `created_at` | timestamptz | |
| `created_by_user_id` | uuid FK | |

### 5.2 Edge Function: `nhs-notify`

`supabase/functions/nhs-notify/index.ts`

Actions:

**`send_sms`:**
- Fetches org's API key from `ps_notify_settings` (service-role client).
- POSTs to `https://api.notifications.service.gov.uk/v2/notifications/sms` with `{ phone_number, template_id, personalisation }`.
- Logs to `ps_messages` with returned `notify_message_id`.

**`send_letter`:**
- POSTs to NHS Notify letters endpoint.
- Letters require address fields (`address_line_1` through `address_line_7`) in personalisation.
- Logs to `ps_messages`.

**`send_broadcast`:**
- Fetches patients matching `recipient_filter` from `ps_patients`.
- Iterates `send_sms` or `send_letter` per patient with rate limiting (NHS Notify: 3,000/min for SMS).
- Updates `ps_broadcasts.sent_count` incrementally.

**`check_status`:**
- GET `https://api.notifications.service.gov.uk/v2/notifications/{id}`.
- Updates `ps_messages.status` accordingly.

Org API key is **never** exposed to the client — the edge function fetches it server-side.

### 5.3 Routes

| Route | Component | Auth |
|---|---|---|
| `/messaging` | `MessagingHubPage` | Protected |
| `/messaging/compose` | `ComposeMessagePage` | Protected |
| `/messaging/broadcasts` | `BroadcastsPage` | Protected |
| `/messaging/broadcasts/new` | `NewBroadcastPage` | Protected |
| `/messaging/history` | `MessageHistoryPage` | Protected |

### 5.4 UI Components

- **`MessagingHubPage`** — summary cards (messages today / week / month), quick compose CTA, recent messages table.
- **`ComposeMessagePage`** — select channel (SMS / Letter), search patient, select template, fill personalisation, preview, send.
- **`BroadcastsPage`** — list of broadcasts with status, recipient count, actions.
- **`NewBroadcastPage`** — name, channel, template, recipient filter builder, preview sample, send/schedule.
- **`MessageHistoryPage`** — paginated log with status badges, filter by date/channel/status.

### 5.5 Settings Integration

`SettingsPage` gains a **"Messaging"** tab:
- Input for NHS Notify API key (masked).
- "Test Connection" button (calls edge function to verify key).
- Template manager: list fetched templates, assign friendly names.

### 5.6 SideNav

New section **"Messaging"**:
- 💬 Hub → `/messaging`
- ✏️ Compose → `/messaging/compose`
- 📢 Broadcasts → `/messaging/broadcasts`

---

## Cross-cutting: Patient Management

### Routes

| Route | Component | Auth |
|---|---|---|
| `/patients` | `PatientsPage` | Protected (staff) |
| `/patients/:patientId` | `PatientDetailPage` | Protected (staff) |

### UI

- **`PatientsPage`** — searchable, sortable table of `ps_patients` for the org. Add patient, quick actions.
- **`PatientDetailPage`** — profile, appointment history, message history, linked account status, video consultation history.

### Patient-Facing Routes

| Route | Component | Auth |
|---|---|---|
| `/patient/login` | `PatientLoginPage` | Public |
| `/patient/register` | `PatientRegisterPage` | Public |
| `/patient/appointments` | `PatientAppointmentsPage` | Patient auth |
| `/patient/profile` | `PatientProfilePage` | Patient auth |

Use a separate `PatientLayout` with minimal branding.

---

## Summary: New Database Tables

| # | Table | Phase |
|---|---|---|
| 1 | `ps_patients` | 0 |
| 2 | `ps_service_library` | 1 |
| 3 | `ps_services` | 1 |
| 4 | `ps_service_forms` | 1 |
| 5 | `ps_service_form_fields` | 1 |
| 6 | `ps_appointment_slots` | 2 |
| 7 | `ps_appointments` | 2 |
| 8 | `ps_log_templates` | 3 |
| 9 | `ps_log_fields` | 3 |
| 10 | `ps_log_subscriptions` | 3 |
| 11 | `ps_log_entries` | 3 |
| 12 | `ps_video_consultations` | 4 |
| 13 | `ps_notify_settings` | 5 |
| 14 | `ps_messages` | 5 |
| 15 | `ps_broadcasts` | 5 |

## Summary: New Edge Functions

| Function | Phase | Purpose |
|---|---|---|
| `daily-video` | 4 | Create/manage Daily rooms, verify access codes |
| `nhs-notify` | 5 | Send SMS/letters via GOV.UK Notify |

## Summary: New Dependencies

| Package | Phase | Purpose |
|---|---|---|
| `@fullcalendar/react` + plugins | 2 | Appointment calendar |
| `@daily-co/daily-js` | 4 | Daily Prebuilt iframe control |

## Summary: New Zustand Stores

| Store | Phase |
|---|---|
| `usePatientStore` | 0 |
| `useServiceStore` | 1 |
| `useAppointmentStore` | 2 |
| `useLogStore` | 3 |

## Summary: SideNav (final state)

```
Dashboard
Registers ▾
  CD Register
  AI Scan
  RP Log
  Returns
Services ▾
  Services
  Library
Appointments ▾
  Calendar
  Slots
  Patients
Logs ▾
  My Logs
  Log Library
Video Consults
Messaging ▾
  Hub
  Compose
  Broadcasts
Utilities ▾
  Handover Notes
  SOPs
─────────
✨ Genie
⚙ Settings
```
