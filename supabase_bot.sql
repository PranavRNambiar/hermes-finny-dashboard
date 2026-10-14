-- Finny bot on Telegram: per-message switches and an on-demand send queue.
-- Run once in the Supabase SQL Editor. Only affects the Telegram bot; MCP (Claude/ChatGPT) is untouched.
CREATE TABLE IF NOT EXISTS bot_settings (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO bot_settings (key) VALUES
  ('bot'), ('transactions'), ('incoming'), ('nudges'), ('daily_digest'), ('weekly_review')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS bot_jobs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | error
  result        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bot_settings FROM anon, authenticated;
REVOKE ALL ON TABLE bot_jobs FROM anon, authenticated;
SELECT 'bot tables ready' AS status;
