# Drug Delivery System — Expansion Plan

## Overview

A full lifecycle module for pharmacies that physically deliver medications to patients' homes. Covers patient medication management, delivery round creation & batching, driver assignment via existing role/permissions system, real-time tracking, signature capture, failed delivery handling with redelivery queue, reusable round templates, and NHS Notify integration.

---

## Core Concepts

### 1. Patient Onboarding & Medication List

Each patient (using existing `ps_patients` table — name, address, phone) has a **persistent medication list** (CRUDable). Medications are searched and selected from the **BNF drug database** (`bnf_medicinal_forms` — 18,488 forms covering all prescription drugs). Each patient-drug record stores:

- Drug reference (FK to `bnf_medicinal_forms`)
- Drug name (denormalised for display)
- Drug form, strength
- Previous dose, quantity
- Active/inactive status
- Notes

**UX flow:** When creating a delivery round, past drugs auto-populate with tick-to-select/deselect. New drugs can be searched & added from the BNF database (not freeform). Drugs can be permanently removed from the patient's medication list.

### 2. Drug Database

The full drug database is already in Supabase — **not just CD drugs**:

| Table | Rows | What |
|---|---|---|
| `bnf_drugs` | 1,709 | Drug monographs (parent lookup) |
| `bnf_medicinal_forms` | 18,488 | **Primary search table** — forms, brands, ingredients, strengths, legal category |
| `bnf_form_packs` | 20,731 | Pack sizes, NHS prices, legal classification (POM/P/GSL) |
| `dmd_amp` | 154,228 | dm+d actual medicinal products (NHS standard) |
| `dmd_ampp` | 172,897 | dm+d product packs with legal category |
| `cdr_drugs_unique` | 957 | CD drugs only (subset, used by CD register) |

Patient medication search hits `bnf_medicinal_forms` joined to `bnf_drugs` for drug name. This covers every prescription drug in the BNF.

### 3. Delivery Round Creation

A **delivery round** is a container that bundles **multiple patients + their selected medications** into a single dispatch run.

- Staff create delivery rounds, pick patients, confirm which meds go in each patient's parcel
- Optionally override the delivery address per patient (temp address for a specific round)
- Add notes per patient
- Assign a driver (any org member with `delivery_drive` permission)
- Set a scheduled delivery date/time window

### 4. Drivers = Roles, Not a Separate Table

Drivers use the **existing role/permissions system**. No separate `ps_delivery_drivers` table.

- Two new permissions added to the existing `Permissions` interface: **`delivery_drive`** and **`delivery_manage`**
- Any org member with `delivery_drive: true` can be assigned as a driver and access the driver view
- Any org member with `delivery_manage: true` can create/edit rounds, manage the dashboard
- Permission resolved via existing `resolvePermissions(role, overrides)` — default role mappings + per-member JSONB overrides
- `driver_id` on delivery rounds → FK to `ps_organisation_members`

**Default permission mappings:**

| Role | `delivery_manage` | `delivery_drive` |
|---|---|---|
| `owner` | `true` | `true` |
| `manager` | `true` | `true` |
| `pharmacist` | `true` | `false` |
| `technician` | `false` | `true` |
| `dispenser` | `false` | `true` |
| `locum` | `false` | `false` |

Any individual can be overridden — e.g. a locum given `delivery_drive: true` via their member JSONB.

### 5. Driver View

Drivers are org members with `delivery_drive` permission.

- Driver sees their assigned route with ordered patients
- Can **tick off** each patient as completed
- **Collect signatures** (touch/draw on device)
- Update round status in real-time
- Post GPS location for live tracking

### 6. Maps & Live Tracking

- Drivers see map-based routes with patients in delivery order
- Central staff dashboard shows live driver positions and round progress on a map
- Route optimisation potential (future enhancement)

### 7. Delivery Round Dashboard

Staff-facing view of all delivery rounds:

