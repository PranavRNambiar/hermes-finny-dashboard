---
name: finny-poll
description: Run Finny's Gmail transaction poll — fetches new emails from DBS, Scapia, and Axis Atlas labels, parses them with Haiku, and stores to Supabase. Runs every 15 minutes.
schedule: "*/15 * * * *"
---

Run the Finny Gmail poll script:

```bash
cd /path/to/finny/agent && python gmail_poll.py
```

This script:
1. Lists all message IDs in each Gmail label (DBS, Scapia, Axis Atlas)
2. Skips already-processed emails (dedup via processed_emails table)
3. For each new email: fetches body → parses with Haiku → categorises with Haiku → writes to Supabase
4. Updates recurring_patterns table for exempt merchant detection
5. Logs summary: processed / skipped / failed counts

If parse fails (amount or date not extractable), marks email with parse_failed=TRUE and skips — no retry.
If Haiku API or DB fails, does NOT mark processed — email is retried next poll.
