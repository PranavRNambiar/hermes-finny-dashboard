# Finny — Project Constitution

## What this project is
Finny is a personal finance agent. It ingests transaction emails from Gmail, parses and categorises them, stores them in a database, serves them on a Next.js dashboard hosted on Vercel, and sends a daily Telegram digest at 00:00 SGT.

## Stack
- **Agent runtime:** Node.js (ESM) + Hermes (OpenClaw)
- **Gmail access:** Gmail MCP (OAuth 2.0)
- **Database:** SQLite (dev) → Supabase Postgres (prod)
- **Dashboard:** Next.js 14 App Router + Tailwind CSS + Recharts
- **Hosting:** Vercel free tier
- **Telegram:** node-telegram-bot-api
- **Models:** Claude Haiku for parsing/classification · Claude Sonnet for daily digest

## Repo structure
```
finny/
├── CLAUDE.md           ← you are here
├── SPEC.md             ← full product spec
├── TASKS.md            ← phased task list with acceptance criteria
├── agent/              ← Hermes agent (ingestion + digest)
│   ├── src/
│   │   ├── gmail.ts        poll + fetch emails via Gmail MCP
│   │   ├── parser.ts       Haiku: extract fields from email body
│   │   ├── categoriser.ts  Haiku: assign category
│   │   ├── dedup.ts        check + write processed_emails table
│   │   ├── store.ts        write transactions to DB
│   │   ├── digest.ts       Sonnet: build daily digest message
│   │   ├── anomaly.ts      anomaly detection + recurring carve-outs
│   │   └── telegram.ts     send message via Telegram bot
│   ├── cron/
│   │   ├── poll.ts         runs every 15 min
│   │   └── daily.ts        runs at 00:00 SGT
│   └── db/
│       ├── schema.sql
│       └── migrate.ts
├── dashboard/          ← Next.js app
│   ├── app/
│   │   ├── page.tsx        transaction feed
│   │   ├── analytics/      spend charts (SGD / INR panels)
│   │   └── api/
│   │       └── transactions/route.ts
│   └── components/
└── .env.example
```

## Commands
```bash
# Agent
cd agent && npm install
npm run dev:poll       # manual ingestion run
npm run dev:digest     # manual digest trigger
npm run migrate        # run DB migrations
npm run test           # jest unit tests

# Dashboard
cd dashboard && npm install
npm run dev            # Next.js dev server
npm run build          # production build
npm run lint           # eslint + tsc check
```

## Code style
- TypeScript strict mode throughout
- ES modules (import/export), never CommonJS require
- Async/await only, no raw Promise chains
- No `any` types — define interfaces for all API responses
- Functions under 40 lines; extract helpers liberally
- Every external API call wrapped in try/catch with typed error logging

## Critical invariants — never break these
1. **SGD and INR are never summed together.** All DB queries, API responses, and UI components must keep currencies separated.
2. **Deduplication is based on Gmail message ID.** Never re-process an email that exists in `processed_emails`.
3. **Haiku for volume ops, Sonnet for digest only.** Do not call Sonnet in the ingestion path.
4. **Recurring payments (rent, gym, fixed subscriptions) are excluded from anomaly flags** once identified (2+ occurrences same merchant ±5% amount).
5. **Daily digest covers the previous full calendar day in SGT timezone.** 12:00 AM Apr 10 reports Apr 9 00:00–23:59 SGT.

## Environment variables
See `.env.example`. Never hardcode secrets. Load via `dotenv` in agent, via `process.env` (Vercel) in dashboard.

## Testing strategy
- Unit tests for: parser.ts, categoriser.ts, dedup.ts, anomaly.ts
- Use fixture email bodies in `agent/tests/fixtures/` (one per card type)
- Integration test: run full poll cycle against a test Gmail label with known emails
- Before shipping dashboard: verify SGD panel and INR panel show different totals from the same seed data

## Verification checkpoints
After each phase, run the checklist in TASKS.md before moving to the next phase.
Claude Code must not proceed past a phase gate without all checklist items passing.
