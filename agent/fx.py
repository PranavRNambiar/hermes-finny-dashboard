"""Foreign-currency spends: find the original amount in the bank email and turn it into the
card's home currency (SGD/INR), which is what every total adds up.

- Wise says what it took: "You spent 22.93 EUR at Uber. This used 33.05 SGD" → amount 33.05.
- DBS card alerts only state the foreign amount ("Amount: EUR21.46"), so we convert at the
  ECB rate for that day plus the card's foreign-transaction fee (DBS: up to 3.25%). The bank's
  final figure can differ by a little; the original amount is kept alongside.
"""
import logging
import re
from functools import lru_cache

import httpx

log = logging.getLogger(__name__)

HOME = ("SGD", "INR")
FX_FEE = {"dbs": 0.0325}   # card → foreign transaction fee charged on top of the rate

_CCY = r"([A-Z]{3})"
_NUM = r"([\d,]+(?:\.\d+)?)"
DBS_FOREIGN = re.compile(r"Amount:\s*" + _CCY + r"\s?" + _NUM)
WISE_SPENT = re.compile(r"spent\s+" + _NUM + r"\s+" + _CCY + r".{0,200}?This used\s+" + _NUM + r"\s+" + _CCY, re.S)
WISE_SPENT_ONLY = re.compile(r"spent\s+" + _NUM + r"\s+" + _CCY)


def _n(s: str) -> float:
    return float(s.replace(",", ""))


@lru_cache(maxsize=512)
def rate(frm: str, to: str, date: str) -> float:
    """ECB reference rate (frankfurter.dev) for `date`, or the last business day before it."""
    r = httpx.get(f"https://api.frankfurter.dev/v1/{date}", params={"from": frm, "to": to}, timeout=15)
    r.raise_for_status()
    return float(r.json()["rates"][to])


def foreign(card: str, home: str, text: str) -> dict | None:
    """The foreign original in an email, plus the home amount if the email states it."""
    flat = re.sub(r"\s+", " ", text or "")
    if card == "wise":
        m = WISE_SPENT.search(flat)
        if m and m.group(2) not in HOME:
            return {"orig_currency": m.group(2), "orig_amount": _n(m.group(1)), "charged": _n(m.group(3)), "charged_currency": m.group(4)}
        m = WISE_SPENT_ONLY.search(flat)
        if m and m.group(2) not in HOME:
            return {"orig_currency": m.group(2), "orig_amount": _n(m.group(1))}
        return None
    m = DBS_FOREIGN.search(flat)
    if m and m.group(1) not in HOME and m.group(1) != home:
        return {"orig_currency": m.group(1), "orig_amount": _n(m.group(2))}
    return None


def apply(parsed: dict, card: str, home: str, text: str) -> dict:
    """If the spend was in a foreign currency, set amount/currency to the home currency and record
    the original. Raises if a needed rate can't be fetched (the email is retried later)."""
    f = foreign(card, home, text)
    if not f:
        return parsed
    date = parsed.get("txn_date")
    if f.get("charged") is not None and f.get("charged_currency") == home:
        amount, fx = f["charged"], f["charged"] / f["orig_amount"]
    elif f.get("charged") is not None:
        r = rate(f["charged_currency"], home, date)
        amount, fx = round(f["charged"] * r, 2), f["charged"] * r / f["orig_amount"]
    else:
        fx = rate(f["orig_currency"], home, date) * (1 + FX_FEE.get(card, 0))
        amount = round(f["orig_amount"] * fx, 2)
    log.info("[FX] %s %s %.2f → %s %.2f", card.upper(), f["orig_currency"], f["orig_amount"], home, amount)
    parsed.update(amount=amount, currency=home, orig_currency=f["orig_currency"], orig_amount=f["orig_amount"], fx_rate=round(fx, 6))
    return parsed
