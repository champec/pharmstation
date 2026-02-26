# Delivery Round System — Development Milestones

> Last updated: 2026-02-26

---

## Phase 1: Permission Updates ✅
- [x] Add `delivery_manage` and `delivery_drive` to `Permissions` interface
- [x] Add defaults to `DEFAULT_ROLE_PERMISSIONS` matrix
- [x] Verify `resolvePermissions()` picks up new keys

## Phase 2: Database Migration ✅
- [x] `ps_patient_medications` table + RLS + indexes
- [x] `ps_delivery_rounds` table + RLS + indexes
- [x] `ps_delivery_round_patients` table + RLS + indexes (incl. redelivery columns)
- [x] `ps_delivery_patient_medications` table + RLS + indexes
- [x] `ps_delivery_round_templates` table + RLS + indexes
- [x] `ps_delivery_round_template_patients` table + RLS + indexes
- [x] `ps_delivery_round_template_medications` table + RLS + indexes
- [x] `ps_delivery_location_updates` table + RLS + indexes
- [x] `updated_at` triggers for relevant tables
- [x] Partial index on `pending_redelivery` status

## Phase 3: TypeScript Types ✅
- [x] `PatientMedication` interface
- [x] `DeliveryRoundStatus` + `DeliveryPatientStatus` types
- [x] `DeliveryRound` interface
- [x] `DeliveryRoundPatient` interface
- [x] `DeliveryPatientMedication` interface
- [x] `DeliveryRoundTemplate` + child interfaces
- [x] `DeliveryLocationUpdate` interface

## Phase 4: Zustand Stores ✅
- [x] `patient-medication-store.ts` — CRUD + BNF drug search
- [x] `delivery-round-store.ts` — round CRUD
- [x] `delivery-round-store.ts` — patient/med management within rounds
- [x] `delivery-round-store.ts` — redelivery queue actions
- [x] `delivery-round-store.ts` — template CRUD + create-from-template + repeat-round
- [x] `delivery-round-store.ts` — NHS Notify integration
- [x] `delivery-round-store.ts` — Supabase Realtime subscriptions
- [x] `driver-store.ts` — assigned rounds + route fetching
- [x] `driver-store.ts` — patient status updates + signature submission
- [x] `driver-store.ts` — GPS location posting + Realtime

## Phase 5: Staff Pages ✅
- [x] `DeliveryRoundDashboardPage` — list rounds with filters (ongoing/scheduled/completed)
- [x] `NewDeliveryRoundPage` — multi-step round creation wizard
- [x] `DeliveryRoundDetailPage` — full round detail with live status + route map
- [x] `EditDeliveryRoundPage` — edit draft/scheduled rounds
- [x] `RedeliveryQueuePage` — triage failed deliveries
- [x] `RoundTemplatesPage` — list/manage templates
- [x] `RoundTemplateDetailPage` — edit template patients + meds

## Phase 6: Driver Pages ✅
- [x] `DriverDashboardPage` — assigned rounds for today/upcoming
- [x] `DriverRoutePage` — ordered patient list + tick-off + signature capture

## Phase 7: Shared Components ✅
- [x] `DeliveryStatusBadge` — RoundStatusBadge + PatientStatusBadge reusable components
- [x] `SignatureCapture` — touch/draw signature pad with ref API (clear, getDataUrl, isEmpty)
- [x] `DeliveryRouteMap` — Mapbox GL map with patient pins, driver live location, postcode geocoding

## Phase 8: Routing ✅
- [x] Add `/delivery-rounds/**` routes to `App.tsx` (7 routes)
- [x] Add `/driver/**` routes to `App.tsx` (2 routes)
- [x] Navigation sidebar entries for Delivery Rounds + Driver sections

## Phase 9: NHS Notify Integration ✅
- [x] `sendRoundNotifications()` in delivery-round-store — sends SMS to all patients in round
- [x] "Notify Patients" button on DeliveryRoundDetailPage for scheduled/in_progress rounds
- [x] Auto-generated message with date/time window

## Phase 10: Maps & Live Tracking ✅
- [x] `DeliveryRouteMap` component using Mapbox GL + react-map-gl
- [x] Patient markers with delivery order numbers, colour-coded by status
- [x] Bulk UK postcode geocoding via postcodes.io API
- [x] Live driver position via Supabase Realtime on `ps_delivery_location_updates`
- [x] GPS posting from driver view via `navigator.geolocation.watchPosition`
- [x] Map auto-fits to all patient markers

## Phase 11: Polish
- [x] Loading states on all pages
- [x] Error handling + dismiss buttons
- [x] Empty states for no rounds/no patients/no templates
- [x] Fixed RoundTemplateDetailPage import issues

---

## Post-Build Bug Fixes & Improvements ✅

### Bug: Map Constructor Error ✅
- **Symptom**: `Map is not a constructor` error when rendering `DeliveryRouteMap`
- **Root Cause**: The `Map` import from `react-map-gl/mapbox` was shadowing JavaScript's built-in `Map` constructor, used elsewhere in the component for data lookups
- **Fix**: Renamed the import to `MapGL` and updated all JSX tags (`<MapGL>` / `</MapGL>`) in `DeliveryRouteMap.tsx`

