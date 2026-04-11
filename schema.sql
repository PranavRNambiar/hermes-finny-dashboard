-- Finny — Supabase schema
-- Run this once via Supabase SQL Editor

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,       -- Gmail message ID
  card          TEXT NOT NULL,          -- 'dbs' | 'scapia' | 'axis'
  currency      TEXT NOT NULL,          -- 'SGD' | 'INR'
  amount        REAL NOT NULL,          -- always positive
  merchant      TEXT,
  category      TEXT NOT NULL DEFAULT 'Transfers & Misc',
  raw_desc      TEXT,                   -- first 200 chars of email for debugging
  txn_date      DATE NOT NULL,          -- ISO 8601, SGT timezone
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anomaly_flagged BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS processed_emails (
  email_id      TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parse_failed  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS recurring_patterns (
  id            SERIAL PRIMARY KEY,
  merchant      TEXT NOT NULL,
  card          TEXT NOT NULL,
  amount_min    REAL NOT NULL,          -- amount * 0.95
  amount_max    REAL NOT NULL,          -- amount * 1.05
  occurrences   INTEGER NOT NULL DEFAULT 1,
  is_exempt     BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE when occurrences >= 2
  last_seen     DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_card     ON transactions(card);
CREATE INDEX IF NOT EXISTS idx_txn_currency ON transactions(currency);
