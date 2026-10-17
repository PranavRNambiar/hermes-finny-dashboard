# Supabase Auth API — Divide App

## Base URL

```
https://pohpjaynhxqwpiuodxqd.supabase.co
```

Auth endpoints go to:

```
POST https://pohpjaynhxqwpiuodxqd.supabase.co/auth/v1/<endpoint>
```

### Required headers for every request

```
Content-Type: application/json
apikey:       eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0
```

---

## 1. Send OTP

Sends an SMS OTP to the given phone number via a custom Edge Function (`sms_service`). **We do not use the native Supabase `/auth/v1/otp` endpoint for this.**

### Endpoint

```
POST /functions/v1/sms_service
```

### Request body

| Parameter            | Type   | Required | Description                                         |
|----------------------|--------|----------|-----------------------------------------------------|
| `operation`          | string | Required | Always `"login"` for sending an OTP                 |
| `payload.phone_number` | string | Required | Phone number in E.164 format, e.g. `"+919876543210"` |

### Example curl

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/functions/v1/sms_service' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -d '{
    "operation": "login",
    "payload": {
      "phone_number": "+919876543210"
    }
  }'
```

### Response

Returns `{}` on success (HTTP 200).

---

## 2. Verify OTP → get tokens

Verifies the OTP and returns the `access_token` and `refresh_token`.

### Endpoint

```
POST /auth/v1/verify
```

### Request body

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| `type`    | string | Required | Always `"sms"` for phone auth      |
| `phone`   | string | Required | Phone number in E.164 format       |
| `token`   | string | Required | 6-digit OTP received via SMS       |

### Example curl

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/auth/v1/verify' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -d '{
    "type": "sms",
    "phone": "+919876543210",
    "token": "123456"
  }'
```

### Response

```json
{
  "access_token": "eyJ...",
  "refresh_token": "abc123...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "phone": "+919876543210",
    "role": "authenticated",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

### Response field reference

| Field           | Type   | Description                                                    |
|-----------------|--------|----------------------------------------------------------------|
| `access_token`  | string | JWT — use as `Authorization: Bearer <token>` in RPC calls     |
| `refresh_token` | string | Single-use token to get a new access token when it expires     |
| `expires_in`    | number | Seconds until `access_token` expires (typically 3600)         |
| `user.id`       | string | UUID of the authenticated user                                 |

---

## 3. Refresh access token

Exchanges a refresh token for a new `access_token` + `refresh_token` pair. Refresh tokens are **single-use** — always store the latest one.

### Endpoint

```
POST /auth/v1/token?grant_type=refresh_token
```

### Request body

| Parameter       | Type   | Required | Description                        |
|-----------------|--------|----------|------------------------------------|
| `refresh_token` | string | Required | The current valid refresh token    |

### Example curl

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/auth/v1/token?grant_type=refresh_token' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -d '{"refresh_token": "abc123..."}'
```

### Response

Same shape as the verify response — new `access_token` and new `refresh_token`.

---

## Call sequence

```
1. POST /functions/v1/sms_service  → send OTP to phone (custom Edge Function)
2. POST /auth/v1/verify            → verify OTP, get access_token + refresh_token
3. Use access_token as Authorization: Bearer <token> in all RPC calls
4. POST /auth/v1/token?grant_type=refresh_token  → refresh when expired
```

---

## Notes

- The `access_token` is the JWT used as `Authorization: Bearer <token>` in all RPC calls (see [supabase_rest_api.md](supabase_rest_api.md))
- Refresh tokens are **single-use** — each refresh returns a new pair; store the latest immediately
- In Flutter, the Supabase SDK handles token refresh automatically via `supabase.auth.currentSession`; these endpoints are useful for external integrations or testing via curl
