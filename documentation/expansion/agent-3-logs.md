# Agent 3 — Logs (Flexible Electronic Documents)

> **Wave:** 2 (runs in PARALLEL with Agents 1, 2, 4, 5 — after Agent 0 completes)
> **Prerequisite:** Agent 0 (Foundation) must be complete
> **Base plan:** `documentation/expansion/expansion-plan.md` — Phase 3
> **Assumes:** All types already exist in `@pharmstation/types`, all routes already wired in `App.tsx`, all nav items already in `SideNav.tsx`, all placeholder pages already created by Agent 0.

This agent builds the **Logs** feature: a flexible system where pharmacies can subscribe to platform-provided log templates (fridge temp, cleaning, visitor, CD keys, date checking) or create custom logs. Logs are form-based documents where entries are recorded daily, on custom days, or sporadically.

---

## Scope Summary

1. Create the logs database migration (4 tables + seed data for 5 platform logs)
2. Create `useLogStore` Zustand store
3. Create `CanvasField` component (reusable HTML5 canvas for signatures/drawing)
4. Implement `LogsPage` — org's active log subscriptions
5. Implement `LogLibraryPage` — platform log catalogue
6. Implement `LogViewPage` — the log itself (daily grid or sporadic entry list)
7. Implement `LogBuilderPage` — create/edit custom log templates
8. Implement `LogSettingsPage` — subscription-level settings

---

## 1. Database Migration

Create: `supabase/migrations/20260219_logs.sql`

