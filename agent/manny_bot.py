"""
Manny — the debt-collecting Telegram bot.

Finny tracks Pranav's own spending; Manny tracks who owes Pranav and chases it down.
Splits are recorded by Finny (replies to transaction notifications); Manny owns the
conversation about collecting them: who owes what, settling up, cashflow, and the
cash conversion cycle (how long money is tied up before it comes back).

Manny also syncs settlements into the external Divide app (see divide_client.py).

Commands:
  /splits        — who owes you, by person and currency
  /cashflow      — cash conversion cycle: money out, avg days to get paid back, lifetime collected
  /settle <name> — mark a person's debts settled (and sync to Divide if linked)
  /divide_login <phone> — start Divide phone-OTP login (reply with the 6-digit code)
  /divide_status — Divide login + linking status
  /link <name>   — link a local person to a Divide group member
  /dashboard     — open the dashboard

Anything else — answered conversationally with the debt/cashflow context.
"""

import logging
import os
import re
from datetime import datetime, timezone, timedelta

import httpx
from dotenv import load_dotenv

import divide_client
from db import (
    get_outstanding_splits,
    settle_splits_for_person,
    get_cash_conversion_stats,
    get_settle_speed_by_person,
    get_divide_session,
    count_linked_people,
    list_people,
    get_or_create_person,
    get_person,
    link_person_to_divide,
    get_settled_splits_for_person,
    get_pending_splits_for_person,
    mark_split_synced,
    get_transaction_split_person_count,
)
from llm import get_client as get_llm, CHAT_MODEL, cached_system

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SGT = timezone(timedelta(hours=8))

# In-memory conversational state (single long-lived process). Lost on restart — the
# user just re-runs the command.
_pending_login: dict[str, str] = {}           # chat_id -> phone awaiting OTP
_pending_link: dict[str, dict] = {}           # chat_id -> {"person_id", "options": [{user_id, group_id, label}]}
_pending_divide_confirm: dict[str, dict] = {} # chat_id -> {person_id, person_name} — waiting yes/no for Divide push
_pending_group_select: dict[str, dict] = {}   # chat_id -> {person_id, options: [{group_id, label}]} — waiting for group choice

_NOT_SET = object()  # sentinel for group_id default


SYSTEM_PROMPT = """You are Manny — a sharp, no-nonsense debt-collecting bot working for this user (Pranav).

Your entire world is money owed TO Pranav by friends and the flow of that money:
who owes what, who's slow to pay, settling up, and the cash conversion cycle (CCC) —
how many days Pranav's money stays tied up after he fronts a shared bill before it's
paid back. You also sync with the Divide app.

You do NOT handle Pranav's own spending, budgets, or savings — that's Finny's job. If
asked about personal spending, tell them to ask Finny.

Divide integration capabilities:
- You CAN push bill splits directly to Divide for people who are linked (have a Divide account linked via /link).
- When a person is linked, their pending splits are automatically pushed to Divide immediately after linking.
- Use /sync <name> to manually push all pending splits for a linked person to Divide.
- /settle <name> settles locally AND syncs a settleUp transaction to Divide for linked people.

Rules:
- Always use S$ for SGD and ₹ for INR. Never mix or add the two currencies together.
- Be direct and numbers-first. "Raj owes you S$45 across 3 bills, slowest payer at 18 days avg" beats vague summaries.
- When asked about cashflow or CCC, talk about money currently out, average days to get paid back, and lifetime collected.
- Keep responses under 250 words, plain text, suitable for Telegram.

Available commands:
/splits        — who owes you, by person and currency
/cashflow      — cash conversion cycle and money in the system
/settle <name> — mark a person's debts settled (syncs to Divide if linked)
/sync <name>   — push all pending splits for a linked person to Divide now
/divide_login <phone> — log in to the Divide app
/divide_status — Divide login and linking status
/link <name>   — link a person to a Divide group member (auto-pushes their pending splits)
/dashboard     — open the dashboard"""


def send(chat_id: str | int, text: str) -> None:
    token = os.environ["MANNY_BOT_TOKEN"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)


def _sym(currency: str) -> str:
    return "S$" if currency == "SGD" else "₹"


# ── /splits ──────────────────────────────────────────────────

