"""Fix foreign-currency spends saved before fx.py existed (e.g. a DBS "Amount: EUR21.46" stored as S$21.46).

Idempotent:
- converts a row only while its amount still equals the foreign number (i.e. it was never converted)
- fills orig_currency/orig_amount/fx_rate when those columns exist (supabase_fx.sql)
Run on the agent box:  python backfill_fx.py [--dry-run] [--old-fee 0.0325] [--actual "MERCHANT=31.04"]
  --old-fee   also re-convert rows converted earlier with that fee (when the fee estimate changes)
  --actual    set the real home amount the bank charged, e.g. "AIRALO=20.78,ROAMLESS=23.10"
"""
import sys

from db import get_client
from fx import HOME, apply, foreign, rate

DRY = "--dry-run" in sys.argv


def _arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


OLD_FEE = float(_arg("--old-fee")) if _arg("--old-fee") else None
# --actual "AIRALO=20.78,ROAMLESS=23.10": real amounts the bank charged, by merchant
ACTUAL = dict(a.rsplit("=", 1) for a in (_arg("--actual") or "").split(",") if "=" in a)


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
        if has_cols and t.get("orig_currency") and OLD_FEE is None and not ACTUAL:
            continue  # already done
        unconverted = abs(float(t["amount"]) - f["orig_amount"]) < 0.005 and f.get("charged") is None
        parsed = {"amount": t["amount"], "currency": t["currency"], "txn_date": t["txn_date"]}
        apply(parsed, t["card"], home, t.get("raw_desc") or "")
        if OLD_FEE is not None and f.get("charged") is None and not unconverted:
            old = round(f["orig_amount"] * rate(f["orig_currency"], home, t["txn_date"]) * (1 + OLD_FEE), 2)
            unconverted = abs(float(t["amount"]) - old) < 0.015   # converted with the old estimate → redo
        for name, amt in ACTUAL.items():
            if name.lower() in (t["merchant"] or "").lower():
                parsed.update(amount=float(amt), fx_rate=round(float(amt) / f["orig_amount"], 6))
                unconverted = True
        patch = {}
        if unconverted and abs(float(t["amount"]) - parsed["amount"]) >= 0.005:
            patch.update(amount=parsed["amount"], currency=home)
        if has_cols:
            # Keep the stored amount (it may be the real charge you entered); the rate follows from it.
            final = parsed["amount"] if unconverted else float(t["amount"])
            patch.update(orig_currency=parsed["orig_currency"], orig_amount=parsed["orig_amount"],
                         fx_rate=round(final / parsed["orig_amount"], 6))
        if not patch:
            continue
        splits = db.table("transaction_splits").select("id").eq("transaction_id", t["id"]).execute().data
        note = "  (has splits: shares were entered in the old amount — check them)" if splits and unconverted else ""
        head = f"{t['txn_date']} {t['card']:6} {t['merchant'][:28]:28} {f['orig_currency']} {f['orig_amount']:.2f}: "
        what = (f"{t['currency']} {float(t['amount']):.2f} → {home} {patch['amount']:.2f}{note}" if "amount" in patch
                else f"keeps {t['currency']} {float(t['amount']):.2f}, records original + rate {patch.get('fx_rate')}")
        print(head + what)
        if not DRY:
            db.table("transactions").update(patch).eq("id", t["id"]).execute()
        fixed += 1
    print(f"{'would fix' if DRY else 'fixed'} {fixed} row(s); original-amount columns {'present' if has_cols else 'missing — run supabase_fx.sql, then run this again'}")


if __name__ == "__main__":
    main()
