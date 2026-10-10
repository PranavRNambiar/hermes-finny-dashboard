"""Supabase client and all DB queries for Finny."""

import os
import re
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from supabase import create_client, Client

SGT = timezone(timedelta(hours=8))


def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


# ── cards ────────────────────────────────────────────────────

# Env-var fallback used when the cards table is missing or empty
_ENV_CARDS = [
    ("GMAIL_LABEL_WISE",   "wise",   "SGD"),
    ("GMAIL_LABEL_SCAPIA", "scapia", "INR"),
    ("GMAIL_LABEL_AXIS",   "axis",   "INR"),
    ("GMAIL_LABEL_IXIGO",  "ixigo",  "INR"),
    ("GMAIL_LABEL_DBS",    "dbs",    "SGD"),
    ("GMAIL_LABEL_OCBC",   "ocbc",   "SGD"),
]


def get_active_cards() -> list[dict]:
    """Active cards as [{card, label, currency}]. Reads the cards table
    (managed from the dashboard); falls back to GMAIL_LABEL_* env vars."""
    try:
        db = get_client()
        rows = (
            db.table("cards")
            .select("card, label, currency")
            .eq("active", True)
            .order("created_at")
            .execute()
            .data
        )
        if rows:
            return rows
    except Exception:
        pass
    return [
        {"card": card, "label": os.environ[env], "currency": currency}
        for env, card, currency in _ENV_CARDS
        if os.environ.get(env)
    ]


def add_card(card: str, label: str, currency: str) -> None:
    db = get_client()
    db.table("cards").upsert({"card": card, "label": label, "currency": currency, "active": True}).execute()


# ── scan_requests ────────────────────────────────────────────

