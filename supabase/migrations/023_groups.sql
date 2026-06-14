-- ============================================================
-- GROUPS SUPPORT (Phase 5)
--
-- WhatsApp group chats appear in the inbox as conversations.
-- The "contact" for a group conversation is the group itself;
-- individual senders are tracked per-message.
--
-- Changes:
--   contacts:      is_group, group_jid (for dedup lookup)
--   conversations: is_group, group_jid, group_name
--   messages:      sender_name (who in the group sent this)
--   groups:        cache table synced from Baileys groups.upsert
-- ============================================================

-- ── contacts additions ────────────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_group   BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_jid  TEXT;   -- e.g. "1234567890@g.us"

CREATE INDEX IF NOT EXISTS idx_contacts_group_jid ON contacts(group_jid)
  WHERE group_jid IS NOT NULL;

-- ── conversations additions ───────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_jid  TEXT,
  ADD COLUMN IF NOT EXISTS group_name TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_is_group ON conversations(is_group)
  WHERE is_group = TRUE;

-- ── messages additions ────────────────────────────────────────────────────────
-- Stores the display name of the sender inside a group thread.
-- NULL for 1-to-1 conversations.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- ── groups cache table ────────────────────────────────────────────────────────
-- Kept in sync via POST /api/whatsapp/groups/sync (baileys-service pushes
-- groups.upsert events here). Used to look up group names before a
-- conversation row exists, and to populate a Groups directory page later.
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_id    TEXT      NOT NULL, -- whatsapp_config.phone_number_id
  group_jid   TEXT      NOT NULL, -- e.g. "1234567890@g.us"
  name        TEXT      NOT NULL,
  description TEXT,
  participant_count INTEGER,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, group_jid)
);

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;

-- NOTE: PostgreSQL does not support CREATE POLICY IF NOT EXISTS.
-- Use DROP IF EXISTS + CREATE pattern instead.
DROP POLICY IF EXISTS whatsapp_groups_select ON whatsapp_groups;
CREATE POLICY whatsapp_groups_select ON whatsapp_groups
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_groups_insert ON whatsapp_groups;
CREATE POLICY whatsapp_groups_insert ON whatsapp_groups
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_groups_update ON whatsapp_groups;
CREATE POLICY whatsapp_groups_update ON whatsapp_groups
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_account ON whatsapp_groups(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_jid     ON whatsapp_groups(group_jid);
