"""
Finny Gmail poll — runs every 15 minutes via Hermes cron.
Uses IMAP + App Password to fetch transaction emails from Gmail labels.
"""

import email
import imaplib
import logging
import os
import sys
from datetime import datetime, timezone, timedelta
from email import policy

from dotenv import load_dotenv

from parser import parse_transaction
from categoriser import categorise
from db import is_processed, mark_processed, insert_transaction, update_recurring_patterns, get_active_cards

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))

# Cards come from the cards table (managed via the dashboard), with a
# GMAIL_LABEL_* env fallback — see db.get_active_cards().


def get_imap_connection() -> imaplib.IMAP4_SSL:
    conn = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    conn.login(os.environ["GMAIL_ADDRESS"], os.environ["GMAIL_APP_PASSWORD"])
    return conn


def fetch_message_ids(conn: imaplib.IMAP4_SSL, label: str) -> list[str]:
    """Return message UIDs in a Gmail label, limited to last 3 months."""
    status, _ = conn.select(f'"{label}"', readonly=True)
    if status != "OK":
        status, _ = conn.select(label, readonly=True)
    if status != "OK":
        log.error("Could not select label %r", label)
        return []

    # Only fetch emails from the last 3 months
    since = (datetime.now(SGT) - timedelta(days=90)).strftime("%d-%b-%Y")
    status, data = conn.uid("search", None, f'SINCE {since}')
    if status != "OK" or not data[0]:
        return []

    return data[0].decode().split()


def fetch_message_body(conn: imaplib.IMAP4_SSL, uid: str) -> str:
    """Fetch plain-text body of a message by UID."""
    status, data = conn.uid("fetch", uid, "(RFC822)")
    if status != "OK":
        return ""

    raw = data[0][1]
    msg = email.message_from_bytes(raw, policy=policy.default)

    # Walk parts to find text/plain
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                return part.get_content()
    else:
        if msg.get_content_type() == "text/plain":
            return msg.get_content()

    # Fallback: return decoded payload
    return msg.get_payload(decode=True).decode("utf-8", errors="replace") if msg.get_payload(decode=True) else ""


def process_label(conn: imaplib.IMAP4_SSL, card_config: dict) -> tuple[int, int, int]:
    """Process all new emails for one card label. Returns (processed, skipped, failed)."""
    label    = card_config["label"]
    card     = card_config["card"]
    currency = card_config["currency"]

    processed = skipped = failed = 0

    uids = fetch_message_ids(conn, label)
    if not uids:
        log.info("[%s] No messages in label %r", card.upper(), label)
        return 0, 0, 0

    for uid in uids:
        # Use label+uid as a stable email ID (IMAP UIDs can change on reconnect,
        # but are stable within a session and unique per mailbox)
        email_id = f"{label}:{uid}"

        if is_processed(email_id):
            skipped += 1
            continue

        try:
            body = fetch_message_body(conn, uid)
        except Exception as exc:
            log.error("[%s] Failed to fetch UID %s: %s", card.upper(), uid, exc)
            continue  # do NOT mark processed — retry next poll

        try:
            parsed = parse_transaction(body, card, currency)
        except Exception as exc:
            log.error("[%s] LLM API error for UID %s: %s", card.upper(), uid, exc)
            continue  # do NOT mark processed — retry next poll

        if parsed is None:
            log.warning("[%s] PARSE_FAILED for UID %s", card.upper(), uid)
            mark_processed(email_id, parse_failed=True)
            failed += 1
            continue

        category = categorise(parsed["merchant"] or "", parsed.get("raw_desc") or "")

        txn = {
            "id":       email_id,
            "card":     card,
            "currency": parsed["currency"],
            "amount":   parsed["amount"],
            "merchant": parsed["merchant"],
            "category": category,
            "raw_desc": parsed.get("raw_desc"),
            "txn_date": parsed["txn_date"],
        }

        try:
            insert_transaction(txn)
            update_recurring_patterns(parsed["merchant"] or "", card, parsed["amount"])
            mark_processed(email_id)
            processed += 1
            log.info("[%s] Saved: %s %s%.2f (%s)", card.upper(),
                     parsed["merchant"], "S$" if currency == "SGD" else "₹",
                     parsed["amount"], category)
        except Exception as exc:
            log.error("[%s] DB write failed for UID %s: %s", card.upper(), uid, exc)
            # do NOT mark processed — retry next poll

    return processed, skipped, failed


def main() -> None:
    log.info("[POLL] Starting poll — %s", datetime.now(SGT).isoformat())

    try:
        conn = get_imap_connection()
    except Exception as exc:
        log.error("[POLL] IMAP login failed: %s", exc)
        sys.exit(1)

    total_processed = total_skipped = total_failed = 0

    try:
        for card_config in get_active_cards():
            p, s, f = process_label(conn, card_config)
            log.info("[POLL] %s — processed=%d skipped=%d failed=%d",
                     card_config["card"].upper(), p, s, f)
            total_processed += p
            total_skipped   += s
            total_failed    += f
    finally:
        conn.logout()

    log.info("[POLL] Done — total: processed=%d skipped=%d failed=%d",
             total_processed, total_skipped, total_failed)


if __name__ == "__main__":
    main()
