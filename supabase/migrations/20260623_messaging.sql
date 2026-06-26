-- ===========================================
-- PharmStation: Messaging (NHS Notify / GOV.UK Notify)
--
-- Per-org NHS Notify credentials + template IDs, the sent-message
-- log, and bulk broadcasts. The org's API key is fetched server-side
-- only (edge function) and is never exposed to the client — the
-- client reads the `ps_notify_settings_safe` view instead.
--
-- NOTE: This migration is idempotent so it can be applied to a fresh
-- database and is a no-op on environments where these objects already
-- exist. Vault-based key encryption and the delivery callback live in
-- 20260623_messaging_callbacks.sql.
-- ===========================================

-- -------------------------------------------
-- Per-org NHS Notify settings
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_notify_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE UNIQUE,
  api_key text,                 -- legacy plaintext column; superseded by Vault (see callbacks migration)
  sms_template_id text,
  email_template_id text,
  letter_template_id text,
  is_active boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ps_notify_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_crud_notify_settings" ON ps_notify_settings;
CREATE POLICY "org_members_crud_notify_settings"
  ON ps_notify_settings FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- -------------------------------------------
-- Sent message log
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES ps_patients(id) ON DELETE SET NULL,
  recipient_phone text,
  recipient_email text,
  recipient_address jsonb,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'letter')),
  subject text,
  body text NOT NULL,
  personalisation jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'delivered', 'failed',
                      'permanent-failure', 'temporary-failure', 'technical-failure')),
  notify_message_id text,
  broadcast_id uuid,
  sent_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_org ON ps_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_messages_patient ON ps_messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON ps_messages(org_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON ps_messages(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_messages_notify_id ON ps_messages(notify_message_id);

ALTER TABLE ps_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_crud_messages" ON ps_messages;
CREATE POLICY "org_members_crud_messages"
  ON ps_messages FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- -------------------------------------------
-- Broadcasts (bulk sends)
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS ps_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'letter')),
  subject text,
  body text NOT NULL,
  recipient_filter jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'cancelled')),
  total_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  created_by_user_id uuid NOT NULL REFERENCES ps_user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_org ON ps_broadcasts(org_id);

ALTER TABLE ps_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_crud_broadcasts" ON ps_broadcasts;
CREATE POLICY "org_members_crud_broadcasts"
  ON ps_broadcasts FOR ALL
  USING (org_id IN (SELECT ps_get_user_org_ids()))
  WITH CHECK (org_id IN (SELECT ps_get_user_org_ids()));

-- ps_messages.broadcast_id -> ps_broadcasts.id (added after both tables exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_broadcast'
  ) THEN
    ALTER TABLE ps_messages
      ADD CONSTRAINT fk_messages_broadcast
      FOREIGN KEY (broadcast_id) REFERENCES ps_broadcasts(id) ON DELETE SET NULL;
  END IF;
END$$;

-- -------------------------------------------
-- Safe view: never exposes the raw api_key to the client
-- -------------------------------------------
CREATE OR REPLACE VIEW ps_notify_settings_safe AS
  SELECT
    id,
    org_id,
    sms_template_id,
    email_template_id,
    letter_template_id,
    is_active,
    last_tested_at,
    created_at,
    CASE WHEN api_key IS NOT NULL AND api_key <> '' THEN true ELSE false END AS has_api_key
  FROM ps_notify_settings;

GRANT SELECT ON ps_notify_settings_safe TO authenticated;
