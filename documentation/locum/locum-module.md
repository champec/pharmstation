# PharmStation — Locum Module: Engineering Reference

> **Last updated:** 3 March 2026
> **Status:** Core portal built and functional. Stripe, document upload, and SOP sign-off pending.
> **Original plan:** See [`locum-expansion-plan.md`](./locum-expansion-plan.md)

This document is the canonical engineering reference for the locum module. It covers the complete
current state: architecture, database schema, auth system, all pages, known bugs and their resolutions,
and what remains to build. An engineer new to this module should be able to take over from here.

---

## 1. What This Module Is

A two-sided marketplace inside PharmStation connecting **locum pharmacists** with **pharmacies**
on the platform. It is a self-contained portal running at `/locum/*` and a pharmacy-side mini-app
at `/shifts/*` inside the main dashboard.

Key characteristics:
- Locums are **not members of any organisation**. They join the platform network, not a specific pharmacy.
- A locum's presence at a pharmacy is temporary and defined by a **booking** (`ps_locum_bookings`).
- Payment flows through Stripe Connect. PharmStation takes 50p per completed shift.
- The locum portal is entirely **external** — it has its own auth session, its own Supabase client,
  and its own layout. Pharmacy staff and locums never share a session.

---

## 2. Architecture Overview

### Supabase Clients

There are **two** Supabase clients in `packages/supabase-client/src/index.ts` —
one per *concurrent session*, not per role:

| Client | Storage Key | Used by |
|---|---|---|
| `getOrgClient()` | `ps-org-session` | Pharmacy organisation login (workstation, all day) |
| `getUserClient()` | `ps-user-session` | The current human — staff, locum, patient, driver… |

> **Locum/patient are ROLES, not account types.** `getLocumClient()` and
> `getPatientClient()` still exist but are deprecated aliases of
> `getUserClient()`. RLS keys off `auth.uid()`; roles are profile/permission
> rows (`ps_locum_profiles`, `ps_organisation_members`, patient linkage).
> Portals are differently-gated routes riding the same user session.
> **Never add a per-role client.**

A single email holds one auth account and unlocks multiple portals. An
existing staff member does **not** need a second account or a second login to
use the locum portal — they just need a `ps_locum_profiles` row (created via
the complete-profile flow).

### User Identity

```
auth.users (Supabase built-in)
    │
    └─► ps_user_profiles   ← one row per person, all roles
             id (= auth.users.id)
             email
             first_name / last_name / full_name
             default_role  ('locum' | 'pharmacist' | 'admin' | 'patient')
             phone, avatar_url

    └─► ps_locum_profiles  ← one row per locum (the "locum ACL")
             user_id → ps_user_profiles.id
             gphc_number, indemnity_*, dbs_*, ni_number, nhs_email,
             smart_card_held, address_*, stripe_account_id,
             onboarding_complete, stripe_onboarded
```

**Having a `ps_locum_profiles` row = is a locum on the platform.**
The `default_role` on `ps_user_profiles` is informational. The route guard keys off whether
`locumProfile` (the `ps_locum_profiles` row) is null or not.

---

## 3. Auth Flow

### Registration (`/locum/register`)

1. User fills 4-step wizard: Account → Compliance → Services → Review
2. On submit: `locumSignUp(email, password)` called
3. **Email confirmation is ON** for this project. `signUp()` returns `session: null`.
4. If `session === null`: registration data (first/last name, compliance details, selected services)
   is serialised to `localStorage` under the key `locum_pending_profile`. A "check your email"
   screen is shown. **No DB rows are created yet.**
5. User confirms email link → comes back and logs in.

> **Important:** If `user.identities?.length === 0` after `signUp()`, the email already exists in
> `auth.users`. The UI now shows a clear message: "This email already has an account. Sign in at
> /locum/login — your locum profile will be set up automatically." Don't show "account created."

### Login (`/locum/login`)

Handled by `login()` in `packages/core/src/stores/locum-auth-store.ts`:

```
locumSignIn(email, password)
    │
    ├─ fetchLocumUserProfile(user.id) → maybeSingle()
    │       returns null if no ps_user_profiles row yet (do not throw)
    │
    ├─ if null → check localStorage 'locum_pending_profile'
    │       if found: INSERT ps_user_profiles, clear key, re-fetch
    │
    ├─ if still null → INSERT minimal ps_user_profiles from auth.user.email
    │       (catch-all so login never fails due to missing profile)
    │
    ├─ fetchLocumExtendedProfile(user.id) → maybeSingle()
    │       returns null if no ps_locum_profiles row yet
    │
    └─ set({ userProfile, locumProfile, isLoggedIn: true })
         locumProfile may be null — that's fine, route guard handles it
```

**There is no `default_role` check in login.** Any authenticated user can pass through; the
route guard that checks `locumProfile` is where access is actually controlled.

### Route Guard (App.tsx)

```tsx
// 3-tier guard on all /locum/* protected routes:
!isLocumLoggedIn        →  <Navigate to="/locum/login" />
!locumProfile           →  <Navigate to="/locum/complete-profile" />
otherwise               →  <LocumLayout />
```

The `/locum/complete-profile` route is outside the `LocumLayout` guard (accessible when
`isLocumLoggedIn === true` but `locumProfile === null`).

### Forgot Password

`LocumLoginPage` has an inline reset panel. Clicking "Forgot password?" toggles the form in place
(no new route), calls `getLocumClient().auth.resetPasswordForEmail()` with redirect to
`/locum/update-password`.

> ⚠️ `/locum/update-password` page **does not exist yet** — the Supabase email link will 404.
> This page needs to call `supabase.auth.updateUser({ password: newPassword })` after the redirect.

---

## 4. Database Schema

All tables are in the `public` schema with RLS enabled. Full migration files are in `supabase/migrations/`.

### Core Locum Tables

| Table | Purpose |
|---|---|
| `ps_locum_profiles` | Extended locum profile. 1:1 with `ps_user_profiles` via `user_id`. |
| `ps_locum_documents` | Document vault. Types: `gov_id`, `dbs`, `insurance`, `gphc_cert`, `smart_card`, `qualification`. Storage upload pending. |
| `ps_locum_services` | Services a locum declares. FK → `ps_service_library` (shared with pharmacy services). |

### Shift & Booking Tables

| Table | Purpose |
|---|---|
| `ps_locum_shifts` | Shift slots created by orgs. Has `booking_mode` (`auto_accept` / `manual_review`) and `payment_mode` (`platform` / `external`). |
| `ps_locum_shift_criteria` | Per-shift requirements: required service IDs, `requires_references`, `requires_sop_acknowledgement`. |
| `ps_locum_bookings` | Locum ↔ shift association. Statuses: `pending`, `approved`, `rejected`, `completed`, `cancelled`, `no_show`. |
| `ps_locum_sop_documents` | Org-uploaded SOPs with version tracking. `is_required` flag per doc. |
| `ps_locum_sop_signoffs` | Locum signed a specific version of a doc (locum_id, document_id, version, signed_at). |
| `ps_locum_sign_ins` | Arrival record. `signed_in_at`, `signed_out_at`, `duration_minutes` (auto-computed by trigger). Links to booking + RP log entry. |

### Commerce Tables

| Table | Purpose |
|---|---|
| `ps_locum_payment_mandates` | Stripe SetupIntent mandates per org. One-time setup; auto-charges on invoice. |
| `ps_locum_payment_weeks` | Weekly billing aggregation (Mon–Sun, per org per locum). Unique constraint prevents duplicate invoice weeks. |
| `ps_locum_invoices` | One invoice per completed payment week. `issued_at` = Wednesday, `due_date` = Friday. |
| `ps_locum_invoice_lines` | One line per completed shift. `line_total_pence`, `platform_fee_pence` (50p), `net_pence`. |
| `ps_locum_payments` | Payment record per invoice. Stripe `payment_intent_id` + `transfer_id`. |

### Reputation & Controls Tables