```sql
-- ===========================================
-- PharmStation: Logs — Templates, Fields, Subscriptions, Entries
-- ===========================================

-- Log template definitions
CREATE TABLE ps_log_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES ps_organisations(id) ON DELETE CASCADE, -- null = platform-provided
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'custom'
    CHECK (category IN ('cleaning', 'fridge', 'cd', 'visitor', 'date_check', 'custom')),
  schedule_type text NOT NULL DEFAULT 'sporadic'
    CHECK (schedule_type IN ('daily', 'custom_days', 'sporadic')),
  required_days int[], -- 0=Sun…6=Sat, relevant for daily/custom_days
  is_library boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_log_templates_org ON ps_log_templates(org_id);
CREATE INDEX idx_log_templates_library ON ps_log_templates(is_library) WHERE is_library = true;

ALTER TABLE ps_log_templates ENABLE ROW LEVEL SECURITY;

-- Org members can CRUD their own templates
CREATE POLICY "org_members_crud_log_templates"
  ON ps_log_templates FOR ALL
  USING (
    org_id IN (SELECT ps_get_user_org_ids())
    OR is_library = true
  )
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- Library templates are globally readable (even anon)
CREATE POLICY "anyone_read_library_templates"
  ON ps_log_templates FOR SELECT
  USING (is_library = true);


-- Log field definitions (columns in a template)
CREATE TABLE ps_log_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES ps_log_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_key text NOT NULL,
  field_type text NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date', 'textarea', 'signature', 'canvas')),
  options jsonb, -- for select/multiselect choices
  is_required boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0,
  column_width text -- optional layout hint e.g. '120px', '1fr'
);

CREATE INDEX idx_log_fields_template ON ps_log_fields(template_id);

ALTER TABLE ps_log_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_log_fields"
  ON ps_log_fields FOR ALL
  USING (
    template_id IN (
      SELECT id FROM ps_log_templates
      WHERE org_id IN (SELECT ps_get_user_org_ids()) OR is_library = true
    )
  )
  WITH CHECK (
    template_id IN (
      SELECT id FROM ps_log_templates
      WHERE org_id IN (SELECT ps_get_user_org_ids())
    )
  );

CREATE POLICY "anyone_read_library_fields"
  ON ps_log_fields FOR SELECT
  USING (
    template_id IN (SELECT id FROM ps_log_templates WHERE is_library = true)
  );


-- Log subscriptions (org activates a template)
CREATE TABLE ps_log_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES ps_log_templates(id) ON DELETE CASCADE,
  custom_title text, -- nullable override
  custom_fields jsonb, -- any field overrides
  is_active boolean NOT NULL DEFAULT true,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(org_id, template_id)
);

CREATE INDEX idx_log_subscriptions_org ON ps_log_subscriptions(org_id);

ALTER TABLE ps_log_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_subscriptions"
  ON ps_log_subscriptions FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));


-- Log entries (one row per log event)
CREATE TABLE ps_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES ps_log_subscriptions(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', -- keyed by field_key
  entered_by_user_id uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_log_entries_sub ON ps_log_entries(subscription_id);
CREATE INDEX idx_log_entries_org ON ps_log_entries(org_id);
CREATE INDEX idx_log_entries_date ON ps_log_entries(subscription_id, entry_date);

ALTER TABLE ps_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_crud_entries"
  ON ps_log_entries FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));


-- ===========================================
-- Seed: Platform Library Log Templates + Fields
-- ===========================================

-- 1. Cleaning Log (sporadic)
INSERT INTO ps_log_templates (id, org_id, title, description, category, schedule_type, is_library)
VALUES ('00000000-0000-0000-0001-000000000001', NULL, 'Cleaning Log', 'Record pharmacy area cleaning', 'cleaning', 'sporadic', true);

INSERT INTO ps_log_fields (template_id, label, field_key, field_type, is_required, display_order) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Area', 'area', 'text', true, 0),
  ('00000000-0000-0000-0001-000000000001', 'Cleaned By', 'cleaned_by', 'text', true, 1),
  ('00000000-0000-0000-0001-000000000001', 'Signed Off By', 'signed_off_by', 'text', false, 2),
  ('00000000-0000-0000-0001-000000000001', 'Notes', 'notes', 'textarea', false, 3);

-- 2. Visitor Log (sporadic)
INSERT INTO ps_log_templates (id, org_id, title, description, category, schedule_type, is_library)
VALUES ('00000000-0000-0000-0001-000000000002', NULL, 'Visitor Log', 'Record visitors to the pharmacy', 'visitor', 'sporadic', true);

INSERT INTO ps_log_fields (template_id, label, field_key, field_type, is_required, display_order) VALUES
  ('00000000-0000-0000-0001-000000000002', 'Visitor Name', 'visitor_name', 'text', true, 0),
  ('00000000-0000-0000-0001-000000000002', 'Address / Company', 'address', 'text', false, 1),
  ('00000000-0000-0000-0001-000000000002', 'Reason for Visit', 'reason', 'text', true, 2),
  ('00000000-0000-0000-0001-000000000002', 'Time In', 'time_in', 'date', true, 3),
  ('00000000-0000-0000-0001-000000000002', 'Time Out', 'time_out', 'date', false, 4),
  ('00000000-0000-0000-0001-000000000002', 'Signature', 'signature', 'canvas', false, 5);

-- 3. Fridge Temperature Log (daily, Mon–Sat)
INSERT INTO ps_log_templates (id, org_id, title, description, category, schedule_type, required_days, is_library)
VALUES ('00000000-0000-0000-0001-000000000003', NULL, 'Fridge Temperature Log', 'Daily fridge temperature recording', 'fridge', 'custom_days', ARRAY[1,2,3,4,5,6], true);

INSERT INTO ps_log_fields (template_id, label, field_key, field_type, is_required, display_order, column_width) VALUES
  ('00000000-0000-0000-0001-000000000003', 'Fridge 1 (°C)', 'fridge_1', 'number', true, 0, '100px'),
  ('00000000-0000-0000-0001-000000000003', 'Fridge 2 (°C)', 'fridge_2', 'number', false, 1, '100px'),
  ('00000000-0000-0000-0001-000000000003', 'Fridge 3 (°C)', 'fridge_3', 'number', false, 2, '100px'),
  ('00000000-0000-0000-0001-000000000003', 'Action Taken', 'action_taken', 'textarea', false, 3, '200px'),
  ('00000000-0000-0000-0001-000000000003', 'Checked By', 'checked_by', 'text', true, 4, '120px');

-- 4. CD Keys Log (sporadic)
INSERT INTO ps_log_templates (id, org_id, title, description, category, schedule_type, is_library)
VALUES ('00000000-0000-0000-0001-000000000004', NULL, 'CD Keys Log', 'Track CD cupboard key handovers', 'cd', 'sporadic', true);

INSERT INTO ps_log_fields (template_id, label, field_key, field_type, is_required, display_order) VALUES
  ('00000000-0000-0000-0001-000000000004', 'Received By', 'received_by', 'text', true, 0),
  ('00000000-0000-0000-0001-000000000004', 'Handed Over By', 'handed_over_by', 'text', true, 1),
  ('00000000-0000-0000-0001-000000000004', 'Time', 'time', 'date', true, 2),
  ('00000000-0000-0000-0001-000000000004', 'Signature', 'signature', 'canvas', false, 3);

-- 5. Date Checking Log (sporadic)
INSERT INTO ps_log_templates (id, org_id, title, description, category, schedule_type, is_library)
VALUES ('00000000-0000-0000-0001-000000000005', NULL, 'Date Checking Log', 'Record date checking of stock', 'date_check', 'sporadic', true);

INSERT INTO ps_log_fields (template_id, label, field_key, field_type, options, is_required, display_order) VALUES
  ('00000000-0000-0000-0001-000000000005', 'Section', 'section', 'select', '["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"]', true, 0),
  ('00000000-0000-0000-0001-000000000005', 'Checked By', 'checked_by', 'text', NULL, true, 1),
  ('00000000-0000-0000-0001-000000000005', 'Expiries Found', 'expiries_found', 'number', NULL, false, 2),
  ('00000000-0000-0000-0001-000000000005', 'Notes', 'notes', 'textarea', NULL, false, 3);
```

