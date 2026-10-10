"""Handles money-in alerts (salary, transfers received, refunds, own top-ups)."""

import logging
import os

from db import insert_incoming, mark_processed
from notify import send as telegram_send

log = logging.getLogger(__name__)

KIND_LABEL = {"salary": "Salary", "transfer": "Transfer in", "refund": "Refund", "own_transfer": "Own transfer"}


def save_incoming(email_id: str, card: str, parsed: dict, notify: bool = True) -> None:
    """Store an incoming-money alert, mark the email processed and ping Telegram."""
    row = {
        "id": email_id,
        "card": card,
        "currency": parsed["currency"],
        "amount": parsed["amount"],
        "counterparty": parsed.get("merchant") or "Unknown",
        "kind": parsed.get("kind") or "transfer",
        "raw_desc": parsed.get("raw_desc"),
        "txn_date": parsed["txn_date"],
        "txn_time": parsed.get("txn_time"),
    }
    kind = insert_incoming(row)
    mark_processed(email_id)
    sym = "S$" if row["currency"] == "SGD" else "₹"
    log.info("[%s] Incoming: %s %s%.2f (%s)", card.upper(), row["counterparty"], sym, row["amount"], kind)
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if notify and chat_id and kind != "own_transfer":
        telegram_send(chat_id, f"💰 {card.upper()} · {KIND_LABEL.get(kind, kind)} · {row['counterparty']} · +{sym}{row['amount']:.2f}")
