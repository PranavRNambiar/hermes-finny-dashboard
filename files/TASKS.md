# Finny — Task Plan for Claude Code

_Execute phases in order. Do not start a phase until all checklist items from the previous phase pass._
_After completing each task group, run the phase gate checklist before continuing._

---

## Phase 0 — Scaffolding

**Goal:** Working repo skeleton, deps installed, env wired up, DB migrated.

### Tasks

- [ ] **0.1** Create repo structure exactly as defined in CLAUDE.md
- [ ] **0.2** Initialise `agent/` as a Node.js TypeScript project
  - `tsconfig.json`: strict, ESNext, module resolution bundler
  - `package.json`: type = "module", scripts: dev:poll, dev:digest, migrate, test
  - Dependencies: `@anthropic-ai/sdk`, `node-telegram-bot-api`, `better-sqlite3`, `dotenv`, `node-cron`
  - Dev deps: `typescript`, `@types/node`, `jest`, `ts-jest`
- [ ] **0.3** Initialise `dashboard/` as a Next.js 14 App Router project
  - `create-next-app` with TypeScript + Tailwind
  - Add `recharts`, `@tanstack/react-query`
- [ ] **0.4** Create `.env.example` with all variables from SPEC.md §8. Create `.env` (gitignored).
- [ ] **0.5** Write `agent/db/schema.sql` exactly as in SPEC.md §3
- [ ] **0.6** Write `agent/db/migrate.ts` — reads schema.sql and executes against DATABASE_URL
- [ ] **0.7** Run migration: `npm run migrate` — verify all tables and indexes created
- [ ] **0.8** Create `agent/tests/fixtures/` with three mock email bodies (one per card):
  - `dbs_debit.txt` — a realistic DBS debit transaction notification
  - `scapia_forex.txt` — a realistic Scapia transaction notification
  - `axis_atlas.txt` — a realistic Axis Atlas transaction notification

### Phase 0 gate ✓
- [ ] `cd agent && npm run migrate` exits 0, no errors
- [ ] `cd dashboard && npm run build` exits 0, no errors
- [ ] `.env.example` contains all 10 variables from SPEC.md §8
- [ ] All three fixture files exist and contain realistic email content

---

## Phase 1 — Ingestion pipeline

**Goal:** Full end-to-end transaction ingestion from Gmail to DB, with dedup.

### Tasks

- [ ] **1.1** `agent/src/gmail.ts` — Gmail MCP client
  - `listMessageIds(labelId: string): Promise<string[]>` — fetch all message IDs for label
  - `getMessageBody(messageId: string): Promise<string>` — fetch full email body text
  - Uses `GMAIL_MCP_URL` and `GMAIL_MCP_TOKEN` from env
  - Handles pagination if label has >100 messages

- [ ] **1.2** `agent/src/dedup.ts` — deduplication
  - `isProcessed(emailId: string): boolean`
  - `markProcessed(emailId: string, parseFailed?: boolean): void`
  - Uses `processed_emails` table

- [ ] **1.3** `agent/src/parser.ts` — Haiku email parser
  - `parseTransaction(emailBody: string, card: string, currency: 'SGD'|'INR'): Promise<ParsedTransaction | null>`
  - Uses Haiku system prompt from SPEC.md §4.2
  - Returns `null` if amount or txn_date is null in response
  - Logs `PARSE_FAILED` with emailId and raw body snippet on null return

- [ ] **1.4** `agent/src/categoriser.ts` — Haiku categoriser
  - `categorise(merchant: string, rawDesc: string): Promise<string>`
  - Uses Haiku system prompt from SPEC.md §4.3
  - Falls back to `'Transfers & Misc'` on API error

- [ ] **1.5** `agent/src/store.ts` — DB writes
  - `insertTransaction(txn: Transaction): void`
  - `updateRecurringPatterns(txn: Transaction): void` — implements SPEC.md §5 logic

- [ ] **1.6** `agent/cron/poll.ts` — main poll orchestrator
  - Iterates all three labels
  - Implements pipeline from SPEC.md §4.1
  - Logs summary: `[POLL] Processed N new, M skipped (dedup), K failed (parse)`