---

## 2. Zustand Store: `useLogStore`

Create: `packages/core/src/stores/log-store.ts`

```typescript
import { create } from 'zustand'
import type {
  LogTemplate,
  LogField,
  LogSubscription,
  LogEntry,
} from '@pharmstation/types'
import { getUserClient } from '@pharmstation/supabase-client'

export interface LogState {
  // Data
  templates: LogTemplate[]          // library templates
  subscriptions: LogSubscription[]  // org's active subscriptions
  entries: LogEntry[]               // entries for active subscription view
  activeTemplate: LogTemplate | null
  activeFields: LogField[]
  activeSubscription: LogSubscription | null
  loading: boolean
  error: string | null

  // Actions
  fetchLibrary: () => Promise<void>
  fetchSubscriptions: (orgId: string) => Promise<void>
  fetchTemplateDetail: (templateId: string) => Promise<void>
  fetchEntries: (subscriptionId: string, dateRange?: { start: string; end: string }) => Promise<void>
  subscribeToLibrary: (orgId: string, templateId: string) => Promise<LogSubscription>
  createEntry: (entry: Partial<LogEntry>) => Promise<LogEntry>
  updateEntry: (entryId: string, data: Record<string, unknown>) => Promise<void>
  buildTemplate: (template: Partial<LogTemplate>, fields: Partial<LogField>[]) => Promise<LogTemplate>
  updateSubscription: (subscriptionId: string, updates: Partial<LogSubscription>) => Promise<void>
  deactivateSubscription: (subscriptionId: string) => Promise<void>
  clearError: () => void
}

export const useLogStore = create<LogState>((set, get) => ({
  templates: [],
  subscriptions: [],
  entries: [],
  activeTemplate: null,
  activeFields: [],
  activeSubscription: null,
  loading: false,
  error: null,

  fetchLibrary: async () => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_log_templates')
        .select('*, fields:ps_log_fields(count)')
        .eq('is_library', true)
        .order('category, title')
      if (error) throw error
      set({ templates: data as LogTemplate[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchSubscriptions: async (orgId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await getUserClient()
        .from('ps_log_subscriptions')
        .select('*, template:ps_log_templates(id, title, description, category, schedule_type, required_days)')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('subscribed_at')
      if (error) throw error
      set({ subscriptions: data as LogSubscription[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchTemplateDetail: async (templateId) => {
    set({ loading: true, error: null })
    try {
      const client = getUserClient()
      const [templateRes, fieldsRes] = await Promise.all([
        client.from('ps_log_templates').select('*').eq('id', templateId).single(),
        client.from('ps_log_fields').select('*').eq('template_id', templateId).order('display_order'),
      ])
      if (templateRes.error) throw templateRes.error
      if (fieldsRes.error) throw fieldsRes.error
      set({
        activeTemplate: templateRes.data as LogTemplate,
        activeFields: fieldsRes.data as LogField[],
        loading: false,
      })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  fetchEntries: async (subscriptionId, dateRange) => {
    set({ loading: true, error: null })
    try {
      let query = getUserClient()
        .from('ps_log_entries')
        .select('*, entered_by:ps_user_profiles(id, full_name)')
        .eq('subscription_id', subscriptionId)
        .order('entry_date', { ascending: false })

      if (dateRange) {
        query = query.gte('entry_date', dateRange.start).lte('entry_date', dateRange.end)
      }

      const { data, error } = await query
      if (error) throw error
      set({ entries: data as LogEntry[], loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  subscribeToLibrary: async (orgId, templateId) => {
    const { data, error } = await getUserClient()
      .from('ps_log_subscriptions')
      .insert({ org_id: orgId, template_id: templateId })
      .select()
      .single()
    if (error) throw error
    const created = data as LogSubscription
    set((s) => ({ subscriptions: [...s.subscriptions, created] }))
    return created
  },

  createEntry: async (entry) => {
    const { data, error } = await getUserClient()
      .from('ps_log_entries')
      .insert(entry)
      .select()
      .single()
    if (error) throw error
    const created = data as LogEntry
    set((s) => ({ entries: [created, ...s.entries] }))
    return created
  },

  updateEntry: async (entryId, newData) => {
    const { error } = await getUserClient()
      .from('ps_log_entries')
      .update({ data: newData })
      .eq('id', entryId)
    if (error) throw error
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === entryId ? { ...e, data: newData } : e
      ),
    }))
  },

  buildTemplate: async (template, fields) => {
    const client = getUserClient()
    // Insert template first
    const { data: tmpl, error: tmplErr } = await client
      .from('ps_log_templates')
      .insert({ ...template, is_library: false })
      .select()
      .single()
    if (tmplErr) throw tmplErr

    // Insert fields
    if (fields.length > 0) {
      const rows = fields.map((f, i) => ({
        ...f,
        template_id: tmpl.id,
        display_order: i,
      }))
      const { error: fieldsErr } = await client.from('ps_log_fields').insert(rows)
      if (fieldsErr) throw fieldsErr
    }

    return tmpl as LogTemplate
  },

  updateSubscription: async (subscriptionId, updates) => {
    const { error } = await getUserClient()
      .from('ps_log_subscriptions')
      .update(updates)
      .eq('id', subscriptionId)
    if (error) throw error
    set((s) => ({
      subscriptions: s.subscriptions.map((sub) =>
        sub.id === subscriptionId ? { ...sub, ...updates } : sub
      ),
    }))
  },

  deactivateSubscription: async (subscriptionId) => {
    await get().updateSubscription(subscriptionId, { is_active: false })
    set((s) => ({
      subscriptions: s.subscriptions.filter((sub) => sub.id !== subscriptionId),
    }))
  },

  clearError: () => set({ error: null }),
}))
```

