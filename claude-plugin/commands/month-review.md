---
description: Review this month's spending against last month, per currency
argument-hint: "[this_month|last_month|last_30_days]"
---

Use the finny-analyst skill. Call `spending_overview` with period `${1:-this_month}`, then `find_subscriptions`.

Write a short review:
1. Total per currency and change vs the previous period.
2. Top 3 categories and top 5 merchants per currency.
3. One-off large transactions that skew the month, with the total excluding them.
4. Subscriptions charged this period.
5. One concrete, specific suggestion based on the data. Don't give generic budgeting advice.
