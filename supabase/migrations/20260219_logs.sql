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
