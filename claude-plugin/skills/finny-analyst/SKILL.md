---
name: finny-analyst
description: Use whenever the user asks about their own spending, transactions, card bills, budgets, subscriptions, merchants, or money owed to them by friends. Explains how to query the Finny MCP tools correctly (currency separation, SGT dates, category names) and how to present the answer.
---

# Finny analyst

Finny records every card transaction Pranav makes, parsed from bank alert emails. The `finny` MCP server exposes it read-only.

## Hard rules

1. **Never add SGD and INR together.** Report each currency on its own line. Only convert when the user asks for one combined number; then call `get_fx_rate`, show the rate and date, and label the result "approx., converted".
2. Dates are Singapore calendar dates. "This month" means the 1st of the current month in SGT through today.
3. Amounts are spend and always positive. A large one-off (tuition, flights) can dominate a month. When it does, say so and give the total without it.
4. Categories are fixed: Food & Drink, Transport, Shopping, Subscriptions, Health & Fitness, Travel, Utilities & Bills, Rent & Housing, Entertainment, Education, Gifts, Transfers & Misc. A **tag** is a free-text label the owner adds. Don't confuse the two.

## Picking a tool

| Question | Tool |
|---|---|
| "How am I doing this month?" / general | `spending_overview` (period) |
| "How much on X?" / "by month/category/merchant" | `spending_breakdown` with `group_by` + filters |
| "Show me the Grab rides last week" | `list_transactions` with filters |
| "What subscriptions do I have?" | `find_subscriptions` |
| "Who owes me?" | `pending_splits` |
| Card names, valid tags | `list_cards_and_categories` |

Prefer one aggregate call over paging through `list_transactions` to add things up yourself.

## Presenting

- Lead with the answer as a number, then 2–4 bullets of context: biggest driver, change vs the previous period, anything unusual.
- Use the currency code with amounts (SGD 1,234.50, INR 12,345).
- Keep tables short (top 5–8 rows) unless asked for everything.
- If the data looks incomplete (e.g. a card with no transactions for weeks), mention it. Finny depends on email parsing.