def handle_splits(chat_id: str | int) -> None:
    outstanding = get_outstanding_splits()
    if not outstanding:
        send(chat_id, "Nothing outstanding — everyone's paid you back. 🎉")
        return

    lines = ["💰 Who owes you", ""]
    totals = {"SGD": 0.0, "INR": 0.0}
    for row in outstanding:
        sym = _sym(row["currency"])
        n = row["count"]
        lines.append(f"  {row['name']}: {sym}{row['total']:.2f} ({n} txn{'s' if n != 1 else ''}, {row['currency']})")
        totals[row["currency"]] += row["total"]

    lines.append("")
    if totals["SGD"] > 0:
        lines.append(f"Total owed (SGD): S${totals['SGD']:.2f}")
    if totals["INR"] > 0:
        lines.append(f"Total owed (INR): ₹{totals['INR']:.2f}")
    lines.append("")
    lines.append("Use /settle <name> when someone pays you back.")
    send(chat_id, "\n".join(lines))


# ── /cashflow ────────────────────────────────────────────────

def _cashflow_summary() -> str:
    stats = get_cash_conversion_stats()
    speed = get_settle_speed_by_person()

    lines = ["💸 Cashflow & cash conversion cycle", ""]

    pending = stats["pending_by_currency"]
    if pending:
        lines.append("Money out (owed to you):")
        for cur in ("SGD", "INR"):
            if pending.get(cur):
                lines.append(f"  {_sym(cur)}{pending[cur]:.2f} ({cur})")
    else:
        lines.append("Money out: nothing — you're all collected.")

    lines.append("")
    if stats["avg_days_to_settle"] is not None:
        lines.append(f"Avg days to get paid back: {stats['avg_days_to_settle']:.1f} days")
    else:
        lines.append("Avg days to get paid back: no settled history yet")

    settled = stats["settled_lifetime_by_currency"]
    if settled:
        lines.append("Collected lifetime:")
        for cur in ("SGD", "INR"):
            if settled.get(cur):
                lines.append(f"  {_sym(cur)}{settled[cur]:.2f} ({cur})")

    if speed:
        lines.append("")
        lines.append("Slowest to pay back:")
        for p in speed[:5]:
            lines.append(f"  {p['name']}: {p['avg_days']:.1f} days avg ({p['count']} settled)")

    return "\n".join(lines)


def handle_cashflow(chat_id: str | int) -> None:
    send(chat_id, _cashflow_summary())


# ── Divide split pushing ─────────────────────────────────────

CATEGORY_SETTLE_UP = "settleUp"

_DIVIDE_CATEGORY_MAP: dict[str, str] = {
    "Food & Drink": "foodAndDrinks",
    "Transport": "transport",
    "Shopping": "shopping",
    "Subscriptions": "subscription",
    "Health & Fitness": "fitness",
    "Travel": "travel",
    "Entertainment": "entertainment",
    "Utilities & Bills": "bill",
    "Rent & Housing": "bill",
}


def _push_pending_splits_to_divide(person: dict, group_id: object = _NOT_SET) -> tuple[int, int]:
    """Push all unsynced pending splits for a linked person to Divide.
    group_id: explicit group to use; pass None for direct (no group); omit to use stored divide_group_id.
    Returns (pushed, failed)."""
    splits = get_pending_splits_for_person(person["id"])
    session = get_divide_session()
    pranav_id = session["user_id"]
    divide_user_id = person["divide_user_id"]
    group_id = person.get("divide_group_id") if group_id is _NOT_SET else group_id

    pushed = failed = 0
    for s in splits:
        if s.get("external_ref"):
            continue  # already synced
        full_amount = s.get("amount") or round(s["share_amount"] * 2, 2)
        pranav_share = round(full_amount - s["share_amount"], 2)
        cat = _DIVIDE_CATEGORY_MAP.get(s.get("category") or "", "general")
        txn_date_raw = s.get("txn_date") or datetime.now(SGT).strftime("%Y-%m-%d")
        txn_date = f"{txn_date_raw}T00:00:00+05:30"
        # 1-to-1: only this person shares the transaction → friend API (no group)
        # Group: multiple people share it → use the stored group_id
        person_count = get_transaction_split_person_count(s["transaction_id"])
        effective_group_id = None if person_count == 1 else group_id
        try:
            txn_id = divide_client.create_transaction_with_splits(
                paid_by=pranav_id,
                amount=full_amount,
                currency=s["currency"],
                description=(s["merchant"] or "Bill")[:70],
                transaction_date=txn_date,
                category=cat,
                splits=[
                    {"user_id": pranav_id, "amount": pranav_share},
                    {"user_id": divide_user_id, "amount": s["share_amount"]},
                ],
                group_id=effective_group_id,
            )
            mark_split_synced(s["id"], txn_id)
            pushed += 1
        except Exception as exc:
            log.error("Divide push failed for split %s: %s", s["id"], exc)
            failed += 1
    return pushed, failed


