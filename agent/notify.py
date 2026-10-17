"""Shared Telegram send helper used by both gmail_watch and telegram_bot."""
import os
import logging
import httpx

log = logging.getLogger(__name__)


def send(chat_id: str | int, text: str, kind: str = "bot", force: bool = False) -> int | None:
    """Send a Telegram message. Returns the sent message_id, or None on failure.
    `kind` is checked against the Finny bot switches (bot_settings); `force` skips that
    check for on-demand sends the owner asked for."""
    from bot_settings import enabled
    if not force and not enabled(kind):
        log.info("Telegram %s message suppressed (switched off)", kind)
        return None
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        resp = httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)
        resp.raise_for_status()
        return resp.json()["result"]["message_id"]
    except Exception as exc:
        log.error("Telegram send failed: %s", exc)
        return None


def send_manny(text: str) -> int | None:
    """Send a message to Manny's Telegram chat. No-op (returns None) if Manny isn't
    provisioned yet (MANNY_BOT_TOKEN/MANNY_CHAT_ID unset), so Finny keeps working."""
    token = os.environ.get("MANNY_BOT_TOKEN")
    chat_id = os.environ.get("MANNY_CHAT_ID")
    if not token or not chat_id:
        return None
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        resp = httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)
        resp.raise_for_status()
        return resp.json()["result"]["message_id"]
    except Exception as exc:
        log.error("Manny send failed: %s", exc)
        return None
