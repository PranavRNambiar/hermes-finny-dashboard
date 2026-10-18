# Finny — Product Specification
_Reference document. Claude Code implements against this. Do not modify during implementation._

---

## 1. System overview

Finny is a single-user personal finance agent. It runs as a Node.js background process that:
1. Polls Gmail every 15 minutes for new transaction emails from three cards
2. Parses, categorises, and stores each transaction exactly once
3. Serves a live web dashboard on Vercel
4. Sends a daily Telegram message at 00:00 SGT with the previous day's spend summary

---

## 2. Cards and currencies

| Card | Currency | Gmail label name | Label env var |
|------|----------|-----------------|---------------|
| DBS Debit | SGD | finny/dbs | GMAIL_LABEL_DBS |
| Scapia Forex | INR | finny/scapia | GMAIL_LABEL_SCAPIA |
| Axis Atlas | INR | finny/axis | GMAIL_LABEL_AXIS |

**Currency rule:** SGD figures and INR figures are stored, computed, and displayed independently. No FX conversion is performed anywhere in the system. If an Axis Atlas email contains a foreign currency charge (e.g. USD), store the INR equivalent amount that appears in the email — do not store raw USD.

---

## 3. Database schema

```sql
-- SQLite (dev) / Postgres (prod) compatible

CREATE TABLE transactions (
  id            TEXT PRIMARY KEY,     -- Gmail message ID
  card          TEXT NOT NULL,        -- 'dbs' | 'scapia' | 'axis'
  currency      TEXT NOT NULL,        -- 'SGD' | 'INR'
  amount        REAL NOT NULL,        -- always positive
  merchant      TEXT,
  category      TEXT NOT NULL DEFAULT 'Transfers & Misc',
  raw_desc      TEXT,                 -- original email snippet for debugging
  txn_date      DATE NOT NULL,        -- ISO 8601, SGT timezone
  ingested_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processed_emails (
  email_id      TEXT PRIMARY KEY,
  processed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_patterns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant      TEXT NOT NULL,
  card          TEXT NOT NULL,
  amount_min    REAL NOT NULL,        -- amount * 0.95
  amount_max    REAL NOT NULL,        -- amount * 1.05
  occurrences   INTEGER NOT NULL DEFAULT 1,
  is_exempt     BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE when occurrences >= 2
  last_seen     DATE NOT NULL
);

CREATE INDEX idx_txn_date ON transactions(txn_date);
CREATE INDEX idx_txn_card ON transactions(card);
CREATE INDEX idx_txn_currency ON transactions(currency);
```

---

## 4. Gmail ingestion pipeline

### 4.1 Poll cycle (every 15 min)

```
for each label in [GMAIL_LABEL_DBS, GMAIL_LABEL_SCAPIA, GMAIL_LABEL_AXIS]:
  1. Fetch all message IDs in label (Gmail MCP: list_messages)
  2. Filter: remove IDs that exist in processed_emails
  3. For each new ID:
     a. Fetch full email body (Gmail MCP: get_message)
     b. Call parser (Haiku) → {amount, currency, merchant, txn_date, raw_desc}
     c. Call categoriser (Haiku) → {category}
     d. Write to transactions table
     e. Update recurring_patterns table
     f. Write email_id to processed_emails
  4. Log: "Processed N new transactions from [label]"
```

### 4.2 Parser (Haiku) — system prompt

```
You are a transaction email parser. Extract the following fields from the email body.

Return ONLY valid JSON matching this schema:
{
  "amount": number,        // positive number, no currency symbol
  "currency": "SGD"|"INR", // infer from card context passed in
  "merchant": string,      // merchant name, cleaned up
  "txn_date": string,      // ISO 8601 date YYYY-MM-DD in SGT timezone
  "raw_desc": string       // first 200 chars of the relevant email section
}

If you cannot extract a field with confidence, return null for that field.
Return ONLY the JSON object. No markdown, no explanation.
```

User message includes: `Card: [card name]\nCurrency: [SGD|INR]\n\nEmail body:\n[body]`

### 4.3 Categoriser (Haiku) — system prompt

```
Assign one category to this transaction based on the merchant name and description.

Categories (pick exactly one):
- Food & Drink
- Transport
- Shopping
- Subscriptions
- Health & Fitness
- Travel
- Utilities & Bills
- Rent & Housing
- Entertainment
- Education
- Transfers & Misc

Return ONLY the category name. No explanation.
```

User message: `Merchant: [merchant]\nDescription: [raw_desc]`

### 4.4 Error handling in ingestion

- If parser returns null for `amount` or `txn_date`: log as `PARSE_FAILED`, write email_id to processed_emails with a `parse_failed=TRUE` flag (add column), skip writing to transactions. Do not retry automatically.
- If Haiku API call fails: log error, do NOT write to processed_emails (allow retry on next poll).
- If DB write fails: log error, do NOT write to processed_emails (allow retry).

---

## 5. Recurring pattern detection

After each successful transaction write:

```
1. Look up recurring_patterns WHERE merchant = txn.merchant AND card = txn.card
   AND amount_min <= txn.amount AND txn.amount <= amount_max
2. If found: increment occurrences, update last_seen
   - If occurrences >= 2: set is_exempt = TRUE
3. If not found: insert new row with occurrences = 1
```