# ── /settle ──────────────────────────────────────────────────


def _sync_settle_to_divide(person: dict, currency: str, total: float) -> str | None:
    """Push a settleUp transaction to Divide for a linked person. Returns the Divide
    transaction id on success, None if not linked / not logged in / failed."""
    divide_user_id = person.get("divide_user_id")
    if not divide_user_id or not divide_client.is_logged_in():
        return None

    session = get_divide_session()
    pranav_id = session["user_id"]
    now_iso = datetime.now(SGT).isoformat()
    # Friend pays Pranav back: friend is payer, the full amount is allocated to Pranav.
    splits = [
        {"user_id": divide_user_id, "amount": 0.0},
        {"user_id": pranav_id, "amount": total},
    ]
    try:
        txn_id = divide_client.create_transaction_with_splits(
            paid_by=divide_user_id,
            amount=total,
            currency=currency,
            description=f"Settle up — {person['name']}",
            transaction_date=now_iso,
            category=CATEGORY_SETTLE_UP,
            splits=splits,
            group_id=None,  # settle-up is always 1-to-1, never a group transaction
        )
        return txn_id
    except Exception as exc:
        log.error("Divide settle sync failed for %s: %s", person.get("name"), exc)
        return None


def handle_settle(chat_id: str | int, text: str) -> None:
    parts = text.split(maxsplit=1)
    name = parts[1].strip() if len(parts) > 1 else ""
    if not name:
        send(chat_id, "Usage: /settle <name>")
        return

    # Capture splits before settling so we can sync the right rows to Divide.
    person_rows = list_people()
    match = next((p for p in person_rows if p["name"].lower() == name.lower()), None)

    result = settle_splits_for_person(name)
    if not result:
        send(chat_id, f"No outstanding debts found for {name}.")
        return

    lines = [f"✅ Settled with {name}:"]
    for currency, info in result.items():
        sym = _sym(currency)
        n = info["count"]
        lines.append(f"  {sym}{info['total']:.2f} ({n} txn{'s' if n != 1 else ''}, {currency})")

    # Sync to Divide if this person is linked and we're logged in.
    if match:
        person = get_person(match["id"])
        if person and person.get("divide_user_id") and divide_client.is_logged_in():
            synced_any = False
            for currency, info in result.items():
                txn_id = _sync_settle_to_divide(person, currency, info["total"])
                if txn_id:
                    synced_any = True
                    # Tag the just-settled splits for this currency with the Divide ref.
                    for s in get_settled_splits_for_person(name, currency):
                        if not s.get("external_ref"):
                            mark_split_synced(s["id"], txn_id)
            lines.append("")
            lines.append("🔗 Synced to Divide." if synced_any else "⚠️ Settled locally, Divide sync failed.")

    send(chat_id, "\n".join(lines))


# ── Divide login / status / link ─────────────────────────────

def _normalize_phone(raw: str) -> str:
    """E.164: a leading + and digits only. Strip spaces, dashes, parens, dots."""
    cleaned = re.sub(r"[\s\-().]", "", raw)
    return cleaned


def handle_divide_login(chat_id: str | int, text: str) -> None:
    parts = text.split(maxsplit=1)
    phone = _normalize_phone(parts[1]) if len(parts) > 1 else ""
    if not phone.startswith("+") or not phone[1:].isdigit():
        send(chat_id, "Usage: /divide_login +<countrycode><number>  (E.164, e.g. +919876543210)")
        return
    try:
        divide_client.send_otp(phone)
    except Exception as exc:
        log.error("send_otp failed: %s", exc)
        send(chat_id, f"OTP failed: {exc}")
        return
    _pending_login[str(chat_id)] = phone
    send(chat_id, f"OTP sent to {phone}. Reply with the 6-digit code.")


