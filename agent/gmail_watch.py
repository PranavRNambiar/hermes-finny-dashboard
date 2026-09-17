"""
Finny Gmail watcher — IMAP IDLE daemon for instant transaction processing.
Replaces the 15-min cron poll. One persistent connection per label; Gmail
notifies us within seconds of a new email arriving.
"""

import email
import logging
import os
import threading
import time
from datetime import datetime, timezone, timedelta
from email import policy

from dotenv import load_dotenv
from imapclient import IMAPClient

from parser import parse_transaction, SkipEmail, is_paylah_sender
from merchant_intel import guess_merchant
from categoriser import categorise
from db import (
    is_processed, processed_to_skip, mark_processed, insert_transaction, update_recurring_patterns,
    get_merchant_tag, save_merchant_tag, set_pending_tag,
    get_transactions_for_date, get_30d_avg, get_budget, get_exempt_merchants,
    save_transaction_message, get_active_cards, claim_next_scan_request,
    complete_scan_request,
)
from notify import send as telegram_send

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))
IDLE_TIMEOUT   = 25 * 60
RECONNECT_WAIT = 30

# Tracks dates already nudged per currency to avoid repeat nudges
_nudged_spike: dict[str, str] = {}   # currency → date
_nudged_budget: dict[str, str] = {}  # "currency:period" → date


def _check_and_nudge(card: str, currency: str, merchant: str, amount: float) -> None:
    """After a transaction saves, send a proactive nudge if spend is spiking or budget threshold crossed.
    Exempt (recurring) merchants are silently skipped."""
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not chat_id:
        return

    today = datetime.now(SGT).strftime("%Y-%m-%d")
    sym = "S$" if currency == "SGD" else "₹"

    try:
        exempt = get_exempt_merchants()
        if (merchant, card) in exempt:
            return  # recurring payment — never nudge

        today_txns  = get_transactions_for_date(today)
        # Exclude exempt merchants from today's total so rent etc. don't inflate the comparison
        today_total = sum(
            t["amount"] for t in today_txns
            if t["currency"] == currency
            and (t.get("merchant") or "", t.get("card") or "") not in exempt
        )
        daily_avg   = get_30d_avg(currency, today)  # already excludes exempt

        # Spend spike: today > 1.5× 30-day avg and not nudged today
        spike_key = currency
        if daily_avg > 0 and today_total >= daily_avg * 1.5 and _nudged_spike.get(spike_key) != today:
            _nudged_spike[spike_key] = today
            multiplier = today_total / daily_avg
            send(
                chat_id,
                f"⚡ Spending spike · {currency}\n"
                f"{sym}{today_total:.2f} today — {multiplier:.1f}× your usual {sym}{daily_avg:.0f}\n"
                f"Latest: {merchant} {sym}{amount:.2f}",
            )

        # Budget threshold: crossed 80% of day budget
        day_budget = get_budget("day", today, currency)
        budget_key = f"{currency}:{today}"
        if day_budget and today_total >= day_budget * 0.8 and _nudged_budget.get(budget_key) != today:
            _nudged_budget[budget_key] = today
            pct = int(today_total / day_budget * 100)
            remaining = max(0, day_budget - today_total)
            send(
                chat_id,
                f"🟡 Budget alert · {currency}\n"
                f"{sym}{today_total:.2f} of {sym}{day_budget:.2f} used ({pct}%) · {sym}{remaining:.2f} left",
            )
    except Exception as exc:
        log.warning("Nudge check failed: %s", exc)

# Cards come from the cards table (managed via the dashboard), with a
# GMAIL_LABEL_* env fallback — see db.get_active_cards().
CARD_REFRESH_INTERVAL = 300  # seconds between checks for newly added cards
SCAN_POLL_INTERVAL    = 15   # seconds between checks for dashboard scan requests


def fetch_body_and_msgid(server: IMAPClient, uid: int) -> tuple[str, str, str, str]:
    """Returns (body_text, message_id, subject, sender).
    Falls back to HTML content (stripped of tags) when no text/plain part exists."""
    import html as _html
    import re as _re
    data = server.fetch([uid], ["RFC822"])
    if not data or uid not in data:
        return "", "", "", ""
    raw = data[uid][b"RFC822"]
    msg = email.message_from_bytes(raw, policy=policy.default)
    message_id = (msg.get("Message-ID") or "").strip()
    subject = (msg.get("Subject") or "").strip()
    sender = (msg.get("From") or "").strip()
    body = ""
    html_body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain" and not body:
                body = part.get_content()
            elif ct == "text/html" and not html_body:
                html_body = part.get_content()
    else:
        ct = msg.get_content_type()
        if ct == "text/plain":
            body = msg.get_content()
        elif ct == "text/html":
            html_body = msg.get_content()
    # Discard text/plain if it's essentially whitespace (some senders put garbage there)
    if body and len(body.strip()) < 50:
        body = ""
    # Fall back to HTML: strip style/script blocks, decode entities, strip tags
    if not body and html_body:
        html_body = _re.sub(r"<(style|script)[^>]*>.*?</(style|script)>", " ", html_body, flags=_re.DOTALL | _re.IGNORECASE)
        body = _re.sub(r"<[^>]+>", " ", html_body)
        body = _html.unescape(body)
        body = _re.sub(r"\s+", " ", body).strip()
    if not body:
        payload = msg.get_payload(decode=True)
        body = payload.decode("utf-8", errors="replace") if payload else ""
    return body, message_id, subject, sender