Export from `packages/core/src/index.ts`:

```typescript
export { useLogStore, type LogState } from './stores/log-store'
```

---

## 3. Canvas / Signature Field Component

Create: `apps/web/src/components/forms/CanvasField.tsx`

This component is reusable across logs and service forms — any field with `field_type: 'signature'` or `'canvas'` should render this component.

**Requirements:**
- HTML5 `<canvas>` element with mouse / touch / stylus drawing support.
- Pointer events: `pointerdown` → start drawing, `pointermove` → draw line, `pointerup` → stop.
- Toolbar: **Undo** (pops last stroke), **Clear** (resets canvas), optional **Colour** (black only is fine for MVP).
- **Output:** stores drawn image as a base64-encoded PNG data URL string.
- Props:
  - `value?: string` — initial base64 image to load onto canvas.
  - `onChange: (base64: string) => void` — called on undo/clear/stroke-end with the latest canvas data URL.
  - `width?: number` (default 400), `height?: number` (default 200).
  - `disabled?: boolean` — when true, renders the saved image as a static `<img>` (no drawing).
- On mount with `value`: draw the existing image onto the canvas.
- Responsive: canvas should fill its container width (`max-width: 100%`).
- **No external library needed** — pure HTML5 Canvas API.

```typescript
// Simplified signature:
interface CanvasFieldProps {
  value?: string
  onChange: (base64: string) => void
  width?: number
  height?: number
  disabled?: boolean
  label?: string
}

export function CanvasField({ value, onChange, width = 400, height = 200, disabled, label }: CanvasFieldProps) {
  // ... canvas refs, stroke state, pointer handlers, undo stack, output ...
}
```

