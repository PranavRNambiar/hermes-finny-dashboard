// Read-only data layer shared by the MCP server (/api/mcp) and the iOS API (/api/v1/*).
// Server-only: uses the Supabase service key. Never import from a client component.
//
// House rules (same as the agent and dashboard):
// - SGD and INR are never summed together. Every total is keyed by currency.
// - Dates are calendar dates in Asia/Singapore.
// - user_tag values starting with "__" are internal (pending/skip markers) and count as untagged.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Txn = {
  id: string;
  card: string;
  currency: string;
  amount: number;
  merchant: string | null;
  category: string;
  raw_desc: string | null;
  txn_date: string;
  txn_time: string | null;
  ingested_at: string;
  anomaly_flagged: boolean;
  user_tag: string | null;
};

export type TxnFilters = {
  from?: string;
  to?: string;
  card?: string;
  currency?: string;
  category?: string;
  merchant?: string; // case-insensitive substring
  tag?: string;
  min_amount?: number;
  max_amount?: number;
};

const TXN_COLUMNS =
  "id, card, currency, amount, merchant, category, txn_date, txn_time, ingested_at, anomaly_flagged, user_tag";

let _client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// ── Dates (SGT) ────────────────────────────────────────────

export function todaySGT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthBounds(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yyyyMm}-01`, to: `${yyyyMm}-${String(last).padStart(2, "0")}` };
}

function prevMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export type Period =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all_time";

export function resolvePeriod(period: Period): { from: string; to: string; label: string } {
  const today = todaySGT();
  switch (period) {
    case "today":
      return { from: today, to: today, label: "today" };
    case "last_7_days":
      return { from: shiftDays(today, -6), to: today, label: "last 7 days" };
    case "last_30_days":
      return { from: shiftDays(today, -29), to: today, label: "last 30 days" };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today, label: "this month to date" };
    case "last_month":
      return { ...monthBounds(prevMonth(today.slice(0, 7))), label: "last month" };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "this year to date" };
    case "all_time":
      return { from: "1970-01-01", to: today, label: "all time" };
  }
}

// ── Queries ────────────────────────────────────────────────

function applyFilters<Q extends { eq: any; gte: any; lte: any; ilike: any }>(q: Q, f: TxnFilters): Q {
  if (f.from) q = q.gte("txn_date", f.from);
  if (f.to) q = q.lte("txn_date", f.to);
  if (f.card) q = q.eq("card", f.card.toLowerCase());
  if (f.currency) q = q.eq("currency", f.currency.toUpperCase());
  if (f.category) q = q.eq("category", f.category);
  if (f.tag) q = q.ilike("user_tag", f.tag);
  if (f.merchant) q = q.ilike("merchant", `%${f.merchant.replace(/[%_]/g, "")}%`);
  if (f.min_amount != null) q = q.gte("amount", f.min_amount);
  if (f.max_amount != null) q = q.lte("amount", f.max_amount);
  return q;
}

export async function listTransactions(
  f: TxnFilters & { limit?: number; offset?: number; sort?: "date_desc" | "date_asc" | "amount_desc" }
): Promise<{ transactions: Txn[]; total: number }> {
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const offset = Math.max(0, f.offset ?? 0);
  let q = db().from("transactions").select(TXN_COLUMNS, { count: "exact" });
  q = applyFilters(q, f);
  if (f.sort === "amount_desc") q = q.order("amount", { ascending: false });
  else {
    const asc = f.sort === "date_asc";
    q = q.order("txn_date", { ascending: asc }).order("ingested_at", { ascending: asc });
  }
  const { data, count, error } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return { transactions: (data ?? []).map(cleanTxn), total: count ?? 0 };
}

/** Every matching row, paged past PostgREST's 1000-row cap. For aggregation only. */
async function fetchAll(f: TxnFilters): Promise<Txn[]> {
  const out: Txn[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    let q = db().from("transactions").select(TXN_COLUMNS);
    q = applyFilters(q, f);
    const { data, error } = await q.order("txn_date").order("id").range(offset, offset + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map(cleanTxn));
    if (!data || data.length < page) break;
  }
  return out;
}

export async function getTransaction(id: string): Promise<(Txn & { splits: any[] }) | null> {
  const { data, error } = await db()
    .from("transactions")
    .select(`${TXN_COLUMNS}, raw_desc`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: splits } = await db()
    .from("transaction_splits")
    .select("id, share_amount, currency, status, settled_at, people(name)")
    .eq("transaction_id", id);
  return {
    ...cleanTxn(data),
    splits: (splits ?? []).map((s: any) => ({
      person: s.people?.name ?? null,
      share_amount: s.share_amount,
      currency: s.currency,
      status: s.status,
      settled_at: s.settled_at,
    })),
  };
}

function cleanTxn(row: any): Txn {
  const tag = row.user_tag as string | null;
  return { ...row, user_tag: tag && !tag.startsWith("__") ? tag : null };
}

export type GroupBy = "category" | "merchant" | "card" | "tag" | "month" | "week" | "day";

function groupKey(t: Txn, by: GroupBy): string {
  switch (by) {
    case "category":
      return t.category;
    case "merchant":
      return t.merchant ?? "Unknown";
    case "card":
      return t.card;
    case "tag":
      return t.user_tag ?? "(untagged)";
    case "month":
      return t.txn_date.slice(0, 7);
    case "day":
      return t.txn_date;
    case "week": {
      // ISO week starting Monday, labelled by its Monday date
      const d = new Date(`${t.txn_date}T00:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7;
      return shiftDays(t.txn_date, -dow);
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function spendingBreakdown(
  f: TxnFilters & { group_by: GroupBy; top?: number }
): Promise<Record<string, { total: number; count: number; groups: { key: string; total: number; count: number; share_pct: number }[] }>> {
  const rows = await fetchAll(f);
  const byCurrency: Record<string, Map<string, { total: number; count: number }>> = {};
  for (const t of rows) {
    const m = (byCurrency[t.currency] ??= new Map());
    const k = groupKey(t, f.group_by);
    const cur = m.get(k) ?? { total: 0, count: 0 };
    cur.total += t.amount;
    cur.count += 1;
    m.set(k, cur);
  }
  const chronological = ["month", "week", "day"].includes(f.group_by);
  const result: Record<string, any> = {};
  for (const [ccy, m] of Object.entries(byCurrency)) {
    const total = [...m.values()].reduce((a, b) => a + b.total, 0);
    let groups = [...m.entries()].map(([key, v]) => ({
      key,
      total: round2(v.total),
      count: v.count,
      share_pct: total ? round2((v.total / total) * 100) : 0,
    }));
    groups.sort(chronological ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.total - a.total);
    if (f.top && !chronological) groups = groups.slice(0, f.top);
    result[ccy] = { total: round2(total), count: [...m.values()].reduce((a, b) => a + b.count, 0), groups };
  }
  return result;
}

