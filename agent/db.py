"""Supabase client and all DB queries for Finny."""

import os
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from supabase import create_client, Client

SGT = timezone(timedelta(hours=8))


def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


# ── processed_emails ────────────────────────────────────────

def is_processed(email_id: str) -> bool:
    db = get_client()
    result = db.table("processed_emails").select("email_id").eq("email_id", email_id).execute()
    return len(result.data) > 0


def mark_processed(email_id: str, parse_failed: bool = False) -> None:
    db = get_client()
    db.table("processed_emails").insert({
        "email_id": email_id,
        "parse_failed": parse_failed,
    }).execute()


# ── transactions ─────────────────────────────────────────────

def insert_transaction(txn: dict) -> None:
    """Insert a parsed transaction. txn must include all required fields."""
    db = get_client()
    db.table("transactions").insert(txn).execute()


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
        .order("amount", desc=True)
        .execute()
    )
    return result.data


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


def get_30d_avg(currency: str, exclude_date: str) -> float:
    """Average daily spend over past 30 days, excluding a specific date."""
    db = get_client()
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=30)).isoformat()
    result = (
        db.table("transactions")
        .select("txn_date, amount")
        .eq("currency", currency)
        .gte("txn_date", from_date)
        .neq("txn_date", exclude_date)
        .execute()
    )
    daily: dict[str, float] = {}
    for row in result.data:
        d = row["txn_date"]
        daily[d] = daily.get(d, 0.0) + row["amount"]
    if not daily:
        return 0.0
    return sum(daily.values()) / len(daily)


def get_last_n_transactions(n: int = 10) -> list[dict]:
    """Last N transactions across all cards/currencies."""
    db = get_client()
    result = (
        db.table("transactions")
        .select("*")
        .order("txn_date", desc=True)
        .order("ingested_at", desc=True)
        .limit(n)
        .execute()
    )
    return result.data


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
