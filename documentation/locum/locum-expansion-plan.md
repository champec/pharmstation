# PharmStation — Locum Expansion Plan

> **Created:** 2 March 2026
> **Status:** Planning — not yet in development
> **Depends on:** Core platform live with active pharmacy users

---

## 1. Purpose & Vision

PharmStation's locum module is a **two-sided marketplace** connecting UK locum pharmacists with pharmacies on the platform. The core promise on each side:

**For pharmacies:**
> Fine-grained control over which locums work at their site, with compliance, sign-in, shift management, and payments handled in one familiar system.

**For locums:**
> A single platform where shifts are discoverable, compliance is portable, payment is predictable, and the experience is consistent across every pharmacy in the network.

The key differentiator from existing locum boards (Locate a Locum, LocumDeck, etc.) is that PharmStation **stays in the payment chain** — every shift posted on the platform goes through the Stripe Connect flow, which means locums are guaranteed timely, structured payment with auto-generated invoices and dispute support. There is no chasing pharmacy managers.

---

## 2. Scope — v1

### Primary role: Locum Pharmacist

v1 targets locum pharmacists only. The role type is designed to be expandable in future to:
- Pharmacy Technician (registered, with registration body + currency)
- ACT (Accuracy Checking Technician)
- Dispenser (Buttercups or NVQ qualification)

For now, **locum = locum pharmacist** throughout.

---

## 3. Platform Architecture

### Who Is a Locum?

A locum is a user with `default_role = 'locum'` on `ps_user_profiles` and a completed `ps_locum_profile`. They are **not a member of any specific organisation** by default. Their presence on the platform is the network membership — no invite required.

When a locum is booked for a shift, a `ps_locum_bookings` record is created linking them to that organisation for the duration of that shift. This is the temporary association. When the shift ends, the association ends.

This is distinct from the existing `ps_organisation_members` model where staff belong to an org permanently.

### Two Sides

| Side | Entity | Auth |
|---|---|---|
| Organisation (pharmacy) | `ps_organisations` | Existing org auth |
| Locum | `ps_user_profiles` (role=locum) + `ps_locum_profile` | Existing user auth |

Locums sign up at the same entry point as staff, selecting account type `locum` during registration.

---

## 4. Feature Set

### 4.1 For the Organisation (Pharmacy)

#### Shift Management
- Create shift slots with date, start time, end time, hourly rate
- Calendar view of all shifts (open, filled, completed)
- Clash prevention — cannot double-book a locum on overlapping shifts
- Set booking mode per shift: **auto-accept** (any eligible locum is confirmed instantly) or **manual review** (org approves each application)

#### Criteria Engine
Each shift can require:
- Universal criteria (applied by the platform — see Section 5)
- Org-specific criteria: services the locum must offer, references required, store-specific SOP sign-off

#### SOP Management
- Upload company SOPs and documents
- Mark as required reading before a locum can book a shift at that org
- Track who has read and signed off each document
- Optional per org — not required to post shifts

#### Central Sign-In
- Locum signs in on arrival via the platform (on any device)
- Sign-in triggers an entry in the **RP log** for that org automatically
- Pro-rated pay clock starts from moment of sign-in, not contracted start time
- Sign-out closes the RP log entry and finalises shift duration for payment

#### Worker Intelligence
- Stats per locum: shifts completed at this org, services provided
- Hidden stats (visible to org only, never to locum or publicly):
  - Cancellation rate
  - Punctuality score (derived from sign-in time vs shift start)
- Internal notes per locum (per org, never visible to locum)
- Blacklist — prevents a locum from booking shifts at this org
  - Org-level only — does not affect the locum at any other org
  - Multi-org owners can blacklist across all their orgs simultaneously
  - Network-level removal (removing someone from the platform entirely) is a platform admin action only, rare

#### Payment Management
- Two payment options (see Section 6)
- View payment history per locum and per shift
- Auto-generated invoices per completed shift
- Dispute raised directly through the platform

---

### 4.2 For the Locum

#### Profile & Document Vault
Self-managed account containing:
- GPhC registration number + expiry (checked on boarding, self-declared ongoing)
- Professional indemnity insurance + expiry
- Smart card (held/not held)
- NHS email address
- DBS certificate + expiry (with renewal prompts)
- Government ID upload
- NI number + address (for payment and verification purposes)
- Qualifications as applicable

Locum manages all of this themselves and is responsible for keeping it current. The platform relies on **integrity and self-declaration** with document upload. Checks are performed on boarding; ongoing compliance is contract and terms-based.