def process_new_uids(server: IMAPClient, label: str, card: str, currency: str) -> int:
    """Search last 3 months of emails in All Mail filtered by label. Uses Message-ID as
    the dedup key so label-folder UIDs and All Mail UIDs never collide."""
    since = (datetime.now(SGT) - timedelta(days=90)).strftime("%d-%b-%Y")
    server.select_folder("[Gmail]/All Mail")
    uids = server.search(["SINCE", since, "X-GM-LABELS", label])
    if not uids:
        return 0

    # Batch-fetch every Message-ID in ONE IMAP round-trip (dedup key), then do ONE
    # batched DB dedup check — instead of an IMAP fetch + a DB call per email, which
    # pegged the box when re-scanning the 90-day backlog every cycle.
    import email as _email
    try:
        hdr_all = server.fetch(uids, ["BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]"])
    except Exception as exc:
        log.error("[%s] Header batch-fetch failed: %s", card.upper(), exc)
        hdr_all = {}

    email_id_by_uid: dict = {}
    for uid in uids:
        message_id = ""
        try:
            raw_hdr = hdr_all[uid][b"BODY[HEADER.FIELDS (MESSAGE-ID)]"]
            message_id = (_email.message_from_bytes(raw_hdr).get("Message-ID") or "").strip()
        except Exception:
            message_id = ""
        # Fall back to label:uid if no Message-ID (shouldn't happen for real emails)
        email_id_by_uid[uid] = f"msgid:{message_id}" if message_id else f"{label}:{uid}"

    skip = processed_to_skip(list(email_id_by_uid.values()))

    saved = 0
    for uid, email_id in email_id_by_uid.items():
        if email_id in skip:
            continue

        try:
            body, _, subject, sender = fetch_body_and_msgid(server, uid)
        except Exception as exc:
            log.error("[%s] Fetch failed UID %s: %s", card.upper(), uid, exc)
            continue  # don't mark processed — retry on next wake

        try:
            parsed = parse_transaction(body, card, currency, subject=subject, sender=sender)
        except SkipEmail:
            log.info("[%s] Skipped non-transaction UID %s", card.upper(), uid)
            mark_processed(email_id, parse_failed=False)
            continue
        except Exception as exc:
            log.error("[%s] LLM error UID %s: %s", card.upper(), uid, exc)
            continue  # don't mark processed — retry on next wake

        if parsed is None:
            log.warning("[%s] PARSE_FAILED UID %s", card.upper(), uid)
            mark_processed(email_id, parse_failed=True)
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
            "txn_time": parsed.get("txn_time"),
        }

        try:
            merchant = parsed["merchant"] or ""
            known_tag = get_merchant_tag(merchant) if merchant else None
            if not known_tag and is_paylah_sender(sender):
                # DBS PayLah! alerts are always PayNow sends — auto-tag deterministically,
                # no need to ask (still filed under the "dbs" card/label).
                known_tag = "PayNow"
            if known_tag:
                txn["user_tag"] = known_tag

            insert_transaction(txn)
            update_recurring_patterns(merchant, card, parsed["amount"])
            mark_processed(email_id)
            saved += 1
            sym = "S$" if currency == "SGD" else "₹"
            log.info("[%s] Saved: %s %s%.2f (%s)", card.upper(),
                     merchant, sym, parsed["amount"], category)

            _check_and_nudge(card, currency, merchant, parsed["amount"])

            # Notify Telegram for every transaction — the message becomes repliable
            # (e.g. for bill-splitting and merchant tagging)
            chat_id = os.environ.get("TELEGRAM_CHAT_ID")
            if chat_id:
                card_label = card.upper()
                amount_str = f"{sym}{parsed['amount']:.2f}"
                notify_msg = f"💳 {card_label} · {merchant or 'Unknown'} · {amount_str} · {category}"

                # Ask user to tag unknown merchants — LLM pre-guesses what the merchant is
                if merchant and not known_tag:
                    set_pending_tag(merchant, card)
                    intel = guess_merchant(merchant)
                    if intel["confidence"] == "high" and intel["suggested_tag"]:
                        notify_msg += (
                            f"\nLooks like {intel['description']} — tag as {intel['suggested_tag']}?\n"
                            f"Reply the tag to confirm, a different word to correct, recurring to exclude, or skip."
                        )
                    else:
                        notify_msg += (
                            "\nWhat was this for? Reply with a tag (e.g. coffee, groceries, transport), "
                            "recurring to exclude, or skip."
                        )

                message_id = telegram_send(chat_id, notify_msg)
                if message_id:
                    save_transaction_message(txn["id"], message_id)
        except Exception as exc:
            log.error("[%s] DB write failed UID %s: %s", card.upper(), uid, exc)

    return saved


