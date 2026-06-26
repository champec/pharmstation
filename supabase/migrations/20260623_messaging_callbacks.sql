-- ===========================================
-- PharmStation: Messaging — Vault key encryption + delivery callbacks
--
-- 1. Encrypt each org's NHS Notify API key at rest using Supabase Vault
--    (the legacy plaintext `ps_notify_settings.api_key` is retired).
-- 2. Per-org `callback_token` so a single shared callback edge function
--    can authenticate + attribute GOV.UK Notify delivery receipts.
-- 3. Delivery/failure/cost columns on ps_messages, updated by the
--    callback, and a `feature`/`reference` tag for functional sends.
--
-- SECURITY DEFINER RPCs are restricted to the service_role so only the
-- edge functions (never the browser) can read/write the decrypted key.
-- ===========================================

-- -------------------------------------------
-- ps_notify_settings: Vault pointer + callback token
-- -------------------------------------------
ALTER TABLE ps_notify_settings
  ADD COLUMN IF NOT EXISTS api_key_secret_id uuid,
  ADD COLUMN IF NOT EXISTS callback_token text;

-- The key now lives in Vault, so the legacy plaintext column is optional.
ALTER TABLE ps_notify_settings ALTER COLUMN api_key DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_callback_token
  ON ps_notify_settings(callback_token) WHERE callback_token IS NOT NULL;

-- -------------------------------------------
-- ps_messages: delivery lifecycle + cost + functional tagging
-- -------------------------------------------
ALTER TABLE ps_messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS cost_in_pounds numeric,
  ADD COLUMN IF NOT EXISTS feature text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_messages_feature ON ps_messages(org_id, feature);

-- Realtime so the message history / hub update live as receipts arrive
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ps_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE ps_messages;
    END IF;
  END IF;
END$$;

-- -------------------------------------------
-- Safe view: report has_api_key for BOTH legacy plaintext and Vault
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
    CASE
      WHEN api_key_secret_id IS NOT NULL THEN true
      WHEN api_key IS NOT NULL AND api_key <> '' THEN true
      ELSE false
    END AS has_api_key,
    callback_token
  FROM ps_notify_settings;

GRANT SELECT ON ps_notify_settings_safe TO authenticated;

-- ===========================================
-- SECURITY DEFINER RPCs (service_role only)
-- ===========================================

-- Upsert settings; encrypt the API key into Vault; mint a callback token.
CREATE OR REPLACE FUNCTION ps_notify_save_settings(
  p_org_id uuid,
  p_api_key text DEFAULT NULL,
  p_sms_template_id text DEFAULT NULL,
  p_email_template_id text DEFAULT NULL,
  p_letter_template_id text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
  v_name text := 'notify_api_key_' || p_org_id::text;
BEGIN
  INSERT INTO ps_notify_settings (org_id)
  VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;

  IF p_api_key IS NOT NULL AND length(btrim(p_api_key)) > 0 THEN
    SELECT api_key_secret_id INTO v_secret_id FROM ps_notify_settings WHERE org_id = p_org_id;
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(
        btrim(p_api_key), v_name, 'NHS Notify API key for org ' || p_org_id::text
      );
      UPDATE ps_notify_settings SET api_key_secret_id = v_secret_id WHERE org_id = p_org_id;
    ELSE
      PERFORM vault.update_secret(v_secret_id, btrim(p_api_key));
    END IF;
    -- retire any legacy plaintext value
    UPDATE ps_notify_settings SET api_key = NULL WHERE org_id = p_org_id;
  END IF;

  -- mint a callback token once (stable thereafter)
  UPDATE ps_notify_settings
  SET callback_token = COALESCE(
        callback_token,
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      )
  WHERE org_id = p_org_id;

  UPDATE ps_notify_settings SET
    sms_template_id    = COALESCE(p_sms_template_id, sms_template_id),
    email_template_id  = COALESCE(p_email_template_id, email_template_id),
    letter_template_id = COALESCE(p_letter_template_id, letter_template_id),
    is_active          = COALESCE(p_is_active, is_active)
  WHERE org_id = p_org_id;
END;
$$;

-- Return the decrypted key + config for server-side sends.
CREATE OR REPLACE FUNCTION ps_notify_get_settings(p_org_id uuid)
RETURNS TABLE (
  api_key text,
  sms_template_id text,
  email_template_id text,
  letter_template_id text,
  is_active boolean,
  callback_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
  v_key text;
BEGIN
  SELECT s.api_key_secret_id, s.api_key
    INTO v_secret_id, v_key
  FROM ps_notify_settings s
  WHERE s.org_id = p_org_id;

  IF v_secret_id IS NOT NULL THEN
    SELECT ds.decrypted_secret INTO v_key
    FROM vault.decrypted_secrets ds
    WHERE ds.id = v_secret_id;
  END IF;

  RETURN QUERY
  SELECT
    v_key,
    s.sms_template_id,
    s.email_template_id,
    s.letter_template_id,
    s.is_active,
    s.callback_token
  FROM ps_notify_settings s
  WHERE s.org_id = p_org_id;
END;
$$;

-- Lock the RPCs down to the service_role (edge functions) only.
REVOKE ALL ON FUNCTION ps_notify_save_settings(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ps_notify_get_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ps_notify_save_settings(uuid, text, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION ps_notify_get_settings(uuid) TO service_role;
