# Agent 1 — Services & Service Forms

> **Wave:** 2 (runs in PARALLEL with Agents 2, 3, 4 — after Agent 0 completes)
> **Prerequisite:** Agent 0 (Foundation) must be complete
> **Base plan:** `documentation/expansion/expansion-plan.md` — Phase 1
> **Assumes:** All types already exist in `@pharmstation/types`, all routes already wired in `App.tsx`, all nav items already in `SideNav.tsx`, all placeholder pages already created.

This agent builds the **Services & Service Forms** feature: the database tables, the Zustand store, and replaces the placeholder page components with real implementations.

---

## Scope Summary

1. Create the services database migration (4 tables + seed data)
2. Create `useServiceStore` Zustand store
3. Implement `ServicesPage` — org's active services list
4. Implement `ServiceLibraryPage` — platform service catalogue
5. Implement `ServiceDetailPage` — service info + forms list
6. Implement `FormBuilderPage` — drag-and-drop form builder

---

## 1. Database Migration

Create: `supabase/migrations/20260219_services.sql`

```sql
-- ===========================================
-- PharmStation: Services & Service Forms
-- ===========================================

-- Platform-curated service library
CREATE TABLE ps_service_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ps_service_library ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the library
CREATE POLICY "anyone_read_service_library"
  ON ps_service_library FOR SELECT
  USING (true);

-- Organisation's services
CREATE TABLE ps_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  library_service_id uuid REFERENCES ps_service_library(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT false,
  duration_minutes int NOT NULL DEFAULT 15,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_org ON ps_services(org_id);
CREATE INDEX idx_services_public ON ps_services(org_id, is_public) WHERE is_public = true;

ALTER TABLE ps_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_services"
  ON ps_services FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Public can read public services of public orgs
CREATE POLICY "anon_read_public_services"
  ON ps_services FOR SELECT
  USING (
    is_public = true
    AND is_active = true
    AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
  );

-- Service forms (attached to a service)
CREATE TABLE ps_service_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES ps_services(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',
  is_default boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_forms_service ON ps_service_forms(service_id);

ALTER TABLE ps_service_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_service_forms"
  ON ps_service_forms FOR ALL
  USING (
    service_id IN (
      SELECT id FROM ps_services WHERE org_id IN (SELECT ps_get_user_org_ids())
    )
  )
  WITH CHECK (
    service_id IN (
      SELECT id FROM ps_services WHERE org_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Public can read forms for public services
CREATE POLICY "anon_read_public_service_forms"
  ON ps_service_forms FOR SELECT
  USING (
    service_id IN (
      SELECT id FROM ps_services
      WHERE is_public = true AND is_active = true
      AND org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- Service form fields (columns/inputs in a form)
CREATE TABLE ps_service_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES ps_service_forms(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_key text NOT NULL,
  field_type text NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date', 'textarea', 'signature')),
  options jsonb,
  is_required boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0
);

CREATE INDEX idx_service_form_fields_form ON ps_service_form_fields(form_id);

ALTER TABLE ps_service_form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_form_fields"
  ON ps_service_form_fields FOR ALL
  USING (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.org_id IN (SELECT ps_get_user_org_ids())
    )
  )
  WITH CHECK (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.org_id IN (SELECT ps_get_user_org_ids())
    )
  );

-- Public can read fields for public service forms
CREATE POLICY "anon_read_public_form_fields"
  ON ps_service_form_fields FOR SELECT
  USING (
    form_id IN (
      SELECT f.id FROM ps_service_forms f
      JOIN ps_services s ON s.id = f.service_id
      WHERE s.is_public = true AND s.is_active = true
      AND s.org_id IN (SELECT id FROM ps_organisations WHERE is_public = true)
    )
  );

-- ===========================
-- Seed: Service Library
-- ===========================

INSERT INTO ps_service_library (name, description, category) VALUES
  ('Flu Vaccination', 'Seasonal influenza vaccination service', 'vaccination'),
  ('COVID-19 Vaccination', 'COVID-19 booster vaccination service', 'vaccination'),
  ('Travel Vaccination', 'Pre-travel vaccination and advice service', 'vaccination'),
  ('Blood Pressure Check', 'Free NHS blood pressure check service', 'screening'),
  ('Medication Review', 'Structured medication review with pharmacist', 'consultation'),
  ('New Medicine Service (NMS)', 'NHS New Medicine Service — follow-up for new prescriptions', 'consultation'),
  ('Smoking Cessation', 'Stop smoking support and NRT supply', 'consultation'),
  ('Emergency Contraception', 'Emergency hormonal contraception consultation', 'consultation'),
  ('UTI Consultation', 'Pharmacy First — urinary tract infection consultation', 'pharmacy_first'),
  ('Sore Throat Consultation', 'Pharmacy First — sore throat test and treat', 'pharmacy_first'),
  ('Sinusitis Consultation', 'Pharmacy First — sinusitis consultation', 'pharmacy_first'),
  ('Impetigo Consultation', 'Pharmacy First — impetigo consultation', 'pharmacy_first'),
  ('Ear Infection Consultation', 'Pharmacy First — ear infection consultation', 'pharmacy_first'),
  ('Shingles Consultation', 'Pharmacy First — shingles consultation', 'pharmacy_first'),
  ('Infected Insect Bite Consultation', 'Pharmacy First — infected insect bite consultation', 'pharmacy_first');
```

