"""
Finny Telegram bot — listens for commands and free-form questions.

Commands:
  /today   — today's spend so far
  /mtd     — month-to-date totals with category breakdown
  /last N  — last N transactions (default 10)

Anything else — answered conversationally using Llama via Groq
"""

import calendar
import logging
import os
import re
import sys
from datetime import datetime, date, timezone, timedelta

import httpx
from dotenv import load_dotenv

from db import (
    get_transactions_for_date,
    get_mtd_total,
    get_mtd_by_card,
    get_mtd_by_category,
    get_last_month_total,
    get_last_month_by_category,
    get_top_merchants_mtd,
    get_last_n_transactions,
    get_last_transaction_by_card,
    get_merchant_tag,
    save_merchant_tag,
    get_mtd_by_tag,
    get_pending_tag,
    get_client,
    save_budget,
    get_budget,
    list_budgets,
    delete_budget,
    mark_exempt,
    get_frequent_merchants,
    get_subscription_candidates,
    get_transaction_by_message_id,
    get_or_create_person,
    list_people,
    create_splits,
)
import notify
from llm import get_client as get_llm, DIGEST_MODEL, CHAT_MODEL, cached_system

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))
INR_PER_SGD = 72


CARD_EMOJI = {"wise": "💸", "dbs": "🏦", "scapia": "🇮🇳", "axis": "🏛️", "ixigo": "✈️", "ocbc": "🏦"}
CAT_EMOJI  = {
    "Food & Drink": "🍽️", "Transport": "🚗", "Shopping": "🛍️",
    "Subscriptions": "🔄", "Health & Fitness": "💪", "Travel": "✈️",
    "Utilities & Bills": "⚡", "Rent & Housing": "🏠", "Entertainment": "🎬",
    "Education": "📚", "Transfers & Misc": "💸",
}

def fmt_amount(amount: float, currency: str) -> str:
    if currency == "SGD":
        return f"S${amount:.2f}"
    return f"₹{amount:.2f} (S${amount / INR_PER_SGD:.2f})"


SYSTEM_PROMPT = """You are Finny — a personal CFO and accountant who knows this user's finances inside out.

You have full transaction history, category breakdowns, month-over-month comparisons, habit patterns, and subscription data.

Your job: help the user understand their money and make better decisions — not just report numbers.

Rules:
- Always use S$ for SGD and ₹ for INR. Never mix or add them together.
- Exchange rate: 1 SGD = 72 INR (only when explicitly asked to convert).
- When asked WHY something happened, name the specific merchant or category — never vague answers.
- When asked if they should cut back, give an actual opinion with numbers, not a hedge.
- Know the difference between subscriptions (Netflix, monthly SaaS) and habits (coffee daily, lunch spots). Don't confuse them.
- If asked about a habit (coffee, lunch), give: visits/week, cost/week, monthly total, and whether it's trending up or down vs last month.
- Be direct and numbers-first. "Food jumped 40% — 4 Ying Thai visits at S$28 avg" beats "you spent more on food."
- Keep responses under 300 words, plain text, suitable for Telegram.

Available commands:
/today     — today's spend with budget progress
/mtd       — month-to-date with category breakdown
/last N    — last N transactions
/digest    — trigger daily digest now
/weekly    — trigger weekly review now
/scan      — rescan Gmail for missing transactions
/dashboard — open the dashboard
/runway    — how long your monthly budget lasts at current pace
/waste     — subscriptions and habits audit (money leaving on autopilot)
/budget    — view budgets

You also understand:
- Natural-language budget setting: "Keep budget for 9 May as S$45"
- Merchant tagging: after "what was this for?", reply with a tag like "coffee" or "skip".

You focus only on the user's own spending, saving and budgets. Debt collection and bill
splitting are handled by a separate bot, Manny. The user can still split a bill by replying
to a transaction notification ("split with Raj and Priya") — that gets recorded automatically
— but for "who owes me what", settling up, and cashflow, point them to Manny."""


def send(chat_id: str | int, text: str) -> None:
    from bot_settings import enabled
    if not enabled("bot"):
        return  # Finny bot switched off on the web: stay quiet
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)


def _fmt_txn(t: dict) -> str:
    """User-facing transaction line (with SGD equivalent for INR)."""
    tag = f" | #{t['user_tag']}" if t.get("user_tag") else ""
    return (
        f"  {t['txn_date']} | {t['card'].upper()} | {t['merchant'] or 'Unknown'} | "
        f"{fmt_amount(t['amount'], t['currency'])} | {t['category']}{tag}"
    )


def _fmt_txn_ctx(t: dict) -> str:
    """LLM-context transaction line — raw amounts only, no currency conversions."""
    sym = "S$" if t["currency"] == "SGD" else "₹"
    tag = f" | #{t['user_tag']}" if t.get("user_tag") else ""
    return (
        f"  {t['txn_date']} | {t['card'].upper()} | {t['currency']} | "
        f"{t['merchant'] or 'Unknown'} | {sym}{t['amount']:.2f} | {t['category']}{tag}"
    )


