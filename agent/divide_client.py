"""Client for the Divide app's Supabase Auth + REST API.

Manny uses this to sync settlements into the Divide app. Auth is a phone-OTP
flow: send_otp -> verify_otp produces an access/refresh token pair that's
persisted in the divide_session table (see db.save_divide_session). Access
tokens expire (~1h); get_access_token() auto-refreshes using the single-use
refresh token and persists the new pair.

The anon apikey (DIVIDE_ANON_KEY) is required on every request; the user JWT
(access_token) is required on RPC calls.

Docs: divide_auth_api.md, supabase_rest_api.md
"""

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta

import httpx

import db

log = logging.getLogger(__name__)

BASE_URL = "https://pohpjaynhxqwpiuodxqd.supabase.co"
REFRESH_SKEW_SECONDS = 120  # refresh if the token expires within 2 minutes


def _anon_key() -> str:
    return os.environ["DIVIDE_ANON_KEY"]


def _base_headers() -> dict:
    return {"Content-Type": "application/json", "apikey": _anon_key()}


def _edge_headers() -> dict:
    """Edge Functions require Authorization: Bearer in addition to apikey."""
    key = _anon_key()
    return {"Content-Type": "application/json", "apikey": key, "Authorization": f"Bearer {key}"}


def _expires_at(expires_in: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()


# ── Auth ─────────────────────────────────────────────────────

def send_otp(phone: str) -> None:
    """Send an SMS OTP via Divide's custom Edge Function (not the native Supabase OTP endpoint)."""
    # Edge Function expects the number WITHOUT leading +
    phone_for_edge = phone.lstrip("+")
    resp = httpx.post(
        f"{BASE_URL}/functions/v1/sms_service",
        headers=_edge_headers(),
        json={"operation": "login", "payload": {"phone_number": phone_for_edge}},
        timeout=20,
    )
    if not resp.is_success:
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        raise RuntimeError(body.get("message") or f"HTTP {resp.status_code}")
    data = resp.json() if resp.content else {}
    if data.get("error"):
        raise RuntimeError(data.get("message") or "OTP send failed")


def verify_otp(phone: str, token: str) -> dict:
    """Verify the OTP and persist the resulting Divide session. Returns the user dict."""
    resp = httpx.post(
        f"{BASE_URL}/auth/v1/verify",
        headers=_base_headers(),
        json={"type": "sms", "phone": phone, "token": token},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    user = data.get("user") or {}
    db.save_divide_session(
        user_id=user.get("id"),
        phone=phone,
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_at=_expires_at(data.get("expires_in", 3600)),
    )
    return user


def _refresh(refresh_token: str) -> dict:
    """Exchange a (single-use) refresh token for a fresh token pair, and persist it."""
    resp = httpx.post(
        f"{BASE_URL}/auth/v1/token?grant_type=refresh_token",
        headers=_base_headers(),
        json={"refresh_token": refresh_token},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    db.update_divide_tokens(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_at=_expires_at(data.get("expires_in", 3600)),
    )
    return data


def get_access_token() -> str | None:
    """Return a valid access token, refreshing if it's expired/expiring. None if not logged in."""
    session = db.get_divide_session()
    if not session or not session.get("access_token"):
        return None

    expires_at = session.get("expires_at")
    needs_refresh = True
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            needs_refresh = exp - datetime.now(timezone.utc) < timedelta(seconds=REFRESH_SKEW_SECONDS)
        except (ValueError, TypeError):
            needs_refresh = True

    if needs_refresh and session.get("refresh_token"):
        try:
            data = _refresh(session["refresh_token"])
            return data["access_token"]
        except Exception as exc:
            log.error("Divide token refresh failed: %s", exc)
            return None
    return session["access_token"]


def is_logged_in() -> bool:
    session = db.get_divide_session()
    return bool(session and session.get("user_id") and session.get("refresh_token"))


# ── RPC ──────────────────────────────────────────────────────

def _auth_headers() -> dict:
    token = get_access_token()
    if not token:
        raise RuntimeError("Not logged into Divide — run /divide_login first.")
    return {**_base_headers(), "Authorization": f"Bearer {token}"}


def get_user_groups_with_balances() -> list[dict]:
    """All Divide groups the logged-in user belongs to, with members + balances."""
    session = db.get_divide_session()
    if not session or not session.get("user_id"):
        raise RuntimeError("Not logged into Divide — run /divide_login first.")
    resp = httpx.post(
        f"{BASE_URL}/rest/v1/rpc/get_user_groups_with_balances",
        headers=_auth_headers(),
        json={"current_user_id": session["user_id"]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def create_transaction_with_splits(
    *,
    paid_by: str,
    amount: float,
    currency: str,
    description: str,
    transaction_date: str,
    category: str,
    splits: list[dict],
    group_id: str | None = None,
) -> str:
    """Create a Divide transaction + splits atomically. Returns the new transaction id.

    splits: [{"user_id": str, "amount": float}, ...] — ids/timestamps are filled in here.
    Must include all participants (including the payer); amounts must sum to `amount`.
    """
    session = db.get_divide_session()
    if not session or not session.get("user_id"):
        raise RuntimeError("Not logged into Divide — run /divide_login first.")
    caller_id = session["user_id"]
    txn_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    p_splits = [
        {
            "id": str(uuid.uuid4()),
            "transaction_id": txn_id,
            "user_id": s["user_id"],
            "amount": float(s["amount"]),
            "currency": currency,
            "updated_at": now,
        }
        for s in splits
    ]

    body = {
        "p_transaction_id": txn_id,
        "p_paid_by": paid_by,
        "p_amount": float(amount),
        "p_currency": currency,
        "p_description": description[:70],
        "p_transaction_date": transaction_date,
        "p_transaction_category": category,
        "p_splits": p_splits,
        "p_updated_by": caller_id,
        "p_group_id": group_id,
    }
    resp = httpx.post(
        f"{BASE_URL}/rest/v1/rpc/create_transaction_with_splits",
        headers=_auth_headers(),
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()
    # RPC returns the transaction id (string); fall back to our generated id.
    if isinstance(result, str):
        return result
    return txn_id
