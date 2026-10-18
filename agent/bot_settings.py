"""Switches for what the Finny Telegram bot may send (set from the web app's Finny bot page).

Keys: "bot" (master), "transactions", "incoming", "nudges", "daily_digest", "weekly_review".
Fails open: if the table is missing or Supabase is unreachable, everything stays on.
"""
import logging
import time

log = logging.getLogger(__name__)

KINDS = ("transactions", "incoming", "nudges", "daily_digest", "weekly_review")
_cache: dict[str, bool] = {}
_at = 0.0
TTL = 20  # seconds; toggles take effect within this


def _load() -> dict[str, bool]:
    global _cache, _at
    if time.time() - _at < TTL:
        return _cache
    try:
        from db import get_client
        rows = get_client().table("bot_settings").select("key, enabled").execute().data or []
        _cache = {r["key"]: bool(r["enabled"]) for r in rows}
    except Exception as exc:
        log.warning("bot_settings unavailable (%s) — treating everything as on", exc)
        _cache = {}
    _at = time.time()
    return _cache


def enabled(kind: str) -> bool:
    """True if the master switch and this kind's switch are both on (missing = on)."""
    s = _load()
    if not s.get("bot", True):
        return False
    return s.get(kind, True)
