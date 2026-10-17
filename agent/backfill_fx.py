"""Fix foreign-currency spends saved before fx.py existed (e.g. a DBS "Amount: EUR21.46" stored as S$21.46).

Idempotent:
- converts a row only while its amount still equals the foreign number (i.e. it was never converted)
- fills orig_currency/orig_amount/fx_rate when those columns exist (supabase_fx.sql)
Run on the agent box:  python backfill_fx.py [--dry-run]
"""
import sys

from db import get_client
from fx import HOME, apply, foreign

DRY = "--dry-run" in sys.argv


def main() -> None:
    db = get_client()
    cards = {c["card"]: c["currency"] for c in db.table("cards").select("card, currency").execute().data}
    try:
        db.table("transactions").select("orig_currency").limit(1).execute()
        has_cols = True
    except Exception:
        has_cols = False
    rows = []
    for off in range(0, 50000, 1000):
        r = db.table("transactions").select("*").range(off, off + 999).execute().data
        rows += r
        if len(r) < 1000:
            break
    fixed = 0
    for t in rows:
        home = t["currency"] if t["currency"] in HOME else cards.get(t["card"], "SGD")
        f = foreign(t["card"], home, t.get("raw_desc") or "")
        if not f:
            continue
        if has_cols and t.get("orig_currency"):
            continue  # already done
        unconverted = abs(float(t["amount"]) - f["orig_amount"]) < 0.005 and f.get("charged") is None
        parsed = {"amount": t["amount"], "currency": t["currency"], "txn_date": t["txn_date"]}
        apply(parsed, t["card"], home, t.get("raw_desc") or "")
        patch = {}
        if unconverted:
            patch.update(amount=parsed["amount"], currency=home)
        if has_cols:
            patch.update(orig_currency=parsed["orig_currency"], orig_amount=parsed["orig_amount"], fx_rate=parsed["fx_rate"])
        if not patch:
            continue
        splits = db.table("transaction_splits").select("id").eq("transaction_id", t["id"]).execute().data
        note = "  (has splits: shares were entered in the old amount — check them)" if splits and unconverted else ""
        print(f"{t['txn_date']} {t['card']:6} {t['merchant'][:28]:28} {f['orig_currency']} {f['orig_amount']:.2f}: "
              f"{t['currency']} {float(t['amount']):.2f} → {home} {parsed['amount']:.2f}{note}")
        if not DRY:
            db.table("transactions").update(patch).eq("id", t["id"]).execute()
        fixed += 1
    print(f"{'would fix' if DRY else 'fixed'} {fixed} row(s); original-amount columns {'present' if has_cols else 'missing — run supabase_fx.sql, then run this again'}")


if __name__ == "__main__":
    main()
