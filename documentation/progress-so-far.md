# PharmStation — Progress Log

## Session 1 — 13 Feb 2026

### Database
- [x] Explored existing Supabase DB (cdr_drugs_unique: 957 CD2 drugs)
- [x] Created all `ps_` tables (organisations, user_profiles, members, sessions, ledgers, entries, annotations, contacts, audit_log)
- [x] Created `ps_make_register_entry()` function with locking + validation
- [x] Created immutability triggers (no UPDATE/DELETE on entries)
- [x] Created auto-learn contacts trigger
- [x] Created audit log trigger
- [x] Enabled RLS on all tables + wrote policies
- [x] Created `ps_handle_new_auth_user()` trigger (auto-creates profile on signup)
- [x] Added `ps_members_select_own` policy (circular RLS fix)
- [x] Fixed RLS infinite recursion (42P17) — created `ps_get_user_org_ids()` SECURITY DEFINER function, rewired all cross-table policies
- [x] Saved migrations to `supabase/migrations/`

### Test Data
- [x] Created org account: `testpharmacy@pharmstation.dev` / `[password removed — see password manager]`
- [x] Created user account: `testuser@pharmstation.dev` / `[password removed — see password manager]`
- [x] Created org→user membership (pharmacist, active)
- [x] Fixed GoTrue NULL column issue for manual auth inserts

### Packages
- [x] `@pharmstation/types` — all entity interfaces, permissions map
- [x] `@pharmstation/supabase-client` — dual client (org + user), auth helpers
- [x] `@pharmstation/core` — Zustand stores (auth, UI, register)
- [x] `@pharmstation/ui` — CSS design tokens, global reset, utility classes

### Web App
- [x] Vite 6 + React 19 setup
- [x] React Router v7 with nested layouts
- [x] Auth pages (OrgLoginPage, UserLoginPage)
- [x] DashboardLayout (SideNav, TopNav, RightPanel)
- [x] DashboardPage (module card grid)
- [x] CDRegisterPage (drug class accordion → drug cards)
- [x] CDLedgerPage (TanStack Table v8 for entries)
- [x] CDEntryForm (React Hook Form + Zod + contact autocomplete)
- [x] RegisterTable component (reusable TanStack wrapper)
- [x] Modal component
- [x] Table, modal, form CSS
- [x] Fixed auth race condition (SIGNED_IN listener removed)
- [x] Hard-coded test credentials in login forms (dev convenience)
- [x] Installed turbo as dev dependency
- [x] Filtered turbo dev to web app only

### Documentation
- [x] tab9.txt — implementation summary
- [x] progress-so-far.md — this file

### Not Started (at Session 1)
- [ ] RP Log page (functional)
- [ ] Returns Register page (functional)
- [ ] Settings page (functional)
- [ ] Inline draft row editing in tables
- [ ] Handover Notes canvas
- [ ] Print functionality
- [ ] Correction entry flow
- [ ] AI scan entry source
- [ ] Realtime subscriptions
- [ ] Offline sync
- [ ] Desktop (Tauri) app
- [ ] Mobile (React Native) app

---

## Sessions 2–5 — 14–26 Feb 2026

> Note: Progress log was not kept up to date during this period. The following reflects the state of the app as observed on 3 Mar 2026.

### Database (additional migrations applied)
- [x] `20260214_ai_models_and_chat.sql` — AI/Genie models and chat tables
- [x] `20260214_subscribed_registers.sql` — subscribed register tables
- [x] `20260215_ai_scan_system.sql` — AI scan queue and results
- [x] `20260215_contact_names_prescriber_reg.sql` — contact name + prescriber reg fields
- [x] `20260216_cd_balance_checks.sql` — CD balance check/audit tables
- [x] `20260219_appointments.sql` — appointments, slots, availability
- [x] `20260219_logs.sql` — log templates, fields, subscriptions, entries
- [x] `20260219_org_public_profile.sql` — org slug, public profile fields
- [x] `20260219_patient_auth_trigger.sql` — patient account type trigger
- [x] `20260219_patients.sql` — ps_patients table
- [x] `20260219_service_deliveries.sql` — service delivery records
- [x] `20260219_services.sql` — ps_service_library, ps_services, forms, fields
- [x] `20260226_delivery_system.sql` — delivery rounds, routes, driver tracking
- [x] `20260226_nhs_claims_schema.sql` — NHS claim submission infrastructure

