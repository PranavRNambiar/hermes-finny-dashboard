"""Anomaly detection for Finny. Implements SPEC §9 rules."""

import logging
import statistics
from datetime import datetime, timezone, timedelta
from supabase import Client

from db import get_client, get_exempt_merchants, flag_transaction_anomaly

log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))


def _category_30d_median(db: Client, category: str, currency: str, exclude_date: str) -> float:
    """30-day median transaction amount for a category+currency, excluding report_date."""
    from datetime import datetime
    today_sgt = datetime.now(SGT).date()
    from_date = (today_sgt - timedelta(days=30)).isoformat()

    result = (
        db.table("transactions")
        .select("amount")
        .eq("category", category)
        .eq("currency", currency)
        .gte("txn_date", from_date)
        .neq("txn_date", exclude_date)
        .execute()
    )
    amounts = [row["amount"] for row in result.data]
    if not amounts:
        return 0.0
    return statistics.median(amounts)


def get_anomalies(report_date: str) -> list[dict]:
    """
    Returns list of anomaly dicts for report_date.
    Also flags transactions in the DB (sets anomaly_flagged=TRUE).

    Rules:
    1. Daily spike: daily_total > 30d_avg * 2.0 (per currency)
    2. Transaction spike: txn.amount > category_30d_median * 2.0 AND not exempt
    3. New merchant: first time a merchant appears
    """
    db = get_client()
    exempt = get_exempt_merchants()
    anomalies: list[dict] = []

    # Fetch today's transactions
    result = (
        db.table("transactions")
        .select("*")
        .eq("txn_date", report_date)
        .execute()
    )
    txns = result.data

    # Check daily spike per currency — exclude exempt (recurring) merchants from both total and avg
    for currency in ("SGD", "INR"):
        daily_total = sum(
            t["amount"] for t in txns
            if t["currency"] == currency
            and (t.get("merchant") or "", t.get("card") or "") not in exempt
        )
        if daily_total == 0:
            continue

        # 30-day avg excluding report_date
        from db import get_30d_avg
        avg = get_30d_avg(currency, report_date)
        if avg > 0 and daily_total > avg * 2.0:
            anomalies.append({
                "type": "daily_spike",
                "currency": currency,
                "daily_total": daily_total,
                "avg": avg,
                "reason": f"{currency} daily spend {daily_total:.2f} is {daily_total/avg:.1f}× the 30-day average of {avg:.2f}",
            })

    # Per-transaction checks
    for txn in txns:
        merchant = txn["merchant"] or ""
        card = txn["card"]
        currency = txn["currency"]

        # Check if exempt
        is_exempt = (merchant, card) in exempt
        if is_exempt:
            continue

        # New merchant check
        hist = (
            db.table("transactions")
            .select("id")
            .eq("merchant", merchant)
            .neq("txn_date", report_date)
            .limit(1)
            .execute()
        )
        if not hist.data and merchant:
            anomalies.append({
                "type": "new_merchant",
                "txn_id": txn["id"],
                "merchant": merchant,
                "amount": txn["amount"],
                "currency": currency,
                "reason": f"New merchant: {merchant}",
            })

        # Transaction spike check (non-exempt)
        median = _category_30d_median(db, txn["category"], currency, report_date)
        if median > 0 and txn["amount"] > median * 2.0:
            flag_transaction_anomaly(txn["id"])
            anomalies.append({
                "type": "txn_spike",
                "txn_id": txn["id"],
                "merchant": merchant,
                "amount": txn["amount"],
                "currency": currency,
                "category": txn["category"],
                "median": median,
                "reason": (
                    f"{merchant} charged {currency} {txn['amount']:.2f} — "
                    f"{txn['amount']/median:.1f}× the 30-day {txn['category']} median of {median:.2f}"
                ),
            })

    return anomalies