def build_context() -> str:
    """Build rich transaction context for Finny — includes month-over-month and category trends."""
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    yesterday = (datetime.now(SGT) - timedelta(days=1)).strftime("%Y-%m-%d")

    today_txns     = get_transactions_for_date(today)
    yesterday_txns = get_transactions_for_date(yesterday)
    recent         = get_last_n_transactions(20)

    sgd_today     = sum(t["amount"] for t in today_txns     if t["currency"] == "SGD")
    inr_today     = sum(t["amount"] for t in today_txns     if t["currency"] == "INR")
    sgd_yesterday = sum(t["amount"] for t in yesterday_txns if t["currency"] == "SGD")
    inr_yesterday = sum(t["amount"] for t in yesterday_txns if t["currency"] == "INR")
    sgd_mtd = get_mtd_total("SGD")
    inr_mtd = get_mtd_total("INR")
    sgd_last = get_last_month_total("SGD")
    inr_last = get_last_month_total("INR")

    # Category breakdowns — current month vs last month
    sgd_cats_now  = get_mtd_by_category("SGD")
    inr_cats_now  = get_mtd_by_category("INR")
    sgd_cats_prev = get_last_month_by_category("SGD")
    inr_cats_prev = get_last_month_by_category("INR")

    def fmt_cat_diff(now: dict[str, float], prev: dict[str, float], sym: str) -> str:
        all_cats = sorted(set(list(now) + list(prev)), key=lambda c: now.get(c, 0), reverse=True)
        lines = []
        for c in all_cats:
            n, p = now.get(c, 0), prev.get(c, 0)
            diff = f" (was {sym}{p:.0f})" if p > 0 else " (new)"
            lines.append(f"  {c}: {sym}{n:.2f}{diff}")
        return "\n".join(lines) or "  (none)"

    # Tag breakdowns for current month
    sgd_tags = get_mtd_by_tag("SGD")
    inr_tags = get_mtd_by_tag("INR")

    def fmt_tags(tags: dict, sym: str) -> str:
        return "\n".join(
            f"  #{k}: {sym}{v:.2f}" for k, v in sorted(tags.items(), key=lambda x: x[1], reverse=True)
        ) or "  (none)"

    # Top merchants this month
    sgd_merchants = get_top_merchants_mtd("SGD")
    inr_merchants = get_top_merchants_mtd("INR")

    def fmt_merchants(merchants: list, sym: str) -> str:
        return "\n".join(f"  {m}: {sym}{v:.2f}" for m, v in merchants) or "  (none)"

    today_lines     = "\n".join(_fmt_txn_ctx(t) for t in today_txns)     or "  (none)"
    yesterday_lines = "\n".join(_fmt_txn_ctx(t) for t in yesterday_txns) or "  (none)"
    recent_lines    = "\n".join(_fmt_txn_ctx(t) for t in recent)

    return f"""Current date (SGT): {today}

IMPORTANT: SGD and INR are separate currencies. Never add them together.

Precomputed totals:
Today ({today}):      SGD S${sgd_today:.2f}  |  INR ₹{inr_today:.2f}
Yesterday ({yesterday}): SGD S${sgd_yesterday:.2f}  |  INR ₹{inr_yesterday:.2f}
MTD:                  SGD S${sgd_mtd:.2f}  |  INR ₹{inr_mtd:.2f}
Last month (full):    SGD S${sgd_last:.2f}  |  INR ₹{inr_last:.2f}

SGD category breakdown (this month vs last month):
{fmt_cat_diff(sgd_cats_now, sgd_cats_prev, "S$")}

INR category breakdown (this month vs last month):
{fmt_cat_diff(inr_cats_now, inr_cats_prev, "₹")}

SGD tag breakdown this month:
{fmt_tags(sgd_tags, "S$")}

INR tag breakdown this month:
{fmt_tags(inr_tags, "₹")}

Top SGD merchants this month:
{fmt_merchants(sgd_merchants, "S$")}

Top INR merchants this month:
{fmt_merchants(inr_merchants, "₹")}

Today's transactions:
{today_lines}

Yesterday's transactions:
{yesterday_lines}

Last 20 transactions:
{recent_lines}"""


_BUDGET_KEYWORDS = re.compile(
    r"\b(budget|limit|cap|spending limit|keep.{0,20}to|set.{0,10}budget|max spend)\b",
    re.IGNORECASE,
)

def _is_budget_intent(text: str) -> bool:
    return bool(_BUDGET_KEYWORDS.search(text)) and bool(re.search(r"\d", text))


_TAG_KEYWORDS = re.compile(r"\b(tag|label|mark|categorise|categorize)\b", re.IGNORECASE)

def _is_tag_intent(text: str) -> bool:
    return bool(_TAG_KEYWORDS.search(text))


def _is_split_intent(text: str) -> bool:
    """Free-text bill-split recording: needs both 'split' and 'with'."""
    t = text.lower()
    return "split" in t and "with" in t


