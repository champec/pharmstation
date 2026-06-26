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

Each **module** is a self-contained mini-app launched from the home screen. A
module owns a set of **tabs** (its own bottom-tab navigator) and is declared
once in **`src/modules/registry.ts`** with three gating dimensions:

- **`tier`** — `user` (personal account) or `org` (needs an active pharmacy + permission)
- **`platform`** — `mobile`, `web`, or `both` (where the feature actually runs)
- **`visible(ctx)`** — fine-grained predicate (role / permission / user type), applied to **both** modules and individual tabs

The home launcher (`src/app/(app)/home.tsx`) renders the **launchable**
modules (`mobile` / `both`) and surfaces `web`-only ones as informational
“On the web” cards, so the two clients visibly complete each other. Web-only
**tabs** inside a mobile module render in the tab bar with a lock badge and
explain where they live when tapped.

| Module | Tier | Platform | Gate | Mobile tabs |
| --- | --- | --- | --- | --- |
| My Account | user | both | always | Profile · Pharmacies · Security |
| Locum Shifts | user | both | locum-type user | Find · Bookings · Timesheets |
| Deliveries | org | mobile | `delivery_drive` / `delivery_manage` | My Route · History · Map · _Setup (web)_ |
| Scanning | org | mobile | `ai_scan_use` | Scan · Queue |
| Pharmacy Management | org | both | org-connected (per-tab perms) | CD Register · RP Log · Handover · _Team (web)_ |
| Communications | org | both | org-connected | Messages · Alerts |
| Services | org | both | org-connected | History · Bookings · _Library (web)_ |
| Video Consultations | org | web | org-connected | _web only_ |

**Configurable home** — `src/stores/module-prefs-store.ts` (Zustand +
AsyncStorage) persists per-device **favourites** (long-press a card to pin) and
**usage counts**. The launcher orders cards by pin → most-used → registry order.

**Adding / building a module:**

1. Add an entry (with `tabs` + `platform`) to `src/modules/registry.ts`.
2. Add real tab screens in `src/modules/screens/<module>.tsx` and map them in
   `src/modules/screens/index.ts` (omit a tab to get an automatic placeholder).

Gating, navigation, the tab bar and web-only handling are all provided by the
shared `ModuleHost` (`src/components/module/`) — you never wire those up again.


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
    │       ├── home.tsx             # configurable, role-gated module launcher
    │       ├── connect-pharmacy.tsx # additive org login (modal)
    │       └── module/[id].tsx      # thin route -> ModuleHost
    ├── lib/supabase.ts      # dual client (AsyncStorage-backed sessions)
    ├── stores/
    │   ├── auth-store.ts        # Zustand: user-first / org-additive
    │   └── module-prefs-store.ts # favourites + usage (AsyncStorage)
    ├── modules/
    │   ├── registry.ts          # module + tab definitions, platform, gates
    │   ├── types.ts             # module system types + helpers
    │   └── screens/             # per-module tab screens + screen map
    ├── hooks/useModuleContext.ts # builds the gating context from auth store
    ├── components/
    │   ├── module/              # ModuleHost, ModuleTabBar, TabPlaceholder
    │   └── ui/                  # Button, Field, Screen
    ├── types/auth.ts        # vendored auth/permission types (mirror of @pharmstation/types)
    └── theme/palette.ts      # brand palette
```

---

## Running it

> **This app is part of the pnpm workspace.** The root `pnpm-workspace.yaml`
> uses `nodeLinker: hoisted` so React Native autolinking and EAS Build resolve
> correctly. Install from the **repo root** with pnpm, then run Expo commands
> from **inside `apps/mobile`**.

```bash
# Install everything (from the repo root)
pnpm install

cd apps/mobile

# Start the dev-client Metro server (SDK 56 is newer than Expo Go supports)
npm run dev          # expo start --dev-client
npm run dev:tunnel   # when phone + PC aren't on the same network
npm run dev:clear    # if Metro's cache misbehaves

# Typecheck
npm run typecheck
```

You need a **custom dev build** on the device (not Expo Go) — build it with
`npm run eas:build:dev`. Camera, GPS, push, OTA updates and biometrics are all
compiled into that dev client.

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
