-- ============================================================
-- SLA ENGINE
--
-- Per-account SLA policy (first-response + resolution targets,
-- optionally business-hours-aware) and per-conversation SLA clocks.
--
-- Flow:
--   - new unanswered inbound  → set first_response_due_at + resolution_due_at
--   - agent replies           → stamp first_response_met_at (FR clock stops)
--   - conversation closed     → stamp resolved_at (resolution clock stops)
--   - customer messages after resolve → reopen: clocks reset
--   - cron flags breaches when due passes unmet
-- ============================================================

CREATE TABLE IF NOT EXISTS sla_policies (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL DEFAULT 'Default SLA',
  first_response_mins  INTEGER     NOT NULL DEFAULT 30,
  resolution_mins      INTEGER     NOT NULL DEFAULT 1440,   -- 24h
  business_hours_only  BOOLEAN     NOT NULL DEFAULT FALSE,
  timezone             TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
  work_start           TEXT        NOT NULL DEFAULT '09:00', -- HH:MM (policy tz)
  work_end             TEXT        NOT NULL DEFAULT '18:00',
  work_days            INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=Sun..6=Sat
  enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)   -- one policy per account in v1
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_policies_select ON sla_policies;
CREATE POLICY sla_policies_select ON sla_policies
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS sla_policies_write ON sla_policies;
CREATE POLICY sla_policies_write ON sla_policies
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Per-conversation SLA clocks
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_response_due_at   TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_response_met_at   TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_due_at       TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolved_at             TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_response_breached BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_breached     BOOLEAN NOT NULL DEFAULT FALSE;

-- Fast lookup for the breach-checker cron: open clocks only
CREATE INDEX IF NOT EXISTS idx_conversations_fr_due
  ON conversations(first_response_due_at)
  WHERE first_response_met_at IS NULL AND first_response_breached = FALSE;
CREATE INDEX IF NOT EXISTS idx_conversations_res_due
  ON conversations(resolution_due_at)
  WHERE resolved_at IS NULL AND resolution_breached = FALSE;

-- Seed a default policy for every existing account that lacks one
INSERT INTO sla_policies (account_id)
SELECT id FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM sla_policies p WHERE p.account_id = a.id);