- [ ] **1.7** Write unit tests:
  - `parser.test.ts` — feed each fixture file, assert amount/currency/merchant/date extracted correctly
  - `dedup.test.ts` — process same emailId twice, assert only written once
  - `categoriser.test.ts` — assert "Netflix" → "Subscriptions", "Grab" → "Transport", "NTUC" → "Food & Drink"

- [ ] **1.8** Manual integration test:
  - Run `npm run dev:poll` against real Gmail (or test label)
  - Verify transactions appear in DB with correct card, currency, amount, category
  - Run again — verify zero new rows added (dedup working)

### Phase 1 gate ✓
- [ ] `npm run test` passes all parser, dedup, categoriser tests
- [ ] Manual poll run against fixture-equivalent Gmail label writes correct rows
- [ ] Second poll run on same label writes 0 new rows
- [ ] DBS transactions have `currency = 'SGD'`, Scapia/Axis have `currency = 'INR'`
- [ ] No row in `transactions` has `currency = NULL` or `amount <= 0`

---

## Phase 2 — Dashboard

**Goal:** Live Vercel-hosted dashboard with feed and analytics. SGD and INR always separate.

### Tasks

- [ ] **2.1** `dashboard/app/api/transactions/route.ts`
  - GET handler with query params: `card`, `currency`, `from`, `to`, `category`, `page` (default 1), `limit` (default 50)
  - Returns: `{ transactions: Transaction[], total: number, page: number }`
  - Reads from DB (direct SQLite in dev, Supabase client in prod via DATABASE_URL)
  - Validates that currency filter is never mixed (if currency=SGD, only SGD rows returned)

- [ ] **2.2** `dashboard/app/page.tsx` — transaction feed
  - Table: date · merchant · amount (with S$ or ₹ prefix, never mix) · card badge · category tag
  - Card badges: DBS = blue, Scapia = teal, Axis = purple
  - Category tags: colour map from SPEC.md §7.4
  - Filter bar: card select, category select, date range picker
  - Infinite scroll or pagination (next 50)
  - ⚠️ icon on transactions where anomaly_flagged = TRUE (add column in Phase 2.3)

- [ ] **2.3** Add `anomaly_flagged BOOLEAN DEFAULT FALSE` column to transactions table
  - Migration: `ALTER TABLE transactions ADD COLUMN anomaly_flagged BOOLEAN DEFAULT FALSE`
  - Backfill: run anomaly check on all existing transactions

- [ ] **2.4** `dashboard/app/analytics/page.tsx` — analytics
  - **SGD Panel** (top half):
    - Header: "SGD Spend — DBS Debit"
    - Recharts BarChart: daily spend last 30 days, x-axis = date, y-axis = S$
    - MTD total prominently displayed
    - Category PieChart (SGD transactions this month)
  - **INR Panel** (bottom half):
    - Header: "INR Spend — Scapia + Axis Atlas"
    - Same layout, y-axis = ₹
    - MTD total
    - Breakdown line: "Scapia: ₹X · Axis: ₹Y"
    - Category PieChart (INR transactions this month)
  - **Rule enforced:** the two panels are completely independent React components receiving separate data fetches. They must never share a combined dataset.

- [ ] **2.5** Deploy to Vercel
  - Connect GitHub repo to Vercel project
  - Set all env vars in Vercel dashboard (DATABASE_URL pointing to Supabase)
  - Verify live URL works and transactions load

### Phase 2 gate ✓
- [ ] Dashboard loads at Vercel URL
- [ ] Transaction feed shows correct S$ / ₹ prefixes per row — never mixed
- [ ] SGD analytics panel total ≠ INR analytics panel total (correct isolation)
- [ ] Filtering by `card=dbs` shows only SGD rows; filtering by `card=scapia` shows only INR rows
- [ ] `npm run build` in dashboard exits 0, no type errors

---

## Phase 3 — Daily Telegram digest

**Goal:** Finny sends a smart daily message at 00:00 SGT. On-demand commands work.

### Tasks

- [ ] **3.1** `agent/src/anomaly.ts` — anomaly detection
  - `getAnomalies(reportDate: string): AnomalyResult[]`
  - Implements SPEC.md §9 rules
  - Reads recurring_patterns to exclude exempt merchants
  - Returns list of flagged transactions with reason string
  - Also updates `anomaly_flagged` column in transactions table