| Table | Purpose |
|---|---|
| `ps_locum_reviews` | Pharmacy → locum internal review. Score, punctuality, professionalism, notes. **Never visible to the locum.** |
| `ps_locum_pharmacy_feedback` | Locum → pharmacy internal feedback. |
| `ps_locum_notes` | Org internal notes on a locum. Per org, never visible to locum. |
| `ps_locum_blacklist` | Org-level block. Locum cannot book at that org. Does not affect other orgs. |

### Key Functions & Triggers

| Name | Type | Purpose |
|---|---|---|
| `ps_get_locum_booking_clashes(locum_id, shift_id)` | SECURITY DEFINER RPC | Cross-org clash detection. Locum can't see other orgs' bookings under RLS — this function bypasses that safely. Called client-side to check before applying. |
| `ps_locum_sign_in_duration()` | Trigger on `ps_locum_sign_ins` | Auto-calculates `duration_minutes` when `signed_out_at` is set. |
| `ps_get_my_locum_id()` | SECURITY DEFINER | Returns caller's `ps_locum_profiles.id`. Used in RLS policies to avoid infinite recursion when querying related tables. |

### RLS Policy Notes

- `ps_locum_shifts` — readable by all authenticated locums (eligibility filtered query-side, not RLS-side).
- `ps_locum_bookings` — readable by the booking locum and the org that owns the shift.
- `ps_locum_notes`, `ps_locum_blacklist`, `ps_locum_reviews` — org-only. Locums cannot read these rows for themselves.
- Policies that need to cross-reference `ps_locum_profiles` use `ps_get_my_locum_id()` to avoid the 42P17 infinite recursion error.

---

## 5. Package Structure

```
packages/
  supabase-client/src/index.ts     ← getLocumClient(), locumSignUp/In/Out,
                                      fetchLocumUserProfile, fetchLocumExtendedProfile
  core/src/stores/
    locum-auth-store.ts            ← Zustand: userProfile, locumProfile, isLoggedIn,
                                      initialize(), login(), logout(), refreshProfile()
  types/src/
    locum.ts (or similar)          ← LocumProfile, LocumBooking, LocumShift, etc.
```

**`refreshProfile()`** currently only re-fetches `locumProfile` from `ps_locum_profiles`.
It does **not** re-fetch `userProfile`. If a name change needs to be reflected in the header
immediately after save, call `refreshProfile()` then trigger a local state update in the page.

> TODO: extend `refreshProfile()` to also re-fetch `userProfile`.

---

## 6. Pages — Locum Portal (`/locum/*`)

All pages live in `apps/web/src/pages/locum/`.

### Public (no auth required)

| File | Route | Notes |
|---|---|---|
| `LocumLoginPage.tsx` | `/locum/login` | Email/password form. Inline forgot-password toggle. Auto-redirects to `/locum/dashboard` if already logged in. |
| `LocumRegisterPage.tsx` | `/locum/register` | 4-step wizard. Stores pending data to localStorage if email confirmation required. Detects duplicate-email signup via `identities.length === 0`. |

### Semi-protected (logged in, no `locumProfile` required)

| File | Route | Notes |
|---|---|---|
| `LocumCompleteProfilePage.tsx` | `/locum/complete-profile` | Shown when `isLocumLoggedIn && !locumProfile`. 2-step form: Compliance (GPhC required to advance; everything else optional) + Services (skippable). Pre-fills from `locum_pending_profile` localStorage. Inserts `ps_locum_profiles` + `ps_locum_services`. Calls `refreshProfile()` then navigates to dashboard. |

### Protected (inside `LocumLayout`, requires `locumProfile`)