### Web App Pages Built (observed state 3 Mar 2026)
- [x] RPLogPage — functional
- [x] ReturnsPage — functional
- [x] RegistersPage + ScanQueuePage
- [x] SettingsPage
- [x] ServicesPage, ServiceLibraryPage, ServiceDetailPage, FormBuilderPage
- [x] ServiceDeliveriesPage, ServiceDeliveryPage
- [x] AppointmentsCalendarPage, AppointmentSlotsPage, AppointmentDetailPage, NewAppointmentPage
- [x] LogsPage, LogLibraryPage, LogBuilderPage, LogViewPage, LogSettingsPage
- [x] DeliveryRoundDashboardPage, DeliveryRoundDetailPage, NewDeliveryRoundPage, EditDeliveryRoundPage
- [x] RoundTemplatesPage, RoundTemplateDetailPage, RedeliveryQueuePage
- [x] NHSHubPage, NHSClaimsPage, NHSClaimDetailPage
- [x] MessagingHubPage, ComposeMessagePage, BroadcastsPage, NewBroadcastPage, MessageHistoryPage
- [x] VideoConsultsPage, VideoRoomPage
- [x] PatientsPage + patient portal pages
- [x] Public booking pages (`/book/[slug]`)
- [x] SOPs pages, Notes pages

### Status as of 3 Mar 2026
- Platform is feature-complete for core operations
- Awaiting NHS onboarding approval to activate NHS integrations
- Locum expansion planning completed — see `documentation/locum/locum-expansion-plan.md`

---

## Session — 28 Feb 2026 (NHS 111 Integration — Phases 1-3)

### Phase 1 — Backend (Database + Edge Functions)
- [x] Created `ps_nhs111_referrals` table (30+ columns, RLS, indexes, Realtime, trigger)
- [x] Created `packages/types/src/nhs.ts` — NHS 111 type definitions (~250 lines)
- [x] Deployed `nhs111-receive` edge function (v2) — FHIR STU3 → database processor (~500 lines)
- [x] Deployed `get-ods-dos-codes` edge function (v7) — returns ODS codes & DoS IDs

### Phase 2 — Frontend
- [x] Created `packages/core/src/stores/nhs111-store.ts` — Zustand store with Realtime subscription
- [x] Created NHS 111 Queue Page — real-time referral list with priority indicators
- [x] Created NHS 111 Detail Page — full patient info, encounter details, action buttons
- [x] Added routing (`/services/nhs111`, `/services/nhs111/:id`)
- [x] Added SideNav link under Services section

### Phase 3 — Infrastructure + Deployment
- [x] Created `infrastructure/nhs111/` — docker-compose, bridge, Dockerfile, .env.example
- [x] Deployed RabbitMQ on Railway
- [x] Deployed NHS 111 Adaptor (`nhsdev/nia-111-adaptor:1.0.5-amd64`) on Railway
- [x] Deployed Bridge (Node.js AMQP→Supabase forwarder) on Railway
- [x] Fixed CgroupV2 crash (`JAVA_TOOL_OPTIONS=-XX:-UseContainerSupport`)
- [x] Fixed `dosIds: null` NPE in adaptor (edge function returns `[]` not `null`)
- [x] Fixed JMS/AMQP exchange mismatch — **the critical fix** (`PEM111_AMQP_EXCHANGE=jms.durable.queues`)
- [x] Created NHS 111 Test Suite (`apps/nhs111-sandbox/`) — React + Express sandbox

### ✅ End-to-End Pipeline Verified
- Test message sent from sandbox → Adaptor converted CDA→FHIR → RabbitMQ → Bridge → Supabase
- Database row confirmed: patient "Blogg Joe", NHS 1112223344, status "received"
- Pipeline latency: < 2 seconds

### Documentation
- [x] `documentation/nhs/nhs111-pipeline.md` — comprehensive pipeline documentation
- [x] Updated `infrastructure/nhs111/README.md` with critical fixes
- [x] Updated `docker-compose.yml` and `.env.example` with correct exchange value

---