- [ ] **3.2** `agent/src/digest.ts` — digest builder
  - `buildDigest(reportDate: string): Promise<string>` 
  - Fetches all data defined in SPEC.md §6.1
  - Calls Sonnet with prompt from SPEC.md §6.2
  - Returns formatted Telegram MarkdownV2 string
  - Validates output is under 4096 characters (Telegram limit); truncates transaction list if needed

- [ ] **3.3** `agent/src/telegram.ts` — Telegram bot wrapper
  - `sendMessage(text: string): Promise<void>` — sends to TELEGRAM_CHAT_ID
  - `startListening(): void` — registers /today, /mtd, /last handlers
  - Retry logic: 1 retry on send failure, log on second failure

- [ ] **3.4** `agent/cron/daily.ts` — digest cron
  - Runs at `0 0 * * *` in SGT timezone (`TZ=Asia/Singapore` in env)
  - Calls `buildDigest(yesterday)` then `sendMessage(digest)`

- [ ] **3.5** Manual test:
  - Run `npm run dev:digest` with `--date=2025-04-09` flag (or env override)
  - Verify Telegram message received with correct date, sums, transaction list
  - Verify anomaly section is blank for a normal spending day
  - Insert a synthetic high-spend transaction and re-run — verify it appears in anomalies

- [ ] **3.6** Test on-demand commands:
  - Send `/today` to bot — verify partial-day summary received
  - Send `/mtd` to bot — verify month-to-date with category breakdown
  - Send `/last 5` to bot — verify last 5 transactions listed

### Phase 3 gate ✓
- [ ] `npm run dev:digest` sends correctly formatted Telegram message
- [ ] SGD and INR sections are separate in the message with correct currency symbols
- [ ] Anomaly section correctly flags synthetic high-spend transaction
- [ ] Anomaly section does NOT flag a merchant marked `is_exempt = TRUE`
- [ ] All three Telegram commands respond correctly
- [ ] Digest is under 4096 characters

---

## Phase 4 — Hardening

**Goal:** Production-ready. Error handling, logging, safe deploys.

### Tasks

- [ ] **4.1** Structured logging throughout agent
  - Use a lightweight logger (e.g. `pino`) with levels: debug, info, warn, error
  - Every poll cycle logs: start time, label scanned, N processed, N skipped, N failed
  - Every digest logs: date covered, Sonnet token usage, send status

- [ ] **4.2** Parse failure review
  - Add `/api/parse-failures` endpoint on dashboard listing emails with `parse_failed=TRUE`
  - Shows: date, raw_desc snippet, card — so failures can be manually reviewed

- [ ] **4.3** Graceful shutdown
  - Agent handles SIGTERM: finish current poll cycle, then exit cleanly

- [ ] **4.4** Health check
  - Add `/api/health` endpoint on dashboard: returns `{ status: 'ok', lastPoll: timestamp, txnCount: N }`

- [ ] **4.5** Final end-to-end test
  - Seed DB with 30 days of synthetic transactions (SGD and INR)
  - Run full digest — verify all sections correct
  - Run poll on empty label — verify 0 rows added, no errors logged
  - Kill agent mid-poll with SIGTERM — verify no duplicate rows in DB

### Phase 4 gate ✓
- [ ] No unhandled promise rejections in any module
- [ ] Parse failures visible in dashboard UI
- [ ] Health check endpoint returns 200 with correct data
- [ ] SIGTERM test passes with no DB corruption

---

## Notes for Claude Code

- **Context hygiene:** clear context (`/clear`) between phases. Each phase has its own focus.
- **Commits:** commit after each numbered task group (e.g. after 1.1–1.3, after 1.4–1.6, etc.)
- **Test before proceeding:** never skip the phase gate checklist
- **Currency isolation is the hardest invariant to maintain.** After any DB query is written, add a comment asserting which currency(ies) it returns.
- **Timezone is critical.** Every `new Date()` must be in SGT. Use `Intl.DateTimeFormat` or `date-fns-tz` with `Asia/Singapore`. Never use `Date.toLocaleDateString()` without a timezone argument.
