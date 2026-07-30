"""Anthropic client shared by all agent modules."""

import os
import anthropic

# Two tiers, split by task shape (see model eval, 2026-07-30):
#   Sonnet — reasoning/narrative work: talking to Finny + digests.
#   Haiku  — mechanical work: email parsing + merchant categorisation.
# Haiku matched Sonnet on parser accuracy (both 100%) and was ~35-40% faster
# and ~2.8x cheaper, so the extraction path runs on Haiku.
SONNET = "claude-sonnet-4-6"
HAIKU  = "claude-haiku-4-5"

# Back-compat aliases (MODEL/FAST_MODEL are imported directly by some modules).
MODEL      = SONNET
FAST_MODEL = HAIKU

PARSER_MODEL     = HAIKU   # structured extraction from transaction emails
CATEGORISE_MODEL = HAIKU   # merchant -> category classification
DIGEST_MODEL     = SONNET  # daily/weekly digest — needs reasoning
CHAT_MODEL       = SONNET  # conversation with Finny — needs reasoning


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def cached_system(text: str) -> list[dict]:
    """Wrap a system prompt as a cacheable block. Cache activates at ≥1024 tokens on Sonnet."""
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]