## Session 6 — 3 Mar 2026 — Locum Expansion: DB Schema

### Planning
- [x] Full locum expansion architecture planned and documented
- [x] UX journeys defined for both locum and organisation sides
- [x] Invoice cycle confirmed: Mon–Sun work period, generated Wednesday following week, due Friday
- [x] Payment model confirmed: Stripe Connect Express for locums, 50p platform fee per shift
- [x] Route structure defined: `/locum/*` external portal + `/shifts/*` org mini-app in main dashboard
- [x] Calendar: reuses existing FullCalendar v6 — no new libraries
- [x] Documentation saved to `documentation/locum/locum-expansion-plan.md`

### Database Migrations Applied (live DB via MCP)

- [x] **`locum_identity_and_compliance`**
  - `ps_locum_profiles` — extended locum profile (GPhC, insurance, DBS, smart card, NHS email, NI, Stripe account ref)
  - `ps_locum_documents` — document vault (gov_id, dbs, insurance, gphc_cert, smart_card, qualification, other)
  - `ps_locum_services` — services a locum declares, FK to `ps_service_library`

- [x] **`locum_shifts_and_booking`**
  - `ps_locum_shifts` — shift slots created by orgs (date, time, rate, booking_mode, payment_mode, status)
  - `ps_locum_shift_criteria` — per-shift requirements (required services, references, SOP flag)
  - `ps_locum_bookings` — locum↔shift association (pending/approved/rejected/completed/cancelled/no_show)
  - `ps_get_locum_booking_clashes()` — SECURITY DEFINER function for cross-org clash detection

- [x] **`locum_compliance_docs`**
  - `ps_locum_sop_documents` — org-uploaded SOPs with versioning
  - `ps_locum_sop_signoffs` — record of locum reading and signing a specific SOP version

- [x] **`locum_sign_ins`**
  - `ps_locum_sign_ins` — central arrival record, links to booking + RP log entry, drives pay clock
  - `ps_locum_sign_in_duration()` trigger — auto-calculates `duration_minutes` on sign-out

- [x] **`locum_commerce`**
  - `ps_locum_payment_mandates` — Stripe mandate per org (standing order / SetupIntent)
  - `ps_locum_payment_weeks` — weekly billing period record (Mon–Sun, per org per locum)
  - `ps_locum_invoices` — one invoice per payment week (issued Wednesday, due Friday)
  - `ps_locum_invoice_lines` — one line per shift on the invoice
  - `ps_locum_payments` — payment record per invoice (Stripe payment_intent + transfer IDs)

- [x] **`locum_controls_and_reputation`**
  - `ps_locum_reviews` — pharmacy→locum internal review (score, punctuality, professionalism, notes)
  - `ps_locum_pharmacy_feedback` — locum→pharmacy internal feedback
  - `ps_locum_notes` — internal org notes on a locum (never visible to locum)
  - `ps_locum_blacklist` — org-level block (does not affect other orgs)

- [x] **`locum_cross_table_rls_policies`**
  - Deferred policies applied: org members can read profiles, documents, and services of locums booked with their org

### Next Steps — Locum Expansion
- [x] Add locum types to `@pharmstation/types`
- [x] Scaffold `/locum/*` routes + placeholder pages (external portal)
- [x] Scaffold `/shifts/*` routes + placeholder pages (org mini-app in main dashboard)
- [x] Add `Shifts` section to SideNav
- [ ] Add locum auth routing (detect `default_role = 'locum'` on login → redirect to `/locum/`)
- [ ] Build locum onboarding wizard (register → profile → documents → services → Stripe Express)
- [ ] Build shift creation form (org side)
- [ ] Build shift browse + eligibility filter (locum side)
- [ ] Build sign-in flow → RP log trigger
- [ ] Stripe Connect integration (Stripe CLI + MCP — to be configured by owner)
- [ ] Weekly invoice generation Edge Function (Sunday night cron)
- [ ] Build payments UI (mandate setup, invoice history, PDF download)
- [ ] Build reputation & controls UI (reviews, notes, blacklist, hidden stats)

---

## Session 7 — Locum Auth + Functional Pages