export async function overview(period: Period = "this_month") {
  const range = resolvePeriod(period);
  const rows = await fetchAll({ from: range.from, to: range.to });

  // Same-length window immediately before, for a like-for-like comparison.
  const days =
    (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000 + 1;
  const prevRows =
    period === "all_time"
      ? []
      : await fetchAll({ from: shiftDays(range.from, -days), to: shiftDays(range.from, -1) });

  const currencies: Record<string, any> = {};
  for (const ccy of new Set([...rows, ...prevRows].map((r) => r.currency))) {
    const cur = rows.filter((r) => r.currency === ccy);
    const prev = prevRows.filter((r) => r.currency === ccy);
    const total = cur.reduce((a, b) => a + b.amount, 0);
    const prevTotal = prev.reduce((a, b) => a + b.amount, 0);
    const sumBy = (key: (t: Txn) => string) => {
      const m = new Map<string, number>();
      for (const t of cur) m.set(key(t), (m.get(key(t)) ?? 0) + t.amount);
      return [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, total: round2(v) }));
    };
    const daily = new Map<string, number>();
    for (const t of cur) daily.set(t.txn_date, (daily.get(t.txn_date) ?? 0) + t.amount);
    currencies[ccy] = {
      total: round2(total),
      count: cur.length,
      previous_period_total: round2(prevTotal),
      change_pct: prevTotal ? round2(((total - prevTotal) / prevTotal) * 100) : null,
      avg_per_day: round2(total / days),
      by_category: sumBy((t) => t.category),
      top_merchants: sumBy((t) => t.merchant ?? "Unknown").slice(0, 8),
      by_card: sumBy((t) => t.card),
      daily: [...daily.entries()].sort().map(([date, v]) => ({ date, total: round2(v) })),
      largest: [...cur].sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  }

  return {
    period: { name: period, ...range, days },
    currencies,
    anomalies: rows.filter((r) => r.anomaly_flagged).slice(-10),
  };
}