def claim_next_scan_request() -> dict | None:
    """Oldest pending scan request, marked running. None if queue is empty."""
    db = get_client()
    rows = (
        db.table("scan_requests")
        .select("*")
        .eq("status", "pending")
        .order("id")
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None
    req = rows[0]
    db.table("scan_requests").update({"status": "running"}).eq("id", req["id"]).execute()
    return req


def complete_scan_request(request_id: int, result: dict, error: str | None = None) -> None:
    db = get_client()
    db.table("scan_requests").update({
        "status": "error" if error else "done",
        "result": {**result, **({"error": error} if error else {})},
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", request_id).execute()


# ── processed_emails ────────────────────────────────────────

def is_processed(email_id: str) -> bool:
    db = get_client()
    result = db.table("processed_emails").select("email_id, parse_failed, processed_at").eq("email_id", email_id).execute()
    if not result.data:
        return False
    row = result.data[0]
    # Retry recent parse failures (within 24h) — handles transient LLM errors
    if row["parse_failed"]:
        from datetime import datetime, timezone, timedelta
        failed_at = datetime.fromisoformat(row["processed_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - failed_at < timedelta(hours=24):
            return False  # trigger retry
    return True


def processed_to_skip(email_ids: list[str]) -> set[str]:
    """Batched version of is_processed(): given many email_ids, return the subset
    that should be SKIPPED (already processed), applying the same 24h parse-failure
    retry rule. One query per 100 ids instead of one per email — avoids hammering
    the DB when the watcher re-scans a large backlog every cycle."""
    from datetime import datetime, timezone, timedelta
    if not email_ids:
        return set()
    db = get_client()
    now = datetime.now(timezone.utc)
    skip: set[str] = set()
    ids = list(dict.fromkeys(email_ids))  # dedupe, preserve order
    for i in range(0, len(ids), 100):     # chunk to keep the `in` filter / URL bounded
        chunk = ids[i:i + 100]
        rows = db.table("processed_emails").select(
            "email_id, parse_failed, processed_at").in_("email_id", chunk).execute().data
        for row in rows:
            if row["parse_failed"]:
                failed_at = datetime.fromisoformat(row["processed_at"].replace("Z", "+00:00"))
                if now - failed_at < timedelta(hours=24):
                    continue  # within retry window — don't skip
            skip.add(row["email_id"])
    return skip


def mark_processed(email_id: str, parse_failed: bool = False) -> None:
    db = get_client()
    db.table("processed_emails").upsert({
        "email_id": email_id,
        "parse_failed": parse_failed,
    }).execute()


# ── transactions ─────────────────────────────────────────────

def insert_transaction(txn: dict) -> None:
    """Insert a parsed transaction. Uses upsert to handle parse_failed retries safely."""
    db = get_client()
    db.table("transactions").upsert(txn).execute()


# ── incoming money ───────────────────────────────────────────
# Kept in its own table so nothing that sums `transactions` (dashboard, digests,
# anomaly checks, recurring patterns) can mistake money received for spending.

def insert_incoming(row: dict) -> str:
    """Insert one incoming-money row. Returns the kind actually stored: a kind the
    owner set for this sender (incoming_rules) wins over the parser's guess."""
    db = get_client()
    try:
        rule = db.table("incoming_rules").select("kind").eq("counterparty", row.get("counterparty") or "").limit(1).execute()
        if rule.data:
            row["kind"] = rule.data[0]["kind"]
    except Exception:
        pass  # rules table optional
    db.table("incoming").upsert(row).execute()
    return row["kind"]


# ── merchant_tags ────────────────────────────────────────────

def get_merchant_tag(merchant: str) -> str | None:
    """Return the user-assigned tag for a merchant, or None if unknown/pending."""
    db = get_client()
    result = (
        db.table("merchant_tags")
        .select("user_tag")
        .eq("merchant", merchant)
        .limit(1)
        .execute()
    )
    tag = result.data[0]["user_tag"] if result.data else None
    # Don't propagate internal state tags to individual transactions
    if not tag or tag.startswith("__"):
        return None
    return tag


def save_merchant_tag(merchant: str, tag: str) -> None:
    """Upsert a merchant → tag mapping and backfill all existing transactions."""
    db = get_client()
    db.table("merchant_tags").upsert({"merchant": merchant, "user_tag": tag}).execute()
    db.table("transactions").update({"user_tag": tag}).eq("merchant", merchant).execute()


def set_pending_tag(merchant: str, card: str = "") -> None:
    """Mark a merchant as awaiting a user tag. Stores card so 'recurring' reply can exempt correctly."""
    import time
    db = get_client()
    db.table("merchant_tags").upsert({"merchant": merchant, "user_tag": f"__pending__:{card}:{int(time.time())}"}).execute()


def get_pending_tag(max_age_seconds: int = 3600) -> tuple[str, str] | None:
    """Return (merchant, card) most recently awaiting a tag, or None if stale/absent."""
    import time
    db = get_client()
    result = (
        db.table("merchant_tags")
        .select("merchant, user_tag")
        .like("user_tag", "__pending__%")
        .execute()
    )
    if not result.data:
        return None
    # Find the most recent pending by parsing the timestamp out of user_tag
    best: tuple[str, str] | None = None
    best_ts = 0
    for row in result.data:
        parts = row["user_tag"].split(":")
        if len(parts) != 3:
            continue
        _, card, ts_str = parts
        try:
            ts = int(ts_str)
        except ValueError:
            continue
        if time.time() - ts > max_age_seconds:
            continue
        if ts > best_ts:
            best_ts = ts
            best = (row["merchant"], card)
    return best


def mark_exempt(merchant: str, card: str) -> None:
    """Manually mark a merchant as a recurring/exempt payment — excluded from spend averages and alerts."""
    db = get_client()
    today = datetime.now(SGT).date().isoformat()
    existing = (
        db.table("recurring_patterns")
        .select("id, occurrences")
        .eq("merchant", merchant)
        .eq("card", card)
        .limit(1)
        .execute()
    )
    if existing.data:
        db.table("recurring_patterns").update({
            "is_exempt": True,
            "occurrences": max(existing.data[0]["occurrences"], 2),
        }).eq("id", existing.data[0]["id"]).execute()
    else:
        db.table("recurring_patterns").insert({
            "merchant": merchant,
            "card": card,
            "amount_min": 0,
            "amount_max": 9999999,
            "occurrences": 2,
            "is_exempt": True,
            "last_seen": today,
        }).execute()


def get_transactions(
    *,
    card: Optional[str] = None,
    currency: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    category: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Returns paginated transactions. Currency is never mixed implicitly."""
    db = get_client()
    query = db.table("transactions").select("*", count="exact")

    if card:
        query = query.eq("card", card)
    if currency:
        # Enforce: only return rows for the requested currency
        query = query.eq("currency", currency)
    if from_date:
        query = query.gte("txn_date", from_date)
    if to_date:
        query = query.lte("txn_date", to_date)
    if category:
        query = query.eq("category", category)

    offset = (page - 1) * limit
    result = query.order("txn_date", desc=True).range(offset, offset + limit - 1).execute()
    return {"transactions": result.data, "total": result.count, "page": page}


def get_transactions_for_date(report_date: str) -> list[dict]:
    """All transactions for a given date (SGT). Returns both currencies."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("*")
        .eq("txn_date", report_date)
        .order("txn_time", desc=False)
        .execute()
    )
    return result.data


def get_transactions_for_window(window_start: datetime, window_end: datetime) -> list[dict]:
    """Transactions ingested within [window_start, window_end) UTC. Used by the daily digest
    so that the 22:30 SGT cutoff is respected: anything polled after 22:30 rolls into tomorrow."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("*")
        .gte("ingested_at", window_start.isoformat())
        .lt("ingested_at", window_end.isoformat())
        .order("amount", desc=True)
        .execute()
    )
    return result.data


def get_mtd_by_category(currency: str) -> dict[str, float]:
    """Current month-to-date spend by category."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    result = (
        db.table("transactions")
        .select("category, amount")
        .eq("currency", currency)
        .gte("txn_date", today_sgt.replace(day=1).isoformat())
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        totals[row["category"]] = totals.get(row["category"], 0.0) + row["amount"]
    return totals


def get_mtd_by_tag(currency: str) -> dict[str, float]:
    """Current month-to-date spend grouped by user_tag. Internal tags (__pending__, __skip__) count as untagged."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    result = (
        db.table("transactions")
        .select("user_tag, amount")
        .eq("currency", currency)
        .gte("txn_date", today_sgt.replace(day=1).isoformat())
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        raw = row.get("user_tag") or ""
        tag = "(untagged)" if (not raw or raw.startswith("__")) else raw
        totals[tag] = totals.get(tag, 0.0) + row["amount"]
    return totals


def get_last_month_total(currency: str) -> float:
    """Total spend for last calendar month."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    first_this = today_sgt.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    first_prev = last_prev.replace(day=1)
    result = (
        db.table("transactions")
        .select("amount")
        .eq("currency", currency)
        .gte("txn_date", first_prev.isoformat())
        .lte("txn_date", last_prev.isoformat())
        .execute()
    )
    return sum(row["amount"] for row in result.data)


def get_last_month_by_category(currency: str) -> dict[str, float]:
    """Last calendar month spend by category."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    first_this = today_sgt.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    first_prev = last_prev.replace(day=1)
    result = (
        db.table("transactions")
        .select("category, amount")
        .eq("currency", currency)
        .gte("txn_date", first_prev.isoformat())
        .lte("txn_date", last_prev.isoformat())
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        totals[row["category"]] = totals.get(row["category"], 0.0) + row["amount"]
    return totals


def get_top_merchants_mtd(currency: str, n: int = 5) -> list[tuple[str, float]]:
    """Top N merchants by spend MTD."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    result = (
        db.table("transactions")
        .select("merchant, amount")
        .eq("currency", currency)
        .gte("txn_date", today_sgt.replace(day=1).isoformat())
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        m = row["merchant"] or "Unknown"
        totals[m] = totals.get(m, 0.0) + row["amount"]
    return sorted(totals.items(), key=lambda x: x[1], reverse=True)[:n]


def get_frequent_merchants(currency: str, lookback_days: int = 30, min_occurrences: int = 3) -> list[dict]:
    """Merchants visited ≥ min_occurrences times in lookback_days. Returns habit-level spend stats."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=lookback_days)).isoformat()
    result = (
        db.table("transactions")
        .select("merchant, amount, txn_date, user_tag")
        .eq("currency", currency)
        .gte("txn_date", from_date)
        .execute()
    )
    by_merchant: dict[str, list] = {}
    for row in result.data:
        m = row["merchant"] or "Unknown"
        by_merchant.setdefault(m, []).append(row)

    habits = []
    for merchant, txns in by_merchant.items():
        if len(txns) < min_occurrences:
            continue
        total = sum(t["amount"] for t in txns)
        weekly_avg = total / (lookback_days / 7)
        tags = {t["user_tag"] for t in txns if t.get("user_tag")}
        habits.append({
            "merchant": merchant,
            "occurrences": len(txns),
            "total": total,
            "avg_per_visit": total / len(txns),
            "weekly_avg": weekly_avg,
            "tag": next(iter(tags), None),
        })
    return sorted(habits, key=lambda x: x["total"], reverse=True)


def get_subscription_candidates(currency: str, lookback_days: int = 120) -> list[dict]:
    """Merchants with monthly/quarterly cadence (25–95 day avg gap) and stable amount (≤15% variance)."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=lookback_days)).isoformat()
    result = (
        db.table("transactions")
        .select("merchant, amount, txn_date")
        .eq("currency", currency)
        .gte("txn_date", from_date)
        .order("txn_date", desc=False)
        .execute()
    )
    by_merchant: dict[str, list] = {}
    for row in result.data:
        m = row["merchant"] or "Unknown"
        by_merchant.setdefault(m, []).append(row)

    subscriptions = []
    for merchant, txns in by_merchant.items():
        if len(txns) < 2:
            continue
        amounts = [t["amount"] for t in txns]
        avg_amount = sum(amounts) / len(amounts)
        if avg_amount == 0:
            continue
        max_dev = max(abs(a - avg_amount) / avg_amount for a in amounts)
        if max_dev > 0.15:
            continue  # amount too variable — not a subscription

        dates = sorted(date.fromisoformat(t["txn_date"]) for t in txns)
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        avg_gap = sum(gaps) / len(gaps)
        if not (25 <= avg_gap <= 95):
            continue  # not monthly/quarterly cadence

        subscriptions.append({
            "merchant": merchant,
            "amount": avg_amount,
            "avg_gap_days": int(avg_gap),
            "occurrences": len(txns),
        })
    return sorted(subscriptions, key=lambda x: x["amount"], reverse=True)


def get_week_totals(week_start: str, week_end: str, currency: str) -> dict[str, float]:
    """Daily totals for a date range by currency."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("txn_date, amount")
        .eq("currency", currency)
        .gte("txn_date", week_start)
        .lte("txn_date", week_end)
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        d = row["txn_date"]
        totals[d] = totals.get(d, 0.0) + row["amount"]
    return totals


def get_daily_totals_last_30(currency: str) -> list[dict]:
    """Daily spend totals for the last 30 days for one currency."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=30)).isoformat()
    result = (
        db.table("transactions")
        .select("txn_date, amount")
        .eq("currency", currency)  # currency always filtered explicitly
        .gte("txn_date", from_date)
        .execute()
    )
    # Aggregate by date
    totals: dict[str, float] = {}
    for row in result.data:
        d = row["txn_date"]
        totals[d] = totals.get(d, 0.0) + row["amount"]
    return [{"date": d, "total": t} for d, t in sorted(totals.items())]


def get_mtd_total(currency: str) -> float:
    """Month-to-date total for one currency."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    first_of_month = today_sgt.replace(day=1).isoformat()
    result = (
        db.table("transactions")
        .select("amount")
        .eq("currency", currency)  # currency always filtered explicitly
        .gte("txn_date", first_of_month)
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    return sum(row["amount"] for row in result.data)


def get_mtd_by_card(currency: str) -> dict[str, float]:
    """MTD total broken down by card for one currency."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    first_of_month = today_sgt.replace(day=1).isoformat()
    result = (
        db.table("transactions")
        .select("card, amount")
        .eq("currency", currency)
        .gte("txn_date", first_of_month)
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    totals: dict[str, float] = {}
    for row in result.data:
        totals[row["card"]] = totals.get(row["card"], 0.0) + row["amount"]
    return totals


def get_wtd_total(currency: str) -> float:
    """Week-to-date total (Monday → today) for one currency."""
    db = get_client()
    from datetime import timedelta
    today_sgt = datetime.now(SGT).date()
    monday = today_sgt - timedelta(days=today_sgt.weekday())  # weekday() == 0 on Monday
    result = (
        db.table("transactions")
        .select("amount")
        .eq("currency", currency)
        .gte("txn_date", monday.isoformat())
        .lte("txn_date", today_sgt.isoformat())
        .execute()
    )
    return sum(row["amount"] for row in result.data)


def get_30d_avg(currency: str, exclude_date: str) -> float:
    """Average daily spend over past 30 days, excluding a specific date and exempt (recurring) merchants."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=30)).isoformat()
    result = (
        db.table("transactions")
        .select("txn_date, amount, merchant, card")
        .eq("currency", currency)
        .gte("txn_date", from_date)
        .neq("txn_date", exclude_date)
        .execute()
    )
    exempt = get_exempt_merchants()
    daily: dict[str, float] = {}
    for row in result.data:
        if (row.get("merchant") or "", row.get("card") or "") in exempt:
            continue
        d = row["txn_date"]
        daily[d] = daily.get(d, 0.0) + row["amount"]
    if not daily:
        return 0.0
    return sum(daily.values()) / len(daily)


def get_last_transaction_by_card(card: str) -> dict | None:
    """The single most recent transaction for a specific card."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("*")
        .eq("card", card)
        .order("txn_date", desc=True)
        .order("ingested_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def get_last_n_transactions(n: int = 10) -> list[dict]:
    """Last N transactions across all cards/currencies, ordered by date then time."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("*")
        .order("txn_date", desc=True)
        .order("txn_time", desc=True)
        .order("ingested_at", desc=True)
        .limit(n)
        .execute()
    )
    return result.data


# ── budgets ──────────────────────────────────────────────────

def save_budget(period_type: str, period: str, currency: str, amount: float, category: str | None = None) -> None:
    """Upsert a budget. period_type='day' + period='YYYY-MM-DD', or 'month' + 'YYYY-MM'."""
    db = get_client()
    db.table("budgets").upsert({
        "period_type": period_type,
        "period": period,
        "currency": currency,
        "category": category,
        "amount": amount,
    }, on_conflict="period_type,period,currency,category").execute()


def get_budget(period_type: str, period: str, currency: str, category: str | None = None) -> float | None:
    """Return budget amount for a period/currency, or None if not set."""
    db = get_client()
    query = (
        db.table("budgets")
        .select("amount")
        .eq("period_type", period_type)
        .eq("period", period)
        .eq("currency", currency)
    )
    query = query.is_("category", "null") if category is None else query.eq("category", category)
    result = query.limit(1).execute()
    return result.data[0]["amount"] if result.data else None


def list_budgets() -> list[dict]:
    """All budgets ordered by period desc."""
    db = get_client()
    result = (
        db.table("budgets")
        .select("*")
        .order("period", desc=True)
        .execute()
    )
    return result.data


def delete_budget(period_type: str, period: str, currency: str, category: str | None = None) -> None:
    db = get_client()
    query = (
        db.table("budgets")
        .delete()
        .eq("period_type", period_type)
        .eq("period", period)
        .eq("currency", currency)
    )
    query = query.is_("category", "null") if category is None else query.eq("category", category)
    query.execute()


def get_parse_failures() -> list[dict]:
    """Emails that failed parsing — for dashboard review."""
    db = get_client()
    result = (
        db.table("processed_emails")
        .select("*")
        .eq("parse_failed", True)
        .order("processed_at", desc=True)
        .execute()
    )
    return result.data


# ── recurring_patterns ───────────────────────────────────────

def update_recurring_patterns(merchant: str, card: str, amount: float) -> None:
    """Upsert recurring pattern for a merchant+card. Sets is_exempt when occurrences >= 2."""
    db = get_client()
    amount_min = amount * 0.95
    amount_max = amount * 1.05
    today = datetime.now(SGT).date().isoformat()

    # Look for existing pattern in the ±5% band
    result = (
        db.table("recurring_patterns")
        .select("*")
        .eq("merchant", merchant)
        .eq("card", card)
        .lte("amount_min", amount)
        .gte("amount_max", amount)
        .execute()
    )

    if result.data:
        pattern = result.data[0]
        new_occurrences = pattern["occurrences"] + 1
        db.table("recurring_patterns").update({
            "occurrences": new_occurrences,
            "is_exempt": new_occurrences >= 2,
            "last_seen": today,
        }).eq("id", pattern["id"]).execute()
    else:
        db.table("recurring_patterns").insert({
            "merchant": merchant,
            "card": card,
            "amount_min": amount_min,
            "amount_max": amount_max,
            "occurrences": 1,
            "is_exempt": False,
            "last_seen": today,
        }).execute()


def get_exempt_merchants() -> set[tuple[str, str]]:
    """Returns set of (merchant, card) pairs that are exempt from anomaly flagging."""
    db = get_client()
    result = (
        db.table("recurring_patterns")
        .select("merchant, card")
        .eq("is_exempt", True)
        .execute()
    )
    return {(row["merchant"], row["card"]) for row in result.data}


def flag_transaction_anomaly(txn_id: str) -> None:
    db = get_client()
    db.table("transactions").update({"anomaly_flagged": True}).eq("id", txn_id).execute()


# ── bill splitting ───────────────────────────────────────────

def _normalize_person_name(name: str) -> str:
    """Collapse whitespace and trim, so 'Rutuja ' and 'Rutuja  Sharma' match
    their canonical forms regardless of stray spacing from chat input."""
    return re.sub(r"\s+", " ", name).strip()


def get_or_create_person(name: str) -> int:
    """Find an existing person by name or alias (case- and whitespace-insensitive), or create one."""
    db = get_client()
    normalized = _normalize_person_name(name)
    key = normalized.lower()
    result = db.table("people").select("id, name, aliases").execute()
    for row in result.data:
        if _normalize_person_name(row["name"]).lower() == key:
            return row["id"]
        if any(_normalize_person_name(a).lower() == key for a in (row.get("aliases") or [])):
            return row["id"]
    inserted = db.table("people").insert({"name": normalized}).execute()
    return inserted.data[0]["id"]


def list_people() -> list[dict]:
    """All known people — used as LLM context for matching names in split replies."""
    db = get_client()
    result = db.table("people").select("id, name, aliases").order("name").execute()
    return result.data


def save_transaction_message(transaction_id: str, telegram_message_id: int) -> None:
    """Record which Telegram message announced a transaction, so replies can be matched back to it."""
    db = get_client()
    db.table("transaction_messages").upsert({
        "transaction_id": transaction_id,
        "telegram_message_id": telegram_message_id,
    }).execute()


def get_transaction_by_message_id(telegram_message_id: int) -> dict | None:
    """Returns the transaction a Telegram message announced, or None if it wasn't a transaction message."""
    db = get_client()
    mapping = (
        db.table("transaction_messages")
        .select("transaction_id")
        .eq("telegram_message_id", telegram_message_id)
        .limit(1)
        .execute()
    )
    if not mapping.data:
        return None
    txn = (
        db.table("transactions")
        .select("*")
        .eq("id", mapping.data[0]["transaction_id"])
        .limit(1)
        .execute()
    )
    return txn.data[0] if txn.data else None


def create_splits(transaction_id: str, currency: str, splits: list[dict]) -> None:
    """Replace any existing splits for this transaction.
    splits = [{"person_id": int, "share_amount": float}, ...]"""
    db = get_client()
    db.table("transaction_splits").delete().eq("transaction_id", transaction_id).execute()
    if not splits:
        return
    rows = [
        {
            "transaction_id": transaction_id,
            "person_id": s["person_id"],
            "currency": currency,
            "share_amount": s["share_amount"],
        }
        for s in splits
    ]
    db.table("transaction_splits").insert(rows).execute()


def get_outstanding_splits() -> list[dict]:
    """Pending splits grouped by (person, currency) — total owed + transaction count."""
    db = get_client()
    result = (
        db.table("transaction_splits")
        .select("person_id, currency, share_amount, people(name)")
        .eq("status", "pending")
        .execute()
    )
    totals: dict[tuple[int, str], dict] = {}
    for row in result.data:
        key = (row["person_id"], row["currency"])
        if key not in totals:
            totals[key] = {
                "person_id": row["person_id"],
                "name": row["people"]["name"],
                "currency": row["currency"],
                "total": 0.0,
                "count": 0,
            }
        totals[key]["total"] += row["share_amount"]
        totals[key]["count"] += 1
    return sorted(totals.values(), key=lambda x: (x["currency"], -x["total"]))


def get_splits_for_person(name: str) -> list[dict]:
    """Pending splits for one person (case- and whitespace-insensitive name match), with transaction details."""
    db = get_client()
    person = db.table("people").select("id, name").ilike("name", _normalize_person_name(name)).limit(1).execute()
    if not person.data:
        return []
    result = (
        db.table("transaction_splits")
        .select("id, share_amount, currency, transaction_id, transactions(merchant, txn_date, amount)")
        .eq("person_id", person.data[0]["id"])
        .eq("status", "pending")
        .execute()
    )
    return result.data


def settle_splits_for_person(name: str, currency: str | None = None) -> dict[str, dict]:
    """Mark a person's pending splits as settled. Returns {currency: {"count": int, "total": float}} —
    SGD and INR are reported separately, never summed."""
    db = get_client()
    person = db.table("people").select("id").ilike("name", _normalize_person_name(name)).limit(1).execute()
    if not person.data:
        return {}

    query = (
        db.table("transaction_splits")
        .select("id, share_amount, currency")
        .eq("person_id", person.data[0]["id"])
        .eq("status", "pending")
    )
    if currency:
        query = query.eq("currency", currency)
    pending = query.execute()
    if not pending.data:
        return {}

    by_currency: dict[str, dict] = {}
    for row in pending.data:
        c = row["currency"]
        bucket = by_currency.setdefault(c, {"count": 0, "total": 0.0, "ids": []})
        bucket["count"] += 1
        bucket["total"] += row["share_amount"]
        bucket["ids"].append(row["id"])

    all_ids = [i for bucket in by_currency.values() for i in bucket["ids"]]
    now = datetime.now(timezone.utc).isoformat()
    db.table("transaction_splits").update({"status": "settled", "settled_at": now}).in_("id", all_ids).execute()

    return {c: {"count": v["count"], "total": v["total"]} for c, v in by_currency.items()}


def settle_split(split_id: int) -> None:
    """Mark a single split as settled (used by the dashboard 'mark settled' button)."""
    db = get_client()
    now = datetime.now(timezone.utc).isoformat()
    db.table("transaction_splits").update({"status": "settled", "settled_at": now}).eq("id", split_id).execute()


# ── Divide integration (Manny) ───────────────────────────────

def get_divide_session() -> dict | None:
    """Return the stored Divide auth session (single row), or None if never logged in."""
    db = get_client()
    result = db.table("divide_session").select("*").eq("id", 1).limit(1).execute()
    return result.data[0] if result.data else None


def save_divide_session(
    user_id: str,
    phone: str,
    access_token: str,
    refresh_token: str,
    expires_at: str,
) -> None:
    """Upsert the singleton Divide auth session."""
    db = get_client()
    db.table("divide_session").upsert({
        "id": 1,
        "user_id": user_id,
        "phone": phone,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def update_divide_tokens(access_token: str, refresh_token: str, expires_at: str) -> None:
    """Persist a refreshed token pair without touching user_id/phone."""
    db = get_client()
    db.table("divide_session").update({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", 1).execute()


def link_person_to_divide(person_id: int, divide_user_id: str, divide_group_id: str | None) -> None:
    """Map a local person to their Divide user/group so settlements can be synced."""
    db = get_client()
    db.table("people").update({
        "divide_user_id": divide_user_id,
        "divide_group_id": divide_group_id,
    }).eq("id", person_id).execute()


def get_person(person_id: int) -> dict | None:
    """Fetch a single person row (incl. divide_user_id/divide_group_id)."""
    db = get_client()
    result = db.table("people").select("*").eq("id", person_id).limit(1).execute()
    return result.data[0] if result.data else None


def count_linked_people() -> int:
    """How many people have a Divide user id linked."""
    db = get_client()
    result = db.table("people").select("id", count="exact").not_.is_("divide_user_id", "null").execute()
    return result.count or 0


def mark_split_synced(split_id: int, external_ref: str) -> None:
    """Record the Divide transaction id a settled split was synced to."""
    db = get_client()
    db.table("transaction_splits").update({"external_ref": external_ref}).eq("id", split_id).execute()


def get_transaction_split_person_count(transaction_id: str) -> int:
    """Return how many distinct people have splits for a given Finny transaction."""
    db = get_client()
    result = (
        db.table("transaction_splits")
        .select("person_id")
        .eq("transaction_id", transaction_id)
        .execute()
    )
    return len({r["person_id"] for r in (result.data or [])})


def get_pending_splits_for_person(person_id: int) -> list[dict]:
    """Pending splits for a person with full transaction details, used to push to Divide."""
    db = get_client()
    result = (
        db.table("transaction_splits")
        .select("id, share_amount, currency, transaction_id, external_ref, "
                "transactions(merchant, txn_date, amount, category)")
        .eq("person_id", person_id)
        .eq("status", "pending")
        .order("id")
        .execute()
    )
    rows = []
    for r in result.data:
        txn = r.get("transactions") or {}
        rows.append({
            "id": r["id"],
            "share_amount": r["share_amount"],
            "currency": r["currency"],
            "transaction_id": r["transaction_id"],
            "external_ref": r.get("external_ref"),
            "merchant": txn.get("merchant") or "Bill",
            "txn_date": txn.get("txn_date"),
            "amount": txn.get("amount"),
            "category": txn.get("category"),
        })
    return rows


def get_settled_splits_for_person(name: str, currency: str | None = None) -> list[dict]:
    """Settled splits for a person (most recent first), with transaction details.
    Used to build the Divide settleUp sync after settling locally."""
    db = get_client()
    person = db.table("people").select("id").ilike("name", _normalize_person_name(name)).limit(1).execute()
    if not person.data:
        return []
    query = (
        db.table("transaction_splits")
        .select("id, share_amount, currency, transaction_id, settled_at, external_ref, "
                "transactions(merchant, txn_date, amount)")
        .eq("person_id", person.data[0]["id"])
        .eq("status", "settled")
    )
    if currency:
        query = query.eq("currency", currency)
    return query.order("settled_at", desc=True).execute().data


def get_cash_conversion_stats() -> dict:
    """Cash conversion cycle metrics for personal lending:
    - pending_by_currency: money currently owed to Pranav (still 'out')
    - settled_lifetime_by_currency: total ever collected back
    - avg_days_to_settle: mean (settled_at - created_at) over settled splits (currency-agnostic time metric)
    SGD and INR are reported separately, never summed."""
    db = get_client()
    rows = (
        db.table("transaction_splits")
        .select("currency, share_amount, status, created_at, settled_at")
        .execute()
        .data
    )
    pending: dict[str, float] = {}
    settled: dict[str, float] = {}
    durations: list[float] = []
    pending_count = 0
    settled_count = 0
    for r in rows:
        cur = r["currency"]
        if r["status"] == "pending":
            pending[cur] = pending.get(cur, 0.0) + r["share_amount"]
            pending_count += 1
        elif r["status"] == "settled":
            settled[cur] = settled.get(cur, 0.0) + r["share_amount"]
            settled_count += 1
            if r.get("created_at") and r.get("settled_at"):
                try:
                    c = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                    s = datetime.fromisoformat(r["settled_at"].replace("Z", "+00:00"))
                    durations.append((s - c).total_seconds() / 86400.0)
                except (ValueError, TypeError):
                    pass
    avg_days = sum(durations) / len(durations) if durations else None
    return {
        "pending_by_currency": pending,
        "settled_lifetime_by_currency": settled,
        "avg_days_to_settle": avg_days,
        "pending_count": pending_count,
        "settled_count": settled_count,
    }


def get_settle_speed_by_person() -> list[dict]:
    """Per-person average days-to-settle (over their settled splits) + counts.
    Surfaces who's slow to pay Pranav back. Sorted slowest first."""
    db = get_client()
    rows = (
        db.table("transaction_splits")
        .select("person_id, status, created_at, settled_at, people(name)")
        .eq("status", "settled")
        .execute()
        .data
    )
    by_person: dict[int, dict] = {}
    for r in rows:
        if not (r.get("created_at") and r.get("settled_at")):
            continue
        try:
            c = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
            s = datetime.fromisoformat(r["settled_at"].replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        days = (s - c).total_seconds() / 86400.0
        pid = r["person_id"]
        bucket = by_person.setdefault(pid, {
            "person_id": pid,
            "name": (r.get("people") or {}).get("name", "Unknown"),
            "durations": [],
        })
        bucket["durations"].append(days)
    result = []
    for b in by_person.values():
        ds = b["durations"]
        result.append({
            "person_id": b["person_id"],
            "name": b["name"],
            "avg_days": sum(ds) / len(ds),
            "count": len(ds),
        })
    return sorted(result, key=lambda x: x["avg_days"], reverse=True)