- **Ongoing** — currently being delivered
- **Scheduled** — upcoming rounds
- **Completed** — historic rounds with full audit trail
- **Redelivery Queue** — failed patients awaiting redelivery
- Drill into any round for full details (patients, meds, driver, statuses, signatures, timestamps)

### 8. Failed Delivery Handling & Redelivery

When a driver marks a patient as `failed`:

1. Driver enters a **failure reason** (not home, refused, wrong address, etc.)
2. Patient's status in the round becomes `failed`
3. Patient automatically enters the **redelivery queue** — a system-wide list of failed deliveries awaiting action
4. Staff can then:
   - **Move to another round** — add the failed patient (with their original meds) to an existing upcoming round
   - **Create a redelivery round** — quick-create a new round pre-populated with failed patients from the queue
   - **Mark as returned to pharmacy** — meds came back, no further delivery attempt (status: `returned`)
   - **Cancel redelivery** — patient no longer needs it (status: `cancelled`)

**Patient-level statuses (expanded):**

| Status | Meaning |
|---|---|
| `pending` | Awaiting delivery (round in progress or not yet started) |
| `delivered` | Successfully delivered, signature captured |
| `failed` | Delivery attempted but unsuccessful — enters redelivery queue |
| `skipped` | Intentionally skipped this round (e.g. patient called to cancel) |
| `pending_redelivery` | Failed and awaiting assignment to a new round |
| `moved_to_round` | Was failed, now reassigned to another round (links to new round) |
| `returned` | Meds returned to pharmacy, no further delivery |
| `cancelled` | Redelivery cancelled by staff |

**`ps_delivery_round_patients` gets additional columns for redelivery tracking:**

| Column | Type | Notes |
|---|---|---|
| `original_round_patient_id` | uuid FK self | Nullable — if this is a redelivery, points to the original failed record |
| `moved_to_round_patient_id` | uuid FK self | Nullable — if this patient was moved, points to the new record |

This creates a **chain of custody**: original failed delivery → redelivery attempt → final outcome.

### 9. Reusable Round Templates

For pharmacies with regular rounds (e.g. weekly care home deliveries):

- A round can be **saved as a template** — stores the patient list + their default medication selections
- **"Repeat Round"** button on any completed/historic round — clones patients + meds into a new draft round, needing only a new date + driver
- Templates are org-scoped and named (e.g. "Oakwood Care Home — Weekly")
- Template patient lists can be edited independently of actual rounds

### 10. NHS Notify Integration

- On delivery round creation/scheduling, auto-send SMS/email to patients via existing `nhs-notify` edge function
- Notify patients of upcoming delivery date/time window
- On failed delivery, notify patient of redelivery options
- Log notifications in `ps_messages` linked to patient
- Reuse existing messaging store pattern

---

## Existing Assets to Reuse

| Asset | How It's Used |
|---|---|
| `ps_patients` | Patient records with address, phone, name |
| `bnf_medicinal_forms` + `bnf_drugs` | Full drug lookup (search & select, not freeform) |
| `ps_organisation_members` + `Permissions` | Driver = member with `delivery_drive` permission |
| `resolvePermissions()` | Permission checks for driver/manager access |
| `nhs-notify` edge function + messaging store | Send delivery notifications to patients |
| `ps_notify_settings` / `ps_messages` | Track sent notifications |
| Auth model (org-scoped, RLS) | All delivery round tables will be org-scoped with RLS |
| Zustand store pattern | New delivery round & driver stores |
| App routing/layout pattern | New `/delivery-rounds/**` routes |

---

## Phase 1 — Database Schema (Supabase Migration)

### Permission Updates (existing tables)

Add to `Permissions` interface and `DEFAULT_ROLE_PERMISSIONS`:

```typescript
delivery_manage: boolean;  // create/edit/delete rounds, manage dashboard, handle redelivery queue
delivery_drive: boolean;   // access driver view, update patient statuses, submit signatures, post GPS
```

### New Tables

#### `ps_patient_medications`