Exempt merchants are excluded from anomaly flagging in the digest.

---

## 6. Daily digest (Sonnet, 00:00 SGT)

### 6.1 Data to fetch before calling Sonnet

```
report_date = today - 1 day  (SGT)

sgd_today = SUM(amount) WHERE currency='SGD' AND txn_date = report_date
sgd_mtd   = SUM(amount) WHERE currency='SGD' AND txn_date >= first day of current month AND txn_date <= report_date
inr_today = SUM(amount) WHERE currency='INR' AND txn_date = report_date
inr_mtd   = SUM(amount) WHERE currency='INR' AND txn_date >= first day of current month AND txn_date <= report_date

txns_today = all transactions WHERE txn_date = report_date, ordered by amount DESC

sgd_30d_avg = AVG(daily SGD total) for past 30 days excluding report_date
inr_30d_avg = AVG(daily INR total) for past 30 days excluding report_date

non_exempt_txns = txns_today WHERE merchant NOT IN exempt merchants for that card
```

### 6.2 Sonnet prompt

```
You are Finny, a personal finance assistant. Write a Telegram message (plain text, Telegram Markdown v2 formatting allowed).

Data for [report_date]:

SGD (DBS Debit):
- Today: S$[sgd_today]
- MTD: S$[sgd_mtd]
- 30-day daily avg: S$[sgd_30d_avg]

INR (Scapia + Axis Atlas):
- Today: ₹[inr_today]
- MTD: ₹[inr_mtd]
- 30-day daily avg: ₹[inr_30d_avg]

Today's transactions:
[list each: merchant | amount+currency | category]

Non-exempt transactions above 2× their category's 30-day median:
[list or "none"]

Write the message with these sections:
1. Header with date
2. SGD summary (today + MTD)
3. INR summary (today + MTD)
4. Transaction list (max 8, show top by amount)
5. Anomalies & flags (be specific, compare to averages, give actionable commentary)
6. Finny's take (1–2 sentences: overall spend health, anything to watch)

Tone: direct, friendly, not preachy. Flag real anomalies only — don't flag normal recurring payments.
```

### 6.3 Telegram delivery

```typescript
await bot.sendMessage(TELEGRAM_CHAT_ID, digestText, { parse_mode: 'MarkdownV2' })
```

Retry once on failure. Log on second failure, do not crash.

### 6.4 On-demand commands (Telegram bot listeners)

| Command | Response |
|---------|----------|
| `/today` | Same as digest but for today so far (partial day) |
| `/mtd` | Month-to-date totals: SGD + INR with category breakdown |
| `/last [n]` | Last n transactions (default 10) |

---

## 7. Dashboard (Next.js)

### 7.1 Routes

| Route | Description |
|-------|-------------|
| `/` | Transaction feed — newest first, filterable by card/category/date |
| `/analytics` | Spend charts — SGD and INR panels always separate |
| `/api/transactions` | GET: returns paginated JSON, supports ?card=&currency=&from=&to=&category= |

### 7.2 Transaction feed columns

date · merchant · amount (with S$ or ₹ prefix) · card badge · category tag · anomaly flag (⚠️ if flagged)

### 7.3 Analytics panels

**SGD Panel (DBS Debit)**
- Daily spend bar chart (last 30 days)
- MTD total
- Category pie chart

**INR Panel (Scapia + Axis Atlas)**
- Daily spend bar chart (last 30 days)
- MTD total, broken down by card
- Category pie chart

Rule: SGD and INR charts never share an axis. They are visually distinct panels with different headers and currency symbols.

### 7.4 Category colour map

| Category | Colour |
|----------|--------|
| Food & Drink | green |
| Transport | blue |
| Shopping | coral/orange |
| Subscriptions | purple |
| Health & Fitness | teal |
| Travel | amber |
| Utilities & Bills | gray |
| Rent & Housing | red |
| Entertainment | pink |
| Education | indigo |
| Transfers & Misc | neutral gray |

---

## 8. Environment variables

```
# Anthropic
ANTHROPIC_API_KEY=

# Gmail MCP
GMAIL_MCP_URL=https://gmail.mcp.claude.com/mcp
GMAIL_MCP_TOKEN=
GMAIL_LABEL_DBS=
GMAIL_LABEL_SCAPIA=
GMAIL_LABEL_AXIS=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Database
DATABASE_URL=           # sqlite:./finny.db  OR  postgresql://...

# App
TZ=Asia/Singapore       # critical for date calculations
NODE_ENV=development
```

---

## 9. Anomaly detection rules

1. **Daily spike:** `daily_total > 30d_avg * 2.0` → flag in digest
2. **Transaction spike:** `txn.amount > category_30d_median * 2.0` AND `is_exempt = FALSE` → flag
3. **Exempt:** any merchant where `is_exempt = TRUE` in recurring_patterns → never flag
4. **New merchant:** first time a merchant appears → note as "new merchant" in digest, not an anomaly

---

## 10. Non-functional requirements

- Poll cycle must complete in under 60 seconds for up to 50 new emails
- Dashboard API must respond in under 500ms for 90th percentile queries
- All timestamps stored in UTC; all display and digest logic converts to SGT (UTC+8)
- No secrets in version control; `.env` in `.gitignore`
- Dashboard deployed as static-compatible Next.js (no edge runtime required on free tier)
