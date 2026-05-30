"""
Finny weekly review — runs Monday 00:00 UTC (08:00 SGT).
Covers the previous Monday–Sunday week.
"""

import logging
import os
import sys
from datetime import date, datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

from db import get_client as _db, get_week_totals
from llm import get_client, DIGEST_MODEL, cached_system

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))
INR_PER_SGD = 72

SYSTEM_PROMPT = (
    "You are Finny, a personal finance assistant. Write a Monday morning weekly review for Telegram using HTML formatting only.\n"
    "Allowed HTML: <b>bold</b>, <i>italic</i>. No markdown, no tables, no backslashes.\n\n"
    "Format:\n"
    "1. <b>Weekly Review — [Mon DD Mon] to [Sun DD Mon YYYY]</b>\n"
    "2. 🇸🇬 <b>SGD</b>: total, vs last week (↑/↓%), weekend vs weekday split\n"
    "3. 🇮🇳 <b>INR</b>: same structure\n"
    "4. 📅 <b>Weekend Detail</b> — list every Saturday and Sunday transaction individually, grouped by day. "
    "Format each line: merchant | amount | category. Show SGD and INR transactions together under each day label. "
    "If a day has no transactions, write '(none)'.\n"
    "5. <b>Key insight</b> — one specific observation: 'weekend drove X% of spend', 'food up 40% vs last week', the outlier merchant, etc.\n"
    "6. <b>This week</b> — one direct, concrete suggestion (not generic advice)\n\n"
    "CRITICAL: SGD and INR are separate currencies. Never add or compare them.\n"
    "Keep it under 350 words. Be direct and specific — name the actual merchant or category, not vague patterns."
)


def _pct_change(current: float, previous: float) -> str:
    if previous == 0:
        return "new"
    pct = (current - previous) / previous * 100
    arrow = "↑" if pct > 0 else "↓"
    return f"{arrow}{abs(pct):.0f}%"


def build_weekly_review() -> str:
    today_sgt = datetime.now(SGT).date()
    days_since_monday = today_sgt.weekday()
    last_monday = today_sgt - timedelta(days=days_since_monday + 7)
    last_sunday = last_monday + timedelta(days=6)
    prev_monday = last_monday - timedelta(days=7)
    prev_sunday = last_monday - timedelta(days=1)

    week_start = last_monday.isoformat()
    week_end   = last_sunday.isoformat()
    prev_start = prev_monday.isoformat()
    prev_end   = prev_sunday.isoformat()

    sgd_days  = get_week_totals(week_start, week_end, "SGD")
    inr_days  = get_week_totals(week_start, week_end, "INR")
    sgd_prev  = sum(get_week_totals(prev_start, prev_end, "SGD").values())
    inr_prev  = sum(get_week_totals(prev_start, prev_end, "INR").values())

    sgd_total = sum(sgd_days.values())
    inr_total = sum(inr_days.values())

    def split_weekend_weekday(daily: dict[str, float]) -> tuple[float, float]:
        we = sum(v for d, v in daily.items() if date.fromisoformat(d).weekday() >= 5)
        wd = sum(v for d, v in daily.items() if date.fromisoformat(d).weekday() < 5)
        return we, wd

    sgd_we, sgd_wd = split_weekend_weekday(sgd_days)
    inr_we, inr_wd = split_weekend_weekday(inr_days)

    # Category and merchant breakdown for this week
    db = _db()
    txns = (
        db.table("transactions")
        .select("txn_date, merchant, amount, currency, category")
        .gte("txn_date", week_start)
        .lte("txn_date", week_end)
        .order("amount", desc=True)
        .execute()
        .data
    )

    cat_sgd: dict[str, float] = {}
    cat_inr: dict[str, float] = {}
    for t in txns:
        cat = t["category"]
        if t["currency"] == "SGD":
            cat_sgd[cat] = cat_sgd.get(cat, 0.0) + t["amount"]
        else:
            cat_inr[cat] = cat_inr.get(cat, 0.0) + t["amount"]

    def fmt_cats(cats: dict[str, float], sym: str) -> str:
        return "\n".join(
            f"  {c}: {sym}{v:.2f}" for c, v in sorted(cats.items(), key=lambda x: x[1], reverse=True)
        ) or "  (none)"

    top_txns = "\n".join(
        f"  {t['txn_date']} | {t['merchant'] or 'Unknown'} | "
        f"{'S$' if t['currency'] == 'SGD' else '₹'}{t['amount']:.2f} | {t['category']}"
        for t in txns[:12]
    ) or "  (none)"

    def fmt_day_txns(day_txns: list, label: str) -> str:
        if not day_txns:
            return f"  {label}: (none)"
        lines = [f"  {label}:"]
        for t in sorted(day_txns, key=lambda x: x["amount"], reverse=True):
            sym = "S$" if t["currency"] == "SGD" else "₹"
            lines.append(f"    {t['merchant'] or 'Unknown'} | {sym}{t['amount']:.2f} | {t['category']}")
        return "\n".join(lines)

    sat_txns = [t for t in txns if date.fromisoformat(t["txn_date"]).weekday() == 5]
    sun_txns = [t for t in txns if date.fromisoformat(t["txn_date"]).weekday() == 6]
    sat_label = (last_monday + timedelta(days=5)).strftime("Saturday %-d %b")
    sun_label = last_sunday.strftime("Sunday %-d %b")

    weekend_txns = f"{fmt_day_txns(sat_txns, sat_label)}\n{fmt_day_txns(sun_txns, sun_label)}"

    per_day = "\n".join(
        f"  {d}: " + " | ".join(filter(None, [
            f"S${sgd_days[d]:.2f}" if d in sgd_days else "",
            f"₹{inr_days[d]:.2f}"  if d in inr_days else "",
        ]))
        for d in sorted(set(list(sgd_days) + list(inr_days)))
    ) or "  (no transactions)"

    prompt = f"""Week: {week_start} to {week_end}

SGD: S${sgd_total:.2f} (prev week S${sgd_prev:.2f}, {_pct_change(sgd_total, sgd_prev)})
  Weekdays: S${sgd_wd:.2f} | Weekend: S${sgd_we:.2f}
  Categories:
{fmt_cats(cat_sgd, "S$")}

INR: ₹{inr_total:.2f} (prev week ₹{inr_prev:.2f}, {_pct_change(inr_total, inr_prev)})
  Weekdays: ₹{inr_wd:.2f} | Weekend: ₹{inr_we:.2f}
  Categories:
{fmt_cats(cat_inr, "₹")}

Per-day totals:
{per_day}

Weekend transactions (individual):
{weekend_txns}

Top transactions this week:
{top_txns}"""

    client = get_client()
    response = client.messages.create(
        model=DIGEST_MODEL,
        max_tokens=1200,
        system=cached_system(SYSTEM_PROMPT),
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


def send_telegram(text: str) -> None:
    token   = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    url     = f"https://api.telegram.org/bot{token}/sendMessage"
    dashboard_url = os.environ.get("DASHBOARD_URL", "")
    if dashboard_url:
        text += f"\n\n📊 {dashboard_url}"
    try:
        resp = httpx.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"}, timeout=15)
        resp.raise_for_status()
        log.info("[WEEKLY] Sent to Telegram")
    except Exception as exc:
        log.error("[WEEKLY] Telegram send failed: %s", exc)


def main() -> None:
    log.info("[WEEKLY] Building weekly review")
    try:
        review = build_weekly_review()
        log.info("[WEEKLY] Built (%d chars)", len(review))
        send_telegram(review)
    except Exception as exc:
        log.error("[WEEKLY] Fatal: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