---

## 2. Zustand Store: `useServiceStore`

Create: `packages/core/src/stores/service-store.ts`

```typescript
import { create } from 'zustand'
import type { Service, ServiceLibraryItem, ServiceForm, ServiceFormField } from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface ServiceState {
  // Data
  services: Service[]
  libraryItems: ServiceLibraryItem[]
  activeService: Service | null
  activeForms: ServiceForm[]
  activeFields: ServiceFormField[]
  loading: boolean
  error: string | null

  // Actions
  fetchServices: (orgId: string) => Promise<void>
  fetchLibrary: () => Promise<void>
  fetchServiceDetail: (serviceId: string) => Promise<void>
  fetchFormFields: (formId: string) => Promise<void>
  createService: (service: Partial<Service>) => Promise<Service>
  subscribeToLibraryService: (orgId: string, libraryItemId: string) => Promise<Service>
  updateService: (serviceId: string, updates: Partial<Service>) => Promise<void>
  deleteService: (serviceId: string) => Promise<void>
  createForm: (serviceId: string, name: string) => Promise<ServiceForm>
  saveFields: (formId: string, fields: Partial<ServiceFormField>[]) => Promise<void>
  deleteForm: (formId: string) => Promise<void>
  clearError: () => void
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  services: [],
  libraryItems: [],
  activeService: null,
  activeForms: [],
  activeFields: [],
  loading: false,
  error: null,

  fetchServices: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_services')
        .select('*')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw error
      set({ services: data as Service[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchLibrary: async () => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_service_library')
        .select('*')
        .eq('is_active', true)
        .order('category, name')
      if (error) throw error
      set({ libraryItems: data as ServiceLibraryItem[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchServiceDetail: async (serviceId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [serviceRes, formsRes] = await Promise.all([
        client.from('ps_services').select('*').eq('id', serviceId).single(),
        client.from('ps_service_forms').select('*').eq('service_id', serviceId).order('created_at'),
      ])
      if (serviceRes.error) throw serviceRes.error
      if (formsRes.error) throw formsRes.error
      set({
        activeService: serviceRes.data as Service,
        activeForms: formsRes.data as ServiceForm[],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchFormFields: async (formId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_service_form_fields')
        .select('*')
        .eq('form_id', formId)
        .order('display_order')
      if (error) throw error
      set({ activeFields: data as ServiceFormField[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  createService: async (service) => {
    const { data, error } = await getUserClient()
      .from('ps_services')
      .insert(service)
      .select()
      .single()
    if (error) throw error
    const created = data as Service
    set((s) => ({ services: [...s.services, created] }))
    return created
  },

  subscribeToLibraryService: async (orgId, libraryItemId) => {
    // Find the library item to copy name/description
    const lib = get().libraryItems.find((l) => l.id === libraryItemId)
    if (!lib) throw new Error('Library item not found')
    return get().createService({
      org_id: orgId,
      library_service_id: libraryItemId,
      name: lib.name,
      description: lib.description,
    })
  },

  updateService: async (serviceId, updates) => {
    const { error } = await getUserClient()
      .from('ps_services')
      .update(updates)
      .eq('id', serviceId)
    if (error) throw error
    set((s) => ({
      services: s.services.map((svc) =>
        svc.id === serviceId ? { ...svc, ...updates } : svc
      ),
      activeService: s.activeService?.id === serviceId
        ? { ...s.activeService, ...updates }
        : s.activeService,
    }))
  },

  deleteService: async (serviceId) => {
    const { error } = await getUserClient()
      .from('ps_services')
      .delete()
      .eq('id', serviceId)
    if (error) throw error
    set((s) => ({
      services: s.services.filter((svc) => svc.id !== serviceId),
    }))
  },

  createForm: async (serviceId, name) => {
    const { data, error } = await getUserClient()
      .from('ps_service_forms')
      .insert({ service_id: serviceId, name })
      .select()
      .single()
    if (error) throw error
    const created = data as ServiceForm
    set((s) => ({ activeForms: [...s.activeForms, created] }))
    return created
  },

  saveFields: async (formId, fields) => {
    const client = getUserClient()
    // Delete existing fields for this form
    await client.from('ps_service_form_fields').delete().eq('form_id', formId)
    // Insert all fields with correct display_order
    const rows = fields.map((f, i) => ({
      ...f,
      form_id: formId,
      display_order: i,
    }))
    if (rows.length > 0) {
      const { error } = await client.from('ps_service_form_fields').insert(rows)
      if (error) throw error
    }
    // Refresh
    await get().fetchFormFields(formId)
  },

  deleteForm: async (formId) => {
    const { error } = await getUserClient()
      .from('ps_service_forms')
      .delete()
      .eq('id', formId)
    if (error) throw error
    set((s) => ({
      activeForms: s.activeForms.filter((f) => f.id !== formId),
    }))
  },

  clearError: () => set({ error: null }),
}))
```

