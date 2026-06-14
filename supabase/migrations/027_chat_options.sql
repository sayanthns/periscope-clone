-- ============================================================
-- PER-CHAT OPTIONS (Periskope/WhatsApp parity)
--
-- pinned   — sticks the conversation to the top of the inbox list
-- muted    — suppresses the unread highlight + badge styling
-- archived — hides from the default list (Archived filter shows them)
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS muted    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations(account_id, pinned) WHERE pinned;
