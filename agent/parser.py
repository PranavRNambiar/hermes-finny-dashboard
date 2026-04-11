"""Hermes 3 email parser via OpenRouter. Extracts transaction fields from raw email bodies."""

import json
import logging
from typing import Optional

from llm import get_client, PARSER_MODEL

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a transaction email parser. Extract the following fields from the email body.

Return ONLY valid JSON matching this schema:
{
  "amount": number,        // positive number, no currency symbol
  "currency": "SGD"|"INR", // infer from card context passed in
  "merchant": string,      // merchant name, cleaned up
  "txn_date": string,      // ISO 8601 date YYYY-MM-DD in SGT timezone
  "raw_desc": string       // first 200 chars of the relevant email section
}

If you cannot extract a field with confidence, return null for that field.
Return ONLY the JSON object. No markdown, no explanation."""


def parse_transaction(
    email_body: str,
    card: str,
    currency: str,
) -> Optional[dict]:
    """
    Parse a transaction email using Hermes 3 via OpenRouter.
    Returns a dict with amount/currency/merchant/txn_date/raw_desc,
    or None if amount or txn_date cannot be extracted.
    """
    client = get_client()
    user_message = f"Card: {card}\nCurrency: {currency}\n\nEmail body:\n{email_body}"

    try:
        response = client.chat.completions.create(
            model=PARSER_MODEL,
            max_tokens=256,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown code fences if model wraps output
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
    except Exception as exc:
        log.error("LLM API call failed during parsing: %s", exc)
        raise

    if not parsed.get("amount") or not parsed.get("txn_date"):
        log.warning("PARSE_FAILED: amount=%s txn_date=%s", parsed.get("amount"), parsed.get("txn_date"))
        return None

    return parsed