Export from `packages/core/src/index.ts`:

```typescript
export { useServiceStore, type ServiceState } from './stores/service-store'
```

---

## 3. ServicesPage

Replace placeholder at: `apps/web/src/pages/services/ServicesPage.tsx`

**Requirements:**
- On mount, call `useServiceStore.fetchServices(orgId)` where `orgId` comes from `useAuthStore.organisation.id`.
- Display a header: "Services" with two action buttons: "+ New Service" and "Browse Library" (links to `/services/library`).
- Show a card grid of the org's services. Each card shows:
  - Service name (bold)
  - Description (truncated)
  - Duration badge (e.g. "15 min")
  - Status: Active/Inactive toggle or badge
  - Public badge if `is_public`
  - Click → navigates to `/services/${service.id}`
- If no services: empty state CTA "Get started by browsing the service library or creating a custom service."
- "+ New Service" opens a modal/drawer with a form: name, description, duration_minutes, is_public toggle. On save → `createService`, navigate to the new service detail page.
- Loading state: skeleton cards.
- Error state: inline error banner.

---

## 4. ServiceLibraryPage

Replace placeholder at: `apps/web/src/pages/services/ServiceLibraryPage.tsx`

**Requirements:**
- On mount, call `useServiceStore.fetchLibrary()`.
- Header: "Service Library" with back link to `/services`.
- Group cards by `category` (with category header labels: "Vaccination", "Screening", "Consultation", "Pharmacy First").
- Each card shows: name, description, category badge.
- "Subscribe" button on each card → calls `subscribeToLibraryService(orgId, libraryItem.id)`.
- If already subscribed (check `services` list for matching `library_service_id`), show "Already added" badge instead of subscribe button.
- Search/filter input at the top.

---

