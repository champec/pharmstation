-- ===========================================
-- PharmStation: Pharmacy Network (org-to-org messaging)
--
-- Secure internal communication between PharmStation organisations
-- (e.g. prescription queries, community alerts, stock queries). An org
-- can optionally receive an SMS "ping" (via its own NHS Notify account)
-- when a new network message arrives.
--
-- Idempotent — safe to apply to a fresh DB and a no-op where objects
-- already exist.
-- ===========================================

-- -------------------------------------------
-- Org-level network preferences
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_network_settings (
  org_id uuid PRIMARY KEY REFERENCES ps_organisations(id) ON DELETE CASCADE,
  network_enabled boolean NOT NULL DEFAULT true,
  sms_pings_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ps_network_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "netsettings_own" ON ps_network_settings;
CREATE POLICY "netsettings_own"
  ON ps_network_settings FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()));

-- -------------------------------------------
-- SMS ping contacts (who at the org gets pinged + quiet hours)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_network_sms_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  label text,
  phone_number text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  pause_until timestamptz,
  notify_start time,
  notify_end time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_net_sms_contacts_org ON ps_network_sms_contacts(org_id);

ALTER TABLE ps_network_sms_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smscontacts_own" ON ps_network_sms_contacts;
CREATE POLICY "smscontacts_own"
  ON ps_network_sms_contacts FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()));

-- -------------------------------------------
-- The messages themselves (threaded)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_network_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_org_id uuid NOT NULL REFERENCES ps_organisations(id),
  to_org_id uuid NOT NULL REFERENCES ps_organisations(id),
  thread_id uuid NOT NULL,
  broadcast_id uuid,
  subject text,
  body text NOT NULL,
  label text NOT NULL DEFAULT 'other'
    CHECK (label IN ('prescription_query', 'community_alert', 'stock_query', 'other')),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  request_sms_ping boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ps_network_messages_distinct_orgs CHECK (from_org_id <> to_org_id)
);

CREATE INDEX IF NOT EXISTS idx_net_msg_to ON ps_network_messages(to_org_id, is_read);
CREATE INDEX IF NOT EXISTS idx_net_msg_from ON ps_network_messages(from_org_id);
CREATE INDEX IF NOT EXISTS idx_net_msg_thread ON ps_network_messages(thread_id, created_at);

ALTER TABLE ps_network_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "netmsg_participant" ON ps_network_messages;
CREATE POLICY "netmsg_participant"
  ON ps_network_messages FOR ALL
  USING (
    from_org_id IN (SELECT ps_get_user_org_ids())
    OR to_org_id IN (SELECT ps_get_user_org_ids())
  );
