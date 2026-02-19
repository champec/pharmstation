# PharmStation Expansion — Complete Summary

> **Created:** 21 February 2026  
> **Scope:** Services, Appointments, Logs, Video Consultations, Messaging  
> **Build Order:** Agent 0 (Foundation) first → Agents 1–5 in parallel  
> **Total Agent Briefs:** 6 documents, ~4,800 lines of implementation spec

---

## Table of Contents

1. [What Is PharmStation?](#1-what-is-pharmstation)
2. [Who Uses It?](#2-who-uses-it)
3. [Complete UX Flow](#3-complete-ux-flow)
4. [Feature Walkthrough](#4-feature-walkthrough)
5. [A Typical Day](#5-a-typical-day)
6. [Design Principles & Guidelines](#6-design-principles--guidelines)
7. [Development Guidelines](#7-development-guidelines)
8. [Agent Brief Reference](#8-agent-brief-reference)

---

## 1. What Is PharmStation?

PharmStation is a **SaaS platform** for UK pharmacies. It does not provide clinical services — it provides the **digital infrastructure** pharmacies use to manage their compliance, patients, services, appointments, logs, video consultations, and communications.

Think of it as "Shopify for pharmacy operations" — the pharmacy plugs in, configures their services, and gets a fully compliant digital workstation.

### What Already Exists (Session 1)

- **Organisation & team management** — multi-org support, team invites, role-based access
- **Controlled Drug (CD) Register** — full regulatory-compliant register with balance checks
- **Responsible Pharmacist (RP) Log** — GPhC-compliant sign on / sign off
- **AI (Genie)** — invoice scanning, document analysis, chat assistant
- **Settings** — organisation config, team management, user preferences

### What the Expansion Adds

Five new feature domains, plus cross-cutting foundation work (patient auth, patient records, public profiles).

---

## 2. Who Uses It?

### Three User Types

| User | How They Access | Auth |
|------|----------------|------|
| **Staff** | `app.pharmstation.co.uk` → login → dashboard | `_userClient` (storageKey: `ps-user-session`) |
| **Patient** | `app.pharmstation.co.uk/patient` → login → portal | `patientClient` (storageKey: `ps-patient-session`) |
| **Public** | `app.pharmstation.co.uk/book/[slug]` → no login needed | No auth required (anonymous access) |

### Staff Roles

- **Owner** — full access, billing, settings
- **Pharmacist** — clinical features, CD/RP logs, video consults
- **Technician** — services, appointments, messaging, basic logs
- **Admin** — settings, reports, non-clinical features

### Patient Portal

Patients who create accounts can:
- View their upcoming and past appointments
- Join video consultations via emailed 6-digit access codes
- See their message history from the pharmacy

### Public (No Account)

Anyone with the pharmacy's booking URL can:
- Browse the pharmacy's public service list
- Pick a service, select a date/time, fill a form, and book
- Receive a confirmation email/SMS (if pharmacy has messaging configured)

---

## 3. Complete UX Flow

### 3.1 Staff Flow

```
Login → Dashboard
  ├── Services Tab
  │     ├── Browse platform service library (200+ common UK pharmacy services)
  │     ├── Adopt from library → customise name, description, duration, price, form
  │     ├── Create fully custom service from scratch
  │     ├── Drag-and-drop form builder (text, number, date, select, checkbox, textarea, phone, email, nhs_number)
  │     └── Toggle services public/private + enable/disable
  │
  ├── Appointments Tab
  │     ├── Calendar view (FullCalendar — month/week/day)
  │     ├── Manage availability slots (one-off or recurring weekly)
  │     ├── View/filter bookings by status (confirmed/completed/cancelled/no-show)
  │     ├── Click any appointment → Drawer with full details + form responses
  │     ├── Mark complete, cancel, or no-show
  │     └── Manual booking for walk-ins (pick patient, service, slot)
  │
  ├── Logs Tab
  │     ├── 5 pre-seeded platform logs (Temperature, Fridge, Methadone Supervision, Equipment Calibration, Cleaning)
  │     ├── Create custom logs from scratch via log builder
  │     ├── Each log has configurable fields (text, number, temperature, boolean, select, date, time, signature, notes)
  │     ├── Scheduling: daily grid (fill every day) or sporadic list (log when needed)
  │     ├── Daily logs show calendar-grid with green ✓ / red ✗ / grey ○ per day
  │     ├── Sporadic logs show chronological list with "Add Entry" button
  │     └── Subscribe staff to logs for responsibility tracking
  │
  ├── Video Tab
  │     ├── Schedule consultation → generates Daily.co room + 6-digit access code
  │     ├── Send access code to patient (via messaging or manually)
  │     ├── Click "Join" → Daily Prebuilt iframe launches in-app
  │     ├── View upcoming, active, and completed consultations
  │     ├── Record duration automatically (join/end timestamps)
  │     └── Clinical notes field (staff-only, post-consultation)
  │
  ├── Messaging Tab
  │     ├── Send individual SMS, email, or letter to a patient
  │     ├── Send broadcast messages to filtered patient groups
  │     ├── Message history with delivery status tracking
  │     ├── All messages go through NHS Notify (GOV.UK Notify)
  │     └── Pharmacy provides own NHS Notify API key
  │
  ├── Existing Features
  │     ├── CD Register (controlled drugs)
  │     ├── RP Log (responsible pharmacist)
  │     ├── Genie (AI assistant)
  │     └── Settings (org, team, user, now also messaging config)
  │
  └── Settings → Messaging Sub-Tab (NEW)
        ├── Enter NHS Notify API key
        ├── Enter SMS / Email / Letter template IDs (single blank template each)
        ├── Test connection button
        └── Enable/disable channels
```

### 3.2 Patient Flow

```
/patient/login → Patient Portal
  ├── My Appointments
  │     ├── Upcoming appointments with countdown
  │     ├── Past appointments with status
  │     └── Cancel upcoming (if pharmacy allows)
  │
  ├── Video Consultations
  │     ├── Enter 6-digit access code
  │     ├── Verify identity (DOB check)
  │     ├── Join Daily Prebuilt video call in browser
  │     └── No app download required
  │
  └── Messages
        └── View messages received from pharmacy (read-only history)
```

### 3.3 Public Booking Flow

```
/book/[pharmacy-slug]
  ├── See pharmacy name, logo, description
  ├── Browse available public services
  ├── Select a service
  ├── See available dates/times
  ├── Pick a slot
  ├── Fill in the service form (dynamic fields set by pharmacy)
  ├── Enter contact details (name, email, phone)
  ├── Confirm booking
  └── Receive confirmation (email/SMS if messaging is configured)
```

---

## 4. Feature Walkthrough

### 4.1 Services

**What it is:** A configurable catalogue of services each pharmacy offers.

**Service Library:** PharmStation ships with a starter catalogue of ~200 common UK pharmacy services (Flu Vaccination, Blood Pressure Check, NMS, Smoking Cessation, Travel Vaccination, etc.). This saves pharmacies time — they adopt what they need and customise it. They can also create entirely custom services from scratch.

**Key point:** The service library is a convenience feature. PharmStation does not provide or deliver these services — the pharmacy does. PharmStation is purely the SaaS platform.

**Form Builder:** Each service can have an attached form with drag-and-drop field ordering. Field types: text, number, date, select (with options), checkbox, textarea, phone, email, nhs_number. Form responses are stored as JSONB and displayed when staff view the appointment.

### 4.2 Appointments

**What it is:** A calendar-based booking system.

**Slot Management:** Staff define when they're available — either one-off slots (e.g. "Tuesday 14:00–14:30 for Flu Jab") or recurring weekly patterns (e.g. "Every Monday 09:00–12:00, 30-min slots for BP Checks").

**Calendar View:** Staff see a FullCalendar (month / week / day views) with colour-coded appointment blocks. Clicking any appointment opens a Drawer with full details.

**Public Booking:** Patients browsing `/book/[slug]` see only services marked `is_public = true` and only future slots with `is_available = true`.

**Statuses:** `confirmed` → `completed` / `cancelled` / `no_show`. Staff update status from the appointment detail Drawer.

### 4.3 Logs

**What it is:** Customisable operational logging for pharmacy compliance.

**Platform Logs:** 5 pre-seeded templates that pharmacies commonly need:
1. **Temperature Monitoring** — daily fridge/room temperature readings
2. **Fridge Temperature** — dedicated fridge log with min/max/current
3. **Methadone Supervision** — patient name, dose, witnessed by, notes
4. **Equipment Calibration** — device name, reading, pass/fail, next due
5. **Cleaning Log** — area, method, completed by, verified by

**Custom Logs:** Pharmacies can create any log they need via the log builder. Define fields, set schedule type (daily or sporadic), assign staff subscribers.

**Daily Logs** show a calendar grid — each day is a cell showing ✓ (completed), ✗ (missed), or ○ (future). Click a day to fill in that entry.

**Sporadic Logs** show a chronological list. Click "Add Entry" whenever something needs logging.

### 4.4 Video Consultations

**What it is:** In-browser video calls between pharmacy staff and patients.

**Technology:** Daily.co Prebuilt — an iframe-embeddable video UI. No custom WebRTC code needed. Rooms are created via Daily's REST API through a Supabase Edge Function.

**Flow:**
1. Staff schedule a consultation → system creates a Daily room + generates a 6-digit OTP access code
2. Access code is sent to the patient (via SMS/email through messaging, or verbally)
3. Patient goes to `/patient/video`, enters the code, verifies their DOB
4. Both parties join the same Daily Prebuilt room in their browser
5. Staff click "End Consultation" → duration is recorded, notes can be added

**Security:** Access codes are hashed (SHA-256) in the database. Patients must also verify their date of birth. Daily rooms use `enable_knocking = true` so staff can admit patients. Room names are UUIDs (unguessable).

### 4.5 Messaging

**What it is:** SMS, email, and letter sending powered by NHS Notify (GOV.UK Notify).

**Setup:** Each pharmacy provides their own NHS Notify API key + creates one blank template per channel (SMS, email, letter) on GOV.UK Notify. The blank template contains a single `((body))` personalisation field. All actual message content is passed as the `body` value at send time.

**Why one blank template?** It avoids managing dozens of templates on GOV.UK Notify. The pharmacy controls their messages entirely from within PharmStation.

**Individual Messages:** Staff select a patient, choose a channel (SMS/email/letter), type the message, and send.

**Broadcasts:** Staff define a recipient filter (e.g. "all patients with a flu jab appointment in the last year"), compose a message, and send to all matching patients.

**Status Tracking:** Every message has a `notify_message_id` from NHS Notify. The system polls for delivery status: `sending` → `delivered` / `failed` / `technical_failure`.

---

## 5. A Typical Day

> **09:00** — *Pharmacist Sarah* logs in. Dashboard shows today's 12 appointments and 3 pending daily logs.

> **09:05** — She opens the Temperature Log, enters this morning's fridge readings: min -1.2°C, max 4.8°C, current 3.1°C. The calendar grid marks today green ✓.

> **09:15** — First patient arrives for a Flu Vaccination. Sarah opens the appointment, reviews the form responses (allergy? No. Egg allergy? No. Previous reaction? No.), administers the vaccine, clicks "Mark Complete".

> **10:00** — A walk-in patient asks about a Blood Pressure Check. Sarah opens the Appointments tab, clicks "Manual Booking", selects the patient from records, picks the BP Check service, assigns the next available slot, and books it.

> **11:00** — A video consultation is scheduled. Sarah clicks "Join" on the Video tab. The patient had received a 6-digit code by SMS yesterday. They enter it on the patient portal, verify their DOB, and both join the Daily Prebuilt video room. After the consultation, Sarah adds clinical notes.

> **14:00** — *Technician James* opens the Messaging tab and sends a broadcast SMS to all patients who had a flu jab last year but haven't booked this year: "Hi {{first_name}}, flu vaccinations are now available. Book at [link]. — High Street Pharmacy"

> **16:30** — Sarah checks the Cleaning Log (sporadic type), adds an entry: "Dispensary deep clean, bleach solution, completed by Sarah, verified by James."

> **17:00** — End of day. The RP Log (existing feature) records Sarah signing off as Responsible Pharmacist.

---

## 6. Design Principles & Guidelines

### 6.1 CRITICAL: No Native Browser Dialogs

> **🚫 NEVER use `window.alert()`, `window.confirm()`, or `window.prompt()`**

These are forbidden throughout the entire application. They are ugly, inconsistent across browsers, block the main thread, cannot be styled, and break the professional appearance of the platform.

**Always use the custom overlay components instead:**

#### `<Modal>` — For confirmations, important messages, and focused tasks

```tsx
import { Modal } from '@/components/Modal'

// Confirmation dialog
<Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Cancel Appointment?">
  <p>This will notify the patient and free up the slot.</p>
  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
    <button className="ps-btn ps-btn-secondary" onClick={() => setShowConfirm(false)}>Keep</button>
    <button className="ps-btn ps-btn-danger" onClick={handleCancel}>Yes, Cancel</button>
  </div>
</Modal>

// Success message
<Modal isOpen={showSuccess} onClose={() => setShowSuccess(false)} title="Appointment Booked">
  <p>The appointment has been confirmed for 14:00 on Tuesday.</p>
</Modal>

// Error message
<Modal isOpen={showError} onClose={() => setShowError(false)} title="Booking Failed">
  <p>The selected slot is no longer available. Please choose another time.</p>
</Modal>
```

**Modal Features:**
- `isOpen` / `onClose` controlled state
- Escape key closes
- Body scroll lock when open
- Click-outside-to-close (backdrop click)
- `aria-modal="true"` + `role="dialog"` for accessibility
- Configurable `width` (default 640px)

#### `<Drawer>` — For forms, detail panels, and side content

```tsx
import { Drawer } from '@/components/Drawer'

<Drawer isOpen={showDrawer} onClose={() => setShowDrawer(false)} title="Appointment Details">
  <p><strong>Patient:</strong> John Smith</p>
  <p><strong>Service:</strong> Blood Pressure Check</p>
  <p><strong>Time:</strong> 14:00 – 14:30</p>
  {/* Form responses, actions, etc. */}
</Drawer>
```

**Drawer Features:**
- Slides in from the right
- Dimmed backdrop (user can still see the page behind it)
- Escape key closes
- Body scroll lock
- Configurable `width` (default 540px)

#### When to Use Which

| Scenario | Component |
|----------|-----------|
| "Are you sure?" confirmation | `<Modal>` |
| Success / error / info message | `<Modal>` |
| Viewing appointment details | `<Drawer>` |
| Editing a form (add entry, edit service) | `<Drawer>` |
| Focused single-action task | `<Modal>` |
| Multi-field data entry | `<Drawer>` |

### 6.2 Brand Colors

Use CSS custom properties — **never hardcode hex values** in components. All colors come from `--ps-*` tokens defined in `packages/ui/src/styles/globals.css`.

#### Primary Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--ps-deep-blue` | `#257BB4` | Primary brand, main CTAs, headers, links |
| `--ps-sky-blue` | `#378FC2` | Hover states, secondary elements |
| `--ps-cloud-blue` | `#9FCADE` | Glow effects, highlights, borders |
| `--ps-electric-cyan` | `#04B0FF` | Accent, interactive highlights, focus rings |

#### Neutrals

| Token | Hex | Usage |
|-------|-----|-------|
| `--ps-midnight` | `#1A1A2E` | Primary text |
| `--ps-slate` | `#4A4A6A` | Secondary text, ghost button text |
| `--ps-mist` | `#B0B0C0` | Placeholder text, subtle borders |
| `--ps-off-white` | `#E5F2F7` | Main background, card borders, secondary btn bg |
| `--ps-white` | `#FFFFFF` | Card surfaces, modal backgrounds |

#### Semantic / Status Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--ps-success` | `#22C55E` | Success messages, completed states, log ✓ |
| `--ps-warning` | `#F59E0B` | Warnings, pending states, amber badges |
| `--ps-error` | `#EF4444` | Errors, danger buttons, failed states, log ✗ |
| `--ps-info` | `#3B82F6` | Info messages, blue badges |

#### How to Use

```css
/* ✅ CORRECT — use tokens */
.my-component {
  color: var(--ps-deep-blue);
  background: var(--ps-off-white);
  border: 1px solid var(--ps-cloud-blue);
}

/* ❌ WRONG — hardcoded hex */
.my-component {
  color: #257BB4;
  background: #E5F2F7;
}
```

### 6.3 Typography

| Font | Token / Usage | Weights |
|------|---------------|---------|
| **Inter** | `var(--ps-font-family)` — body text, UI, buttons, forms | 400, 500, 600, 700 |
| **Poppins** | Headings, hero text, feature titles | 500, 600, 700 |
| **JetBrains Mono** | `var(--ps-font-mono)` — code, log entries, register data | 400, 500 |

#### Size Scale

| Token | Size | Usage |
|-------|------|-------|
| `--ps-font-xs` | 0.75rem (12px) | Badges, fine print, timestamps |
| `--ps-font-sm` | 0.875rem (14px) | Buttons, table cells, form labels |
| `--ps-font-base` | 1rem (16px) | Body text, paragraphs |
| `--ps-font-lg` | 1.125rem (18px) | Sub-headings |
| `--ps-font-xl` | 1.25rem (20px) | Section headings |
| `--ps-font-2xl` | 1.5rem (24px) | Page titles |
| `--ps-font-3xl` | 1.875rem (30px) | Hero / dashboard headers |

### 6.4 Button Classes

Always use the `ps-btn` base class plus a variant:

| Class | Appearance | When to Use |
|-------|------------|-------------|
| `ps-btn ps-btn-primary` | Deep Blue bg, white text | Primary actions: Save, Book, Send, Confirm |
| `ps-btn ps-btn-secondary` | Off-White bg, blue text, blue border | Secondary actions: Cancel, Back, Filter |
| `ps-btn ps-btn-ghost` | Transparent, slate text | Tertiary actions: close buttons, subtle toggles |
| `ps-btn ps-btn-danger` | Red bg, white text | Destructive: Delete, Remove, Cancel Appointment |

**Disabled state:** All buttons get `opacity: 0.5` and `cursor: not-allowed` when `:disabled`.

### 6.5 Input & Form Classes

| Class | Usage |
|-------|-------|
| `ps-input` | All text inputs, selects, textareas |
| `ps-input:focus` | Electric Cyan border + subtle glow ring |

Forms use `react-hook-form` + `Zod` for validation. Error messages appear inline below the field — never in alert boxes.

### 6.6 Card & Badge Classes

| Class | Usage |
|-------|-------|
| `ps-card` | White bg, rounded corners, subtle shadow — all content panels |
| `ps-badge ps-badge-blue` | Info / default status (e.g. "scheduled") |
| `ps-badge ps-badge-green` | Success status (e.g. "completed", "delivered") |
| `ps-badge ps-badge-amber` | Warning / pending (e.g. "sending", "pending") |
| `ps-badge ps-badge-red` | Error / danger (e.g. "failed", "cancelled") |

### 6.7 Spacing & Layout Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--ps-space-xs` | 4px | Tight gaps (badge padding, icon margins) |
| `--ps-space-sm` | 8px | Button padding, input padding |
| `--ps-space-md` | 16px | Standard gaps, section padding |
| `--ps-space-lg` | 24px | Card padding, section margins |
| `--ps-space-xl` | 32px | Page section gaps |
| `--ps-space-2xl` | 48px | Major layout sections |

Layout constants:
- Sidebar expanded: `--ps-sidenav-expanded` (240px)
- Sidebar icons-only: `--ps-sidenav-icons` (64px)
- Top nav height: `--ps-topnav-height` (56px)
- Right panel: `--ps-right-panel-width` (400px)

### 6.8 Shadows & Radii

| Token | Value |
|-------|-------|
| `--ps-shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` — cards, inputs |
| `--ps-shadow-md` | `0 4px 6px ...` — elevated panels |
| `--ps-shadow-lg` | `0 10px 15px ...` — modals, popovers |
| `--ps-shadow-xl` | `0 20px 25px ...` — floating elements |
| `--ps-radius-sm` | 4px — badges, small elements |
| `--ps-radius-md` | 6px — buttons, inputs |
| `--ps-radius-lg` | 8px — cards |
| `--ps-radius-xl` | 12px — modals, large containers |
| `--ps-radius-full` | 9999px — pills, circular badges |

### 6.9 Accessibility (WCAG AA)

- **Contrast ratios:** All text-on-background combos meet WCAG AA (4.5:1 normal text, 3:1 large text). Deep Blue on Off-White = 7.2:1 (AAA). Deep Blue on Pure White = 7.4:1 (AAA).
- **Focus indicators:** Every interactive element must have a visible focus ring. Inputs use Electric Cyan border + glow on `:focus`.
- **Keyboard navigation:** All modals/drawers close on `Escape`. All interactive elements reachable via `Tab`.
- **ARIA:** Modals use `role="dialog"` + `aria-modal="true"` + `aria-label`.
- **Not colour alone:** Never rely solely on colour to convey status. Always pair with text labels, icons, or patterns.
- **Touch targets:** Minimum 44px for mobile touch targets.

### 6.10 Print Styles

- Use `ps-no-print` class to hide elements in print (nav, sidebars, buttons)
- Use `ps-print-only` class for print-specific content (headers, footers)
- Log entries and registers should be printable with clean, structured layouts

---

## 7. Development Guidelines

### 7.1 CRITICAL: Always Use MCP to Access Tables

> **🚫 Do NOT read migration files to understand table structure**  
> **✅ Always use the Supabase MCP server to inspect tables**

Migration files in `/supabase/migrations/` are **for quick reference only**. They may be outdated, incomplete, or not yet applied. The **single source of truth** for table schemas is the live database accessed via the Supabase MCP tools.

**How to inspect tables:**
- Use `mcp_pharmex-supab_list_tables` — to see all tables in the database
- Use `mcp_pharmex-supab_execute_sql` — to query `information_schema.columns` for column details
- Use `mcp_pharmex-supab_list_extensions` — to check enabled PostgreSQL extensions

**Example — checking a table schema:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ps_services'
ORDER BY ordinal_position;
```

### 7.2 The `ps_` Table Prefix

All new PharmStation tables use the `ps_` prefix:

| Table | Domain |
|-------|--------|
| `ps_organisations` | Core |
| `ps_users` | Core |
| `ps_patients` | Foundation |
| `ps_service_library` | Services |
| `ps_services` | Services |
| `ps_service_forms` | Services |
| `ps_service_form_fields` | Services |
| `ps_appointment_slots` | Appointments |
| `ps_appointments` | Appointments |
| `ps_log_templates` | Logs |
| `ps_log_fields` | Logs |
| `ps_log_subscriptions` | Logs |
| `ps_log_entries` | Logs |
| `ps_video_consultations` | Video |
| `ps_notify_settings` | Messaging |
| `ps_messages` | Messaging |
| `ps_broadcasts` | Messaging |

**Why the prefix?** It differentiates PharmStation tables from any Supabase system tables, extension tables, or legacy tables. When you see `ps_`, you know it's ours.

### 7.3 Row-Level Security (RLS)

Every `ps_` table has RLS enabled. Policies use the existing SECURITY DEFINER function:

```sql
ps_get_user_org_ids()
-- Returns an array of organisation IDs the current auth user belongs to
```

Standard policy pattern:
```sql
CREATE POLICY "Org members can read" ON ps_services
  FOR SELECT USING (
    organisation_id = ANY(ps_get_user_org_ids())
  );
```

Patient-facing policies check `auth.uid()` directly against the patient's `auth_user_id`.

### 7.4 Auth Architecture

Three separate Supabase clients, each with its own storage key:

| Client | Storage Key | Usage |
|--------|-------------|-------|
| `_orgClient` | `ps-org-session` | Organisation-level operations |
| `_userClient` | `ps-user-session` | Staff auth & data access |
| `patientClient` | `ps-patient-session` | Patient portal auth |

All clients are exported from `@pharmstation/supabase-client`. Staff stores use `getUserClient()`. Patient stores use `getPatientClient()`.

### 7.5 State Management (Zustand)

Each feature domain has its own Zustand store in `packages/core/src/stores/`:

| Store | Manages |
|-------|---------|
| `useServiceStore` | Services, service library, service forms |
| `useAppointmentStore` | Slots, appointments, calendar state |
| `useLogStore` | Log templates, entries, subscriptions |
| `useVideoStore` | Video consultations, Daily room lifecycle |
| `useMessageStore` | Messages, broadcasts, delivery status |
| `usePatientStore` | Patient auth, profile, portal data |

All stores follow the same pattern:
```ts
export const useServiceStore = create<ServiceState>((set, get) => ({
  services: [],
  loading: false,
  error: null,
  fetchServices: async () => { /* supabase query */ },
  // ...
}))
```

### 7.6 Forms: react-hook-form + Zod

All forms use `react-hook-form` with Zod schema validation:

```tsx
const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  duration: z.number().min(5, 'Minimum 5 minutes'),
  price: z.number().min(0).optional(),
})

const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema),
})
```

**Validation errors appear inline** below the relevant field. Never in alerts or toasts that disappear.

### 7.7 Tables: TanStack Table v8

Data tables use TanStack Table v8 with the existing `RegisterTable` wrapper pattern. Features: sorting, filtering, pagination, column visibility, row selection.

### 7.8 Routing: React Router v7

All new routes are added to the existing React Router v7 configuration. The expansion adds:

**Staff routes (authenticated):**
- `/services` — service management
- `/appointments` — calendar + booking management
- `/logs` — log templates + entries
- `/video` — video consultation management

**Patient routes (patient auth):**
- `/patient/login` `/patient/register` `/patient/forgot-password`
- `/patient/portal` — dashboard
- `/patient/appointments` — appointment history
- `/patient/video` — join video consultation
- `/patient/messages` — message history

**Public routes (no auth):**
- `/book/:slug` — pharmacy public profile
- `/book/:slug/:serviceId` — specific service booking
- `/book/:slug/:serviceId/confirm` — booking confirmation

### 7.9 Edge Functions (Deno)

Two new edge functions in `supabase/functions/`:

| Function | Purpose |
|----------|---------|
| `daily-video` | Proxy to Daily.co REST API — creates rooms, generates meeting tokens, verifies access codes, ends consultations |
| `nhs-notify` | Proxy to NHS Notify API — sends SMS/email/letters, checks delivery status, tests connections |

Edge functions use service role keys and validate the calling user's auth token before proceeding.

### 7.10 Build Order

The expansion is split into two waves:

**Wave 1 — Foundation (Agent 0)**
Must run first. Creates: `ps_patients` table, `patientClient`, `usePatientStore`, org slug/public profile, all new types, all route definitions, all nav updates, all placeholder pages.

**Wave 2 — Features (Agents 1–5, in parallel)**
Each agent fills in the placeholder pages and builds their domain:
- Agent 1: Services + Form Builder
- Agent 2: Appointments + Calendar + Public Booking
- Agent 3: Logs + Log Builder + Platform Seeds
- Agent 4: Video + Daily.co Integration + Edge Function
- Agent 5: Messaging + NHS Notify Integration + Edge Function

Agents 1–5 can run in parallel because Agent 0 has already created all shared infrastructure (types, routes, nav, placeholders).

---

## 8. Agent Brief Reference

Each agent has a comprehensive implementation brief:

| Agent | File | Lines | Scope |
|-------|------|-------|-------|
| 0 — Foundation | `agent-0-foundation.md` | ~866 | Patient table, patient auth, org slugs, all types, all routes, all nav, all placeholders |
| 1 — Services | `agent-1-services.md` | ~526 | Service library, services, form builder, service management pages |
| 2 — Appointments | `agent-2-appointments.md` | ~818 | Slots, appointments, FullCalendar, public booking, patient portal appointments |
| 3 — Logs | `agent-3-logs.md` | ~617 | Log templates, fields, entries, 5 seed templates, daily-grid/sporadic-list views, log builder |
| 4 — Video | `agent-4-video.md` | ~899 | Video consultations, Daily.co Prebuilt, OTP access codes, daily-video edge function |
| 5 — Messaging | `agent-5-messaging.md` | ~1066 | NHS Notify, messages, broadcasts, settings messaging tab, nhs-notify edge function |

All briefs are in `documentation/expansion/` and contain:
- Exact SQL for migrations (CREATE TABLE, RLS policies, seed data)
- Complete TypeScript type definitions
- Zustand store implementation
- React component structure with props, state, and event handlers
- Page-by-page implementation instructions
- Edge function code (where applicable)

---

## Quick Reference Card

| Rule | Detail |
|------|--------|
| **No `window.alert()`** | Always `<Modal>` or `<Drawer>` |
| **No hardcoded colors** | Always `var(--ps-*)` tokens |
| **No reading migrations for schema** | Always MCP tools (`list_tables`, `execute_sql`) |
| **Table prefix** | All PharmStation tables start with `ps_` |
| **RLS on every table** | Use `ps_get_user_org_ids()` for staff, `auth.uid()` for patients |
| **Forms** | `react-hook-form` + Zod, inline errors only |
| **Tables** | TanStack Table v8, `RegisterTable` pattern |
| **State** | Zustand stores in `packages/core/src/stores/` |
| **Auth** | Three clients: `_orgClient`, `_userClient`, `patientClient` |
| **WCAG AA** | All text meets 4.5:1 contrast. Focus rings on everything. |
| **Build order** | Agent 0 first, then Agents 1–5 in parallel |

---

*This document is the single summary reference for the PharmStation expansion. For implementation details, refer to the individual agent briefs in this directory.*
