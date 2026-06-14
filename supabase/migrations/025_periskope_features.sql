-- ============================================================
-- PERISKOPE FEATURE PARITY (Phase 7)
--
-- 1. scheduled_messages  — single + recurring sends to any chat
-- 2. labels + conversation_labels — chat-level organisation
-- 3. messages.sender_type 'note' — team-only private notes inline
-- 4. accounts.auto_assign_enabled — round-robin new chats
-- 5. accounts.mask_numbers — hide customer phones from agents
-- ============================================================

-- ── 1. Scheduled messages ──────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content_text    TEXT        NOT NULL,
  send_at         TIMESTAMPTZ NOT NULL,
  -- NULL = one-off. Recurring rows are re-armed by the cron after each send.
  recurrence      TEXT        CHECK (recurrence IN ('daily', 'weekly', 'monthly')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON scheduled_messages(status, send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conversation
  ON scheduled_messages(conversation_id);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
CREATE POLICY scheduled_messages_select ON scheduled_messages
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
CREATE POLICY scheduled_messages_insert ON scheduled_messages
  FOR INSERT WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
CREATE POLICY scheduled_messages_update ON scheduled_messages
  FOR UPDATE USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_delete ON scheduled_messages;
CREATE POLICY scheduled_messages_delete ON scheduled_messages
  FOR DELETE USING (is_account_member(account_id));

-- ── 2. Labels on conversations ─────────────────────────────
CREATE TABLE IF NOT EXISTS labels (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, name)
);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS labels_all ON labels;
CREATE POLICY labels_all ON labels
  FOR ALL USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS conversation_labels (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id        UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, label_id)
);

ALTER TABLE conversation_labels ENABLE ROW LEVEL SECURITY;

-- Membership check goes through the label's account.
DROP POLICY IF EXISTS conversation_labels_all ON conversation_labels;
CREATE POLICY conversation_labels_all ON conversation_labels
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM labels
      WHERE labels.id = conversation_labels.label_id
        AND is_account_member(labels.account_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_conversation_labels_label
  ON conversation_labels(label_id);

-- ── 3. Private notes: allow sender_type = 'note' ───────────
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_sender_type_check
  CHECK (sender_type IN ('customer', 'agent', 'bot', 'note'));

-- ── 4 + 5. Account-level feature toggles ───────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_assign_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mask_numbers        BOOLEAN NOT NULL DEFAULT FALSE;

-- Round-robin cursor: remembers the last assigned agent so the next
-- new conversation goes to the following member.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_assigned_user_id UUID;