Persistent patient drug list.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organisation_id` | uuid FK `ps_organisations` | NOT NULL, org-scoped |
| `patient_id` | uuid FK `ps_patients` | NOT NULL |
| `drug_id` | uuid FK `bnf_medicinal_forms` | NOT NULL |
| `drug_name` | text | Denormalised for display (brand/generic name) |
| `drug_form` | text | e.g. tablet, capsule, oral solution |
| `drug_strength` | text | e.g. 10mg, 5mg/5ml |
| `dose` | text | e.g. "1 tablet twice daily" |
| `quantity` | integer | Default supply quantity |
| `is_active` | boolean | Default `true`, soft-delete |
| `notes` | text | Nullable |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | Auto-managed via trigger |

**Indexes:** `(patient_id)`, `(organisation_id)`, `(patient_id, drug_id)` unique.

#### `ps_delivery_rounds`

A delivery round — a single dispatch run containing multiple patients.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organisation_id` | uuid FK `ps_organisations` | NOT NULL |
| `title` | text | Optional friendly name, e.g. "Morning Round" |
| `status` | text | `draft`, `scheduled`, `in_progress`, `completed`, `cancelled` |
| `scheduled_date` | date | Nullable — when the round is planned |
| `scheduled_time_start` | time | Nullable — delivery window start |
| `scheduled_time_end` | time | Nullable — delivery window end |
| `driver_id` | uuid FK `ps_organisation_members` | Nullable — assigned driver (must have `delivery_drive` permission) |
| `template_id` | uuid FK `ps_delivery_round_templates` | Nullable — if created from a template |
| `notes` | text | Nullable |
| `created_by` | uuid FK `ps_user_profiles` | Who created this round |
| `started_at` | timestamptz | When driver started the route |
| `completed_at` | timestamptz | When all patients resolved |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | Auto-managed |

**Indexes:** `(organisation_id)`, `(status)`, `(driver_id)`, `(scheduled_date)`, `(template_id)`.

#### `ps_delivery_round_patients`

Junction: which patients are in a delivery round, with per-patient delivery details.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `round_id` | uuid FK `ps_delivery_rounds` | NOT NULL |
| `patient_id` | uuid FK `ps_patients` | NOT NULL |
| `organisation_id` | uuid FK `ps_organisations` | NOT NULL |
| `delivery_order` | integer | Order in the route |
| `status` | text | `pending`, `delivered`, `failed`, `skipped`, `pending_redelivery`, `moved_to_round`, `returned`, `cancelled` |
| `delivery_address_line_1` | text | Override address (nullable — defaults to patient address) |
| `delivery_address_line_2` | text | Nullable |
| `delivery_city` | text | Nullable |
| `delivery_postcode` | text | Nullable |
| `notes` | text | Per-patient delivery notes |
| `signature_data` | text | Base64 signature or storage URL |
| `delivered_at` | timestamptz | When this patient's delivery was completed |
| `failure_reason` | text | If status = `failed` or `pending_redelivery` |
| `original_round_patient_id` | uuid FK self | Nullable — if this is a redelivery, links to the original failed record |
| `moved_to_round_patient_id` | uuid FK self | Nullable — if moved to another round, links to the new record |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | Auto-managed |

**Indexes:** `(round_id)`, `(patient_id)`, `(round_id, patient_id)` unique, `(status)` partial index on `pending_redelivery` for the redelivery queue.

#### `ps_delivery_patient_medications`

Which medications go to which patient in which delivery round ("what's in the bag").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `delivery_round_patient_id` | uuid FK `ps_delivery_round_patients` | NOT NULL |
| `patient_medication_id` | uuid FK `ps_patient_medications` | NOT NULL |
| `quantity` | integer | Quantity for this specific delivery |
| `notes` | text | Nullable |
| `created_at` | timestamptz | Default `now()` |

**Indexes:** `(delivery_round_patient_id)`, `(delivery_round_patient_id, patient_medication_id)` unique.

#### `ps_delivery_round_templates`