#### Services Declared
- Select from a predetermined list (drawn from `ps_service_library`)
- Examples: NMS, MUR, Flu Vaccination, Blood Pressure Check, Smoking Cessation, Emergency Contraception, Travel Vaccination, etc.
- Services are visible to pharmacies when browsing locums or reviewing applicants

#### Shift Discovery
- Browse all available shifts across all orgs on the platform
- Filter by: eligible only, geography, date range, shift duration, rate
- Eligibility is computed live — a shift is marked eligible if the locum's profile meets all universal and shift-specific criteria
- Shifts where org-specific SOPs have not yet been signed are surfaced as "requires sign-off before booking"

#### Booking Flow
1. Locum selects a shift
2. If org has required SOPs → prompted to read and sign off before proceeding
3. If `booking_mode = auto` and locum is eligible → confirmed immediately
4. If `booking_mode = manual` → application submitted, org reviews and responds
5. Confirmation sent once approved

#### References
- Locums can add public references from previous employers
- References can be a criteria requirement for specific shifts (org's choice)
- References are visible to orgs when reviewing applications

#### Payment & Invoicing
- Every completed shift generates an auto-invoice
- Payment is received through the platform on a predictable schedule
- Full payment history accessible in account
- Dispute mechanism available for non-payment or rate disagreements
- Stripe-backed — funds deposited to locum's connected bank account

#### Reviews Received
- Pharmacies leave internal reviews after each shift
- Not visible to the locum directly, not public — used to inform hidden stats and org decision-making
- Future: may become semi-public once reputation model is validated

#### Reviews Given
- Locum can leave feedback on pharmacies they have worked at
- Internal only, not public for now
- Serves as a feedback loop for platform quality

---

## 5. Compliance — Universal Criteria

The following apply to **all** locums on the platform regardless of shift or org:

| Requirement | How Verified |
|---|---|
| GPhC registration — current and valid | Upload on boarding + self-declaration. GPhC public register check via automated headless browser script (Phase 2) |
| Professional indemnity insurance | Upload certificate + expiry date |
| Smart card | Self-declaration (held / not held) |
| NHS email address | Verified at signup |
| DBS certificate | Upload + expiry date. DBS renewal prompts when approaching expiry. 3rd-party DBS renewal service to be integrated (Phase 2) |
| Government ID | Upload (passport or driving licence) |

Ongoing compliance after boarding relies on:
- Self-declaration
- Agreement to platform terms of service
- Signing digital service contracts with pharmacies
- Expiry tracking and renewal prompts built into the platform

---

## 6. Payments — Stripe Connect Architecture

### Platform Fee
50p per completed shift transaction. Applied as `application_fee_amount` in Stripe Connect — PharmStation never touches the principal, Stripe routes it automatically.

### Locum Onboarding
Each locum creates a **Stripe Express account** during profile setup. Stripe handles KYC, identity verification, and bank account setup. Stripe handles payout to the locum's bank. PharmStation has no access to locum funds.

### Pharmacy Payment Options

**Option A — Standing Order / Mandate (preferred)**
- Pharmacy sets up a Stripe mandate (SetupIntent) — a one-time action
- On shift completion → auto-invoice generated → Stripe charges mandate automatically
- Funds routed to locum's Stripe Express account minus 50p platform fee
- Pharmacy receives invoice copy automatically

**Option B — Manual Payment**
- Pharmacy pays into PharmStation's central Stripe account manually per invoice
- Platform disburses to locum's Express account
- Slower, relies on pharmacy action — not recommended but supported for flexibility

Both options produce:
- Auto-generated invoice per shift (PDF, downloadable)
- Full payment history for both parties
- Stripe dispute/support layer for escalations

### Payment Field on Shifts
`payment_mode` on `ps_locum_shifts`:
- `platform` — full Stripe Connect flow (v1 only value)
- `external` — reserved for future use when large chains with their own payroll are onboarded

### Enterprise / Large Chain Strategy
Large chains (Boots, Lloyds etc.) require a one-time vendor onboarding with their finance/procurement team before payments can flow through the platform. This is a **commercial and procurement conversation**, not an architectural problem. The platform fully supports their shifts once their finance team has added PharmStation as a vendor.

**Go-to-market sequencing:**
- v1: Independent pharmacies and small groups — full platform, immediate
- v2: Medium groups already using PharmStation for compliance modules — natural upsell
- v3: Large chains — approached after market penetration via compliance modules, sold as vendor add-on or API integration with their existing workforce systems

---

## 7. Proposed Database Schema

### New Tables

| Table | Purpose |
|---|---|
| `ps_locum_profiles` | Extended profile — registration, insurance, smart card, NHS email, DBS, indemnity expiry. 1:1 with `ps_user_profiles` where role=locum |
| `ps_locum_documents` | Document vault. Types: `gov_id`, `dbs`, `insurance`, `gphc_cert`, `smart_card`, `qualification` |
| `ps_locum_services` | Services a locum declares. FK to `ps_service_library` |
| `ps_locum_shifts` | Shifts created by orgs. date, time range, rate, booking_mode, status, payment_mode |
| `ps_locum_shift_criteria` | Per-shift requirements. Required services, references, SOP sign-offs |
| `ps_locum_bookings` | Locum ↔ shift association. Status: `pending`, `approved`, `rejected`, `completed`, `cancelled` |
| `ps_locum_sop_documents` | Org-specific SOPs locums must read/sign before booking |
| `ps_locum_sop_signoffs` | Record of a locum signing a specific SOP (locum + doc + booking) |
| `ps_locum_sign_ins` | Central arrival record. Triggers RP log entry. Starts pay clock |
| `ps_locum_payments` | Per-shift payment. Stripe payment_intent_id, amount, status |
| `ps_locum_payment_mandates` | Stripe mandate per org for standing order payments |
| `ps_locum_invoices` | Auto-generated invoice per completed shift. FK to booking + payment |
| `ps_locum_reviews` | Pharmacy → locum internal review. Score, notes. Feeds hidden stats |
| `ps_locum_pharmacy_feedback` | Locum → pharmacy internal feedback. Not public |
| `ps_locum_notes` | Internal org notes on a locum. Per org, never visible to locum |
| `ps_locum_blacklist` | Org-level block. Prevents booking at that org |

### Existing Tables — Already Compatible

- `ps_user_profiles` — `default_role = 'locum'` already in CHECK constraint
- `ps_organisation_members` — `is_locum BOOLEAN` already present
- `ps_register_ledgers` — `register_type = 'RP'` already exists, sign-in writes to it
- `ps_service_library` — locum-declared services reference existing library

### Key RLS Considerations

- `ps_locum_shifts` — readable by all authenticated locums (eligibility filtered query-side)
- `ps_locum_bookings` — readable by the booking locum and the org that owns the shift
- `ps_locum_notes` + `ps_locum_blacklist` — org-only, never readable by the locum
- `ps_locum_reviews` — org-only read, locum cannot see their own reviews
- Clash detection requires a SECURITY DEFINER function (locum's bookings across all orgs) — same pattern as existing `ps_get_user_org_ids()`

---

## 8. Build Phases

### Phase 1 — Locum Identity & Compliance
- `ps_locum_profiles`, `ps_locum_documents`, `ps_locum_services`
- Locum registration flow, profile UI, document vault, services declaration
- GPhC number captured, expiry tracking, renewal prompts

### Phase 2 — Shift Management (Org side)
- `ps_locum_shifts`, `ps_locum_shift_criteria`, `ps_locum_sop_documents`
- Shift creation UI, calendar view, criteria engine, SOP upload + management

### Phase 3 — Booking (Locum side)
- `ps_locum_bookings`, `ps_locum_sop_signoffs`
- Shift browse + eligibility filter, SOP sign-off flow, apply / auto-book, clash detection

### Phase 4 — Sign-In & RP Log Integration
- `ps_locum_sign_ins`
- Central sign-in UI, trigger to RP log, pro-rated pay clock, sign-out flow

### Phase 5 — Payments
- `ps_locum_payment_mandates`, `ps_locum_invoices`, `ps_locum_payments`
- Stripe Express onboarding for locums, mandate setup for orgs, auto-invoicing, payment history, dispute flow

### Phase 6 — Reputation & Org Controls
- `ps_locum_reviews`, `ps_locum_pharmacy_feedback`, `ps_locum_notes`, `ps_locum_blacklist`
- Hidden stats computation (cancellation rate, punctuality), internal review UI, notes, blacklist management

---

## 9. Open Items / Future Phases

| Item | Notes |
|---|---|
| GPhC automated check | Headless browser script (Playwright/Puppeteer) querying GPhC public register. Phase 2 enhancement |
| DBS renewal service | 3rd-party integration (e.g. uCheck). Phase 2 |
| Public reviews | Currently internal only. May become semi-public once reputation model validated |
| Dispenser / Technician / ACT roles | Schema supports it via role type config. Not in scope for v1 |
| Large chain API integration | Workforce system sync for chains with their own systems (Kronos/UKG etc). v3 |
| `payment_mode = external` | Reserved in schema. Not active in v1 |
| Network-level blacklist | Platform admin action only. Not an org capability |
