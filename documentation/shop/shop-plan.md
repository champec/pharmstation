# PharmStation Shop — Unified Pharmacy Marketplace Plan

> Route: `pharmstation.co.uk/shop`
> Status: Phase 1 in progress
> Last updated: 2026-07-28

## Vision

A single, beautiful, Deliveroo/Amazon-style marketplace where every pharmacy-type
organisation on PharmStation can list **products and services** in one unified shop
front. Customers (logged in as patients, or guests) browse by **proximity**, filter by
delivery, compare prices across pharmacies, and order online. Orders route to the
selling pharmacy, which fulfils them through their PharmStation dashboard with
stock/inventory management built in.

**Only organisations with `organisation_type = 'pharmacy'` can sell.** Other org types
(care homes, etc.) do not get shop features.

## Why should a pharmacy invest? (the pitch)

- **Turn-key e-commerce** — no website, no payment integration, no compliance headache.
  PharmStation handles checkout complexity, security and compliance.
- **Shared customer pool** — listing exposes a pharmacy to every other pharmacy's
  customers. Compete on proximity, price, delivery, speed of response.
- **P-med compliance built in** — pharmacist review gates, custom questionnaires,
  purchase-history "consultation cards" that transfer between pharmacies.
- **Repeat purchases made instant** — a logged-in patient with a prior consultation
  (e.g. sildenafil) can re-purchase quickly by presenting their digital consultation
  card / purchase history.

## Customer experience (end state)

1. **Landing** (`/shop`) — asks for location (browser geolocation or postcode), then
   lists nearest pharmacies + products/services, like Deliveroo. Worldwide search also
   possible.
2. **Browse** — categories & subcategories for pharmacy items (plus "Uncategorised" —
   pharmacies can list anything). Filters: distance, delivery offered, store open now,
   price, in stock.
3. **Product & service listings** — products with stock/price/photos; services with
   real slot availability (reuses appointment slots system).
4. **Cart & checkout** — multi-item cart per pharmacy. Logged-in patient OR guest
   (guest provides phone number; gets an SMS link with a checkout-session
   authorisation link to complete/finish checkout).
5. **Availability check flow** — pharmacy can flag items "check availability before
   payment": customer completes checkout intent → pharmacy confirms → customer gets a
   message/link to complete payment.
6. **P-med flow** — restricted items require a pharmacy-defined questionnaire (any
   number of questions, simple form builder). Pharmacist reviews answers before
   approving sale. Approved consultations become reusable "cards" on the patient's
   account for faster repeat purchase.
7. **Delivery / collection** — pharmacy sets a delivery radius (validated both against
   browser proximity and the purchase address). Collection always available.

## Pharmacy experience (end state)

- **Products & Inventory** (`/shop-admin` inside org dashboard):
  - CRUD products: name, description, images, category/subcategory, price, SKU/barcode,
    stock quantity, `requires_availability_check`, `requires_consultation`
    (+ linked questionnaire), active/hidden.
  - Automatic stock decrement on sale ("automatic SKU reduction"), low-stock alerts,
    manual stock adjustments with audit trail.
- **Orders** — kanban/list of incoming orders: new → confirmed → ready →
  out-for-delivery/collected → completed / cancelled / refunded. Confirming an
  availability-check order triggers the customer "complete your payment" message.
- **Shop settings** — enable shop, delivery on/off, delivery radius, delivery fee,
  free-delivery threshold, opening-hours awareness.
- **Consultation review queue** — P-med questionnaire answers awaiting pharmacist
  approval.

## Data model (ps_shop_* tables)

| Table | Purpose |
|---|---|
| `ps_shop_settings` | Per-org shop config: enabled, delivery radius/fee/threshold |
| `ps_shop_categories` | Global category tree (parent_id for subcategories) |
| `ps_shop_products` | Product listings (org-scoped), price in pence, stock, flags |
| `ps_shop_orders` | Orders (patient or guest), status machine, delivery/collection |
| `ps_shop_order_items` | Line items, snapshot of price/name at purchase |
| Later: `ps_shop_questionnaires`, `ps_shop_questionnaire_responses` (P-med forms), `ps_shop_consultation_cards`, `ps_shop_stock_movements` (audit) |

Key decisions:
- Prices stored in **pence** (integer), like existing payments code.
- Proximity uses existing `ps_organisations.geolocation` (PostGIS) — same infra as maps.
- Services are NOT duplicated: the storefront links to the existing public booking flow
  (`/book/:orgSlug/:serviceId`) for slot availability.
- Guest orders keyed by phone number + secure token link (like checkout session auth).
- Stock decremented atomically via RPC on order confirmation, not client-side.

## Phased delivery (slow and simple → complex)

### Phase 1 — Foundation (NOW)
- DB: settings, categories (seeded), products, orders, order items + RLS.
- Org side: enable shop, product CRUD with stock, simple orders list with status
  updates and automatic stock decrement.
- Public side: `/shop` storefront — geolocation/postcode proximity sort, category
  filter, search, product detail, pharmacy shop page. Cart + **order without online
  payment** (cash on collection/delivery) for logged-in patients and guests (name +
  phone). No SMS yet.

### Phase 2 — Payments & messaging
- Stripe checkout (reuse existing payments edge functions pattern).
- Guest SMS links (checkout-session authorisation link) via SMS Works.
- Availability-check flow (checkout intent → pharmacy confirm → pay link).
- Staff alerts on new orders (wire into `ps_fanout_notification`).

### Phase 3 — Delivery & discovery polish
- Delivery radius enforcement (browser proximity + delivery address validation).
- Delivery fees, free-delivery thresholds, "open now" filter using opening hours.
- Services surfaced in storefront search results with live slot availability.
- Product images (Supabase storage bucket), richer category browsing.

### Phase 4 — P-meds & consultations
- Questionnaire builder (any number of questions, simple forms).
- Pharmacist review queue; approve/reject before sale completes.
- Consultation cards on patient account; transferable purchase history enabling
  fast re-purchase at any participating pharmacy.

### Phase 5 — Scale & compete
- Reviews/ratings, response-speed metrics, promotions/discounts, multi-pharmacy cart,
  order tracking, driver integration with existing deliveries module, analytics for
  pharmacies (best sellers, conversion).