### Auth System — Completed
- [x] Added 4th Supabase client `_locumClient` with `ps-locum-session` storage key in `@pharmstation/supabase-client`
- [x] Added helpers: `locumSignUp()`, `locumSignIn()`, `locumSignOut()`, `getLocumSession()`, `fetchLocumUserProfile()`, `fetchLocumExtendedProfile()`
- [x] Created `packages/core/src/stores/locum-auth-store.ts` — Zustand store with `initialize()`, `login()`, `logout()`, `refreshProfile()`; validates `default_role === 'locum'` on sign-in
- [x] Exported `useLocumAuthStore` from `@pharmstation/core`
- [x] `LocumLayout.tsx` — top nav with Dashboard, Browse Shifts, My Bookings, Invoices, Profile links + sign-out + `<Outlet />`
- [x] `App.tsx` — locum auth initialisation in `useEffect`, protected `/locum/*` routes wrapped in `LocumLayout`, login-redirect guards

### New Pages — Locum Portal
- [x] **`LocumLoginPage.tsx`** — real email/password form, calls `useLocumAuthStore().login()`, validates locum role, navigates to `/locum/dashboard`
- [x] **`LocumRegisterPage.tsx`** — 4-step onboarding wizard:
  - Step 1: Account (name, email, password)
  - Step 2: Compliance (GPhC, indemnity, DBS, NI, NHS email, smartcard, home address)
  - Step 3: Services (multi-select from `ps_service_library`)
  - Step 4: Review + submit → `locumSignUp()` → INSERT `ps_user_profiles` + `ps_locum_profiles` + `ps_locum_services`
  - Handles email-confirmation-required case (stores pending data, shows "check your email")
- [x] **`LocumShiftsBrowsePage.tsx`** — functional shift discovery:
  - Loads all `ps_locum_shifts` (status=open, date >= today) with criteria
  - Checks eligibility per shift vs locum's declared services
  - Clash detection via `ps_get_locum_booking_clashes()` RPC
  - Filters: eligible only, date range, minimum rate
  - Apply button → INSERT `ps_locum_bookings` (prevents double-apply, shows clash badge)
  - Shows org name, booking mode, SOP/reference requirement badges

### New Pages — Shifts Org Mini-App
- [x] **`ShiftsDashboardPage.tsx`** — overview with:
  - 4 stat cards: Open Shifts, Pending Applications, Confirmed (upcoming), Completed (this month)
  - Live queries against `ps_locum_shifts` + `ps_locum_bookings` for org
  - Upcoming shifts table (next 14 days) with status badges
  - Quick action links (Post Shift, Calendar, Directory, SOPs, Payments)
- [x] **`ShiftsCalendarPage.tsx`** — FullCalendar v6 (same daygrid/timegrid/list/interaction pattern as AppointmentsCalendarPage):
  - Loads all org shifts into calendar events, colour-coded by status
  - Status filter dropdown
  - Click event → navigate to `/shifts/:id`
  - Date click → navigate to `/shifts/new?date=...`
  - Legend for status colours
- [x] **`NewShiftPage.tsx`** — shift creation form:
  - Date, start/end time, hourly rate (calculated total shown live), notes
  - Booking mode toggle (auto-accept vs manual review)
  - Optional eligibility criteria panel: required services multi-select, references toggle, SOP acknowledge toggle
  - Date pre-fill via `?date=` query param (from calendar date-click)
  - On submit: INSERT `ps_locum_shifts` + optional `ps_locum_shift_criteria`
  - Navigates to new shift's detail page on success
- [x] **`ShiftDetailPage.tsx`** — shift management:
  - Shows shift info card (date, time, duration, rate, booking mode, status)
  - Criteria card (required services count, references, SOP flags)
  - Pending applicants table with Confirm/Reject actions (manual mode)
  - Confirmed locum card (GPhC, indemnity provider, smartcard, Stripe status)
  - Sign-in record (badge when locum has signed in, in/out times, duration)
  - Cancel shift action (rejects all pending bookings)
  - Booking history (rejected/cancelled entries)

### Still Pending (at end of Session 7)
- [ ] Sign-in flow (locum arrives → scans/enters → creates `ps_locum_sign_ins` row → triggers RP log entry)
- [ ] Stripe Connect (owner to configure Stripe CLI + MCP server; 50p fee per shift)
- [ ] Weekly invoice Edge Function (Sunday cron: Mon–Sun shifts → Wednesday invoice, Friday due)
- [ ] Document upload (Supabase Storage bucket `locum-documents`)

