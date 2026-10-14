"""On-demand sends queued from the web app's Finny bot page (bot_jobs table).

Each "Send now" button inserts a row; gmail_watch's main loop calls run_next() every few seconds.
On-demand sends ignore the switches — the owner asked for them explicitly.
"""
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone

from db import get_client
from notify import send

log = logging.getLogger(__name__)
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
SYM = {"SGD": "S$", "INR": "₹"}


def _script(name: str) -> str:
    env = {**os.environ, "FINNY_FORCE": "1"}
    p = subprocess.run([sys.executable, os.path.join(AGENT_DIR, name)], capture_output=True, text=True,
                       timeout=300, cwd=AGENT_DIR, env=env)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1] if (p.stderr or p.stdout) else f"exit {p.returncode}")
    return "sent"


def _latest_transaction(chat_id: str) -> str:
    rows = (get_client().table("transactions").select("card, currency, amount, merchant, category, txn_date")
            .order("txn_date", desc=True).order("ingested_at", desc=True).limit(1).execute().data)
    if not rows:
        raise RuntimeError("no transactions yet")
    t = rows[0]
    send(chat_id, f"💳 {t['card'].upper()} · {t['merchant'] or 'Unknown'} · {SYM.get(t['currency'], '')}{t['amount']:.2f} · "
                  f"{t['category']}\n(latest transaction, {t['txn_date']})", force=True)
    return f"{t['merchant']} {t['amount']}"


def _latest_incoming(chat_id: str) -> str:
    rows = (get_client().table("incoming").select("card, currency, amount, counterparty, kind, txn_date")
            .order("txn_date", desc=True).limit(1).execute().data)
    if not rows:
        raise RuntimeError("no money in yet")
    r = rows[0]
    send(chat_id, f"💰 {r['card'].upper()} · {r['kind']} · {r['counterparty']} · +{SYM.get(r['currency'], '')}{r['amount']:.2f}\n"
                  f"(latest money in, {r['txn_date']})", force=True)
    return f"{r['counterparty']} {r['amount']}"


def run_next() -> None:
    db = get_client()
    rows = db.table("bot_jobs").select("*").eq("status", "pending").order("id").limit(1).execute().data
    if not rows:
        return
    job = rows[0]
    # Claim it; if another worker got there first, the update matches nothing.
    claimed = db.table("bot_jobs").update({"status": "running"}).eq("id", job["id"]).eq("status", "pending").execute().data
    if not claimed:
        return
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    kind = job["kind"]
    log.info("[BOT] On-demand %s (job #%s)", kind, job["id"])
    try:
        if kind == "daily_digest":
            result = _script("daily_digest.py")
        elif kind == "weekly_review":
            result = _script("weekly_review.py")
        elif kind == "transactions":
            result = _latest_transaction(chat_id)
        elif kind == "incoming":
            result = _latest_incoming(chat_id)
        elif kind == "test":
            send(chat_id, "👋 Finny bot is connected. Manage what I send from the Finny bot page on the web.", force=True)
            result = "sent"
        else:
            raise RuntimeError(f"unknown job kind {kind!r}")
        status, err = "done", None
    except Exception as exc:
        status, result = "error", str(exc)[:300]
        log.error("[BOT] Job #%s failed: %s", job["id"], exc)
    db.table("bot_jobs").update({"status": status, "result": result,
                                 "completed_at": datetime.now(timezone.utc).isoformat()}).eq("id", job["id"]).execute()