| File | Route | Notes |
|---|---|---|
| `LocumDashboardPage.tsx` | `/locum/dashboard` | 4 stat cards, upcoming bookings table, recent invoices, quick links. |
| `LocumShiftsBrowsePage.tsx` | `/locum/shifts` | Browse all open shifts. Live eligibility check. Clash detection via RPC. Date/rate/eligible filters. Apply button → INSERT `ps_locum_bookings`. |
| `LocumBookingsPage.tsx` | `/locum/bookings` | Status filter tabs. Sign-in CTA for confirmed shifts today. Expandable row with rate breakdown. |
| `LocumProfilePage.tsx` | `/locum/profile` | 3 tabs: Compliance (GPhC, indemnity, DBS, NI, NHS email, smartcard, address), Services (multi-select), Documents (status panel — upload pending). Saves to both `ps_locum_profiles` and `ps_user_profiles` in parallel. |
| `LocumInvoicesPage.tsx` | `/locum/invoices` | Invoice accordion. Lazy-loads line items per invoice. PDF download when `pdf_url` set. |
| `LocumSOPsPage.tsx` | `/locum/sops` | Lists required SOPs from orgs the locum has bookings with. Sign-off flow pending. |

---

## 7. Pages — Shifts Org Mini-App (`/shifts/*`)

All pages live in `apps/web/src/pages/shifts/`. These sit inside the main pharmacy dashboard
(`DashboardLayout`) so they require both org and user auth (existing auth, unchanged).

| File | Route | Notes |
|---|---|---|
| `ShiftsDashboardPage.tsx` | `/shifts` | 4 stat cards. Upcoming shifts table. Quick links. |
| `ShiftsCalendarPage.tsx` | `/shifts/calendar` | FullCalendar v6. Colour-coded by status. Click → detail. Date click → new shift with date pre-filled. |
| `NewShiftPage.tsx` | `/shifts/new` | Date, time, rate (total shown live), booking mode, optional criteria panel. `?date=` query param support. |
| `ShiftDetailPage.tsx` | `/shifts/:id` | Shift info, pending applicants (confirm/reject), confirmed locum card, sign-in record, cancel action. |
| `ShiftLocumDirectoryPage.tsx` | `/shifts/directory` | All locums with bookings at this org. Notes drawer. Blacklist action. Search. |
| `ShiftSOPsPage.tsx` | `/shifts/sops` | Upload/manage org SOPs. View signoff list per SOP. Deactivate toggle. |
| `ShiftPaymentsPage.tsx` | `/shifts/payments` | Invoices tab (list all, manual invoice trigger). Mandate tab (Stripe setup — pending integration). |

---

## 8. Edge Functions

| Function | Slug | Trigger | Purpose |
|---|---|---|---|
| Weekly Invoice Generator | `generate-weekly-invoices` | Wednesday cron (not yet scheduled) or manual POST | Groups completed bookings by org+locum for the Mon–Sun week. Upserts `ps_locum_payment_weeks`. Generates `ps_locum_invoices` + `ps_locum_invoice_lines`. Returns `{ invoicesCreated, invoiceNumbers, skipped, weekStart, weekEnd }`. |

The Edge Function is deployed and callable. `ShiftPaymentsPage` has a manual trigger UI with optional
date range pickers.

> TODO: Schedule via `pg_cron` (or Supabase Dashboard cron) to run every Wednesday at 00:01 UTC.

---

## 9. Known Issues & Resolutions

### 9.1 `.single()` throwing on empty profile (FIXED)

**Was:** `fetchLocumUserProfile()` used `.single()` — throws PGRST116 when 0 rows returned.
**Fix:** Changed to `.maybeSingle()` — returns `null` cleanly. Location: `packages/supabase-client/src/index.ts`.

### 9.2 `default_role` gate blocking all non-locum users (FIXED)

**Was:** `login()` threw if `userProfile.default_role !== 'locum'`. Blocked pharmacists who wanted to add locum access.
**Fix:** Removed the check. Access is now gated by `locumProfile !== null` in the route guard, not `default_role`.

### 9.3 Email confirmation gap — profiles never created (FIXED)

**Was:** With email confirmation enabled, `signUp()` returns `session: null`. Code checked `if (!session)` and stored pending profile data to localStorage but never called `insertProfiles()`. User confirmed email, tried to log in, no DB rows existed — login failed.
**Fix:** `login()` checks for `locum_pending_profile` in localStorage. If found, inserts `ps_user_profiles` at login time, clears the key. Locum then lands on `/locum/complete-profile` to finish the `ps_locum_profiles` row.

### 9.4 Duplicate email signup (FIXED)

