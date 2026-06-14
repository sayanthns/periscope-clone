-- ============================================================
-- PERISKOPE PARITY PHASE 8
--
-- 1. wa-media storage bucket — inbound/outbound media files
-- 2. group_auto_replies — per-group keyword auto-responders
-- 3. tasks — tickets created from messages
-- 4. conversations.custom_properties — free-form chat fields
-- 5. api_keys + webhooks — public developer platform
-- ============================================================

-- ── 1. Storage bucket for WhatsApp media ───────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('wa-media', 'wa-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (bucket is public anyway; this covers the API path)
DROP POLICY IF EXISTS "wa-media public read" ON storage.objects;
CREATE POLICY "wa-media public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'wa-media');

-- Authenticated users can upload (outbound attachments from the inbox)
DROP POLICY IF EXISTS "wa-media authenticated upload" ON storage.objects;
CREATE POLICY "wa-media authenticated upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'wa-media' AND auth.role() = 'authenticated');

-- ── 2. Per-group auto-replies ──────────────────────────────
CREATE TABLE IF NOT EXISTS group_auto_replies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_jid   TEXT        NOT NULL,
  -- Case-insensitive substring trigger, e.g. "price" or "#help"
  keyword     TEXT        NOT NULL,
  reply_text  TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, group_jid, keyword)
);

CREATE INDEX IF NOT EXISTS idx_group_auto_replies_lookup
  ON group_auto_replies(account_id, group_jid) WHERE enabled;

ALTER TABLE group_auto_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_auto_replies_all ON group_auto_replies;
CREATE POLICY group_auto_replies_all ON group_auto_replies
  FOR ALL USING (is_account_member(account_id));

-- ── 3. Tasks / tickets ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      UUID        REFERENCES messages(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  assignee_id     UUID        REFERENCES auth.users(id),
  due_date        DATE,
  status          TEXT        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'done')),
  created_by      UUID        NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_account_status ON tasks(account_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_all ON tasks;
CREATE POLICY tasks_all ON tasks
  FOR ALL USING (is_account_member(account_id));

-- ── 4. Custom chat properties ──────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS custom_properties JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 5. Public API keys + webhooks ──────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  -- SHA-256 of the raw key. Raw key shown once at creation.
  key_hash    TEXT        NOT NULL UNIQUE,
  -- First 8 chars of the raw key for display ("pk_a1b2c3…")
  key_prefix  TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_all ON api_keys;
CREATE POLICY api_keys_all ON api_keys
  FOR ALL USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  url         TEXT        NOT NULL,
  -- Subscribed events: message.received, message.sent, conversation.created
  events      TEXT[]      NOT NULL DEFAULT ARRAY['message.received'],
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  secret      TEXT,       -- HMAC signing secret (optional)
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status INTEGER,
  last_fired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhooks_account ON webhooks(account_id) WHERE enabled;

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhooks_all ON webhooks;
CREATE POLICY webhooks_all ON webhooks
  FOR ALL USING (is_account_member(account_id, 'admin'));
