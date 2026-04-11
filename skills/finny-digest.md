---
name: finny-digest
description: Run Finny's daily Telegram digest — summarises yesterday's spending using Claude Sonnet and sends to Telegram. Runs at 00:00 SGT (16:00 UTC).
schedule: "0 16 * * *"
---

Run the Finny daily digest script:

```bash
cd /path/to/finny/agent && python daily_digest.py
```

This script:
1. Computes report_date = yesterday in SGT (Asia/Singapore)
2. Fetches SGD and INR totals (today + MTD + 30-day avg) — always separate, never combined
3. Runs anomaly detection (daily spikes, transaction spikes, new merchants)
4. Calls Claude Sonnet to write a Telegram MarkdownV2 message
5. Sends to TELEGRAM_CHAT_ID with one retry on failure

To test for a specific date, set DIGEST_DATE=YYYY-MM-DD in env before running.