## 5. ServiceDetailPage

Replace placeholder at: `apps/web/src/pages/services/ServiceDetailPage.tsx`

**Requirements:**
- URL param: `serviceId` from `useParams()`.
- On mount: `fetchServiceDetail(serviceId)`.
- Shows service details at top: name, description (editable inline or via edit modal), duration, is_public toggle, is_active toggle.
- Below: **Forms section** — list of service forms as cards.
  - Each form card: name, version, "Default" badge if `is_default`, field count, "Edit form" button → links to `/services/${serviceId}/form/${formId}`.
  - "Add form variant" button → prompts for name, creates form via `createForm`, navigates to form builder.
  - Delete form (with confirmation) — only if not the last form.
- "Delete service" danger button at bottom (with confirmation modal).

---

## 6. FormBuilderPage

Replace placeholder at: `apps/web/src/pages/services/FormBuilderPage.tsx`

This is the most complex component. It's a **visual form builder** where the user defines what data a service form collects.

**Requirements:**

### Layout
- URL params: `serviceId`, `formId` from `useParams()`.
- On mount: `fetchFormFields(formId)`.
- Two-panel layout:
  - **Left panel (narrow):** field type palette — one draggable/clickable button for each `FieldType` value: Text, Number, Yes/No, Dropdown, Multi-select, Date, Text Area, Signature.
  - **Right panel (wide):** the form field list — vertically ordered, reorderable via drag handles or up/down buttons.

### Field Cards
Each field in the list is a card with:
- **Drag handle** (left edge) for reordering.
- **Label input** (text) — the human-readable name.
- **Field key** (auto-generated from label, kebab-case, editable).
- **Type badge** showing current type (non-editable after creation, or allow changing before save).
- **Required toggle** (checkbox or switch).
- **Options editor** (only visible for `select` / `multiselect` types): list of option values, add/remove/reorder.
- **Delete button** (trash icon, right edge).

### Adding Fields
- Click a type in the left palette → appends a new blank field of that type to the bottom of the list.
- Or drag from palette to a specific position in the list.
- New fields get a default label like "New text field" and an auto-generated `field_key`.

### Saving
- "Save" button at the top → calls `saveFields(formId, fields)` with the current field list.
- The save is a full replace (delete all existing + insert all current) — the store already does this.
- Show success toast on save.
- "Discard changes" button → reloads from DB.

### Preview
- Optional: a "Preview" toggle that renders the form as it would appear to a patient/staff member filling it in (read-only mock).

### Tech Notes
- Use `react-hook-form` for the field editing forms (label, key, options).
- Reordering: use a simple state array with move-up/move-down buttons. True drag-and-drop is nice-to-have (could use `@dnd-kit/core` if desired, but not required for MVP).
- Field key auto-generation: `label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')`.

---

## Verification Checklist

After completing all work:

- [ ] Migration applies cleanly — all 4 tables created, seed data inserted
- [ ] `useServiceStore` compiles and all actions work against Supabase
- [ ] `ServicesPage` shows services, can create new, navigates to detail
- [ ] `ServiceLibraryPage` shows library items grouped by category, subscribe works
- [ ] `ServiceDetailPage` shows service info + forms, can add/delete forms
- [ ] `FormBuilderPage` can add fields of all types, reorder, edit labels/options, save, reload
- [ ] Public RLS: anon users can read public services + forms + fields (for public booking in Phase 2)
- [ ] No typescript errors — `pnpm build` succeeds

---

## Files Modified

| File | Action |
|---|---|
| `supabase/migrations/20260219_services.sql` | **CREATE** |
| `packages/core/src/stores/service-store.ts` | **CREATE** |
| `packages/core/src/index.ts` | **EDIT** — add service store export |
| `apps/web/src/pages/services/ServicesPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/services/ServiceLibraryPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/services/ServiceDetailPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/services/FormBuilderPage.tsx` | **REPLACE** placeholder |

**DO NOT modify** `App.tsx`, `SideNav.tsx`, or `packages/types/src/index.ts` — Agent 0 handles those.
