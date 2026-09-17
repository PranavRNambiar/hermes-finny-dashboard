"""
Finny daily digest — runs at 00:00 SGT via Hermes cron.
Builds a Telegram message for the previous day's spend using Claude.
"""

import calendar
import logging
import os
import sys
from datetime import date, datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

from llm import get_client, DIGEST_MODEL, cached_system
from db import get_transactions_for_date, get_30d_avg, get_mtd_total, get_wtd_total, get_exempt_merchants, get_frequent_merchants, get_subscription_candidates, get_budget
from anomaly import get_anomalies

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))
INR_PER_SGD = 72


def build_digest(report_date: str) -> str:
    txns = get_transactions_for_date(report_date)

    sgd_today = sum(t["amount"] for t in txns if t["currency"] == "SGD")
    inr_today = sum(t["amount"] for t in txns if t["currency"] == "INR")
    sgd_mtd   = get_mtd_total("SGD")
    inr_mtd   = get_mtd_total("INR")
    sgd_wtd   = get_wtd_total("SGD")
    inr_wtd   = get_wtd_total("INR")
    sgd_avg   = get_30d_avg("SGD", report_date)
    inr_avg   = get_30d_avg("INR", report_date)
    anomalies = get_anomalies(report_date)

    def fmt_amount(amount: float, currency: str) -> str:
        if currency == "SGD":
            return f"S${amount:.2f}"
        return f"₹{amount:.2f} (S${amount / INR_PER_SGD:.2f})"

    top_txns = sorted(txns, key=lambda t: t["amount"], reverse=True)[:8]
    txn_lines = "\n".join(
        f"  {t['merchant'] or 'Unknown'} | {fmt_amount(t['amount'], t['currency'])} | {t['category']}"
        for t in top_txns
    ) or "  No transactions"

    anomaly_lines = "\n".join(a["reason"] for a in anomalies) or "None"

    # Runway — how long does this month's budget last at current pace?
    month = report_date[:7]
    yr, mo, day = int(report_date[:4]), int(report_date[5:7]), int(report_date[8:])
    days_in_month = calendar.monthrange(yr, mo)[1]
    days_elapsed  = day

    def runway_status(currency: str) -> str:
        budget = get_budget("month", month, currency)
        if not budget:
            return "no budget set"
        mtd = get_mtd_total(currency)
        sym = "S$" if currency == "SGD" else "₹"
        remaining  = budget - mtd
        daily_pace = mtd / days_elapsed if days_elapsed > 0 else 0
        projected  = daily_pace * days_in_month
        surplus    = budget - projected
        if remaining <= 0:
            return f"OVER BUDGET — {sym}{abs(remaining):.0f} over, spent {sym}{mtd:.0f} of {sym}{budget:.0f}"
        if projected <= budget:
            return f"on track — {sym}{mtd:.0f} spent, {sym}{remaining:.0f} left, projected {sym}{projected:.0f} (under by {sym}{surplus:.0f})"
        runway_days = remaining / daily_pace if daily_pace > 0 else days_in_month - days_elapsed
        runs_out_day = min(day + runway_days, days_in_month)
        runs_out = date(yr, mo, int(runs_out_day)).strftime("%-d %b")
        return (
            f"OVER PACE — {sym}{mtd:.0f} spent, {sym}{remaining:.0f} left, "
            f"pace {sym}{daily_pace:.0f}/day, runs out ~{runs_out}, projected {sym}{projected:.0f}"
        )

    sgd_runway = runway_status("SGD")
    inr_runway = runway_status("INR")

    # Habits (frequent merchants in last 30 days)
    habits_sgd = get_frequent_merchants("SGD", lookback_days=30, min_occurrences=3)
    habits_inr = get_frequent_merchants("INR", lookback_days=30, min_occurrences=3)

    def fmt_habits(habits: list, sym: str) -> str:
        if not habits:
            return "  (none)"
        lines = []
        for h in habits[:6]:
            tag = f" #{h['tag']}" if h.get("tag") else ""
            lines.append(
                f"  {h['merchant']}{tag}: {h['occurrences']}x · "
                f"{sym}{h['avg_per_visit']:.2f}/visit · {sym}{h['weekly_avg']:.2f}/week · {sym}{h['total']:.2f} MTD"
            )
        return "\n".join(lines)

    # Subscriptions (monthly/quarterly cadence, stable amount)
    subs_sgd = get_subscription_candidates("SGD")
    subs_inr = get_subscription_candidates("INR")

    def fmt_subs(subs: list, sym: str) -> str:
        if not subs:
            return "  (none detected)"
        lines = []
        for s in subs:
            cadence = "monthly" if s["avg_gap_days"] <= 35 else f"every ~{s['avg_gap_days']}d"
            lines.append(f"  {s['merchant']}: {sym}{s['amount']:.2f} {cadence}")
        return "\n".join(lines)

    from datetime import timedelta
    today_sgt = datetime.now(SGT).date()
    monday = today_sgt - timedelta(days=today_sgt.weekday())

    prompt_data = f"""Data for {report_date} (day {days_elapsed} of {days_in_month}):

SGD (Wise + DBS):
- Today: S${sgd_today:.2f}
- WTD (Mon {monday} → today): S${sgd_wtd:.2f}
- MTD (1st → today): S${sgd_mtd:.2f}
- 30-day daily avg: S${sgd_avg:.2f}
- Monthly runway: {sgd_runway}

INR (Scapia + Axis Atlas):
- Today: ₹{inr_today:.2f}
- WTD (Mon {monday} → today): ₹{inr_wtd:.2f}
- MTD (1st → today): ₹{inr_mtd:.2f}
- 30-day daily avg: ₹{inr_avg:.2f}
- Monthly runway: {inr_runway}

Today's transactions (top by amount):
{txn_lines}

Anomalies & flags:
{anomaly_lines}

Spending habits (merchants visited ≥3x in last 30 days):
SGD habits:
{fmt_habits(habits_sgd, "S$")}
INR habits:
{fmt_habits(habits_inr, "₹")}

Subscriptions detected (monthly/quarterly recurring charges):
SGD subscriptions:
{fmt_subs(subs_sgd, "S$")}
INR subscriptions:
{fmt_subs(subs_inr, "₹")}"""

    system_prompt = (
        "You are Finny — a sharp personal CFO and accountant. "
        "Write a daily Telegram report using HTML formatting only.\n"
        "Allowed HTML: <b>bold</b>, <i>italic</i>. No markdown, no tables, no backslashes.\n\n"
        "Sections (omit any section where data is empty):\n"
        "1. <b>Daily Spend — [Day, Date]</b>\n"
        "2. 🇸🇬 <b>SGD (Wise + DBS)</b> — today / WTD / MTD / 30d avg\n"
        "3. 🇮🇳 <b>INR (Scapia + Axis)</b> — today / WTD / MTD / 30d avg\n"
        "4. 💳 <b>Transactions</b> — numbered list\n"
        "5. 📊 <b>Runway</b> — only if monthly budget is set. Show remaining budget, daily pace, and one of: "
        "'on track — S$X to spare' OR 'over pace — runs out ~[date], cut to S$Y/day to stay on budget'. Skip if no budget.\n"
        "6. ⚠️ <b>Flags</b> — anomalies only, be specific (name the merchant and amount)\n"
        "6. ☕ <b>Habits</b> — if habits data non-empty: name each merchant, visits/week, cost/week, monthly total. "
        "If a habit exceeds S$50/month (SGD) or ₹3000/month (INR), flag it with the exact number. "
        "Coffee and daily food are habits, NOT subscriptions — never list them as subscriptions.\n"
        "7. 🔄 <b>Subscriptions</b> — if subscription data non-empty: list each with monthly cost. "
        "Flag any that haven't appeared recently (possible cancellation) or look redundant.\n"
        "8. 🐠 <b>Finny's Take</b> — 2 sentences max. One key observation with a number, one direct suggestion. "
        "CFO tone: no filler, no pep talk.\n\n"
        "CRITICAL:\n"
        "- SGD and INR are separate. Never add or compare them.\n"
        "- INR amounts: ₹X (S$Y) order always.\n"
        "- Never show a combined total.\n"
        "Keep total under 400 words."
    )

    client = get_client()
    response = client.messages.create(
        model=DIGEST_MODEL,
        max_tokens=1500,
        system=cached_system(system_prompt),
        messages=[
            {"role": "user", "content": prompt_data},
        ],
    )
    digest = response.content[0].text.strip()

    if len(digest) > 4096:
        digest = digest[:4090] + "\n…"

    return digest


def send_telegram(text: str) -> None:
    token   = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    url     = f"https://api.telegram.org/bot{token}/sendMessage"
    dashboard_url = os.environ.get("DASHBOARD_URL", "")
    if dashboard_url:
        text = text + f"\n\n📊 {dashboard_url}"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}

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
    now_sgt = datetime.now(SGT)
    report_date = os.environ.get("DIGEST_DATE") or (now_sgt - timedelta(days=1)).strftime("%Y-%m-%d")

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