def handle_otp_reply(chat_id: str | int, code: str) -> None:
    phone = _pending_login.get(str(chat_id))
    if not phone:
        return
    try:
        user = divide_client.verify_otp(phone, code)
    except Exception as exc:
        log.error("verify_otp failed: %s", exc)
        send(chat_id, "That code didn't work. Run /divide_login again to retry.")
        _pending_login.pop(str(chat_id), None)
        return
    _pending_login.pop(str(chat_id), None)
    send(chat_id, f"✅ Logged into Divide as {phone}.\nUse /link <name> to map your friends to Divide accounts.")


def handle_divide_status(chat_id: str | int) -> None:
    session = get_divide_session()
    if not session or not session.get("user_id"):
        send(chat_id, "Not logged into Divide. Run /divide_login +<phone> to connect.")
        return
    phone = session.get("phone") or ""
    masked = (phone[:3] + "•••" + phone[-2:]) if len(phone) > 5 else phone
    expires = session.get("expires_at") or "unknown"
    linked = count_linked_people()
    lines = [
        "🔗 Divide status",
        f"  Logged in as: {masked}",
        f"  Token expires: {expires}",
        f"  Linked people: {linked}",
    ]
    send(chat_id, "\n".join(lines))


def handle_link(chat_id: str | int, text: str) -> None:
    parts = text.split(maxsplit=1)
    name = parts[1].strip() if len(parts) > 1 else ""
    if not name:
        send(chat_id, "Usage: /link <name>")
        return
    if not divide_client.is_logged_in():
        send(chat_id, "Log into Divide first: /divide_login +<phone>")
        return

    try:
        groups = divide_client.get_user_groups_with_balances()
    except Exception as exc:
        log.error("get_user_groups failed: %s", exc)
        send(chat_id, "Couldn't load your Divide groups. Try again in a moment.")
        return

    session = get_divide_session()
    pranav_id = session["user_id"]

    # Flatten members across groups (excluding Pranav himself); dedupe by (user_id, group_id).
    options = []
    seen = set()
    for g in groups:
        for m in g.get("members", []):
            if m["user_id"] == pranav_id:
                continue
            key = (m["user_id"], g["group_id"])
            if key in seen:
                continue
            seen.add(key)
            display = (m.get("raw_user_meta_data") or {}).get("display_name") or m.get("phone") or "Unknown"
            options.append({
                "user_id": m["user_id"],
                "group_id": g["group_id"],
                "label": f"{display} · {g['group_name']}",
            })

    if not options:
        send(chat_id, "No Divide group members found to link.")
        return

    person_id = get_or_create_person(name)
    _pending_link[str(chat_id)] = {"person_id": person_id, "name": name, "options": options}

    lines = [f"Who is {name} in Divide? Reply with a number:", ""]
    for i, o in enumerate(options, 1):
        lines.append(f"  {i}. {o['label']}")
    send(chat_id, "\n".join(lines))


def handle_link_reply(chat_id: str | int, index: int) -> None:
    pending = _pending_link.get(str(chat_id))
    if not pending:
        return
    options = pending["options"]
    if not (1 <= index <= len(options)):
        send(chat_id, f"Pick a number between 1 and {len(options)}.")
        return
    choice = options[index - 1]
    link_person_to_divide(pending["person_id"], choice["user_id"], choice["group_id"])
    _pending_link.pop(str(chat_id), None)

    send(chat_id, f"🔗 Linked {pending['name']} → {choice['label']}.")

    # If there are unsynced splits, go through the group-select flow.
    if divide_client.is_logged_in():
        person = get_person(pending["person_id"])
        splits = get_pending_splits_for_person(pending["person_id"]) if person else []
        unsynced = [s for s in splits if not s.get("external_ref")]
        if unsynced and person and person.get("divide_user_id"):
            _pending_divide_confirm[str(chat_id)] = {
                "person_id": pending["person_id"],
                "person_name": pending["name"],
            }
            total = sum(s["share_amount"] for s in unsynced)
            sym = _sym(unsynced[0]["currency"])
            send(chat_id, f"There are {len(unsynced)} unsynced split{'s' if len(unsynced) != 1 else ''} "
                          f"({sym}{total:.2f}) for {pending['name']}. Add them to Divide? (yes / no)")


