"""
One-shot IMAP scan for all active card labels. Runs, prints results to stdout, exits.
Called by the Telegram /scan command and the dashboard scan CTA (via gmail_watch's
scan-request worker). Optional args: --card <name> to scan one card, --days <n> window.
"""

import argparse
import email as _email
import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from imapclient import IMAPClient

load_dotenv()
logging.basicConfig(level=logging.WARNING)

from gmail_watch import fetch_body_and_msgid
from db import is_processed, mark_processed, insert_transaction, update_recurring_patterns, get_merchant_tag, set_pending_tag, get_active_cards
from parser import parse_transaction, SkipEmail, is_paylah_sender
from incoming import save_incoming
from categoriser import categorise

SGT = timezone(timedelta(hours=8))
SCAN_DAYS    = 7
LLM_WORKERS  = 5   # parallel LLM calls per card
IMAP_TIMEOUT = 60  # socket timeout (s) — without this a flaky link hangs the scan forever
FETCH_RETRIES = 3  # retry a transient email fetch before dropping the transaction


def _fetch_with_retry(fn, *, attempts=FETCH_RETRIES):
    """Run an IMAP fetch, retrying transient failures. Returns None if all attempts fail."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def process_recent(server: IMAPClient, label: str, card: str, currency: str, days: int = SCAN_DAYS) -> dict:
    """Scan one card's recent emails. Returns a breakdown of what happened so
    dropped transactions are visible instead of silently lost."""
    since = (datetime.now(SGT) - timedelta(days=days)).strftime("%d-%b-%Y")
    server.select_folder("[Gmail]/All Mail")
    uids = server.search(["SINCE", since, "X-GM-LABELS", label])

    # Phase 1: fetch all email data sequentially (IMAPClient is not thread-safe)
    to_process = []
    fetch_failed = 0  # transient fetch errors — NOT marked processed, so a later scan retries them
    for uid in uids:
        hdr_data = _fetch_with_retry(
            lambda: server.fetch([uid], ["BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]"]))
        message_id = ""
        if hdr_data is not None:
            try:
                raw_hdr = hdr_data[uid][b"BODY[HEADER.FIELDS (MESSAGE-ID)]"]
                message_id = (_email.message_from_bytes(raw_hdr).get("Message-ID") or "").strip()
            except Exception:
                message_id = ""

        email_id = f"msgid:{message_id}" if message_id else f"{label}:{uid}"
        if is_processed(email_id):
            continue

        fetched = _fetch_with_retry(lambda: fetch_body_and_msgid(server, uid))
        if fetched is None:
            fetch_failed += 1  # give up on this email for now; next scan/watcher retries it
            continue
        body, _, subject, sender, sent = fetched

        to_process.append((email_id, body, subject, sender, sent))

    if not to_process:
        return {"saved": 0, "fetch_failed": fetch_failed, "parse_failed": 0}

    # Phase 2: parse + categorise in parallel (LLM calls are independent)
    def llm_process(item):
        email_id, body, subject, sender, sent = item
        try:
            parsed = parse_transaction(body, card, currency, subject=subject, sender=sender, sent=sent)
        except SkipEmail:
            return (email_id, None, None, "skip", sender)
        except Exception:
            return (email_id, None, None, "error", sender)
        if parsed is None:
            return (email_id, None, None, "parse_failed", sender)
        if parsed.get("direction") == "in":
            return (email_id, parsed, None, "incoming", sender)
        category = categorise(parsed["merchant"] or "", parsed.get("raw_desc") or "")
        return (email_id, parsed, category, "ok", sender)

    with ThreadPoolExecutor(max_workers=LLM_WORKERS) as executor:
        results = list(executor.map(llm_process, to_process))

    # Phase 3: write to DB sequentially
    saved = 0
    parse_failed = 0
    for email_id, parsed, category, status, sender in results:
        if status == "error":
            continue
        if status == "skip":
            mark_processed(email_id, parse_failed=False)
            continue
        if status == "parse_failed":
            parse_failed += 1  # LLM couldn't extract fields — flagged for review
            mark_processed(email_id, parse_failed=True)
            continue
        if status == "incoming":
            try:
                save_incoming(email_id, card, parsed, notify=False)  # scans can be bulk; no per-item pings
                saved += 1
            except Exception:
                pass
            continue
        txn = {
            "id": email_id, "card": card, "currency": parsed["currency"],
            "amount": parsed["amount"], "merchant": parsed["merchant"],
            "category": category, "raw_desc": parsed.get("raw_desc"),
            "txn_date": parsed["txn_date"], "txn_time": parsed.get("txn_time"),
        }
        try:
            merchant = parsed["merchant"] or ""
            known_tag = get_merchant_tag(merchant) if merchant else None
            if not known_tag and is_paylah_sender(sender):
                known_tag = "PayNow"
            if known_tag:
                txn["user_tag"] = known_tag
            insert_transaction(txn)
            update_recurring_patterns(merchant, card, parsed["amount"])
            mark_processed(email_id)
            saved += 1
        except Exception:
            pass

    return {"saved": saved, "fetch_failed": fetch_failed, "parse_failed": parse_failed}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--card", help="scan only this card")
    ap.add_argument("--days", type=int, default=SCAN_DAYS, help="how many days back to scan")
    args = ap.parse_args()

    active = get_active_cards()
    if args.card:
        active = [c for c in active if c["card"] == args.card]
    if not active:
        print(json.dumps({"error": f"No card labels configured{' for ' + args.card if args.card else ''}"}))
        return

    server = IMAPClient("imap.gmail.com", use_uid=True, ssl=True, timeout=IMAP_TIMEOUT)
    server.login(os.environ["GMAIL_ADDRESS"], os.environ["GMAIL_APP_PASSWORD"])

    total = 0
    skipped = 0  # transactions not saved this run (transient fetch failures + parse failures)
    results = []
    for c in active:
        try:
            r = process_recent(server, c["label"], c["card"], c["currency"], days=args.days)
            total += r["saved"]
            skipped += r["fetch_failed"] + r["parse_failed"]
            results.append({"card": c["card"], **r})
        except Exception as exc:
            results.append({"card": c["card"], "error": str(exc)})

    try:
        server.logout()
    except Exception:
        pass

    print(json.dumps({"total": total, "skipped": skipped, "cards": results}))


if __name__ == "__main__":
    main()