Saved round templates for repeatable rounds.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organisation_id` | uuid FK `ps_organisations` | NOT NULL |
| `name` | text | NOT NULL — e.g. "Oakwood Care Home — Weekly" |
| `notes` | text | Nullable |
| `created_by` | uuid FK `ps_user_profiles` | NOT NULL |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | Auto-managed |

**Indexes:** `(organisation_id)`.

#### `ps_delivery_round_template_patients`

Patients in a template.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `template_id` | uuid FK `ps_delivery_round_templates` | NOT NULL, CASCADE delete |
| `patient_id` | uuid FK `ps_patients` | NOT NULL |
| `delivery_order` | integer | Default order in route |
| `delivery_address_line_1` | text | Nullable override |
| `delivery_address_line_2` | text | Nullable |
| `delivery_city` | text | Nullable |
| `delivery_postcode` | text | Nullable |
| `notes` | text | Nullable |
| `include_all_active_meds` | boolean | Default `true` — auto-include all active patient meds when round is created from template |
| `created_at` | timestamptz | Default `now()` |

**Indexes:** `(template_id)`, `(template_id, patient_id)` unique.

#### `ps_delivery_round_template_medications`

Specific medication selections per patient in template (only used when `include_all_active_meds = false`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `template_patient_id` | uuid FK `ps_delivery_round_template_patients` | NOT NULL, CASCADE delete |
| `patient_medication_id` | uuid FK `ps_patient_medications` | NOT NULL |
| `default_quantity` | integer | Nullable — override default quantity for this template |
| `created_at` | timestamptz | Default `now()` |

**Indexes:** `(template_patient_id)`.

#### `ps_delivery_location_updates`

Real-time driver GPS pings for live tracking.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `round_id` | uuid FK `ps_delivery_rounds` | NOT NULL |
| `driver_id` | uuid FK `ps_organisation_members` | NOT NULL |
| `latitude` | double precision | NOT NULL |
| `longitude` | double precision | NOT NULL |
| `recorded_at` | timestamptz | Default `now()` |

**Indexes:** `(round_id, recorded_at)`, `(driver_id)`.

### RLS Policy Pattern

All tables follow the existing org-scoped pattern:

- **SELECT/INSERT/UPDATE/DELETE** for org members: `organisation_id IN (SELECT organisation_id FROM ps_organisation_members WHERE user_id = auth.uid())`
- Driver-specific write policies for `ps_delivery_location_updates` and patient status updates — requires `delivery_drive` permission via JSONB check
- Round management (create/edit/delete) — requires `delivery_manage` permission

---

## Phase 2 — TypeScript Types (`@pharmstation/types`)

### Permission Updates

```typescript
// Add to existing Permissions interface
delivery_manage?: boolean;
delivery_drive?: boolean;
```

### New Interfaces

```typescript
// ── Patient Medications ──