# ── Divide group-select + push flow ──────────────────────────

def _get_divide_groups_for_person(divide_user_id: str) -> list[dict]:
    """Return Divide groups that contain both Pranav and this person."""
    session = get_divide_session()
    pranav_id = session["user_id"]
    try:
        groups = divide_client.get_user_groups_with_balances()
    except Exception as exc:
        log.error("Could not fetch Divide groups: %s", exc)
        return []
    result = []
    for g in groups:
        member_ids = {m["user_id"] for m in g.get("members", [])}
        if pranav_id in member_ids and divide_user_id in member_ids:
            result.append({"group_id": g["group_id"], "group_name": g["group_name"]})
    return result


def _trigger_group_select(chat_id: str | int, person: dict) -> None:
    """Ask the user which Divide context to use for this person's pending splits."""
    groups = _get_divide_groups_for_person(person["divide_user_id"])
    options = [{"group_id": None, "label": f"{person['name'].title()} directly (no group)"}]
    for g in groups:
        options.append({"group_id": g["group_id"], "label": g["group_name"]})

    if len(options) == 1:
        # No shared groups — push directly without asking.
        _do_divide_push(chat_id, person, group_id=None)
        return

    _pending_group_select[str(chat_id)] = {"person_id": person["id"], "options": options}
    lines = ["Add to which?", ""]
    for i, o in enumerate(options, 1):
        lines.append(f"  {i}. {o['label']}")
    send(chat_id, "\n".join(lines))


def _do_divide_push(chat_id: str | int, person: dict, group_id: object) -> None:
    """Push all unsynced splits and report the result."""
    pushed, failed = _push_pending_splits_to_divide(person, group_id=group_id)
    if pushed == 0 and failed == 0:
        send(chat_id, "No unsynced splits to push.")
        return
    lines = []
    if pushed:
        lines.append(f"↗️ Pushed {pushed} split{'s' if pushed != 1 else ''} to Divide.")
    if failed:
        lines.append(f"⚠️ {failed} failed — check logs.")
    send(chat_id, "\n".join(lines))


def handle_group_select_reply(chat_id: str | int, index: int) -> None:
    pending = _pending_group_select.get(str(chat_id))
    if not pending:
        return
    options = pending["options"]
    if not (1 <= index <= len(options)):
        send(chat_id, f"Pick a number between 1 and {len(options)}.")
        return
    choice = options[index - 1]
    _pending_group_select.pop(str(chat_id), None)
    person = get_person(pending["person_id"])
    if not person:
        send(chat_id, "Couldn't find that person.")
        return
    _do_divide_push(chat_id, person, group_id=choice["group_id"])


# ── Finny notification → Divide confirm ──────────────────────