---

## Session 8 — Locum Portal: Remaining Pages

### Completed This Session

- [x] **`LocumDashboardPage.tsx`** — functional locum-side overview:
  - 4 stat cards: upcoming bookings, pending applications, completed shifts, this-week earnings
  - Upcoming bookings table (next 30 days, with org name + status badge)
  - Recent invoices summary panel
  - Quick action links to Browse Shifts, Bookings, Invoices, Profile

- [x] **`LocumBookingsPage.tsx`** — locum's own booking list:
  - Status filter tabs (all / upcoming / pending / completed / cancelled)
  - Flat list with org name, date, time, duration, rate, status badge
  - Sign-in CTA badge for confirmed shifts today
  - Expandable row with booking notes and rate breakdown

- [x] **`LocumProfilePage.tsx`** — 3-tab profile management:
  - **Compliance Details**: edit GPhC (with colour-coded expiry warning: <30 days = amber, expired = red), indemnity insurance, DBS certificate, NI number, NHS email, smartcard checkbox, home address. Saves to `ps_locum_profiles` then calls `refreshProfile()`
  - **My Services**: multi-select from `ps_service_library` grouped by category. Replaces `ps_locum_services` on save
  - **Documents**: static status panel showing "On record" / "Pending upload" per document type. Info banner about Supabase Storage coming soon

- [x] **`LocumInvoicesPage.tsx`** — invoice accordion with lazy-loaded line items:
  - 3 summary stat cards: Total Invoiced, Platform Fees, Net Earnings
  - Invoice cycle info banner (Mon–Sun → Wednesday invoice → Friday due)
  - Invoice list sorted newest-first, shows invoice number, org name, week period, total, due date, status badge
  - Expand per invoice to reveal line-item table (date, time, duration, rate, gross, fee, net)
  - PDF download link when `pdf_url` present
  - Per-invoice line items loaded lazily on first expand (only fetches once)

- [x] **`ShiftLocumDirectoryPage.tsx`** — org-side locum management:
  - Loads all locums with bookings at this org from `ps_locum_bookings` → joins `ps_locum_profiles` → `ps_user_profiles`
  - Per locum card: name, GPhC, completed shifts, cancellation count, last shift date, average review score
  - **Notes panel** (slide-in drawer): view all org notes for this locum + add new note → `ps_locum_notes`
  - **Blacklist**: confirmation dialog with reason input → INSERT `ps_locum_blacklist`. Shows "Blacklisted" badge + reason on card
  - Name/GPhC search filter

- [x] **`ShiftSOPsPage.tsx`** — SOP document management:
  - List all `ps_locum_sop_documents` for org; colour-coded active/inactive + required badges
  - Add new SOP form: title, description, file URL, is_required toggle → INSERT to `ps_locum_sop_documents`
  - Expand per SOP to see signoff list (locum name, doc version, signed_at). Outdated-version badge shown if locum signed an older version
  - Deactivate/activate toggle per SOP

- [x] **`ShiftPaymentsPage.tsx`** — org-side payments hub:
  - **Invoices tab**: all weekly invoices across all locums for this org, status filter buttons (all/pending/processing/paid/overdue/disputed), 3 stat cards (total invoiced, outstanding, count), expand per invoice for line-item table. Stripe "Pay now" intentionally omitted (pending integration)
  - **Mandate tab**: shows active mandate status (payment method last-4, set-up date) or "no mandate" banner with disabled "Set Up Direct Debit" button

### Still Pending (at end of Session 8)
- [ ] Sign-in flow — weekly invoice Edge Function, Stripe Connect, document upload

---

## Session 9 — Sign-in Flow, Weekly Invoice Edge Function

### Completed This Session

- [x] **Sign-out `duration_minutes`** — `LocumBookingsPage.handleSignOut` now computes `duration_minutes` as `Math.round((signedOutAt - signedInAt) / 60000)` and writes it to `ps_locum_sign_ins`. Previously only `signed_out_at` was set.

