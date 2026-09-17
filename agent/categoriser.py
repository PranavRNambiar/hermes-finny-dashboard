"""Transaction categoriser via Claude."""

import logging
from llm import get_client, CATEGORISE_MODEL, cached_system

log = logging.getLogger(__name__)

# In-process cache: merchant → category (persists for the lifetime of the process)
_merchant_cache: dict[str, str] = {}

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


def _lookup_existing_category(merchant: str) -> str | None:
    """Return category from a previous transaction for the same merchant, if any."""
    try:
        from supabase import create_client
        import os
        db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
        result = (
            db.table("transactions")
            .select("category")
            .eq("merchant", merchant)
            .not_.eq("category", "Transfers & Misc")
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["category"]
    except Exception:
        pass
    return None


def categorise(merchant: str, raw_desc: str) -> str:
    """
    Categorise a transaction using Claude.
    Returns cached result for known merchants; falls back to 'Transfers & Misc' on API error.
    """
    if merchant in _merchant_cache:
        return _merchant_cache[merchant]

    existing = _lookup_existing_category(merchant)
    if existing:
        _merchant_cache[merchant] = existing
        return existing

    client = get_client()
    user_message = f"Merchant: {merchant}\nDescription: {raw_desc}"

    try:
        response = client.messages.create(
            model=CATEGORISE_MODEL,
            max_tokens=32,
            system=cached_system(SYSTEM_PROMPT),
            messages=[
                {"role": "user", "content": user_message},
            ],
        )
        category = response.content[0].text.strip()
        if category in CATEGORIES:
            _merchant_cache[merchant] = category
            return category
        for c in CATEGORIES:
            if c.lower() in category.lower():
                _merchant_cache[merchant] = c
                return c
        log.warning("Model returned unknown category %r, using default", category)
        return "Transfers & Misc"
    except Exception as exc:
        log.error("LLM API call failed during categorisation: %s", exc)
        return "Transfers & Misc"