---

## 4. LogsPage

Replace placeholder at: `apps/web/src/pages/logs/LogsPage.tsx`

**Requirements:**
- On mount, call `useLogStore.fetchSubscriptions(orgId)`.
- Header: "My Logs" with action buttons: "+ Create Custom Log" → `/logs/new`, "Browse Library" → `/logs/library`.
- Card grid of active log subscriptions. Each card shows:
  - Title (custom_title or template title).
  - Category badge (colour-coded: fridge=blue, cleaning=green, cd=purple, visitor=amber, date_check=orange, custom=grey).
  - Schedule indicator: "Daily", "Mon–Sat", "Sporadic".
  - **Today's status:** For daily/custom_days logs:
    - ✅ "Complete" — entry exists for today.
    - ⏳ "Pending" — today is a required day but no entry yet.
    - ➖ "Not Required" — today is not a required day (e.g. Sunday for Mon–Sat).
  - For sporadic logs: show total entry count and last entry date.
- Click card → navigates to `/logs/:subscriptionId`.
- Empty state: "You haven't subscribed to any logs yet. Browse the library to get started."

---

## 5. LogLibraryPage

Replace placeholder at: `apps/web/src/pages/logs/LogLibraryPage.tsx`

**Requirements:**
- On mount, call `useLogStore.fetchLibrary()`.
- Header: "Log Library" with back link to `/logs`.
- Card grid of platform library templates, grouped by category.
- Each card: title, description, category badge, schedule type, field count.
- "Subscribe" button → `subscribeToLibrary(orgId, templateId)`. On success, show toast "Subscribed to [title]".
- If already subscribed (check `subscriptions` for matching `template_id`), show "Already subscribed" badge.
- Search/filter by name.

---

## 6. LogViewPage

Replace placeholder at: `apps/web/src/pages/logs/LogViewPage.tsx`

This is the core log experience. The layout depends on the template's `schedule_type`.

**Requirements:**

### Daily / Custom Days Logs (e.g. Fridge Temperature Log)
- **Spreadsheet-like grid view:**
  - Rows = dates (one row per date, most recent at top).
  - Columns = the template's fields (from `ps_log_fields`), plus a "Date" column and an "Entered By" column.
  - Use `column_width` hint from fields to set column widths.
  - **Today's row** is highlighted and editable inline. Other rows are read-only (or click to edit).
  - **Missing days** (required days that have no entry) are highlighted in red/amber.
  - **Not-required days** (e.g. Sunday for Mon–Sat) are greyed out.
- Date range selector: show last 7 days | last 30 days | custom range.
- "Add Entry" for today → if today's row doesn't exist, clicking it creates a new entry with today's date and shows inline editing.
- Saves: on blur or explicit "Save" button, calls `createEntry` or `updateEntry`.

### Sporadic Logs (e.g. Cleaning Log, Visitor Log)
- **Reverse-chronological entry list:**
  - Each entry is a card showing date, field values, entered by.
  - "Add Entry" button → opens a modal/drawer with a dynamically-rendered form from the template's fields.
  - Form uses `react-hook-form`, each field rendered by type:
    - `text` → text input
    - `number` → number input
    - `boolean` → checkbox/switch
    - `select` → dropdown from `options`
    - `multiselect` → multi-select from `options`
    - `date` → date/datetime picker
    - `textarea` → textarea
    - `signature` / `canvas` → `<CanvasField />`
  - On submit → `createEntry({ subscription_id, org_id, entry_date: today, data: formValues, entered_by_user_id })`.