### Feature: Configure Medications Modal ✅
- **Problem**: No way to configure patient medications on the New Round page — old inline editing was removed
- **Solution**: Full rewrite of `NewDeliveryRoundPage.tsx` (796 lines) with a new modal-based approach:
  - ⚙️ gear icon button on each patient card opens a **Configure Medications** modal
  - Modal shows all existing patient medications with checkboxes, quantity overrides, active/inactive badges, and delete buttons
  - **＋ Add Drug** sub-section within the modal with live BNF drug search (18k+ medicinal forms)
  - Patient cards display medication count badge and pill tag summary
  - State management: `showConfigMedsModal`, `configMedsPatientId`, `configMedsPatientName`, `configMedsLoading`, `showAddDrug`

### Bug: Patient Search Not Working ✅
- **Symptom**: Patient search dropdown always empty when typing in the round creation wizard
- **Root Cause** (two bugs in `appointment-store.ts` → `searchPatients`):
  1. Never called `set({ patients: results })` — store state was never updated with search results
  2. Single-string ilike wasn't fuzzy enough for multi-word queries
- **Fix**: Rewrote search with word-splitting fuzzy logic:
  - Single word: matches `first_name`, `last_name`, `nhs_number`, `phone`, `email`
  - Multiple words: each word must match `first_name` OR `last_name` (e.g. "John Smith")
  - Properly calls `set({ patients: results })` to update the store

### Bug: FK Constraint Error When Adding Medications ✅
- **Symptom**: Foreign key violation when adding a drug to a patient via the Configure Medications modal
- **Root Cause**: `ps_patient_medications.drug_id` references `bnf_medicinal_forms(id)`, but code was passing `selectedDrug.drug_id` which is the parent `bnf_drugs.id`
- **Fix**: Changed to `selectedDrug.id` (which is `bnf_medicinal_forms.id`, the correct FK target)
- **Key Mapping**: `BnfDrugSearchResult.id` = `bnf_medicinal_forms.id` ✓ / `.drug_id` = `bnf_drugs.id` ✗

### Setup: Driver Permission for Test User ✅
- **Task**: Make sample user also function as a delivery driver
- **Fix**: Updated `ps_organisation_members` permissions for membership ID `69109e24-8bf0-4935-a193-b5ce7f9a022e` to include `{"delivery_drive": true}`

### Bug: Driver Dashboard Shows No Assigned Deliveries ✅
- **Symptom**: After assigning John Smith as driver to a round, the driver dashboard says "not assigned to any deliveries"
- **Root Cause**: Round was created with `status: 'draft'` (no scheduled date was set), but `fetchAssignedRounds` in `driver-store.ts` only queried for `'scheduled'` and `'in_progress'` rounds — draft rounds were invisible to drivers
- **Investigation**: Verified via SQL that `driver_id` on the round correctly matches the membership row ID, and confirmed `membership.id` from the auth store is the `ps_organisation_members` primary key
- **Fix** (two changes):
  1. **`driver-store.ts`**: Added `'draft'` to the status filter in `fetchAssignedRounds` → `.in('status', ['draft', 'scheduled', 'in_progress'])`
  2. **`DriverDashboardPage.tsx`**: Added a new **"📝 Draft (Awaiting Schedule)"** section that displays draft rounds with distinct styling (slightly dimmed, "Draft" badge, "View Details" button)
- **Note**: The `NewDeliveryRoundPage` already sets `status: 'scheduled'` when a date is provided — drafts only occur when no date is set

---

## Files Modified (Post-Build)

| File | Changes |
|---|---|
| `apps/web/src/components/maps/DeliveryRouteMap.tsx` | Renamed `Map` import → `MapGL`, updated JSX tags |
| `apps/web/src/pages/delivery-rounds/NewDeliveryRoundPage.tsx` | Full rewrite — ⚙️ Configure Medications modal, BNF drug search, patient cards with med badges |
| `packages/core/src/stores/appointment-store.ts` | Rewrote `searchPatients` with fuzzy word-split matching + store update |
| `packages/core/src/stores/driver-store.ts` | Added `'draft'` to `fetchAssignedRounds` status filter |
| `apps/web/src/pages/driver/DriverDashboardPage.tsx` | Added draft rounds section with "Awaiting Schedule" heading |
| DB: `ps_organisation_members` | Added `delivery_drive: true` permission for test user |

---

## Progress Notes

| Date | Note |
|---|---|
| 2026-02-26 | Plan finalised. Driver uses existing role/ACL system. Drug search uses BNF (18k+ forms). Redelivery queue + reusable templates designed. |
| 2026-02-26 | All 11 phases complete. Full delivery round system built: 8 DB tables, 3 Zustand stores, 9 pages, 3 shared components, routing, NHS Notify, Mapbox maps. |
| 2026-02-26 | Post-build session: Fixed 4 bugs (Map constructor, patient search, FK constraint, driver dashboard visibility), added Configure Medications modal, set up driver permissions for test user. 6 files modified. |