def _parse_finny_notification(text: str) -> tuple[str, float, str] | None:
    """Extract (person_name, share_amount, currency) from a Finny split notification.
    Format: line 0 = '🧾 New debt...', line 1 = '  Name: S$XX.XX'"""
    if not text.startswith("🧾"):
        return None
    for line in text.splitlines()[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("Check"):
            continue
        if ":" not in stripped:
            continue
        name_part, amount_part = stripped.split(":", 1)
        name = name_part.strip()
        amt_str = amount_part.strip()
        if "S$" in amt_str:
            try:
                return name, float(amt_str.replace("S$", "").strip()), "SGD"
            except ValueError:
                pass
        elif "₹" in amt_str:
            try:
                return name, float(amt_str.replace("₹", "").strip()), "INR"
            except ValueError:
                pass
    return None


def handle_finny_notification(chat_id: str | int, text: str) -> bool:
    """Handle a Finny split notification. Returns True if consumed."""
    parsed = _parse_finny_notification(text)
    if not parsed:
        return False
    person_name, share, currency = parsed
    sym = _sym(currency)

    people = list_people()
    match = next((p for p in people if p["name"].lower() == person_name.lower()), None)
    if not match or not divide_client.is_logged_in():
        return True  # consumed — no Divide action available

    person = get_person(match["id"])
    if not person or not person.get("divide_user_id"):
        return True  # not linked, nothing to do

    _pending_divide_confirm[str(chat_id)] = {
        "person_id": person["id"],
        "person_name": person_name,
    }
    send(chat_id, f"Add {person_name}'s {sym}{share:.2f} to Divide? (yes / no)")
    return True


def handle_divide_confirm_reply(chat_id: str | int, text: str) -> bool:
    """Handle yes/no to the Divide push confirmation. Returns True if consumed."""
    pending = _pending_divide_confirm.get(str(chat_id))
    if not pending:
        return False

    t = text.strip().lower()
    is_yes = t in {"yes", "yeah", "yep", "sure", "ok", "okay", "yup", "do it", "add it", "go"} or t.startswith("yes")
    is_no = t in {"no", "nope", "skip", "later", "not now", "nah"} or t.startswith("no")

    if not is_yes and not is_no:
        return False  # ambiguous — let LLM handle it

    _pending_divide_confirm.pop(str(chat_id), None)

    if is_no:
        send(chat_id, "Okay, stored locally. Just say \"sync with [name]\" anytime to push to Divide.")
        return True

    person = get_person(pending["person_id"])
    if not person:
        send(chat_id, "Couldn't find that person.")
        return True

    _trigger_group_select(chat_id, person)
    return True


# ── Natural language sync detection ──────────────────────────

def _detect_sync_intent(text: str) -> str | None:
    """If the text looks like a sync-to-Divide request, return the person name. Else None."""
    t = text.lower()
    has_trigger = any(phrase in t for phrase in [
        "sync", "add to divide", "push to divide", "send to divide", "add all to divide",
    ])
    if not has_trigger:
        return None
    for p in list_people():
        if p["name"].lower() in t:
            return p["name"]
    return None


def handle_sync(chat_id: str | int, text: str) -> None:
    """/sync <name> — push all pending splits for a linked person to Divide (with group selection)."""
    parts = text.split(maxsplit=1)
    name = parts[1].strip() if len(parts) > 1 else ""
    if not name:
        send(chat_id, "Usage: /sync <name>")
        return
    if not divide_client.is_logged_in():
        send(chat_id, "Log into Divide first: /divide_login +<phone>")
        return

    people = list_people()
    match = next((p for p in people if p["name"].lower() == name.lower()), None)
    if not match:
        send(chat_id, f"No person named {name} found.")
        return

    person = get_person(match["id"])
    if not person or not person.get("divide_user_id"):
        send(chat_id, f"{name} isn't linked to a Divide account yet. Run /link {name} first.")
        return

    _trigger_group_select(chat_id, person)


def handle_dashboard(chat_id: str | int) -> None:
    url = os.environ.get("DASHBOARD_URL", "")
    send(chat_id, f"📊 Dashboard: {url}" if url else "Dashboard URL not configured.")


# ── free-form chat ───────────────────────────────────────────

def build_debt_context() -> str:
    today = datetime.now(SGT).strftime("%Y-%m-%d")
    outstanding = get_outstanding_splits()
    if outstanding:
        owed_lines = "\n".join(
            f"  {r['name']}: {_sym(r['currency'])}{r['total']:.2f} "
            f"({r['count']} txn{'s' if r['count'] != 1 else ''}, {r['currency']})"
            for r in outstanding
        )
    else:
        owed_lines = "  (nobody owes you right now)"

    session = get_divide_session()
    divide_state = "logged in" if (session and session.get("user_id")) else "not logged in"

    return f"""Current date (SGT): {today}

IMPORTANT: SGD and INR are separate currencies. Never add them together.

Who owes Pranav right now:
{owed_lines}

{_cashflow_summary()}

Divide integration: {divide_state} ({count_linked_people()} people linked).
Capabilities: push bill splits to Divide (/sync <name> or auto on /link), sync settlements (/settle)."""


def handle_chat(chat_id: str | int, question: str) -> None:
    try:
        context = build_debt_context()
    except Exception as exc:
        log.error("Failed to build debt context: %s", exc)
        send(chat_id, "Couldn't load your debt data right now. Try again in a moment.")
        return

    llm = get_llm()
    try:
        response = llm.messages.create(
            model=CHAT_MODEL,
            max_tokens=400,
            system=cached_system(SYSTEM_PROMPT),
            messages=[{"role": "user", "content": f"Debt data:\n{context}\n\nQuestion: {question}"}],
        )
        answer = response.content[0].text.strip()
        dashboard_url = os.environ.get("DASHBOARD_URL", "")
        if dashboard_url:
            answer += f"\n\n📊 {dashboard_url}"
        send(chat_id, answer)
    except Exception as exc:
        log.error("LLM error during chat: %s", exc)
        send(chat_id, "I'm having trouble thinking right now. Try again in a minute.")


# ── polling loop ─────────────────────────────────────────────

def poll_updates(offset: int, token: str) -> tuple[list[dict], int]:
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    resp = httpx.get(url, params={"offset": offset, "timeout": 30}, timeout=35)
    data = resp.json()
    updates = data.get("result", [])
    new_offset = updates[-1]["update_id"] + 1 if updates else offset
    return updates, new_offset


def main() -> None:
    token = os.environ["MANNY_BOT_TOKEN"]
    allowed_chat = os.environ["MANNY_CHAT_ID"]

    log.info("Manny Telegram bot starting…")
    offset = 0

    while True:
        try:
            updates, offset = poll_updates(offset, token)
        except Exception as exc:
            log.error("Failed to get Telegram updates: %s", exc)
            continue

        for update in updates:
            msg = update.get("message") or update.get("edited_message")
            if not msg:
                continue

            chat_id = str(msg["chat"]["id"])
            if chat_id != str(allowed_chat):
                log.warning("Ignoring message from unknown chat %s", chat_id)
                continue

            text = (msg.get("text") or "").strip()
            if not text:
                continue

            log.info("Received: %r", text)

            try:
                # 1. Pending OTP (6 digits) — highest priority.
                if chat_id in _pending_login and text.isdigit() and len(text) == 6:
                    handle_otp_reply(chat_id, text)
                    continue
                # 2. Pending group selection (bare number after yes-to-Divide).
                if chat_id in _pending_group_select and text.isdigit():
                    handle_group_select_reply(chat_id, int(text))
                    continue
                # 3. Pending Divide link selection (bare number after /link).
                if chat_id in _pending_link and text.isdigit():
                    handle_link_reply(chat_id, int(text))
                    continue
                # 4. Pending yes/no for Divide push confirmation.
                if chat_id in _pending_divide_confirm:
                    if handle_divide_confirm_reply(chat_id, text):
                        continue
                    # Ambiguous reply — fall through to LLM but keep state.
                # 5. Finny split notification — auto-ask about Divide.
                if text.startswith("🧾"):
                    handle_finny_notification(chat_id, text)
                    continue

                if text.startswith("/splits"):
                    handle_splits(chat_id)
                elif text.startswith("/cashflow"):
                    handle_cashflow(chat_id)
                elif text.startswith("/settle"):
                    handle_settle(chat_id, text)
                elif text.startswith("/sync"):
                    handle_sync(chat_id, text)
                elif text.startswith("/divide_login"):
                    handle_divide_login(chat_id, text)
                elif text.startswith("/divide_status"):
                    handle_divide_status(chat_id)
                elif text.startswith("/link"):
                    handle_link(chat_id, text)
                elif text.startswith("/dashboard"):
                    handle_dashboard(chat_id)
                elif text.startswith("/start"):
                    send(chat_id, "👋 I'm Manny — I track who owes you and chase it down.\n\n"
                                  "/splits — who owes you\n/cashflow — money in the system\n"
                                  "/settle <name> — mark a debt paid\n/link <name> — link to Divide\n"
                                  "/divide_login +<phone> — connect Divide\nOr just say \"sync with Rutuja\" 👊")
                else:
                    # 6. Natural language sync intent before falling to LLM.
                    sync_name = _detect_sync_intent(text)
                    if sync_name and divide_client.is_logged_in():
                        people = list_people()
                        match = next((p for p in people if p["name"].lower() == sync_name.lower()), None)
                        if match:
                            person = get_person(match["id"])
                            if person and person.get("divide_user_id"):
                                _trigger_group_select(chat_id, person)
                                continue
                    handle_chat(chat_id, text)
            except Exception as exc:
                log.error("Error handling %r: %s", text, exc)
                send(chat_id, "⚠️ Something went wrong. Try again in a moment.")


if __name__ == "__main__":
    main()
