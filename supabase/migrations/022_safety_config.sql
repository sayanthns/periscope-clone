-- ============================================================
-- SAFETY CONFIG — ban-prevention layer
--
-- 1. whatsapp_config: warm-up tracking + daily send counter
-- 2. contacts: opt-in / opt-out consent tracking
-- ============================================================

-- ── whatsapp_config additions ─────────────────────────────────────────────────

ALTER TABLE whatsapp_config
  -- When the Baileys session first connected successfully.
  -- Used to enforce warm-up tiers (see baileys-service rate-limiter).
  ADD COLUMN IF NOT EXISTS connected_since TIMESTAMPTZ,

  -- Rolling daily outbound message counter; reset by nightly cron.
  ADD COLUMN IF NOT EXISTS daily_out_count  INTEGER NOT NULL DEFAULT 0,

  -- Date the counter was last reset (so we know if today's counter is stale).
  ADD COLUMN IF NOT EXISTS daily_out_reset_date DATE;

-- ── contacts additions ────────────────────────────────────────────────────────

ALTER TABLE contacts
  -- TRUE  = contact has given consent (messaged us first, or explicit opt-in).
  -- FALSE = manually added; must not receive automated outbound until opted in.
  ADD COLUMN IF NOT EXISTS opted_in     BOOLEAN NOT NULL DEFAULT FALSE,

  -- When they opted in (NULL if opted_in = false).
  ADD COLUMN IF NOT EXISTS opted_in_at  TIMESTAMPTZ,

  -- When they opted out via STOP keyword or manual removal.
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

-- Index: fast lookup of opted-out contacts to exclude from broadcasts
CREATE INDEX IF NOT EXISTS idx_contacts_opted_out ON contacts(opted_out_at)
  WHERE opted_out_at IS NOT NULL;

-- Index: fast lookup for broadcast eligibility
CREATE INDEX IF NOT EXISTS idx_contacts_opted_in ON contacts(opted_in)
  WHERE opted_in = TRUE;
