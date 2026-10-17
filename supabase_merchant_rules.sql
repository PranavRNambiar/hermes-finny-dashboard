-- Finny: custom merchant names and per-merchant category rules.
-- Keyed by the raw merchant string the bank sends. Run once in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS merchant_rules (
  merchant      TEXT PRIMARY KEY,
  display_name  TEXT,
  category      TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE merchant_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE merchant_rules FROM anon, authenticated;
SELECT 'merchant_rules ready' AS status;