- [x] **`generate-weekly-invoices` Edge Function** — deployed to Supabase, callable manually or via Wednesday cron:
  - Accepts optional `{ week_start, week_end }` in POST body; auto-detects last Mon–Sun if omitted
  - Queries `ps_locum_shifts` in date range → completed `ps_locum_bookings` for those shifts
  - Groups by (org_id, locum_id). Skips any group where an invoice already exists for the week
  - Upserts `ps_locum_payment_weeks` (unique constraint on org+locum+week_start ensures idempotency)
  - Computes `line_total_pence = ceil((duration_minutes / 60) × rate × 100)` per booking
  - Platform fee = 50p per completed shift (booking)
  - Generates sequential invoice numbers `INV-YYYY-NNNNNN`
  - `issued_at` = today, `due_date` = today + 2 days (Wednesday → Friday)
  - Inserts `ps_locum_invoices` + `ps_locum_invoice_lines`
  - Returns `{ ok, invoicesCreated, invoiceNumbers, skipped, weekStart, weekEnd }`

- [x] **Manual invoice trigger in `ShiftPaymentsPage`** — "⚙ Generate Invoices Manually" collapsible panel in Invoices tab with optional week date pickers, calls Edge Function via `supabase.functions.invoke()`, shows success/error result, auto-refreshes invoice list on success

### Still Pending
- [ ] Stripe Connect (owner to configure Stripe CLI + MCP server; 50p fee per shift)
- [ ] Schedule Edge Function via Supabase cron (pg_cron) — run every Wednesday
- [ ] Document upload (Supabase Storage bucket `locum-documents`)
- [ ] SOP sign-off flow in locum portal (present required SOPs; locum signs; INSERT `ps_locum_sop_signoffs`)

---

## Session 10 — 3 Mar 2026 — Locum Auth Bug Investigation & Registration UX

### Auth Architecture Clarification
- Confirmed that all 4 Supabase clients (`ps-org-session`, `ps-user-session`, `ps-patient-session`, `ps-locum-session`) connect to the **same** Supabase project and share `auth.users`. They are differentiated only by their `localStorage` storage key for session isolation.
- `ps_user_profiles` is a **single shared table** for all user types (pharmacist, locum, admin). `default_role` distinguishes type.
- `ps_locum_profiles` is the "locum ACL" — having a row here means the user is a locum. A pharmacist or admin can have both a `ps_user_profiles` row and a `ps_locum_profiles` row; they do **not** need two accounts.

### Root Cause: Sign-in Redirect After Registration
- **Symptom**: Users were redirected back to `/locum/login` immediately after signing in, even after successfully registering.
- **Root cause 1 — email confirmation gate**: With email confirmation enabled, `supabase.auth.signUp()` returns `session: null`. The registration code checked `if (!session)` and stored pending profile data to `localStorage` but never called `insertProfiles()`. The user confirmed their email, then tried to log in — but no `ps_user_profiles` or `ps_locum_profiles` rows existed.
- **Root cause 2 — `.single()` throwing**: `fetchLocumUserProfile()` used `.single()`, which throws a PostgREST error (PGRST116) when 0 rows are found. This exception was caught by the login store's `catch` block, which set `loading: false` and re-threw, leaving `isLoggedIn: false` → redirect to login.
- **Root cause 3 — role gate**: `login()` checked `if (userProfile.default_role !== 'locum')` and threw, blocking any pharmacist or admin from using the locum portal even if they wanted to add locum access.
- **Confirmed via auth logs**: `user_repeated_signup` for `champe@live.co.uk` (email already existed from Feb 2023), followed by `invalid_credentials` — the actual sign-in failure was a wrong password, not a code bug.

### Fixes Applied

#### `packages/supabase-client/src/index.ts`
- `fetchLocumUserProfile()`: changed `.single()` → `.maybeSingle()`. Returns `null` instead of throwing when no row exists — allows the login flow to distinguish "no profile yet" from a real error.

