"""
Finny Telegram bot — listens for on-demand commands.
Run this as a persistent process alongside the cron jobs.

Commands:
  /today   — today's spend so far (partial day)
  /mtd     — month-to-date totals with category breakdown
  /last N  — last N transactions (default 10)
"""

import logging
import os
import sys
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

from db import (
    get_transactions_for_date,
    get_mtd_total,
    get_mtd_by_card,
    get_last_n_transactions,
    get_client,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))


def send(chat_id: str | int, text: str) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)


def handle_today(chat_id: str | int) -> None:
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    txns = get_transactions_for_date(today)

    sgd_total = sum(t["amount"] for t in txns if t["currency"] == "SGD")
    inr_total = sum(t["amount"] for t in txns if t["currency"] == "INR")

    lines = [f"📊 Today so far ({today})", ""]
    lines.append(f"SGD (DBS): S${sgd_total:.2f}")
    lines.append(f"INR (Scapia + Axis): ₹{inr_total:.2f}")

    if txns:
        lines.append("")
        lines.append("Transactions:")
        for t in sorted(txns, key=lambda x: x["amount"], reverse=True)[:8]:
            sym = "S$" if t["currency"] == "SGD" else "₹"
            lines.append(f"  {t['merchant'] or 'Unknown'} — {sym}{t['amount']:.2f} ({t['category']})")
    else:
        lines.append("\nNo transactions yet today.")

    send(chat_id, "\n".join(lines))


def handle_mtd(chat_id: str | int) -> None:
    today_sgt = datetime.now(SGT)
    month_label = today_sgt.strftime("%B %Y")

    sgd_mtd = get_mtd_total("SGD")
    inr_mtd = get_mtd_total("INR")
    inr_by_card = get_mtd_by_card("INR")

    # Category breakdown
    db = get_client()
    first_of_month = today_sgt.date().replace(day=1).isoformat()
    today_str = today_sgt.date().isoformat()

    sgd_cats = (
        db.table("transactions")
        .select("category, amount")
        .eq("currency", "SGD")
        .gte("txn_date", first_of_month)
        .lte("txn_date", today_str)
        .execute()
        .data
    )
    inr_cats = (
        db.table("transactions")
        .select("category, amount")
        .eq("currency", "INR")
        .gte("txn_date", first_of_month)
        .lte("txn_date", today_str)
        .execute()
        .data
    )

    def cat_breakdown(rows: list[dict]) -> str:
        totals: dict[str, float] = {}
        for r in rows:
            totals[r["category"]] = totals.get(r["category"], 0.0) + r["amount"]
        return "\n".join(
            f"  {cat}: {v:.2f}"
            for cat, v in sorted(totals.items(), key=lambda x: x[1], reverse=True)
        )

    lines = [f"📅 Month-to-date — {month_label}", ""]
    lines.append(f"SGD (DBS): S${sgd_mtd:.2f}")
    lines.append(cat_breakdown(sgd_cats) or "  (no transactions)")
    lines.append("")
    lines.append(f"INR total: ₹{inr_mtd:.2f}")
    if inr_by_card:
        lines.append(f"  Scapia: ₹{inr_by_card.get('scapia', 0):.2f}  Axis: ₹{inr_by_card.get('axis', 0):.2f}")
    lines.append(cat_breakdown(inr_cats) or "  (no transactions)")

    send(chat_id, "\n".join(lines))


def handle_last(chat_id: str | int, n: int) -> None:
    txns = get_last_n_transactions(n)
    if not txns:
        send(chat_id, "No transactions found.")
        return
    lines = [f"Last {len(txns)} transactions:", ""]
    for t in txns:
        sym = "S$" if t["currency"] == "SGD" else "₹"
        lines.append(
            f"{t['txn_date']} · {t['merchant'] or 'Unknown'} · {sym}{t['amount']:.2f} · {t['card'].upper()}"
        )
    send(chat_id, "\n".join(lines))


def poll_updates(offset: int, token: str) -> tuple[list[dict], int]:
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    resp = httpx.get(url, params={"offset": offset, "timeout": 30}, timeout=35)
    data = resp.json()
    updates = data.get("result", [])
    new_offset = updates[-1]["update_id"] + 1 if updates else offset
    return updates, new_offset


def main() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    allowed_chat = os.environ["TELEGRAM_CHAT_ID"]

    log.info("Finny Telegram bot starting…")
    offset = 0

    while True:
        try:
            updates, offset = poll_updates(offset, token)
        except Exception as exc:
            log.error("Failed to get Telegram updates: %s", exc)
            continue

        for update in updates:
            msg = update.get("message") or update.get("edited_message")
            if not msg:
                continue

            chat_id = str(msg["chat"]["id"])
            if chat_id != str(allowed_chat):
                log.warning("Ignoring message from unknown chat %s", chat_id)
                continue

            text = (msg.get("text") or "").strip()
            log.info("Received: %r", text)

            try:
                if text.startswith("/today"):
                    handle_today(chat_id)
                elif text.startswith("/mtd"):
                    handle_mtd(chat_id)
                elif text.startswith("/last"):
                    parts = text.split()
                    n = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 10
                    handle_last(chat_id, n)
            except Exception as exc:
                log.error("Error handling command %r: %s", text, exc)
                send(chat_id, "Something went wrong. Check the logs.")


if __name__ == "__main__":
    main()
