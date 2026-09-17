"""LLM-powered merchant intelligence: guess what a merchant does before asking the user."""

import logging
from llm import get_client, FAST_MODEL

log = logging.getLogger(__name__)


def guess_merchant(merchant_name: str) -> dict:
    """
    Ask Claude what a merchant likely is.
    Returns {description, suggested_tag, confidence: 'high'|'low'}
    """
    client = get_client()
    try:
        response = client.messages.create(
            model=FAST_MODEL,
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": (
                    f"What is the merchant '{merchant_name}'?\n"
                    "Line 1: one short phrase describing it (e.g. 'coffee chain', 'grocery store', 'ride-hailing app', 'SaaS subscription', 'restaurant').\n"
                    "Line 2: single suggested tag (e.g. coffee, groceries, transport, subscription, food, shopping).\n"
                    "Line 3: confidence — 'high' if you're sure, 'low' if guessing.\n"
                    "Return exactly 3 lines. If completely unknown: unknown merchant\\nmisc\\nlow"
                ),
            }],
        )
        lines = [l.strip() for l in response.content[0].text.strip().split("\n") if l.strip()]
        if len(lines) >= 3:
            return {
                "description": lines[0],
                "suggested_tag": lines[1].lower(),
                "confidence": lines[2].lower(),
            }
    except Exception as exc:
        log.warning("Merchant guess failed for %r: %s", merchant_name, exc)
    return {"description": "unknown merchant", "suggested_tag": None, "confidence": "low"}
