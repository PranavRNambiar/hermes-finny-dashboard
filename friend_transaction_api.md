# Friend-to-Friend Transaction API

A friend-to-friend transaction is a non-group expense between exactly two users. Pass `"p_group_id": null` to create one.

## Base URL

```
https://pohpjaynhxqwpiuodxqd.supabase.co
```

## Required headers

```
Content-Type:  application/json
apikey:        eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0
Authorization: Bearer <user_jwt>
```

---

## Endpoint

```
POST /rest/v1/rpc/create_transaction_with_splits
```

## Rules for friend transactions

1. **`p_group_id` must be `null`** — this is what makes it a friend transaction, not a group one.
2. **`p_splits` must contain exactly 2 entries** — one for the payer, one for the friend. Both `user_id` values must be different.
3. **The two `user_id` values in `p_splits` must be the payer (`p_paid_by`) and the friend** — never the same person twice.
4. **Split amounts must sum to `p_amount`** exactly.
5. **`p_updated_by` must be the authenticated caller's user ID** (the user whose JWT is in the Authorization header).

> **Common mistake:** passing the same `user_id` in both split entries, or omitting one of the two users. This creates a self-transaction and causes the affected user to see themselves in their own friends list.

---

## Request body

| Parameter                | Type             | Required | Description |
|--------------------------|------------------|----------|-------------|
| `p_transaction_id`       | string (UUID v4) | Required | Client-generated UUID for the transaction |
| `p_paid_by`              | string (UUID)    | Required | User ID of the person who paid |
| `p_amount`               | number (double)  | Required | Total transaction amount |
| `p_currency`             | string           | Required | ISO currency code, e.g. `"INR"`, `"USD"` |
| `p_description`          | string           | Required | Label for the transaction. Max 70 characters. |
| `p_transaction_date`     | string (ISO 8601 with timezone) | Required | e.g. `"2026-06-08T18:00:00+05:30"` |
| `p_transaction_category` | string           | Required | See [valid categories](./supabase_rest_api.md#valid-transaction-categories) |
| `p_splits`               | array (2 items)  | Required | One entry per person. Must include payer AND friend. See below. |
| `p_updated_by`           | string (UUID)    | Required | User ID of the authenticated caller |
| `p_group_id`             | null             | Required | Must be `null` for friend transactions |

### Split object (each of the 2 entries)

| Field            | Type             | Required | Description |
|------------------|------------------|----------|-------------|
| `id`             | string (UUID v4) | Required | Client-generated UUID for this split |
| `transaction_id` | string (UUID)    | Required | Must match `p_transaction_id` |
| `user_id`        | string (UUID)    | Required | The person this split belongs to |
| `amount`         | number (double)  | Required | How much this person owes (or paid) |
| `currency`       | string           | Required | Must match `p_currency` |
| `updated_at`     | string (ISO 8601 with timezone) | Required | Current timestamp |

---

## Example: User A paid ₹1000 for User A and User B (split 50/50)

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/rest/v1/rpc/create_transaction_with_splits' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -H 'Authorization: Bearer <user_a_jwt>' \
  -d '{
    "p_transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "p_paid_by":        "user-a-uuid",
    "p_amount":         1000.00,
    "p_currency":       "INR",
    "p_description":    "Dinner at Social",
    "p_transaction_date": "2026-06-08T20:00:00+05:30",
    "p_transaction_category": "foodAndDrinks",
    "p_group_id":       null,
    "p_updated_by":     "user-a-uuid",
    "p_splits": [
      {
        "id":             "split-1-uuid",
        "transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "user_id":        "user-a-uuid",
        "amount":         500.00,
        "currency":       "INR",
        "updated_at":     "2026-06-08T20:00:00+05:30"
      },
      {
        "id":             "split-2-uuid",
        "transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "user_id":        "user-b-uuid",
        "amount":         500.00,
        "currency":       "INR",
        "updated_at":     "2026-06-08T20:00:00+05:30"
      }
    ]
  }'
```

**Result:** User B owes User A ₹500. Both users see each other in their friends list with this balance.

---

## Example: User B paid, User A owes the full amount

If User B paid for both but User A is the one making the API call:

```json
{
  "p_transaction_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "p_paid_by":        "user-b-uuid",
  "p_amount":         600.00,
  "p_currency":       "INR",
  "p_description":    "Cab to airport",
  "p_transaction_date": "2026-06-10T08:00:00+05:30",
  "p_transaction_category": "transport",
  "p_group_id":       null,
  "p_updated_by":     "user-a-uuid",
  "p_splits": [
    {
      "id":             "split-3-uuid",
      "transaction_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "user_id":        "user-b-uuid",
      "amount":         300.00,
      "currency":       "INR",
      "updated_at":     "2026-06-10T08:00:00+05:30"
    },
    {
      "id":             "split-4-uuid",
      "transaction_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "user_id":        "user-a-uuid",
      "amount":         300.00,
      "currency":       "INR",
      "updated_at":     "2026-06-10T08:00:00+05:30"
    }
  ]
}
```

**Note:** `p_paid_by` is User B (who actually paid). `p_updated_by` is User A (the caller). These can differ — `p_updated_by` is just an audit field.

---

## Checklist before calling

- [ ] `p_group_id` is `null`
- [ ] `p_splits` has exactly 2 entries
- [ ] The two `user_id` values in `p_splits` are different from each other
- [ ] One of the `user_id` values matches `p_paid_by`
- [ ] Split amounts sum exactly to `p_amount`
- [ ] `p_updated_by` matches the user whose JWT is in the Authorization header
- [ ] All UUIDs are v4 and unique (never reuse a UUID across transactions)
