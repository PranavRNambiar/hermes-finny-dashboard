"""
Finny daily digest — runs at 00:00 SGT via Hermes cron.
Builds a Telegram message for the previous day's spend using Hermes 3 via OpenRouter.
"""

import logging
import os
import sys
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

from llm import get_client, DIGEST_MODEL
from db import get_transactions_for_date, get_30d_avg, get_mtd_total, get_exempt_merchants
from anomaly import get_anomalies

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))


def build_digest(report_date: str) -> str:
    txns = get_transactions_for_date(report_date)

    sgd_today = sum(t["amount"] for t in txns if t["currency"] == "SGD")
    inr_today = sum(t["amount"] for t in txns if t["currency"] == "INR")
    sgd_mtd   = get_mtd_total("SGD")
    inr_mtd   = get_mtd_total("INR")
    sgd_avg   = get_30d_avg("SGD", report_date)
    inr_avg   = get_30d_avg("INR", report_date)
    anomalies = get_anomalies(report_date)

    top_txns = sorted(txns, key=lambda t: t["amount"], reverse=True)[:8]
    txn_lines = "\n".join(
        f"  {t['merchant'] or 'Unknown'} | "
        f"{'S$' if t['currency'] == 'SGD' else '₹'}{t['amount']:.2f} | "
        f"{t['category']}"
        for t in top_txns
    ) or "  No transactions"

    anomaly_lines = "\n".join(a["reason"] for a in anomalies) or "None"

    prompt_data = f"""Data for {report_date}:

SGD (DBS Debit):
- Today: S${sgd_today:.2f}
- MTD: S${sgd_mtd:.2f}
- 30-day daily avg: S${sgd_avg:.2f}

INR (Scapia + Axis Atlas):
- Today: ₹{inr_today:.2f}
- MTD: ₹{inr_mtd:.2f}
- 30-day daily avg: ₹{inr_avg:.2f}

Today's transactions (top by amount):
{txn_lines}

Anomalies & flags:
{anomaly_lines}"""

    system_prompt = (
        "You are Finny, a personal finance assistant. "
        "Write a Telegram message (plain text, Telegram Markdown v2 formatting allowed).\n\n"
        "Write the message with these sections:\n"
        "1. Header with date\n"
        "2. SGD summary (today + MTD)\n"
        "3. INR summary (today + MTD)\n"
        "4. Transaction list (max 8, show top by amount)\n"
        "5. Anomalies & flags (be specific, compare to averages, give actionable commentary)\n"
        "6. Finny's take (1–2 sentences: overall spend health, anything to watch)\n\n"
        "Tone: direct, friendly, not preachy. Flag real anomalies only."
    )

    client = get_client()
    response = client.chat.completions.create(
        model=DIGEST_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_data},
        ],
    )
    digest = response.choices[0].message.content.strip()

    if len(digest) > 4096:
        digest = digest[:4090] + "\n…"

    return digest


def send_telegram(text: str) -> None:
    token   = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    url     = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "MarkdownV2"}

    for attempt in range(1, 3):
        try:
            resp = httpx.post(url, json=payload, timeout=15)
            resp.raise_for_status()
            log.info("Digest sent to Telegram (attempt %d)", attempt)
            return
        except Exception as exc:
            log.error("Telegram send failed (attempt %d): %s", attempt, exc)

    log.error("Digest delivery failed after 2 attempts — giving up")


def main() -> None:
    report_date = os.environ.get("DIGEST_DATE") or (
        datetime.now(SGT) - timedelta(days=1)
    ).strftime("%Y-%m-%d")

    log.info("[DIGEST] Building digest for %s", report_date)
    try:
        digest = build_digest(report_date)
        log.info("[DIGEST] Digest built (%d chars)", len(digest))
        send_telegram(digest)
    except Exception as exc:
        log.error("[DIGEST] Fatal error: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
