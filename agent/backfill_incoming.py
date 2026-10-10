"""One-off: record money-in alerts from the past that were skipped before incoming
money was tracked.

    python backfill_incoming.py [days=180]

Only looks at labelled emails that produced neither a transaction nor an incoming
row, re-parses them, and stores the ones that are money in. Never creates or
changes spending transactions, and sends no Telegram messages.
"""

import email
import logging
import sys
from datetime import datetime, timedelta

from imapclient import IMAPClient

from db import get_active_cards, get_client
from gmail_watch import fetch_body_and_msgid
from incoming import save_incoming
from parser import parse_transaction, SkipEmail, SGT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backfill")


def known_ids(table: str) -> set[str]:
    db, out = get_client(), set()
    for off in range(0, 100_000, 1000):
        rows = db.table(table).select("id").range(off, off + 999).execute().data
        out |= {r["id"] for r in rows}
        if len(rows) < 1000:
            return out
    return out


def main(days: int) -> None:
    import os
    seen = known_ids("transactions") | known_ids("incoming")
    since = (datetime.now(SGT) - timedelta(days=days)).strftime("%d-%b-%Y")
    found = failed = 0
    with IMAPClient("imap.gmail.com", ssl=True) as server:
        server.login(os.environ["GMAIL_ADDRESS"], os.environ["GMAIL_APP_PASSWORD"])
        server.select_folder("[Gmail]/All Mail", readonly=True)
        for c in get_active_cards():
            uids = server.search(["SINCE", since, "X-GM-LABELS", c["label"]])
            for uid in uids:
                hdr = server.fetch([uid], ["BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]"])[uid][b"BODY[HEADER.FIELDS (MESSAGE-ID)]"]
                mid = (email.message_from_bytes(hdr).get("Message-ID") or "").strip()
                email_id = f"msgid:{mid}" if mid else f"{c['label']}:{uid}"
                if email_id in seen:
                    continue
                try:
                    body, _, subject, sender, sent = fetch_body_and_msgid(server, uid)
                    parsed = parse_transaction(body, c["card"], c["currency"], subject=subject, sender=sender, sent=sent)
                    if parsed and parsed.get("direction") == "in":
                        save_incoming(email_id, c["card"], parsed, notify=False)
                        found += 1
                except SkipEmail:
                    continue
                except Exception as exc:  # one bad email (fetch/LLM/DB hiccup) shouldn't stop the run
                    failed += 1
                    log.warning("[%s] Skipped UID %s: %s", c["card"].upper(), uid, exc)
    log.info("Backfill done: %d incoming rows recorded, %d emails failed, over the last %d days", found, failed, days)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 180)
