-- ============================================
-- AI Models Registry & Chat System
-- Created: 2026-02-14
-- ============================================

-- ps_ai_models — registry of available AI models
CREATE TABLE IF NOT EXISTS ps_ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  model_type TEXT NOT NULL CHECK (model_type IN (
    'standard', 'cheap', 'ultra_cheap', 'image_gen', 'realtime'
  )),
  capabilities JSONB NOT NULL DEFAULT '[]',
  context_window INTEGER,
  max_output_tokens INTEGER,
  input_cost_per_1k NUMERIC,
  output_cost_per_1k NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, model_id)
);

ALTER TABLE ps_ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_ai_models_select_all" ON ps_ai_models
  FOR SELECT USING (true);

-- ps_ai_org_settings — per-org AI model preferences
CREATE TABLE IF NOT EXISTS ps_ai_org_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  standard_model_id UUID REFERENCES ps_ai_models(id),
  cheap_model_id UUID REFERENCES ps_ai_models(id),
  ultra_cheap_model_id UUID REFERENCES ps_ai_models(id),
  image_gen_model_id UUID REFERENCES ps_ai_models(id),
  monthly_token_limit INTEGER,
  tokens_used_this_month INTEGER DEFAULT 0,
  enable_ai_features BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organisation_id)
);

ALTER TABLE ps_ai_org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_ai_org_settings_select" ON ps_ai_org_settings
  FOR SELECT USING (organisation_id IN (SELECT ps_get_user_org_ids()));
CREATE POLICY "ps_ai_org_settings_update" ON ps_ai_org_settings
  FOR UPDATE USING (organisation_id IN (SELECT ps_get_user_org_ids()));
CREATE POLICY "ps_ai_org_settings_insert" ON ps_ai_org_settings
  FOR INSERT WITH CHECK (organisation_id IN (SELECT ps_get_user_org_ids()));

-- ps_chat_conversations — chat threads
CREATE TABLE IF NOT EXISTS ps_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES ps_organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ps_user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  model_id UUID REFERENCES ps_ai_models(id),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ps_chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_chat_conversations_select" ON ps_chat_conversations
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ps_chat_conversations_insert" ON ps_chat_conversations
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ps_chat_conversations_update" ON ps_chat_conversations
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "ps_chat_conversations_delete" ON ps_chat_conversations
  FOR DELETE USING (user_id = auth.uid());

-- ps_chat_messages — individual messages
CREATE TABLE IF NOT EXISTS ps_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ps_chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  tool_name TEXT,
  attachments JSONB DEFAULT '[]',
  input_tokens INTEGER,
  output_tokens INTEGER,
  model_provider TEXT,
  model_id_str TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'streaming', 'completed', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ps_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ps_chat_messages_select" ON ps_chat_messages
  FOR SELECT USING (conversation_id IN (SELECT id FROM ps_chat_conversations WHERE user_id = auth.uid()));
CREATE POLICY "ps_chat_messages_insert" ON ps_chat_messages
  FOR INSERT WITH CHECK (conversation_id IN (SELECT id FROM ps_chat_conversations WHERE user_id = auth.uid()));
CREATE POLICY "ps_chat_messages_update" ON ps_chat_messages
  FOR UPDATE USING (conversation_id IN (SELECT id FROM ps_chat_conversations WHERE user_id = auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_conversations_org_user
  ON ps_chat_conversations(organisation_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON ps_chat_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_org_settings_org
  ON ps_ai_org_settings(organisation_id);

-- ============================================
-- Seed AI Models
-- ============================================
INSERT INTO ps_ai_models (provider, model_id, display_name, model_type, capabilities, context_window, max_output_tokens, input_cost_per_1k, output_cost_per_1k, is_active, is_default, sort_order)
VALUES
  ('openai', 'gpt-5.2-2025-12-11', 'GPT-5.2', 'standard', '["text","image_input","function_calling","streaming"]', 128000, 16384, 0.01, 0.03, true, true, 1),
  ('openai', 'gpt-5-mini-2025-08-07', 'GPT-5 Mini', 'cheap', '["text","image_input","function_calling","streaming"]', 128000, 16384, 0.0004, 0.0016, true, true, 2),
  ('openai', 'gpt-image-1.5-2025-12-16', 'GPT Image 1.5', 'image_gen', '["image_gen"]', null, null, null, null, true, true, 3),
  ('anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', 'standard', '["text","image_input","function_calling","streaming"]', 200000, 8192, 0.003, 0.015, true, false, 4),
  ('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', 'cheap', '["text","image_input","function_calling","streaming"]', 200000, 8192, 0.0008, 0.004, true, false, 5),
  ('google', 'gemini-3-pro-preview', 'Gemini 3 Pro', 'standard', '["text","image_input","function_calling","streaming"]', 1000000, 8192, 0.00125, 0.005, true, false, 6),
  ('google', 'gemini-3-flash-preview', 'Gemini 3 Flash', 'cheap', '["text","image_input","function_calling","streaming"]', 1000000, 8192, 0.000075, 0.0003, true, false, 7),
  ('google', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'ultra_cheap', '["text","image_input","function_calling","streaming"]', 1000000, 8192, 0.000038, 0.00015, true, true, 8),
  ('google', 'gemini-3-pro-image-preview', 'Gemini 3 Pro Image', 'image_gen', '["text","image_input","image_gen","streaming"]', 1000000, 8192, 0.00125, 0.005, true, false, 9),
  ('google', 'gemini-2.5-flash-native-audio-preview-12-2025', 'Gemini 2.5 Flash Audio', 'realtime', '["text","audio","streaming"]', 1000000, 8192, 0.000038, 0.00015, true, true, 10)
ON CONFLICT (provider, model_id) DO NOTHING;
