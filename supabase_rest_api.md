# Supabase REST API — Transaction Endpoints

## Base URL

```
https://pohpjaynhxqwpiuodxqd.supabase.co
```

All RPC calls go to:

```
POST https://pohpjaynhxqwpiuodxqd.supabase.co/rest/v1/rpc/<function_name>
```

### Required headers for every request

```
Content-Type:  application/json
apikey:        eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0
Authorization: Bearer <user_jwt>   ← obtained from Supabase Auth sign-in
```

---

## 1. `get_user_groups_with_balances`

Returns all groups the current user belongs to, along with each group's members, their default split percentages, and metadata. This is the primary call to get `groupId`, `members`, and `defaultSplitPercentage` before creating a transaction.

### Endpoint

```
POST /rest/v1/rpc/get_user_groups_with_balances
```

### Request body

| Parameter         | Type   | Required | Description                        |
|-------------------|--------|----------|------------------------------------|
| `current_user_id` | string | Required | UUID of the authenticated user     |

### Example curl

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/rest/v1/rpc/get_user_groups_with_balances' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -H 'Authorization: Bearer <user_jwt>' \
  -d '{"current_user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}'
```

### Response format

Returns an array of group objects.

```json
[
  {
    "group_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "group_name": "Goa Trip",
    "default_currency": "INR",
    "is_trip": true,
    "is_completed": false,
    "trip_start": "2026-01-01T00:00:00+05:30",
    "trip_end": "2026-01-07T00:00:00+05:30",
    "created_at": "2025-12-01T10:00:00+05:30",
    "updated_at": "2025-12-15T10:00:00+05:30",
    "members": [
      {
        "user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "phone": "+919876543210",
        "raw_user_meta_data": {
          "display_name": "Vinayak",
          "profile_icon": "avatar_1"
        },
        "default_split_percentage": 50.0
      },
      {
        "user_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
        "phone": "+919876543211",
        "raw_user_meta_data": {
          "display_name": "Pranav",
          "profile_icon": "avatar_2"
        },
        "default_split_percentage": 50.0
      }
    ]
  }
]
```

#### Response field reference

| Field | Type | Description |
|-------|------|-------------|
| `group_id` | string (UUID) | Use as `p_group_id` when creating a transaction |
| `group_name` | string | Display name of the group |
| `default_currency` | string | e.g. `"INR"`, `"USD"` — use as `p_currency` default |
| `is_trip` | boolean | Whether this group is a trip |
| `is_completed` | boolean | Whether the group/trip is settled |
| `trip_start` | string (ISO 8601) \| null | Trip start date |
| `trip_end` | string (ISO 8601) \| null | Trip end date |
| `created_at` | string (ISO 8601) | Group creation time |
| `updated_at` | string (ISO 8601) | Last update time |
| `members[].user_id` | string (UUID) | Use as `p_paid_by` or `user_id` in splits |
| `members[].phone` | string | Member's phone number |
| `members[].raw_user_meta_data` | object | `display_name`, `profile_icon` |
| `members[].default_split_percentage` | number \| null | If all members have this and they sum to 100, use for auto-split. Otherwise fall back to equal split |

---

## 2. `create_transaction_with_splits`

Creates a transaction and its per-member splits in one call.

### Endpoint

```
POST /rest/v1/rpc/create_transaction_with_splits
```

### Request body

| Parameter               | Type            | Required | Description |
|-------------------------|-----------------|----------|-------------|
| `p_transaction_id`      | string (UUID)   | Required | Client-generated UUID for the transaction. Use `uuid v4`. |
| `p_paid_by`             | string (UUID)   | Required | User ID of the person who paid |
| `p_amount`              | number (double) | Required | Total transaction amount |
| `p_currency`            | string          | Required | ISO currency code, e.g. `"INR"`, `"USD"` |
| `p_description`         | string          | Required | Label for the transaction. Max 70 characters. |
| `p_transaction_date`    | string (ISO 8601 with timezone) | Required | Date of the transaction, e.g. `"2026-06-08T18:00:00+05:30"` |
| `p_transaction_category`| string          | Required | Category name. See [valid values](#valid-transaction-categories) below. |
| `p_splits`              | array of objects | Required | Per-member split breakdown. See [split object](#split-object) below. Must include ALL participants including the payer. Split amounts must sum to `p_amount`. |
| `p_updated_by`          | string (UUID)   | Required | UUID of the user making this API call (the caller) |
| `p_group_id`            | string (UUID)   | Optional | Group UUID from `get_user_groups_with_balances`. Pass `null` for a friend-to-friend transaction. |

### Split object

Each item in `p_splits`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | Required | Client-generated UUID for this split |
| `transaction_id` | string (UUID) | Required | Must match `p_transaction_id` |
| `user_id` | string (UUID) | Required | User ID of this split's member |
| `amount` | number (double) | Required | Amount this member owes (or paid, for the payer) |
| `currency` | string | Required | Must match `p_currency` |
| `updated_at` | string (ISO 8601 with timezone) | Required | Current timestamp |

### Example curl

```bash
curl -X POST \
  'https://pohpjaynhxqwpiuodxqd.supabase.co/rest/v1/rpc/create_transaction_with_splits' \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvaHBqYXluaHhxd3BpdW9keHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMwNjkwMDcsImV4cCI6MjA0ODY0NTAwN30.xX_FXQ9IrWRQOqIUJtlYYKEEsW9_0GWhbNG3U7MBQ_0' \
  -H 'Authorization: Bearer <user_jwt>' \
  -d '{
    "p_transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "p_paid_by": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "p_amount": 1000.00,
    "p_currency": "INR",
    "p_description": "Dinner at Taj",
    "p_transaction_date": "2026-06-08T20:00:00+05:30",
    "p_transaction_category": "foodAndDrinks",
    "p_splits": [
      {
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "user_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "amount": 500.00,
        "currency": "INR",
        "updated_at": "2026-06-08T20:00:00+05:30"
      },
      {
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "transaction_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "user_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
        "amount": 500.00,
        "currency": "INR",
        "updated_at": "2026-06-08T20:00:00+05:30"
      }
    ],
    "p_group_id": "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
    "p_updated_by": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }'
```

### Response

Returns the created transaction ID (string) on success, or an error object on failure.

---

## Valid Transaction Categories

Pass the exact string value from the left column as `p_transaction_category`.

| Value | Display name |
|-------|-------------|
| `general` | General |
| `foodAndDrinks` | Food & Drinks |
| `transport` | Transport |
| `shopping` | Shopping |
| `groceries` | Groceries |
| `entertainment` | Entertainment |
| `travel` | Travel |
| `medical` | Medical |
| `selfCare` | Self Care |
| `fitness` | Fitness |
| `services` | Services |
| `bill` | Bill |
| `subscription` | Subscription |
| `creditBill` | Credit Bill |
| `loan` | Loan |
| `investment` | Investment |
| `support` | Support |
| `insurance` | Insurance |
| `tax` | Tax |
| `petCare` | Pet Care |
| `gift` | Gift |
| `lent` | Lent |
| `donation` | Donation |
| `bankCharges` | Bank Charges |
| `settleUp` | Settle Up |

---

## Call sequence to create a group transaction

```
1. Sign in → get user_jwt
2. POST /rpc/get_user_groups_with_balances  → pick groupId, members, defaultSplitPercentage
3. POST /rpc/create_transaction_with_splits → create the transaction
```

For a friend-to-friend transaction (no group), skip step 2 and pass `"p_group_id": null`. You will need to know the friend's `user_id` separately (e.g. from `GET /rest/v1/profiles`).
