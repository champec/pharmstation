# PharmStation Mobile

**`@pharmstation/mobile`** — the role-based companion app for PharmStation.

Built with **Expo (SDK 56) + Expo Router + React Native 0.85 + React 19**, TypeScript,
Zustand, and Supabase.

One app, many roles. What a person sees is tightly gated by **who they are** and
**which features they need** — exactly like the web app, adapted for mobile.

---

## The two-layer auth model

This is the single most important concept in the app. There are **two independent
Supabase auth sessions**, distinguished only by their storage key (one Supabase
project, two `createClient` instances — see `src/lib/supabase.ts`):

| Layer | Storage key | Identity | What it unlocks |
| --- | --- | --- | --- |
| **User** (primary) | `ps-user-session` | `ps_user_profiles` | Personal account. Standalone — you can log in here alone. |
| **Org** (additive) | `ps-org-session` | `ps_organisations` | The pharmacy you're working at. Layered *on top of* a user session. |

Flow:

1. **Sign in as a user** → you reach your personal account and any user-level
   modules (e.g. a locum browsing shifts across pharmacies). No pharmacy data.
2. **Connect a pharmacy** (additive org login) → now you hold *both* tokens. If
   `ps_organisation_members` confirms you're an **active** member, the org-scoped
   modules appear, each **filtered by your `permissions`**.

> This deliberately flips the web app's "org-first, then user" ordering into
> "user-first, org-optional", which is the intended long-term vision.

Org modules require **all** of: user session + org session + active membership.
See `AuthState.canAccessOrgModules()` in `src/stores/auth-store.ts`.

---

## Modules & permission gates

Every module is declared in **`src/modules/registry.ts`** with a `tier`
(`user` | `org`) and a `visible(ctx)` predicate. The home launcher
(`src/app/(app)/home.tsx`) renders only what each person is allowed to see.

| Module | Tier | Gate (permission / rule) | Status |
| --- | --- | --- | --- |
| My Account | user | always | ✅ scaffolded |
| Locum Shifts | user | locum-type user | 🔜 placeholder |
| Deliveries (driver) | org | `delivery_drive` or `delivery_manage` | 🔜 placeholder |
| Scanning (Rx / invoices) | org | `ai_scan_use` | 🔜 placeholder |
| Pharmacy Management | org | `manage_users` or `org_settings` | 🔜 placeholder |

Adding a module later = add an entry to the registry + build its screen. The
gating is already enforced.

---

## Project structure

```
apps/mobile/
├── app.json                 # Expo config
├── .env / .env.example      # EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
└── src/
    ├── app/                 # Expo Router (file-based routes)
    │   ├── _layout.tsx          # root: init auth, splash, providers
    │   ├── index.tsx            # redirect by auth state
    │   ├── (auth)/              # unauthenticated
    │   │   ├── _layout.tsx
    │   │   └── user-login.tsx   # primary user login
    │   └── (app)/               # authenticated (user session required)
    │       ├── _layout.tsx          # guard
    │       ├── home.tsx             # role-gated module launcher
    │       ├── connect-pharmacy.tsx # additive org login (modal)
    │       └── module/[id].tsx      # account + module placeholders
    ├── lib/supabase.ts      # dual client (AsyncStorage-backed sessions)
    ├── stores/auth-store.ts # Zustand: user-first / org-additive
    ├── modules/registry.ts  # module definitions + permission gates
    ├── types/auth.ts        # vendored auth/permission types (mirror of @pharmstation/types)
    ├── components/ui/        # Button, Field, Screen
    └── theme/palette.ts      # brand palette
```

---

## Running it

> **This app is an isolated install** — it is excluded from the pnpm workspace
> (`pnpm-workspace.yaml`) and uses its own npm `node_modules` to avoid Metro
> monorepo resolution pain. Install/run it from **inside `apps/mobile`** with
> **npm**, not pnpm, and not from the repo root.

```bash
cd apps/mobile

# Install (standalone — the --no-workspaces flag avoids the parent workspace)
npm install --no-workspaces

# Start Metro / Expo dev server
npm start            # then press a (Android) / i (iOS) / w (web)
npm run android
npm run ios
npm run web

# Typecheck
npm run typecheck
```

You'll need the **Expo Go** app or a dev build on a device/emulator. Camera,
GPS, push and biometrics (for the upcoming modules) will require a custom dev
build via EAS rather than Expo Go.

---

## Notes & follow-ups

- **Shared code:** `src/types/auth.ts` is a small vendored mirror of
  `packages/types`. Keep them in sync; when mobile matures we can extract a
  platform-agnostic shared package and drop the copy.
- **Session storage:** sessions persist via `AsyncStorage`. Tokens can later be
  moved to `expo-secure-store` (note its ~2KB value limit) and biometric gating.
- **Security:** the Supabase project currently has **RLS disabled on many
  tables**. Mobile is an untrusted client using the public anon key, so RLS
  policies should be in place before shipping the org modules. This is a
  pre-existing backend issue, surfaced here for visibility.
```