export interface PatientMedication {
  id: string;
  organisation_id: string;
  patient_id: string;
  drug_id: string;
  drug_name: string;
  drug_form: string;
  drug_strength: string;
  dose: string | null;
  quantity: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Delivery Round Statuses ──

export type DeliveryRoundStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export type DeliveryPatientStatus =
  | 'pending'              // awaiting delivery
  | 'delivered'            // successfully delivered
  | 'failed'               // attempted, unsuccessful
  | 'skipped'              // intentionally skipped
  | 'pending_redelivery'   // failed, in redelivery queue
  | 'moved_to_round'       // reassigned to another round
  | 'returned'             // meds returned to pharmacy
  | 'cancelled';           // redelivery cancelled

// ── Delivery Round ──

export interface DeliveryRound {
  id: string;
  organisation_id: string;
  title: string | null;
  status: DeliveryRoundStatus;
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  driver_id: string | null;
  template_id: string | null;
  notes: string | null;
  created_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  driver?: OrganisationMember;
  patients?: DeliveryRoundPatient[];
}

// ── Delivery Round Patient ──

export interface DeliveryRoundPatient {
  id: string;
  round_id: string;
  patient_id: string;
  organisation_id: string;
  delivery_order: number;
  status: DeliveryPatientStatus;
  delivery_address_line_1: string | null;
  delivery_address_line_2: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  notes: string | null;
  signature_data: string | null;
  delivered_at: string | null;
  failure_reason: string | null;
  original_round_patient_id: string | null;
  moved_to_round_patient_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  patient?: Patient;
  medications?: DeliveryPatientMedication[];
}

// ── Delivery Patient Medication ──

export interface DeliveryPatientMedication {
  id: string;
  delivery_round_patient_id: string;
  patient_medication_id: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  // Joined data
  patient_medication?: PatientMedication;
}

// ── Delivery Round Template ──

export interface DeliveryRoundTemplate {
  id: string;
  organisation_id: string;
  name: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined data
  patients?: DeliveryRoundTemplatePatient[];
}

export interface DeliveryRoundTemplatePatient {
  id: string;
  template_id: string;
  patient_id: string;
  delivery_order: number;
  delivery_address_line_1: string | null;
  delivery_address_line_2: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  notes: string | null;
  include_all_active_meds: boolean;
  created_at: string;
  // Joined data
  patient?: Patient;
  medications?: DeliveryRoundTemplateMedication[];
}

export interface DeliveryRoundTemplateMedication {
  id: string;
  template_patient_id: string;
  patient_medication_id: string;
  default_quantity: number | null;
  created_at: string;
  // Joined data
  patient_medication?: PatientMedication;
}

// ── Location Update ──

export interface DeliveryLocationUpdate {
  id: string;
  round_id: string;
  driver_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
}
```

---

## Phase 3 — Zustand Stores (`@pharmstation/core`)

### `patient-medication-store.ts`

- `fetchMedications(patientId)` — load patient's medication list
- `addMedication(patientId, drugId, form, strength, dose, quantity)` — add drug to patient's list
- `updateMedication(id, updates)` — edit dose, quantity, notes
- `removeMedication(id)` — permanently delete from patient's list
- `toggleActive(id)` — soft toggle active/inactive
- `searchDrugs(query)` — search `bnf_medicinal_forms` + `bnf_drugs` for drug lookup

### `delivery-round-store.ts`

- `fetchRounds(filters)` — dashboard data (ongoing, scheduled, completed)
- `fetchRound(id)` — single round with nested patients + medications
- `createRound(data)` — create new delivery round (draft)
- `createRoundFromTemplate(templateId)` — create draft round from a saved template
- `repeatRound(roundId)` — clone a completed round into a new draft
- `updateRound(id, updates)` — edit round details
- `cancelRound(id)` — cancel a round
- `addPatientToRound(roundId, patientId, medications[])` — add patient + their meds to round
- `removePatientFromRound(deliveryRoundPatientId)` — remove patient from round
- `assignDriver(roundId, driverId)` — assign/change driver (must have `delivery_drive` permission)
- `fetchAvailableDrivers()` — list org members with `delivery_drive: true`
- `scheduleRound(roundId, date, timeStart, timeEnd)` — move to scheduled status
- `startRound(roundId)` — move to in_progress
- `completeRound(roundId)` — move to completed
- `subscribeToRound(roundId)` — Supabase Realtime subscription for live updates
- `sendRoundNotifications(roundId)` — trigger NHS Notify SMS to all patients in round
- **Redelivery queue:**
  - `fetchRedeliveryQueue()` — all patients with `pending_redelivery` status org-wide
  - `movePatientToRound(failedPatientId, targetRoundId)` — move failed patient + meds to another round
  - `createRedeliveryRound(failedPatientIds[])` — quick-create new round from selected failed patients
  - `markReturned(deliveryRoundPatientId)` — meds returned to pharmacy
  - `cancelRedelivery(deliveryRoundPatientId)` — no further delivery needed
- **Templates:**
  - `fetchTemplates()` — list all templates for this org
  - `fetchTemplate(id)` — template with patients + meds
  - `saveAsTemplate(roundId, name)` — save a round's patient/med config as a template
  - `createTemplate(name, patients[])` — create template from scratch
  - `updateTemplate(id, updates)` — edit template
  - `deleteTemplate(id)` — remove template

### `driver-store.ts`

- `fetchAssignedRounds()` — driver's assigned delivery rounds (uses current user's member ID)
- `fetchRoundRoute(roundId)` — ordered patients with med details
- `updatePatientStatus(deliveryRoundPatientId, status, signatureData?)` — tick off / mark failed
- `submitSignature(deliveryRoundPatientId, signatureBase64)` — capture signature
- `postLocationUpdate(roundId, lat, lng)` — GPS ping
- `subscribeToRoute(roundId)` — Realtime subscription

---

## Phase 4 — Web Pages

### Staff Side

| Route | Component | Purpose |
|---|---|---|
| `/delivery-rounds` | `DeliveryRoundDashboardPage` | Overview: ongoing, scheduled, completed, redelivery queue with filters & search |
| `/delivery-rounds/new` | `NewDeliveryRoundPage` | Multi-step: pick patients → select meds → assign driver → set schedule → review & create |
| `/delivery-rounds/:id` | `DeliveryRoundDetailPage` | Full detail: patients, meds, driver, live status, signatures, map, timeline |
| `/delivery-rounds/:id/edit` | `EditDeliveryRoundPage` | Edit draft/scheduled round |
| `/delivery-rounds/redelivery` | `RedeliveryQueuePage` | View all failed deliveries, move to rounds, create redelivery rounds, mark returned |
| `/delivery-rounds/templates` | `RoundTemplatesPage` | Manage reusable round templates (CRUD) |
| `/delivery-rounds/templates/:id` | `RoundTemplateDetailPage` | Edit template patients + meds |
| `/patients/:id` | (Extend existing) | Add "Medications" tab to patient detail page |

### Driver Side

| Route | Component | Purpose |
|---|---|---|
| `/driver` | `DriverDashboardPage` | Driver's assigned rounds for today/upcoming |
| `/driver/:roundId` | `DriverRoutePage` | Map + ordered patient list with tick-off + signature capture |

---

## Phase 5 — NHS Notify Integration

### Notification Triggers

1. **Round Scheduled** — SMS to each patient: "Your medication delivery has been scheduled for {date}. Expected between {time_start} – {time_end}."
2. **Driver En Route** (optional) — SMS: "Your delivery is on its way! Estimated arrival: {eta}."
3. **Patient Delivered** — SMS: "Your medication has been delivered. If you have any concerns, contact {pharmacy_name} on {phone}."
4. **Patient Failed** — SMS: "We were unable to deliver your medication today. Please contact {pharmacy_name} on {phone} to arrange redelivery."
5. **Redelivery Scheduled** — SMS: "Your medication redelivery has been scheduled for {date}. Expected between {time_start} – {time_end}."

### Implementation

```typescript
// In delivery-round-store.ts
async sendRoundNotifications(roundId: string, templateType: 'scheduled' | 'en_route' | 'delivered' | 'failed' | 'redelivery_scheduled') {
  const round = await this.fetchRound(roundId);
  const messagingStore = useMessagingStore.getState();
  
  for (const rp of round.patients) {
    if (rp.patient?.phone) {
      await messagingStore.sendMessage({
        channel: 'sms',
        to: rp.patient.phone,
        body: buildDeliveryMessage(templateType, round, rp),
        patient_id: rp.patient_id,
      });
    }
  }
}
```

---

## Phase 6 — Maps & Live Tracking (Enhancement)

### Technology

- **Leaflet + OpenStreetMap** (free, no API key needed) OR **Mapbox GL** (better UX, requires key)
- **Supabase Realtime** for broadcasting driver location to staff dashboard

### Features

1. **Driver Route Map** — Ordered patients plotted on map with route line
2. **Driver Location Broadcasting** — Driver posts GPS every 30s via `ps_delivery_location_updates`, staff dashboard subscribes via Supabase Realtime
3. **Staff Round Map** — Birds-eye view of all active rounds with driver positions
4. **Geocoding** — Convert patient postcodes to lat/lng for map plotting (UK postcode API or Nominatim)

---

## Delivery Round Lifecycle State Machine

### Round-level

```
draft → scheduled → in_progress → completed
  ↓         ↓            ↓
cancelled  cancelled   (all patients must be resolved)
```

### Patient-level (within a round)

```
pending → delivered ✓
   ↓
 failed → pending_redelivery → moved_to_round (→ new round's patient is 'pending')
   ↓              ↓
 skipped       returned (meds back at pharmacy)
                  ↓
               cancelled (no further action)
```

### Round Status Transitions

| From | To | Trigger |
|---|---|---|
| `draft` | `scheduled` | Staff sets date + driver |
| `draft` | `cancelled` | Staff cancels |
| `scheduled` | `in_progress` | Driver starts round |
| `scheduled` | `cancelled` | Staff cancels |
| `in_progress` | `completed` | All patients resolved (delivered/failed/skipped) |

### Patient Status Transitions

| From | To | Trigger |
|---|---|---|
| `pending` | `delivered` | Driver marks delivered + signature |
| `pending` | `failed` | Driver marks failed + reason |
| `pending` | `skipped` | Driver/staff skips patient |
| `failed` | `pending_redelivery` | Automatic (or staff confirms) |
| `pending_redelivery` | `moved_to_round` | Staff moves to another round |
| `pending_redelivery` | `returned` | Staff marks meds returned to pharmacy |
| `pending_redelivery` | `cancelled` | Staff cancels redelivery |

---

## File Structure

```
supabase/migrations/
  20260226_delivery_system.sql

packages/types/src/
  index.ts                              (add new interfaces + permission updates)

packages/core/src/stores/
  patient-medication-store.ts           (new)
  delivery-round-store.ts              (new)
  driver-store.ts                       (new)

apps/web/src/pages/delivery-rounds/
  DeliveryRoundDashboardPage.tsx        (new)
  NewDeliveryRoundPage.tsx              (new)
  DeliveryRoundDetailPage.tsx           (new)
  EditDeliveryRoundPage.tsx             (new)
  RedeliveryQueuePage.tsx               (new)
  RoundTemplatesPage.tsx                (new)
  RoundTemplateDetailPage.tsx           (new)

apps/web/src/pages/driver/
  DriverDashboardPage.tsx               (new)
  DriverRoutePage.tsx                   (new)

apps/web/src/components/delivery-rounds/
  DeliveryRoundCard.tsx                 (new)
  DeliveryRoundStatusBadge.tsx          (new)
  PatientMedicationSelector.tsx         (new)
  DrugSearchInput.tsx                   (new)
  SignatureCapture.tsx                  (new)
  DeliveryRoundMap.tsx                  (new)
  DriverLocationMap.tsx                 (new)
  DeliveryRoundTimeline.tsx             (new)
  RedeliveryQueueTable.tsx              (new)

apps/web/src/App.tsx                    (add new routes)
```

---

## Implementation Order

1. **Permission updates** — add `delivery_manage` + `delivery_drive` to types + default role matrix
2. **Database migration** — all tables + RLS + indexes
3. **TypeScript types** — all new interfaces
4. **Patient medication store** — CRUD + BNF drug search
5. **Delivery round store** — core round CRUD + patient/med management + redelivery queue + templates
6. **Driver store** — driver-side operations
7. **Staff pages** — Dashboard → New Round → Detail → Redelivery Queue → Templates
8. **Driver pages** — Dashboard → Route with signature capture
9. **NHS Notify integration** — round notification triggers
10. **Maps** — route visualisation + live tracking
11. **Polish** — error handling, loading states, edge cases
