-- Finny — Supabase schema
-- Run this once via Supabase SQL Editor

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,       -- Gmail message ID
  card          TEXT NOT NULL,          -- 'wise' | 'dbs' | 'scapia' | 'axis' | 'ixigo' | 'ocbc'
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

-- ── Bill splitting ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS people (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  divide_user_id  TEXT,            -- future: Divide app user id
  divide_group_id TEXT,            -- future: Divide app group id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id              SERIAL PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id),
  person_id       INTEGER NOT NULL REFERENCES people(id),
  currency        TEXT NOT NULL,          -- denormalized from transactions.currency, never mixed
  share_amount    REAL NOT NULL,          -- what that person owes Pranav
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'settled'
  settled_at      TIMESTAMPTZ,
  external_ref    TEXT,                   -- future: Divide app entry id once synced
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_messages (
  transaction_id      TEXT PRIMARY KEY REFERENCES transactions(id),
  telegram_message_id BIGINT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_splits_person ON transaction_splits(person_id);
CREATE INDEX IF NOT EXISTS idx_splits_status ON transaction_splits(status);
CREATE INDEX IF NOT EXISTS idx_splits_txn    ON transaction_splits(transaction_id);

-- ── Divide integration (Manny) ──────────────────────────────
-- Single-row table holding the Divide app auth session for Pranav's account.
-- Manny uses this to sync settlements into the Divide app via its REST API.

-- ── Card management + on-demand scans (dashboard-driven) ────
-- Cards are added from the dashboard /cards page; the agent reads this table
-- (env GMAIL_LABEL_* vars are only a fallback). scan_requests is the queue the
-- dashboard writes to and gmail_watch's scan worker consumes.

CREATE TABLE IF NOT EXISTS cards (
  card       TEXT PRIMARY KEY,        -- short slug, e.g. 'ixigo'
  label      TEXT NOT NULL,           -- exact Gmail label name, e.g. 'Ixigo'
  currency   TEXT NOT NULL CHECK (currency IN ('SGD','INR')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_requests (
  id           BIGSERIAL PRIMARY KEY,
  card         TEXT,                            -- NULL = scan all active cards
  days         INTEGER NOT NULL DEFAULT 7,      -- how far back to scan
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'done' | 'error'
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  result       JSONB                            -- scan_once.py output
);

INSERT INTO cards (card, label, currency) VALUES
  ('wise',   'Wise',       'SGD'),
  ('scapia', 'Scapia',     'INR'),
  ('axis',   'Axis Atlas', 'INR'),
  ('ixigo',  'Ixigo',      'INR'),
  ('dbs',    'DBS',        'SGD')
ON CONFLICT (card) DO NOTHING;

CREATE TABLE IF NOT EXISTS divide_session (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  user_id       TEXT,             -- Divide user UUID (Pranav's account)
  phone         TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT divide_session_singleton CHECK (id = 1)
);
