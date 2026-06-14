-- ============================================================
-- BAILEYS SESSIONS
-- Stores Baileys socket credentials per phone number.
-- One row per phoneId (= whatsapp_config.phone_number_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS baileys_sessions (
  phone_id TEXT PRIMARY KEY,
  creds    JSONB NOT NULL DEFAULT '{}',
  keys     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only service role can read/write (baileys-service uses service role key)
ALTER TABLE baileys_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON baileys_sessions
  USING (auth.role() = 'service_role');
