-- ============================================================
-- QUICK REPLIES (Phase 6)
--
-- Replaces Meta-specific message templates with simple canned
-- text snippets identified by a /shortcut trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_replies (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shortcut    TEXT      NOT NULL,   -- e.g. "/hello", "/thanks"
  message     TEXT      NOT NULL,   -- the full canned text
  created_by  UUID      REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, shortcut)
);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_replies_select ON quick_replies;
CREATE POLICY quick_replies_select ON quick_replies
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;
CREATE POLICY quick_replies_insert ON quick_replies
  FOR INSERT WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS quick_replies_update ON quick_replies;
CREATE POLICY quick_replies_update ON quick_replies
  FOR UPDATE USING (is_account_member(account_id));

DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;
CREATE POLICY quick_replies_delete ON quick_replies
  FOR DELETE USING (is_account_member(account_id));

CREATE INDEX IF NOT EXISTS idx_quick_replies_account ON quick_replies(account_id);
