"""Anthropic client shared by all agent modules."""

import os
import anthropic

MODEL      = "claude-sonnet-4-6"
FAST_MODEL = "claude-sonnet-4-6"

PARSER_MODEL     = MODEL
DIGEST_MODEL     = MODEL
CHAT_MODEL       = FAST_MODEL
CATEGORISE_MODEL = FAST_MODEL


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def cached_system(text: str) -> list[dict]:
    """Wrap a system prompt as a cacheable block. Cache activates at ≥1024 tokens on Sonnet."""
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]