### Both:
- URL param: `subscriptionId`.
- On mount: fetch template detail (for fields), fetch entries for the subscription.
- Header: log title, category badge, schedule type, "Settings" link → `/logs/:subscriptionId/settings`.

---

## 7. LogBuilderPage

Replace placeholder at: `apps/web/src/pages/logs/LogBuilderPage.tsx`

Identical UX to `FormBuilderPage` (Agent 1) with additional log-specific settings.

**Requirements:**
- **Log settings section:**
  - Title (text input).
  - Description (textarea).
  - Category (selector: cleaning, fridge, cd, visitor, date_check, custom).
  - Schedule Type (radio: daily, custom_days, sporadic).
  - Required Days picker (shown for `daily` or `custom_days`): row of day-of-week checkboxes (Mon–Sun). Selecting `daily` pre-selects all 7.
- **Fields section:** same as `FormBuilderPage`:
  - Left palette: field types (Text, Number, Yes/No, Dropdown, Multi-select, Date, Text Area, Signature, Canvas).
  - Right panel: reorderable field list. Each field card: label, field_key (auto-generated), type badge, required toggle, options editor (for select types), column_width (text input, optional), delete.
  - Add field from palette, reorder with up/down buttons.
- **Save:** calls `useLogStore.buildTemplate(template, fields)`, then auto-subscribes the org to the new template, navigates to `/logs/:subscriptionId`.
- "Preview" toggle: simulates what a filled entry would look like.

---

## 8. LogSettingsPage

Replace placeholder at: `apps/web/src/pages/logs/LogSettingsPage.tsx`

**Requirements:**
- URL param: `subscriptionId`.
- Fetches subscription + template detail.
- Editable settings:
  - Custom title override (`custom_title`).
  - Custom field overrides (`custom_fields`) — future enhancement, for now just show field list read-only.
  - Active/inactive toggle.
- "Deactivate Log" danger button → `deactivateSubscription`, navigate to `/logs`.
- If template is org-owned (not library): link to edit the template in `LogBuilderPage`.

---

## Verification Checklist

After completing all work:

- [ ] Migration applies cleanly — all 4 tables created, 5 platform logs seeded with fields
- [ ] `useLogStore` compiles and all actions work against Supabase
- [ ] `CanvasField` component draws with mouse/touch, outputs base64, loads existing value
- [ ] `LogsPage` shows subscriptions with today's status indicators
- [ ] `LogLibraryPage` shows library templates grouped by category, subscribe works
- [ ] `LogViewPage` daily grid renders correctly — today's row editable, missing days highlighted
- [ ] `LogViewPage` sporadic list renders entries, "Add Entry" form works with all field types
- [ ] `LogBuilderPage` creates custom log with fields, auto-subscribes
- [ ] `LogSettingsPage` allows title override and deactivation
- [ ] Canvas/signature fields work in both logs and service forms
- [ ] RLS: org members CRUD own subscriptions/entries; library templates globally readable
- [ ] No typescript errors — `pnpm build` succeeds

---

## Files Modified

| File | Action |
|---|---|
| `supabase/migrations/20260219_logs.sql` | **CREATE** |
| `packages/core/src/stores/log-store.ts` | **CREATE** |
| `packages/core/src/index.ts` | **EDIT** — add log store export |
| `apps/web/src/components/forms/CanvasField.tsx` | **CREATE** |
| `apps/web/src/pages/logs/LogsPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/logs/LogLibraryPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/logs/LogViewPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/logs/LogBuilderPage.tsx` | **REPLACE** placeholder |
| `apps/web/src/pages/logs/LogSettingsPage.tsx` | **REPLACE** placeholder |

**DO NOT modify** `App.tsx`, `SideNav.tsx`, or `packages/types/src/index.ts` — Agent 0 handles those.