**Was:** Supabase silently returned an existing user object with `identities: []` instead of an error.
**Fix:** `LocumRegisterPage.handleSubmit()` detects `user.identities?.length === 0` and shows a clear message directing to login.

### 9.5 RLS infinite recursion on locum tables (FIXED — earlier session)

**Was:** RLS policies on `ps_locum_profiles` sub-queried `ps_locum_bookings`, which sub-queried `ps_locum_profiles` — circular.
**Fix:** `ps_get_my_locum_id()` SECURITY DEFINER function. All affected policies (~12 across 9 tables) were rewritten to use it.

---

## 10. What Still Needs Building

### High Priority

| Item | Detail |
|---|---|
| `/locum/update-password` page | Handles Supabase password-reset redirect. Calls `supabase.auth.updateUser({ password })`. Without it, forgot-password emails 404. |
| SOP sign-off flow (locum side) | `LocumSOPsPage` needs to present required SOPs for orgs with upcoming bookings and INSERT `ps_locum_sop_signoffs` on acceptance. |
| `refreshProfile()` also re-fetches `userProfile` | Current implementation only re-fetches `locumProfile`. Name changes in `LocumProfilePage` don't update the header until page reload. |

### Medium Priority

| Item | Detail |
|---|---|
| Stripe Connect — locum onboarding | Each locum needs a Stripe Express account. Call `stripe.accounts.create({ type: 'express' })` during `LocumCompleteProfilePage` submit or from a dedicated settings page. Store `stripe_account_id` on `ps_locum_profiles`. **Owner must configure Stripe CLI + Stripe MCP server first.** |
| Stripe Connect — pharmacy mandate | `ShiftPaymentsPage` Mandate tab has the UI shell but the "Set Up Direct Debit" button is disabled. Needs `stripe.setupIntents.create()` + redirect flow. |
| Weekly invoice cron | Deploy `pg_cron` job or Supabase Dashboard cron to fire `generate-weekly-invoices` every Wednesday at 00:01 UTC. |
| Document upload | `ps_locum_documents` table exists. Needs a `locum-documents` Supabase Storage bucket + upload UI in `LocumProfilePage` (Documents tab currently shows status-only panel). |

### Low Priority / Future

| Item | Detail |
|---|---|
| GPhC automated verification | Playwright/Puppeteer script querying GPhC public register. Validates locum's declared GPhC number is active. Phase 2. |
| DBS renewal integration | 3rd-party service (e.g. uCheck). Phase 2. |
| Public reviews | Currently internal only. To be decided post-launch. |
| Pharmacy Technician / ACT / Dispenser roles | Schema supports it via role type. Not in scope for v1. |
| Large chain API integration | Workforce system sync (Kronos/UKG etc). v3. |
| Network-level locum removal | Platform admin action. Not org-level. |

---

## 11. Test Accounts

| Account | Email | Password | Notes |
|---|---|---|---|
| Locum (champe) | `champe@live.co.uk` | `Pharmex123!` | Real user, exists since Feb 2023. Password reset 3 Mar 2026. No `ps_locum_profiles` row — will land on `/locum/complete-profile` on first login. |
| Org (test) | `testpharmacy@pharmstation.dev` | `[password removed — see password manager]` | Seed org account. |
| Staff (test) | `testuser@pharmstation.dev` | `[password removed — see password manager]` | Seed staff account, member of test org. |

---

## 12. Local Development Notes

```bash
# Run web app (from repo root)
pnpm dev --filter=web

# Or from apps/web/
pnpm dev
```

The locum portal runs at `http://localhost:5173/locum/login`.

Supabase project is connected via the MCP server (`mcp_pharmex-supab_*` tools) — no local Supabase instance needed for DB work in dev sessions.

Auth email confirmation is currently **ON** in the Supabase project. For testing new registrations without waiting for email, either:
1. Disable email confirmation in Supabase Dashboard → Auth → Settings, or
2. Use the Supabase Dashboard to manually confirm the user after sign-up, or
3. Sign up and check the auth logs for the user ID, then confirm via SQL:
   ```sql
   UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'test@example.com';
   ```
