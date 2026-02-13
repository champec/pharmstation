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
- [x] Created org account: `testpharmacy@pharmstation.dev` / `TestPharmacy123!`
- [x] Created user account: `testuser@pharmstation.dev` / `TestUser123!`
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

### Not Started
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
