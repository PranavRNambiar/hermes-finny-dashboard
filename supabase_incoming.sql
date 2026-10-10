-- Finny: money in (salary, transfers received, refunds, own top-ups).
-- Separate from `transactions` so nothing that sums spending can count it by mistake.
-- Run once in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS incoming (
  id            TEXT PRIMARY KEY,                 -- Gmail message id (same scheme as transactions.id)
  card          TEXT NOT NULL,                    -- account/card the alert came from: dbs, wise, scapia…
  currency      TEXT NOT NULL,
  amount        REAL NOT NULL,                    -- always positive
  counterparty  TEXT,                             -- who paid you (or the refunding merchant)
  kind          TEXT NOT NULL DEFAULT 'transfer', -- salary | transfer | refund | own_transfer
  raw_desc      TEXT,
  txn_date      DATE NOT NULL,
  txn_time      TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incoming_date ON incoming(txn_date);

-- "Always treat money from X as salary": the agent applies these to new alerts.
CREATE TABLE IF NOT EXISTS incoming_rules (
  counterparty  TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incoming ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE incoming, incoming_rules FROM anon, authenticated;
SELECT 'incoming ready' AS status;