export async function pendingSplits() {
  const { data, error } = await db()
    .from("transaction_splits")
    .select("id, share_amount, currency, transaction_id, created_at, people(id, name), transactions(merchant, txn_date, amount)")
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  const byKey = new Map<string, any>();
  for (const row of data ?? []) {
    const person = row.people as any;
    const txn = row.transactions as any;
    const key = `${person?.id}:${row.currency}`;
    const entry = byKey.get(key) ?? { name: person?.name ?? "Unknown", currency: row.currency, total: 0, items: [] };
    entry.total = round2(entry.total + row.share_amount);
    entry.items.push({
      split_id: row.id,
      transaction_id: row.transaction_id,
      merchant: txn?.merchant ?? null,
      txn_date: txn?.txn_date ?? null,
      txn_amount: txn?.amount ?? null,
      share_amount: row.share_amount,
    });
    byKey.set(key, entry);
  }
  const owed = [...byKey.values()].sort((a, b) =>
    a.currency === b.currency ? b.total - a.total : a.currency.localeCompare(b.currency)
  );
  const totals: Record<string, number> = {};
  for (const o of owed) totals[o.currency] = round2((totals[o.currency] ?? 0) + o.total);
  return { owed_to_me: owed, totals_by_currency: totals };
}

export async function listCards() {
  const { data, error } = await db().from("cards").select("card, label, currency, active").order("card");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listCategoriesAndTags() {
  const rows = await fetchAll({});
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const t of rows) {
    categories.set(t.category, (categories.get(t.category) ?? 0) + 1);
    if (t.user_tag) tags.set(t.user_tag.toLowerCase(), (tags.get(t.user_tag.toLowerCase()) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return { categories: sorted(categories), tags: sorted(tags) };
}

/** Merchants with a monthly/quarterly cadence and a stable amount. Mirrors agent/db.py. */
export async function findSubscriptions(lookbackDays = 120) {
  const rows = await fetchAll({ from: shiftDays(todaySGT(), -lookbackDays) });
  const groups = new Map<string, Txn[]>();
  for (const t of rows) {
    const k = `${t.currency}|${t.merchant ?? "Unknown"}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const subs = [];
  for (const [k, txns] of groups) {
    if (txns.length < 2) continue;
    const avg = txns.reduce((a, b) => a + b.amount, 0) / txns.length;
    if (!avg || Math.max(...txns.map((t) => Math.abs(t.amount - avg) / avg)) > 0.15) continue;
    const dates = txns.map((t) => new Date(`${t.txn_date}T00:00:00Z`).getTime()).sort((a, b) => a - b);
    const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / 86400000);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap < 25 || avgGap > 95) continue;
    const [currency, merchant] = k.split("|");
    subs.push({
      merchant,
      currency,
      avg_amount: round2(avg),
      avg_gap_days: Math.round(avgGap),
      occurrences: txns.length,
      last_charged: txns[txns.length - 1].txn_date,
      card: txns[txns.length - 1].card,
    });
  }
  return subs.sort((a, b) => b.avg_amount - a.avg_amount);
}

export async function fxRate(from = "SGD", to = "INR") {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`, {
    next: { revalidate: 21600 },
  });
  if (!res.ok) throw new Error(`FX upstream ${res.status}`);
  const data = await res.json();
  return { from, to, rate: data?.rates?.[to] as number, date: data?.date as string, source: "ECB via frankfurter.dev" };
}