def _parse_free_text_split(text: str, recent: list[dict]) -> dict | None:
    """Extract split intent from free-text. Returns {transaction_id, person_name, share} or None."""
    txn_lines = "\n".join(
        f"  id={t['id']} merchant={t['merchant']} amount={t['amount']} currency={t['currency']} date={t['txn_date']}"
        for t in recent if t.get("merchant")
    )
    known_people = list_people()
    names = ", ".join(p["name"] for p in known_people) or "(none yet)"
    system = (
        f"Recent transactions:\n{txn_lines}\n\n"
        f"Known people: {names}\n\n"
        "The user wants to record a bill split. Extract:\n"
        "- transaction_id: the id field of the matching transaction\n"
        "- person_name: who to split with (match to known people if possible)\n"
        "- share: the other person's share amount (if not specified, assume equal split = total/2, rounded to 2dp)\n"
        "Return ONLY JSON: {\"transaction_id\": \"uuid-here\", \"person_name\": \"Name\", \"share\": 12.34}\n"
        "If no matching transaction found or not a split request, return {\"skip\": true}."
    )
    try:
        import json as _json
        response = get_llm().messages.create(
            model=CHAT_MODEL,
            max_tokens=128,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        data = _json.loads(raw[start:end])
        if data.get("skip"):
            return None
        if data.get("transaction_id") and data.get("person_name"):
            return data
    except Exception as exc:
        log.error("Free-text split parse error: %s", exc)
    return None


def handle_free_text_split(chat_id: str | int, text: str) -> bool:
    """Handle a split recording request sent as free-text (not a reply). Returns True if handled."""
    recent = get_last_n_transactions(40)
    parsed = _parse_free_text_split(text, recent)
    if not parsed:
        return False

    txn_id = str(parsed["transaction_id"])
    txn = next((t for t in recent if str(t["id"]) == txn_id), None)
    if not txn:
        return False

    person_name = str(parsed.get("person_name", "")).strip()
    share = round(float(parsed.get("share", txn["amount"] / 2)), 2)
    sym = "S$" if txn["currency"] == "SGD" else "₹"
    person_id = get_or_create_person(person_name)

    try:
        create_splits(txn["id"], txn["currency"], [{"person_id": person_id, "share_amount": share}])
    except Exception as exc:
        log.error("Failed to save free-text split: %s", exc)
        send(chat_id, "Couldn't save that split, sorry.")
        return True

    your_share = max(txn["amount"] - share, 0)
    merchant = txn["merchant"] or "Unknown"
    reply_lines = [f"Got it! Bill split recorded for {merchant} ({sym}{txn['amount']:.2f}) with {person_name}."]
    reply_lines.append(f"\nYour share: {sym}{your_share:.2f}")
    reply_lines.append(f"{person_name} owes you: {sym}{share:.2f}")
    reply_lines.append("\nFor tracking what they owe and settling up, check with **Manny**. 🤝")
    send(chat_id, "\n".join(reply_lines))

    manny_lines = [f"🧾 New debt logged via Finny — {merchant} {sym}{txn['amount']:.2f}"]
    manny_lines.append(f"  {person_name}: {sym}{share:.2f}")
    manny_lines.append("\nCheck /splits or /cashflow.")
    notify.send_manny("\n".join(manny_lines))
    return True


def _parse_tag_intent(text: str) -> tuple[str, str] | None:
    """Extract (merchant, tag) from natural language using recent transactions as context."""
    recent = get_last_n_transactions(20)
    merchant_list = ", ".join({t["merchant"] for t in recent if t.get("merchant")})
    llm = get_llm()
    system = (
        f"Known merchants: {merchant_list}\n"
        "Extract a merchant tagging request from the message.\n"
        "Return ONLY JSON: {\"merchant\": \"exact merchant name from the list\", \"tag\": \"short tag word\"}\n"
        "If not a tagging request or merchant not in list, return {\"skip\": true}."
    )
    try:
        import json as _json
        response = llm.messages.create(
            model=CHAT_MODEL,
            max_tokens=64,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        data = _json.loads(raw[start:end])
        if data.get("skip"):
            return None
        if data.get("merchant") and data.get("tag"):
            return data["merchant"], data["tag"]
    except Exception as exc:
        log.error("Tag intent parse error: %s", exc)
    return None


def _parse_budget(text: str, today: str) -> dict | None:
    """Use LLM to extract budget details. Returns {period_type, period, currency, amount} or None."""
    llm = get_llm()
    system = (
        f"Today is {today}. Extract budget details from the message.\n"
        "Return ONLY JSON matching: {\"period_type\": \"day\"|\"month\", \"period\": \"YYYY-MM-DD\"|\"YYYY-MM\", "
        "\"currency\": \"SGD\"|\"INR\", \"amount\": number}\n"
        "If not a budget-setting message, return {\"skip\": true}."
    )
    try:
        response = llm.messages.create(
            model=CHAT_MODEL,
            max_tokens=128,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": text}],
        )
        import json as _json
        data = _json.loads(response.content[0].text.strip())
        if data.get("skip"):
            return None
        if all(k in data for k in ("period_type", "period", "currency", "amount")):
            return data
    except Exception as exc:
        log.error("Budget parse error: %s", exc)
    return None


def handle_set_budget(chat_id: str | int, text: str) -> bool:
    """Try to parse and save a budget from natural language. Returns True if handled."""
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    parsed = _parse_budget(text, today)
    if not parsed:
        return False
    try:
        save_budget(
            period_type=parsed["period_type"],
            period=parsed["period"],
            currency=parsed["currency"],
            amount=float(parsed["amount"]),
        )
        period_label = parsed["period"] if parsed["period_type"] == "month" else parsed["period"]
        sym = "S$" if parsed["currency"] == "SGD" else "₹"
        send(chat_id, f"Budget set: {period_label} — {sym}{parsed['amount']:.2f} {parsed['currency']}")
        return True
    except Exception as exc:
        log.error("Failed to save budget: %s", exc)
        send(chat_id, "Couldn't save that budget. Try again.")
        return True


def handle_budget_list(chat_id: str | int) -> None:
    """Show all active budgets."""
    budgets = list_budgets()
    if not budgets:
        send(chat_id, "No budgets set. Try: 'Keep budget for May as S$500' or 'Budget for 9th May: S$45'")
        return
    lines = ["Your budgets:", ""]
    for b in budgets:
        sym = "S$" if b["currency"] == "SGD" else "₹"
        cat = f" ({b['category']})" if b.get("category") else ""
        lines.append(f"  {b['period_type'].upper()} {b['period']} — {sym}{b['amount']:.2f} {b['currency']}{cat}")
    send(chat_id, "\n".join(lines))


def _parse_split_intent(text: str, txn: dict, known_people: list[dict]) -> dict | None:
    """Extract a bill-split request from a reply to a transaction message.
    Returns {"splits": [{"name": str, "share": float}, ...]} or None if not a split request."""
    sym = "S$" if txn["currency"] == "SGD" else "₹"
    names = ", ".join(p["name"] for p in known_people) or "(none yet)"
    system = (
        f"The user paid {sym}{txn['amount']:.2f} at {txn['merchant'] or 'Unknown'} ({txn['currency']}).\n"
        f"Known people: {names}\n\n"
        "The user is replying to this transaction notification. Extract a bill-split request.\n"
        "Rules:\n"
        "- \"split with X and Y\" (no amounts given) -> divide the total amount EQUALLY among "
        "the user plus all named people, and return each named person's equal share.\n"
        "- Explicit amounts (\"Raj owes 15, Priya owes 10\") -> use those amounts directly.\n"
        "- Match a name to an existing known person if it's clearly the same person (case/spelling "
        "variants); otherwise use the name as given.\n"
        "- Round shares to 2 decimal places.\n"
        "Return ONLY JSON: {\"splits\": [{\"name\": \"Raj\", \"share\": 13.33}, ...]}\n"
        "If this reply is not a bill-split request, return {\"skip\": true}."
    )
    try:
        llm = get_llm()
        response = llm.messages.create(
            model=CHAT_MODEL,
            max_tokens=256,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": text}],
        )
        import json as _json
        raw = response.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        data = _json.loads(raw[start:end])
        if data.get("skip"):
            return None
        splits = data.get("splits")
        if splits and isinstance(splits, list):
            return {"splits": splits}
    except Exception as exc:
        log.error("Split intent parse error: %s", exc)
    return None


def handle_split_reply(chat_id: str | int, text: str, txn: dict) -> bool:
    """Try to parse and record a bill split for a transaction. Returns True if handled
    (the reply was a split request), False if it should fall through to other handling."""
    known_people = list_people()
    parsed = _parse_split_intent(text, txn, known_people)
    if not parsed:
        return False

    sym = "S$" if txn["currency"] == "SGD" else "₹"
    splits = []
    lines = []
    others_total = 0.0
    for entry in parsed["splits"]:
        name = str(entry.get("name", "")).strip()
        try:
            share = round(float(entry["share"]), 2)
        except (KeyError, TypeError, ValueError):
            continue
        if not name or share <= 0:
            continue
        person_id = get_or_create_person(name)
        splits.append({"person_id": person_id, "share_amount": share})
        others_total += share
        lines.append(f"  {name}: {sym}{share:.2f}")

    if not splits:
        return False

    try:
        create_splits(txn["id"], txn["currency"], splits)
    except Exception as exc:
        log.error("Failed to save splits: %s", exc)
        send(chat_id, "Couldn't save that split, sorry.")
        return True

    your_share = max(txn["amount"] - others_total, 0)
    merchant = txn["merchant"] or "Unknown"
    reply_lines = [f"✅ Split recorded — {merchant} {sym}{txn['amount']:.2f}"]
    reply_lines.extend(lines)
    reply_lines.append(f"  You: {sym}{your_share:.2f}")
    reply_lines.append("")
    reply_lines.append("Manny is tracking the debt — message him to collect or settle.")
    send(chat_id, "\n".join(reply_lines))

    # Hand the debt off to Manny so all collection conversation lives in his chat.
    manny_lines = [f"🧾 New debt logged via Finny — {merchant} {sym}{txn['amount']:.2f}"]
    manny_lines.extend(lines)
    manny_lines.append("")
    manny_lines.append("Check /splits or /cashflow.")
    notify.send_manny("\n".join(manny_lines))
    return True


def handle_chat(chat_id: str | int, question: str, reply_context: str | None = None) -> None:
    """Answer a free-form question using transaction context."""
    try:
        context = build_context()
    except Exception as exc:
        log.error("Failed to build context: %s", exc)
        send(chat_id, "Couldn't load your transaction data right now. Try again in a moment.")
        return

    user_content = f"Transaction data:\n{context}\n\n"
    if reply_context:
        user_content += f"The user is replying to this message:\n---\n{reply_context}\n---\n\n"
    user_content += f"Question: {question}"

    llm = get_llm()
    try:
        response = llm.messages.create(
            model=CHAT_MODEL,
            max_tokens=400,
            system=cached_system(SYSTEM_PROMPT),
            messages=[
                {"role": "user", "content": user_content},
            ],
        )
        answer = response.content[0].text.strip()
        dashboard_url = os.environ.get("DASHBOARD_URL", "")
        if dashboard_url:
            answer += f"\n\n📊 {dashboard_url}"
        send(chat_id, answer)
    except Exception as exc:
        log.error("LLM error during chat: %s", exc)
        send(chat_id, "I'm having trouble thinking right now (rate limit). Try again in a minute.")


def _budget_line(actual: float, currency: str, period_type: str, period: str) -> str:
    budget = get_budget(period_type, period, currency)
    sym = "S$" if currency == "SGD" else "₹"
    if budget is None:
        return f"{currency}: {sym}{actual:.2f}"
    pct = int(actual / budget * 100) if budget > 0 else 0
    bar = "🟢" if pct < 75 else ("🟡" if pct < 100 else "🔴")
    return f"{currency}: {sym}{actual:.2f} / {sym}{budget:.2f} {bar} {pct}%"


def _compute_runway(mtd_spend: float, budget: float, today_str: str) -> dict:
    """Compute runway stats given MTD spend and a monthly budget."""
    yr, mo, day = int(today_str[:4]), int(today_str[5:7]), int(today_str[8:])
    days_in_month = calendar.monthrange(yr, mo)[1]
    days_elapsed   = day
    days_remaining = days_in_month - days_elapsed

    remaining    = budget - mtd_spend
    daily_pace   = mtd_spend / days_elapsed if days_elapsed > 0 else 0
    projected    = daily_pace * days_in_month

    if daily_pace > 0 and remaining > 0:
        runway_days = remaining / daily_pace
        runs_out_day = min(day + runway_days, days_in_month)
        runs_out = date(yr, mo, int(runs_out_day)).strftime("%-d %b")
    elif remaining <= 0:
        runway_days = 0
        runs_out = "already over"
    else:
        runway_days = days_remaining
        runs_out = None  # survives month even at zero pace

    surplus = budget - projected
    return {
        "remaining": remaining,
        "daily_pace": daily_pace,
        "projected": projected,
        "surplus": surplus,
        "runway_days": runway_days,
        "runs_out": runs_out,
        "days_remaining": days_remaining,
        "on_track": projected <= budget,
    }


def _runway_line(mtd_spend: float, currency: str, today_str: str) -> str | None:
    """One-line runway summary for /today. Returns None if no monthly budget set."""
    month = today_str[:7]
    budget = get_budget("month", month, currency)
    if not budget:
        return None
    sym = "S$" if currency == "SGD" else "₹"
    r = _compute_runway(mtd_spend, budget, today_str)
    if r["remaining"] <= 0:
        return f"  Month: {sym}{mtd_spend:.0f} spent — {sym}{abs(r['remaining']):.0f} over budget 🔴"
    if r["on_track"]:
        return f"  Month: {sym}{mtd_spend:.0f} / {sym}{budget:.0f} · pace {sym}{r['daily_pace']:.0f}/day · on track 🟢"
    else:
        runs_out_str = f" · runs out ~{r['runs_out']}" if r["runs_out"] else ""
        return f"  Month: {sym}{mtd_spend:.0f} / {sym}{budget:.0f} · pace {sym}{r['daily_pace']:.0f}/day{runs_out_str} 🔴"


def handle_today(chat_id: str | int) -> None:
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    month = today[:7]
    txns = get_transactions_for_date(today)

    sgd_today = sum(t["amount"] for t in txns if t["currency"] == "SGD")
    inr_today = sum(t["amount"] for t in txns if t["currency"] == "INR")
    sgd_mtd   = get_mtd_total("SGD")
    inr_mtd   = get_mtd_total("INR")

    day_label = datetime.now(SGT).strftime("%-d %b, %A")
    lines = [f"📅 Today · {day_label}", ""]

    lines.append(f"🇸🇬 {_budget_line(sgd_today, 'SGD', 'day', today)}")
    sgd_runway = _runway_line(sgd_mtd, "SGD", today)
    if sgd_runway:
        lines.append(sgd_runway)

    lines.append(f"🇮🇳 {_budget_line(inr_today, 'INR', 'day', today)}")
    inr_runway = _runway_line(inr_mtd, "INR", today)
    if inr_runway:
        lines.append(inr_runway)

    if txns:
        lines.append("")
        lines.append("Transactions")
        for t in txns:
            time_prefix = f"{t['txn_time']} · " if t.get("txn_time") else ""
            tag_suffix = f" #{t['user_tag']}" if t.get("user_tag") else ""
            cat_icon = CAT_EMOJI.get(t["category"], "·")
            lines.append(f"  {time_prefix}{t['merchant'] or 'Unknown'} · {fmt_amount(t['amount'], t['currency'])} {cat_icon}{tag_suffix}")
    else:
        lines.append("\nNo transactions yet today 🎉")

    dashboard_url = os.environ.get("DASHBOARD_URL", "")
    if dashboard_url:
        lines.append(f"\n📊 {dashboard_url}")

    send(chat_id, "\n".join(lines))


def handle_runway(chat_id: str | int) -> None:
    """Detailed runway breakdown for both currencies."""
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    month = today[:7]
    month_label = datetime.now(SGT).strftime("%B %Y")
    yr, mo = int(today[:4]), int(today[5:7])
    days_in_month = calendar.monthrange(yr, mo)[1]
    day = int(today[8:])

    lines = [f"Runway — {month_label}", f"Day {day} of {days_in_month}", ""]

    for currency in ("SGD", "INR"):
        sym = "S$" if currency == "SGD" else "₹"
        budget = get_budget("month", month, currency)
        mtd = get_mtd_total(currency)

        if not budget:
            lines.append(f"{currency}: {sym}{mtd:.0f} spent this month (no budget set)")
            lines.append(f"  Set one: 'Monthly {currency} budget is {sym}X'")
            lines.append("")
            continue

        r = _compute_runway(mtd, budget, today)

        lines.append(f"{currency} — {sym}{mtd:.0f} spent of {sym}{budget:.0f}")
        lines.append(f"  Remaining: {sym}{max(r['remaining'], 0):.0f}")
        lines.append(f"  Daily pace: {sym}{r['daily_pace']:.0f}/day")
        lines.append(f"  Projected month-end: {sym}{r['projected']:.0f}")

        if r["remaining"] <= 0:
            lines.append(f"  Status: 🔴 Over budget by {sym}{abs(r['remaining']):.0f}")
        elif r["on_track"]:
            lines.append(f"  Status: 🟢 On track — {sym}{r['surplus']:.0f} to spare")
        else:
            lines.append(f"  Status: 🔴 Over pace — runs out ~{r['runs_out']} ({int(r['runway_days'])} days left at this rate)")
            daily_target = max(r["remaining"], 0) / r["days_remaining"] if r["days_remaining"] > 0 else 0
            lines.append(f"  To stay on budget: {sym}{daily_target:.0f}/day for remaining {r['days_remaining']} days")

        lines.append("")

    send(chat_id, "\n".join(lines).rstrip())


def handle_waste(chat_id: str | int) -> None:
    """Surface subscriptions and habits — the money leaving on autopilot."""
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    month = today[:7]
    month_label = datetime.now(SGT).strftime("%B %Y")

    lines = [f"Waste audit — {month_label}", ""]

    grand_sgd = 0.0
    grand_inr = 0.0

    for currency in ("SGD", "INR"):
        sym = "S$" if currency == "SGD" else "₹"
        budget = get_budget("month", month, currency)

        subs  = get_subscription_candidates(currency)
        habits = get_frequent_merchants(currency, lookback_days=30, min_occurrences=3)

        sub_total   = sum(s["amount"] for s in subs)
        habit_total = sum(h["total"] for h in habits)
        combined    = sub_total + habit_total

        if not subs and not habits:
            continue

        lines.append(f"{'SGD' if currency == 'SGD' else 'INR'}")

        if subs:
            lines.append(f"  Subscriptions — {sym}{sub_total:.0f}/month")
            for s in subs:
                cadence = "monthly" if s["avg_gap_days"] <= 35 else f"every ~{s['avg_gap_days']}d"
                lines.append(f"    {s['merchant']}: {sym}{s['amount']:.2f} {cadence}")

        if habits:
            lines.append(f"  Habits — {sym}{habit_total:.0f}/month")
            for h in habits[:6]:
                tag = f" #{h['tag']}" if h.get("tag") else ""
                lines.append(f"    {h['merchant']}{tag}: {h['occurrences']}x · {sym}{h['avg_per_visit']:.0f}/visit · {sym}{h['total']:.0f}/month")

        if budget and combined > 0:
            pct = combined / budget * 100
            lines.append(f"  Total: {sym}{combined:.0f}/month = {pct:.0f}% of your {sym}{budget:.0f} budget")
        elif combined > 0:
            lines.append(f"  Total: {sym}{combined:.0f}/month")

        lines.append("")

        if currency == "SGD":
            grand_sgd = combined
        else:
            grand_inr = combined

    if not any(l.strip() for l in lines[2:]):
        send(chat_id, "No recurring patterns detected yet — check back after a few weeks of transactions.")
        return

    send(chat_id, "\n".join(lines).rstrip())


def handle_mtd(chat_id: str | int) -> None:
    today_sgt = datetime.now(SGT)
    month_label = today_sgt.strftime("%B %Y")

    sgd_mtd = get_mtd_total("SGD")
    inr_mtd = get_mtd_total("INR")
    inr_by_card = get_mtd_by_card("INR")

    db = get_client()
    first_of_month = today_sgt.date().replace(day=1).isoformat()
    today_str = today_sgt.date().isoformat()

    def cat_totals(currency: str) -> dict[str, float]:
        rows = (
            db.table("transactions")
            .select("category, amount")
            .eq("currency", currency)
            .gte("txn_date", first_of_month)
            .lte("txn_date", today_str)
            .execute()
            .data
        )
        totals: dict[str, float] = {}
        for r in rows:
            totals[r["category"]] = totals.get(r["category"], 0.0) + r["amount"]
        return totals

    def fmt_cats(totals: dict[str, float], sym: str) -> str:
        return "\n".join(
            f"  {cat}: {sym}{v:.2f}"
            for cat, v in sorted(totals.items(), key=lambda x: x[1], reverse=True)
        ) or "  (no transactions)"

    lines = [f"Month-to-date — {month_label}", ""]
    lines.append(f"SGD total: S${sgd_mtd:.2f}")
    lines.append(fmt_cats(cat_totals("SGD"), "S$"))
    lines.append("")
    lines.append(f"INR total: ₹{inr_mtd:.2f}")
    if inr_by_card:
        lines.append(f"  Wise: S${inr_by_card.get('wise', 0):.2f}  Scapia: ₹{inr_by_card.get('scapia', 0):.2f}  Axis: ₹{inr_by_card.get('axis', 0):.2f}")
    lines.append(fmt_cats(cat_totals("INR"), "₹"))

    send(chat_id, "\n".join(lines))


def handle_last(chat_id: str | int, n: int) -> None:
    txns = get_last_n_transactions(n)
    if not txns:
        send(chat_id, "No transactions found.")
        return
    lines = [f"🧾 Last {len(txns)} transactions", ""]
    for t in txns:
        cat_icon = CAT_EMOJI.get(t["category"], "·")
        card_icon = CARD_EMOJI.get(t["card"], "💳")
        tag = f" #{t['user_tag']}" if t.get("user_tag") else ""
        lines.append(f"{card_icon} {t['txn_date']} · {t['merchant'] or 'Unknown'} · {fmt_amount(t['amount'], t['currency'])} {cat_icon}{tag}")
    send(chat_id, "\n".join(lines))


def handle_digest(chat_id: str | int) -> None:
    """Manually trigger today's digest."""
    import subprocess
    send(chat_id, "Building your digest...")
    result = subprocess.run(
        [sys.executable, "daily_digest.py"],
        capture_output=True, text=True, cwd="/app"
    )
    if result.returncode != 0:
        log.error("Digest failed: %s", result.stderr)
        send(chat_id, "Digest failed. Check logs.")


def handle_dashboard(chat_id: str | int) -> None:
    url = os.environ.get("DASHBOARD_URL", "")
    if url:
        send(chat_id, f"📊 Dashboard: {url}")
    else:
        send(chat_id, "Dashboard URL not configured.")


def handle_scan(chat_id: str | int) -> None:
    """Force an immediate rescan of all Gmail labels (runs in background thread)."""
    import subprocess, json, threading

    def _run() -> None:
        try:
            result = subprocess.run(
                [sys.executable, "scan_once.py"],
                capture_output=True, text=True, cwd="/app", timeout=900,
            )
        except subprocess.TimeoutExpired:
            log.error("Scan timed out after 900s")
            send(chat_id, "Scan timed out — Gmail was slow to respond. Try /scan again shortly.")
            return
        if result.returncode != 0:
            log.error("Scan failed: %s", result.stderr)
            send(chat_id, "Scan failed. Check logs.")
            return
        try:
            data = json.loads(result.stdout.strip().splitlines()[-1])
            total = data.get("total", 0)
            skipped = data.get("skipped", 0)
            if total == 0 and not skipped:
                send(chat_id, "Scan complete — no new transactions found.")
            else:
                lines = [f"Scan complete — {total} new transaction(s) found:"]
                for c in data.get("cards", []):
                    if c.get("saved"):
                        lines.append(f"  {c['card'].upper()}: {c['saved']} new")
                if skipped:
                    lines.append(f"⚠️ {skipped} email(s) skipped (fetch/parse issue) — will retry next scan.")
                send(chat_id, "\n".join(lines))
        except Exception:
            send(chat_id, "Scan complete.")

    send(chat_id, "Scanning last 7 days across all labels...")
    threading.Thread(target=_run, daemon=True).start()


def _extract_tag(text: str) -> str:
    """Extract bare tag from natural language: 'tag it as grocery' → 'grocery'."""
    t = text.strip().lower()
    for pattern in [
        r"^tag\s+it\s+as\s+", r"^tag\s+as\s+", r"^it'?s?\s+for\s+",
        r"^this\s+is\s+(for\s+)?", r"^for\s+",
    ]:
        m = re.match(pattern, t)
        if m:
            return t[m.end():].strip()
    return t


def handle_tag_reply(chat_id: str | int, text: str, merchant: str, card: str = "") -> None:
    """Handle user's reply to a 'what was this for?' merchant question."""
    if text.lower() == "skip":
        save_merchant_tag(merchant, "__skip__")
        send(chat_id, "👍 Skipped.")
        return

    if text.lower() == "recurring":
        try:
            mark_exempt(merchant, card)
            send(chat_id, f"🔄 {merchant} marked as recurring — excluded from alerts and spend averages.")
            log.info("Marked %r (%s) as recurring/exempt", merchant, card)
        except Exception as exc:
            log.error("Failed to mark exempt: %s", exc)
            send(chat_id, "Couldn't mark that as recurring, sorry.")
        return

    tag = _extract_tag(text)
    try:
        save_merchant_tag(merchant, tag)
        send(chat_id, f"✅ {merchant} → #{tag}")
        log.info("Tagged merchant %r as %r", merchant, tag)
    except Exception as exc:
        log.error("Failed to save tag: %s", exc)
        send(chat_id, "Couldn't save that tag, sorry.")


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
            if not text:
                continue

            # Extract context from the message being replied to (if any)
            replied_to = msg.get("reply_to_message")
            reply_context = (replied_to.get("text") or "").strip() if replied_to else None

            log.info("Received: %r (reply=%s)", text, bool(reply_context))

            try:
                # Reply to a transaction notification — check for split, then tag
                replied_txn = None
                if replied_to and not text.startswith("/"):
                    replied_txn = get_transaction_by_message_id(replied_to["message_id"])
                    if replied_txn and handle_split_reply(chat_id, text, replied_txn):
                        continue
                    # Short reply directly on a transaction notification → tag that merchant
                    if (replied_txn and replied_txn.get("merchant")
                            and "?" not in text
                            and len(text.split()) <= 4
                            and not text.startswith("/")):
                        handle_tag_reply(chat_id, text, replied_txn["merchant"], replied_txn.get("card", ""))
                        continue

                if text.startswith("/today"):
                    handle_today(chat_id)
                elif text.startswith("/mtd"):
                    handle_mtd(chat_id)
                elif text.startswith("/last"):
                    parts = text.split()
                    n = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 10
                    handle_last(chat_id, n)
                elif text.startswith("/digest"):
                    handle_digest(chat_id)
                elif text.startswith("/weekly"):
                    import subprocess as _sp
                    send(chat_id, "Building weekly review...")
                    _sp.Popen([sys.executable, "weekly_review.py"], cwd="/app")
                elif text.startswith("/dashboard"):
                    handle_dashboard(chat_id)
                elif text.startswith("/scan"):
                    handle_scan(chat_id)
                elif text.startswith("/runway"):
                    handle_runway(chat_id)
                elif text.startswith("/waste"):
                    handle_waste(chat_id)
                elif text.startswith("/budget"):
                    handle_budget_list(chat_id)
                elif not text.startswith("/") and _is_split_intent(text):
                    if not handle_free_text_split(chat_id, text):
                        handle_chat(chat_id, text, reply_context=reply_context)
                elif not text.startswith("/") and _is_tag_intent(text):
                    result = _parse_tag_intent(text)
                    if result:
                        merchant, tag = result
                        save_merchant_tag(merchant, tag)
                        send(chat_id, f"✅ {merchant} → #{tag}\nAll past transactions updated.")
                    else:
                        handle_chat(chat_id, text, reply_context=reply_context)
                elif not text.startswith("/") and _is_budget_intent(text):
                    if not handle_set_budget(chat_id, text):
                        handle_chat(chat_id, text, reply_context=reply_context)
                elif not text.startswith("/") and "?" not in text and len(text.split()) <= 4:
                    # Short non-question — could be a tag response
                    pending = get_pending_tag()
                    if pending:
                        merchant, card = pending
                        handle_tag_reply(chat_id, text, merchant, card)
                    else:
                        handle_chat(chat_id, text, reply_context=reply_context)
                else:
                    handle_chat(chat_id, text, reply_context=reply_context)
            except Exception as exc:
                log.error("Error handling %r: %s", text, exc)
                send(chat_id, "⚠️ Something went wrong. Try again in a moment.")


if __name__ == "__main__":
    main()
