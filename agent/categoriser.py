"""Hermes 3 transaction categoriser via OpenRouter."""

import logging
from llm import get_client, PARSER_MODEL

log = logging.getLogger(__name__)

CATEGORIES = [
    "Food & Drink",
    "Transport",
    "Shopping",
    "Subscriptions",
    "Health & Fitness",
    "Travel",
    "Utilities & Bills",
    "Rent & Housing",
    "Entertainment",
    "Education",
    "Transfers & Misc",
]

SYSTEM_PROMPT = f"""Assign one category to this transaction based on the merchant name and description.

Categories (pick exactly one):
{chr(10).join(f"- {c}" for c in CATEGORIES)}

Return ONLY the category name. No explanation."""


def categorise(merchant: str, raw_desc: str) -> str:
    """
    Categorise a transaction using Hermes 3 via OpenRouter.
    Falls back to 'Transfers & Misc' on API error.
    """
    client = get_client()
    user_message = f"Merchant: {merchant}\nDescription: {raw_desc}"

    try:
        response = client.chat.completions.create(
            model=PARSER_MODEL,
            max_tokens=32,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        )
        category = response.choices[0].message.content.strip()
        if category in CATEGORIES:
            return category
        # Handle case where model adds punctuation or extra text
        for c in CATEGORIES:
            if c.lower() in category.lower():
                return c
        log.warning("Model returned unknown category %r, using default", category)
        return "Transfers & Misc"
    except Exception as exc:
        log.error("LLM API call failed during categorisation: %s", exc)
        return "Transfers & Misc"
