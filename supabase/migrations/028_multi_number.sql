-- ============================================================
-- MULTI-NUMBER SUPPORT
--
-- Until now each account had exactly ONE WhatsApp number
-- (whatsapp_config UNIQUE(account_id)). This lets an account
-- connect several numbers, each its own session, and routes every
-- conversation to the number that owns it.
--
-- 1. Drop the one-config-per-account constraint
-- 2. Add a human label per number ("Sales", "Support", …)
-- 3. Tag conversations with the owning phone_number_id
-- 4. Backfill existing conversations to the account's current number
-- ============================================================

-- 1. Allow multiple configs per account; keep phone_number_id globally unique
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- A given phone number can only be claimed once across the whole system.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_phone_number_id_key'
  ) THEN
    -- Guard against pre-existing dupes before adding the unique index
    IF NOT EXISTS (
      SELECT phone_number_id FROM whatsapp_config
      GROUP BY phone_number_id HAVING count(*) > 1
    ) THEN
      ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_phone_number_id_key UNIQUE (phone_number_id);
    END IF;
  END IF;
END $$;

-- 2. Display label per number
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS label TEXT;

-- 3. Which number owns each conversation
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phone_number_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number_id
  ON conversations(account_id, phone_number_id);

-- 4. Backfill: point every existing conversation at the account's
--    current (single) number so nothing disappears from the inbox.
UPDATE conversations c
SET phone_number_id = wc.phone_number_id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND c.phone_number_id IS NULL;
