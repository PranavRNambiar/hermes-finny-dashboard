"""Email parser via Claude. Extracts transaction fields from raw email bodies."""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from llm import get_client, PARSER_MODEL, cached_system

SGT = timezone(timedelta(hours=8))

log = logging.getLogger(__name__)


class SkipEmail(Exception):
    """Raised when the parser intentionally decides not to process an email."""


# DBS PayLah! sends its own PayNow/QR alerts from this address. These are still
# DBS transactions (same card/label), but get auto-tagged "PayNow" since they're
# a distinct payment rail from card swipes / iBanking transfers.
PAYLAH_SENDER = "paylah.alert@dbs.com"


def is_paylah_sender(sender: str) -> bool:
    return PAYLAH_SENDER in (sender or "").lower()

SYSTEM_PROMPT = """You are a transaction email parser. Extract the following fields from the email body.

Return ONLY valid JSON matching this schema:
{
  "amount": number,        // positive number, no currency symbol — must match a labeled amount (e.g. "Amount ₹2,159.53" or "spent 25.18 SGD" or "Amount: 2 SGD"). Ignore stray numbers like image dimensions or font sizes.
  "currency": "SGD"|"INR", // infer from card context passed in. Exception: ixigo (AU Bank) emails state the spend currency explicitly (e.g. "SGD 36.57 were spent") — use that stated currency.
  "merchant": string,      // merchant name, cleaned up. See per-bank rules below.
  "txn_date": string,      // ISO 8601 YYYY-MM-DD. Use the current year provided in the prompt for dates that omit the year (e.g. "03 May", "27 Apr"). Indian emails (Scapia/Axis) use DD-MM-YYYY — e.g. "12-04-2026" → "2026-04-12". Wise emails use "11 April 2026". DBS card emails use "03/05/26" (DD/MM/YY). Never invent a date.
  "txn_time": string|null, // HH:MM in 24h, exactly as stated in the email (do NOT convert timezones). e.g. "01:59 PM" → "13:59", "08:16:28" → "08:16", "22:07 (SGT)" → "22:07". Null if no time in email.
  "raw_desc": string       // first 200 chars of the relevant email section
}

Bank-specific rules:

Wise — two valid transaction types:
1. "X SGD spent at MERCHANT" — card payment
2. "Transfer sent (#NNNN)" — PayNow: amount in "Amount: X SGD", merchant in "X SGD is now in MERCHANT's account", time in "Sent at: HH:MM (SGT) on DD Month YYYY"

DBS — three valid transaction types (all sent from DBS, treat as the same bank/card):
1. PayNow sent (subject "iBanking Alerts"): "Date & Time: DD Mon HH:MM (SGT) Amount: SGDX.XX To: MERCHANT (MOBILE/UEN ...)" — merchant is the name before the parenthesis e.g. "Riya Malik", "BIRDS OF PARADISE"
2. Card purchase (subject "Card Transaction Alert"): "Date & Time: DD Mon HH:MM (SGT) Amount: SGDX.XX ... To: MERCHANT"
3. DBS PayLah! alert (sender "paylah.alert@dbs.com"): a PayNow/QR payment sent from the PayLah! wallet. Format varies but generally states an amount and a recipient/merchant name and a date/time — extract them the same way as type 1 (PayNow). If the email is a "received"/incoming alert, top-up confirmation, or balance notification rather than an outgoing payment, treat it like the SKIP rule below.
SKIP DBS emails that are incoming transfers ("You have received"), eDocuments, or card alert preference changes.

ixigo (AU Small Finance Bank credit card) — transaction alert reads:
"CUR X.XX were spent on your AU Bank Credit Card xx1234 at MERCHANT on DD-MM-YYYY at hh:mm:ss am/pm"
- currency is the one stated in the email (SGD or INR)
- merchant is the name after "at" (e.g. "UNIQLO CITY SQUARE", "TWENTY EIGHT CAFE PTE. LT") — clean it up
- date is DD-MM-YYYY, time is 12-hour with am/pm (convert to 24h, e.g. "02:11:41 pm" → "14:11")
SKIP AU Bank "Payment Alert" emails ("Payment of Rs.X was credited to your Card") — those are bill payments, not spends.

If this email is NOT an outgoing transaction alert (e.g. statement, promotional, reward, incoming transfer), return {"skip": true}.
If you cannot extract amount or txn_date with confidence, return {"skip": true}.
Return ONLY the JSON object. No markdown, no explanation."""


def parse_transaction(
    email_body: str,
    card: str,
    currency: str,
    subject: str = "",
    sender: str = "",
) -> Optional[dict]:
    """
    Parse a transaction email using Claude.
    Returns a dict with amount/currency/merchant/txn_date/raw_desc,
    or None if amount or txn_date cannot be extracted.
    """
    client = get_client()
    # Collapse whitespace before truncating — HTML-stripped bodies can have leading whitespace
    import re as _re
    email_body = _re.sub(r"\s+", " ", email_body).strip()
    body_truncated = email_body[:1500]
    subject_line = f"Subject: {subject}\n" if subject else ""
    sender_line = f"From: {sender}\n" if sender else ""
    current_year = datetime.now(SGT).year
    user_message = f"Card: {card}\nCurrency: {currency}\nCurrent year: {current_year}\n{subject_line}{sender_line}\nEmail body:\n{body_truncated}"

    try:
        response = client.messages.create(
            model=PARSER_MODEL,
            max_tokens=256,
            system=cached_system(SYSTEM_PROMPT),
            messages=[
                {"role": "user", "content": user_message},
            ],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if model wraps output
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        # Extract just the JSON object — Haiku sometimes appends explanation text
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]
        parsed = json.loads(raw)
    except Exception as exc:
        log.error("LLM API call failed during parsing: %s", exc)
        raise

    if parsed.get("skip"):
        log.info("SKIPPED: non-transaction email")
        raise SkipEmail()

    if not parsed.get("amount") or not parsed.get("txn_date"):
        log.warning("PARSE_FAILED: amount=%s txn_date=%s", parsed.get("amount"), parsed.get("txn_date"))
        return None

    # Convert IST → SGT for Indian cards (Scapia, Axis, ixigo/AU Bank). Wise emails are already SGT.
    if parsed.get("txn_time") and card in ("scapia", "axis", "ixigo"):
        try:
            t = datetime.strptime(parsed["txn_time"], "%H:%M")
            t_sgt = t + timedelta(hours=2, minutes=30)
            parsed["txn_time"] = t_sgt.strftime("%H:%M")
        except Exception:
            pass  # leave as-is if conversion fails

    return parsed