#### `packages/core/src/stores/locum-auth-store.ts` — `login()` rewritten
- Removed `default_role !== 'locum'` check — any authenticated user can use the locum portal; the `locumProfile` null-check in the route guard handles incomplete setup instead.
- Added `localStorage` recovery: if `fetchLocumUserProfile()` returns null, checks for `locum_pending_profile` key (stored during registration when email confirmation is required). If found, inserts the `ps_user_profiles` row using that data, then clears the key.
- Added minimal fallback: if still no profile after localStorage recovery, creates a bare `ps_user_profiles` row from `auth.user.email` so login always succeeds.
- `locumProfile` is allowed to be `null` in the store — signals onboarding incomplete, handled by route guard rather than a login error.

### New Page: `LocumCompleteProfilePage.tsx`
- Created `apps/web/src/pages/locum/LocumCompleteProfilePage.tsx`
- Shown when `isLocumLoggedIn === true` but `locumProfile === null`. Covers two scenarios:
  1. Email-confirmed locum whose profiles were never written (email-confirmation gap)
  2. Existing pharmacist/admin adding locum access to their account — no second account needed
- 2-step wizard matching the existing registration wizard style:
  - **Step 1 — Compliance**: GPhC number (required to advance); indemnity, DBS, NI, NHS email, smartcard, home address all optional
  - **Step 2 — Services**: multi-select from `ps_service_library`, skippable
- Pre-fills from `locum_pending_profile` localStorage if present
- On submit: `INSERT ps_locum_profiles` + optional `INSERT ps_locum_services` → calls `refreshProfile()` → `navigate('/locum/dashboard')`
- Handles duplicate-row conflicts gracefully (ignores `23505` on insert)

### Route Guard Update: `App.tsx`
- Added `locumProfile` to the `useLocumAuthStore()` destructure
- Locum protected routes now use a 3-tier guard:
  1. `!isLocumLoggedIn` → `/locum/login`
  2. `!locumProfile` → `/locum/complete-profile`
  3. Otherwise → `<LocumLayout />`
- Added `/locum/complete-profile` as its own route (accessible when logged in but `locumProfile` is null, so not inside the `LocumLayout` guard)

### Registration UX Improvements (`LocumRegisterPage.tsx`)
- Split `fullName` into separate `firstName` + `lastName` fields (stored in dedicated `first_name` / `last_name` DB columns, not just `full_name`)
- Removed GPhC expiry date field — GPhC registration does not expire like a document; active status is checked at point of use
- Made indemnity, DBS, and NI number optional in both UI validation and DB insert
- Removed mandatory service selection — `canAdvance()` on the services step always returns `true`
- Added `user.identities?.length === 0` detection: Supabase silently returns an existing user object with an empty `identities` array instead of an error when the email is already registered. Now shows: "This email already has an account. Sign in at /locum/login — your locum profile will be set up automatically."

### Name Fields Propagated Throughout
- `LocumDashboardPage.tsx`: greeting uses `userProfile.first_name` with fallback chain to `full_name`
- `LocumProfilePage.tsx`: added "Personal Details" card (first/last name edit); save updates both `ps_user_profiles` and `ps_locum_profiles` in parallel
- `LocumLayout.tsx`: header displays `first_name + last_name` with fallback to `full_name` / `email`

### Login Page: Forgot Password Flow (`LocumLoginPage.tsx`)
- Added inline "Forgot password?" toggle (replaces login form with reset form in place — no new route needed)
- Reset form calls `getLocumClient().auth.resetPasswordForEmail()` with redirect to `/locum/update-password`
- Clicking "Forgot password?" auto-fills the reset email field with whatever was already typed in the login email field
- No `/locum/update-password` page yet — redirect from Supabase email will need this page built

### Database Fix
- Reset password for `champe@live.co.uk` directly via `UPDATE auth.users SET encrypted_password = crypt(...)`. Account had existed since Feb 2023 with a forgotten password — this was the actual cause of `invalid_credentials` errors, not a code bug.

### Still Pending
- [ ] Stripe Connect (owner to configure Stripe CLI + MCP server; 50p fee per shift)
- [ ] Schedule Edge Function via Supabase cron (pg_cron) — run every Wednesday
- [ ] Document upload (Supabase Storage bucket `locum-documents`)
- [ ] SOP sign-off flow in locum portal
- [ ] `/locum/update-password` page (handles Supabase password-reset redirect link)
- [ ] `refreshProfile()` in auth store should also re-fetch `userProfile`, not just `locumProfile`