def watch_label(card_config: dict) -> None:
    """Persistent IDLE loop for one card label. Auto-reconnects on any error."""
    label    = card_config["label"]
    card     = card_config["card"]
    currency = card_config["currency"]

    log.info("[%s] Starting watcher for label %r", card.upper(), label)

    while True:
        try:
            server = IMAPClient("imap.gmail.com", use_uid=True, ssl=True)
            server.login(os.environ["GMAIL_ADDRESS"], os.environ["GMAIL_APP_PASSWORD"])
            server.select_folder("[Gmail]/All Mail")
            log.info("[%s] Connected — processing backlog", card.upper())

            # Catch up on anything missed while offline
            process_new_uids(server, label, card, currency)
            log.info("[%s] Backlog done — entering IDLE", card.upper())

            while True:
                server.select_folder("[Gmail]/All Mail")
                server.idle()
                responses = server.idle_check(timeout=IDLE_TIMEOUT)
                server.idle_done()

                if responses:
                    log.info("[%s] New email signal — processing", card.upper())
                # Always scan — catches new emails AND retries any previous parse failures
                process_new_uids(server, label, card, currency)

        except Exception as exc:
            log.error("[%s] Error: %s — reconnecting in %ds", card.upper(), exc, RECONNECT_WAIT)
            try:
                server.logout()
            except Exception:
                pass
            time.sleep(RECONNECT_WAIT)


def process_scan_requests() -> None:
    """Serve one pending dashboard scan request by running scan_once.py."""
    import json
    import subprocess
    import sys

    req = claim_next_scan_request()
    if not req:
        return

    agent_dir = os.path.dirname(os.path.abspath(__file__))
    cmd = [sys.executable, os.path.join(agent_dir, "scan_once.py")]
    if req.get("card"):
        cmd += ["--card", req["card"]]
    if req.get("days"):
        cmd += ["--days", str(req["days"])]

    log.info("[SCAN] Running request #%s (card=%s, days=%s)",
             req["id"], req.get("card") or "all", req.get("days"))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=agent_dir)
        result = json.loads(proc.stdout.strip().splitlines()[-1])
        complete_scan_request(req["id"], result)
        log.info("[SCAN] Request #%s done: %s", req["id"], result)
    except Exception as exc:
        log.error("[SCAN] Request #%s failed: %s", req["id"], exc)
        complete_scan_request(req["id"], {}, error=str(exc))


def main() -> None:
    watchers: dict[str, threading.Thread] = {}

    def sync_watchers() -> None:
        """Start a watcher thread for any active card that doesn't have one yet."""
        for c in get_active_cards():
            if c["card"] not in watchers:
                t = threading.Thread(target=watch_label, args=(c,), daemon=True, name=c["card"])
                t.start()
                watchers[c["card"]] = t
                log.info("Watching %s (label %r)", c["card"].upper(), c["label"])

    sync_watchers()
    if not watchers:
        log.error("No cards configured (cards table empty and no label env vars set). Exiting.")
        return

    log.info("Finny Gmail watcher — watching %d label(s): %s",
             len(watchers), ", ".join(watchers))

    # Main loop: serve dashboard scan requests and pick up newly added cards
    last_card_refresh = time.time()
    last_scan_error = None
    while True:
        try:
            process_scan_requests()
            last_scan_error = None
        except Exception as exc:
            # Log each distinct error once (e.g. scan_requests table not created yet)
            if str(exc) != last_scan_error:
                last_scan_error = str(exc)
                log.error("[SCAN] Worker error: %s", exc)
        if time.time() - last_card_refresh >= CARD_REFRESH_INTERVAL:
            last_card_refresh = time.time()
            try:
                sync_watchers()
            except Exception as exc:
                log.error("Card refresh failed: %s", exc)
        time.sleep(SCAN_POLL_INTERVAL)


if __name__ == "__main__":
    main()
