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
  /** Merchant as the bank sent it; `merchant` may be the owner's custom name. */
  raw_merchant: string | null;
  /** Full charge on the card. `amount` is the owner's share (total minus what others owe). */
  total_amount: number;
  /** Number of other people this was split with (0 = not split). */
  split_with: number;
};

export type TxnFilters = {
  from?: string;
  to?: string;
  card?: string;
  currency?: string;
  category?: string;
  merchant?: string; // case-insensitive substring
  merchant_exact?: string; // exact merchant: a custom name or the bank's name
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
  | "this_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "all_time";

/** Category the owner uses for big one-offs (e.g. tuition): visible, but never counted as spending. */
export const EXCLUDED = "Exclusions";

export function resolvePeriod(period: Period): { from: string; to: string; label: string } {
  const today = todaySGT();
  switch (period) {
    case "today":
      return { from: today, to: today, label: "today" };
    case "last_7_days":
      return { from: shiftDays(today, -6), to: today, label: "last 7 days" };
    case "last_30_days":
      return { from: shiftDays(today, -29), to: today, label: "last 30 days" };
    case "this_week": {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      return { from: shiftDays(today, -dow), to: today, label: "this week" };
    }
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today, label: "this month to date" };
    case "this_quarter": {
      const m = Number(today.slice(5, 7));
      const qStart = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0");
      return { from: `${today.slice(0, 4)}-${qStart}-01`, to: today, label: "this quarter to date" };
    }
    case "last_month":
      return { ...monthBounds(prevMonth(today.slice(0, 7))), label: "last month" };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "this year to date" };
    case "all_time":
      return { from: "1970-01-01", to: today, label: "all time" };
  }
}

// ── Merchant rules (custom names + category overrides) ─────
// Rules are keyed by the raw merchant string the bank sends. Names are applied at
// read time, so future transactions pick them up immediately. Categories are also
// written back to the rows (see syncRuleCategories) so SQL category filters match.

type Rule = { display_name: string | null; category: string | null; updated_at?: string };
let _rules: Map<string, Rule> = new Map();
let _rulesAt = 0;
let _syncedAt = 0;

async function ensureRules(): Promise<Map<string, Rule>> {
  if (Date.now() - _rulesAt < 30_000) return _rules;
  const { data, error } = await db().from("merchant_rules").select("merchant, display_name, category, updated_at");
  // Table missing (migration not run yet) → behave as if there are no rules.
  _rules = new Map(error ? [] : (data ?? []).map((r: any) => [r.merchant, { display_name: r.display_name, category: r.category, updated_at: r.updated_at }]));
  _rulesAt = Date.now();
  if (Date.now() - _syncedAt > 60_000) {
    _syncedAt = Date.now();
    void syncRuleCategories().catch(() => {}); // housekeeping; never block a request on it
  }
  return _rules;
}

/** Apply rule categories to transactions that arrived after the rule was set. Older rows
 *  were updated when the rule was saved, and any one-off change made since stays put. */
async function syncRuleCategories() {
  for (const [merchant, r] of _rules) {
    if (!r.category || !r.updated_at) continue;
    await db().from("transactions").update({ category: r.category })
      .eq("merchant", merchant).gt("ingested_at", r.updated_at).neq("category", r.category);
  }
}

// ── Splits: what others owe on each transaction ───────────
// Cached like rules; edits call resetSplits(). Settled and pending both count —
// once someone owes you their part, it was never your spending.

let _owed: Map<string, { total: number; people: number }> = new Map();
let _owedAt = 0;

async function ensureSplits() {
  if (Date.now() - _owedAt < 30_000) return;
  const next = new Map<string, { total: number; people: number }>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db().from("transaction_splits").select("transaction_id, share_amount").range(off, off + 999);
    if (error) break;
    for (const r of data ?? []) {
      const cur = next.get(r.transaction_id) ?? { total: 0, people: 0 };
      next.set(r.transaction_id, { total: cur.total + Number(r.share_amount), people: cur.people + 1 });
    }
    if (!data || data.length < 1000) break;
  }
  _owed = next;
  _owedAt = Date.now();
}
const resetSplits = () => { _owedAt = 0; };

/** Raw merchants whose custom name matches the search text. */
function merchantsNamed(q: string): string[] {
  const needle = q.toLowerCase();
  return [..._rules.entries()].filter(([, r]) => r.display_name?.toLowerCase().includes(needle)).map(([m]) => m);
}

// ── Queries ────────────────────────────────────────────────

function applyFilters<Q extends { eq: any; gte: any; lte: any; ilike: any }>(q: Q, f: TxnFilters): Q {
  if (f.from) q = q.gte("txn_date", f.from);
  if (f.to) q = q.lte("txn_date", f.to);
  if (f.card) q = q.eq("card", f.card.toLowerCase());
  if (f.currency) q = q.eq("currency", f.currency.toUpperCase());
  if (f.category) q = q.eq("category", f.category);
  if (f.tag) q = q.ilike("user_tag", f.tag);
  if (f.merchant) {
    const term = f.merchant.replace(/[%_,()"]/g, "");
    const named = merchantsNamed(term).map((m) => `"${m.replace(/"/g, '\\"')}"`);
    q = named.length
      ? (q as any).or(`merchant.ilike.%${term}%,merchant.in.(${named.join(",")})`)
      : q.ilike("merchant", `%${term}%`);
  }
  if (f.merchant_exact) {
    const key = f.merchant_exact.toLowerCase();
    const raws = [..._rules.entries()].filter(([, r]) => r.display_name?.toLowerCase() === key).map(([m]) => m);
    q = (q as any).in("merchant", [...raws, f.merchant_exact]);
  }
  if (f.min_amount != null) q = q.gte("amount", f.min_amount);
  if (f.max_amount != null) q = q.lte("amount", f.max_amount);
  return q;
}

export async function listTransactions(
  f: TxnFilters & { limit?: number; offset?: number; sort?: "date_desc" | "date_asc" | "amount_desc" }
): Promise<{ transactions: Txn[]; total: number }> {
  await Promise.all([ensureRules(), ensureSplits()]);
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

/** Every matching row, paged past PostgREST's 1000-row cap. For aggregation only, so
 *  Exclusions are dropped unless asked for (explicitly or by filtering on that category). */
// ── Reversals ──────────────────────────────────────────────
// A refund (Money in, kind "refund") that matches an earlier charge on the same card — same currency
// and amount, within 30 days before it — cancels that charge, so totals show what you really spent.
// The charge stays visible in lists; it just stops counting.
let _refunds: { card: string; currency: string; amount: number; txn_date: string }[] = [];
let _refundsAt = 0;

async function ensureRefunds() {
  if (Date.now() - _refundsAt < 30_000) return;
  const { data, error } = await db().from("incoming").select("card, currency, amount, txn_date").eq("kind", "refund");
  _refunds = error ? [] : (data ?? []);
  _refundsAt = Date.now();
}

export function reversedIds(rows: Txn[]): Set<string> {
  const byKey = new Map<string, Txn[]>();
  for (const t of rows) {
    const k = `${t.card}|${t.currency}|${(t.total_amount ?? t.amount).toFixed(2)}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(t);
  }
  const used = new Set<string>();
  for (const r of [..._refunds].sort((a, b) => a.txn_date.localeCompare(b.txn_date))) {
    const cands = (byKey.get(`${r.card}|${r.currency}|${Number(r.amount).toFixed(2)}`) ?? [])
      .filter((t) => !used.has(t.id) && t.txn_date <= r.txn_date && t.txn_date >= shiftDays(r.txn_date, -30))
      .sort((a, b) => b.txn_date.localeCompare(a.txn_date));
    if (cands[0]) used.add(cands[0].id);
  }
  return used;
}

async function fetchAll(f: TxnFilters, opts: { includeExcluded?: boolean } = {}): Promise<Txn[]> {
  await Promise.all([ensureRules(), ensureSplits(), ensureRefunds()]);
  const keepExcluded = opts.includeExcluded || f.category === EXCLUDED;
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
  const reversed = reversedIds(out);
  return out.filter((t) => !reversed.has(t.id) && (keepExcluded || t.category !== EXCLUDED));
}

export async function getTransaction(id: string): Promise<(Txn & { splits: any[] }) | null> {
  await Promise.all([ensureRules(), ensureSplits()]);
  const { data, error } = await db()
    .from("transactions")
    .select(`${TXN_COLUMNS}, raw_desc`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: splits } = await db()
    .from("transaction_splits")
    .select("id, share_amount, currency, status, settled_at, people(id, name)")
    .eq("transaction_id", id);
  return {
    ...cleanTxn(data),
    splits: (splits ?? []).map((s: any) => ({
      split_id: s.id,
      person_id: s.people?.id ?? null,
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
  const rule = row.merchant ? _rules.get(row.merchant) : undefined;
  const owed = _owed.get(row.id);
  const total = Number(row.amount);
  return {
    ...row,
    raw_merchant: row.merchant,
    merchant: rule?.display_name || row.merchant,
    category: row.category, // the row is the source of truth; rules are written into rows
    user_tag: tag && !tag.startsWith("__") ? tag : null,
    total_amount: total,
    amount: owed ? Math.max(0, round2(total - owed.total)) : total,
    split_with: owed?.people ?? 0,
  };
}

// ── Combined currency view ─────────────────────────────────

export type Combine = "SGD" | "INR";

/** Converts every row into one currency at the latest ECB rate. Never used unless asked for. */
async function convertRows(rows: Txn[], to: Combine): Promise<{ rows: Txn[]; fx: { rate: number; date: string } }> {
  const fx = await fxRate("SGD", "INR");
  const conv = (t: Txn): Txn => {
    if (t.currency === to) return t;
    const amount = to === "SGD" ? t.amount / fx.rate : t.amount * fx.rate;
    return { ...t, amount: round2(amount), currency: to };
  };
  return { rows: rows.map(conv), fx: { rate: fx.rate, date: fx.date } };
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
  f: TxnFilters & { group_by: GroupBy; top?: number; combine?: Combine }
): Promise<Record<string, { total: number; count: number; groups: { key: string; total: number; count: number; share_pct: number }[] }>> {
  let rows = await fetchAll(f);
  if (f.combine) rows = (await convertRows(rows, f.combine)).rows;
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

export async function overview(period: Period = "this_month", combine?: Combine) {
  const range = resolvePeriod(period);
  // Same-length window immediately before, for a like-for-like comparison.
  const days =
    (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000 + 1;
  // One round of parallel queries instead of four sequential ones.
  let [rows, prevRows, excludedRows, inRowsRaw] = await Promise.all([
    fetchAll({ from: range.from, to: range.to }),
    period === "all_time" ? Promise.resolve([] as Txn[]) : fetchAll({ from: shiftDays(range.from, -days), to: shiftDays(range.from, -1) }),
    fetchAll({ from: range.from, to: range.to, category: EXCLUDED }),
    fetchIncoming({ from: range.from, to: range.to }),
  ]);
  let fx: { rate: number; date: string } | null = null;
  if (combine) {
    ({ rows, fx } = await convertRows(rows, combine));
    prevRows = (await convertRows(prevRows, combine)).rows;
    excludedRows = (await convertRows(excludedRows, combine)).rows;
  }
  const excluded: Record<string, { total: number; count: number }> = {};
  for (const t of excludedRows) {
    const e = (excluded[t.currency] ??= { total: 0, count: 0 });
    e.total = round2(e.total + t.amount);
    e.count += 1;
  }

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

  // Money in for the same window. Own transfers/top-ups are shown but not counted as income, and
  // refunds aren't either: they already cancel the charge they reverse (see reversedIds).
  let inRows = inRowsRaw;
  if (combine) inRows = (await convertRows(inRows as any, combine)).rows as any;
  const cash_flow: Record<string, any> = {};
  for (const ccy of new Set([...Object.keys(currencies), ...inRows.map((r) => r.currency)])) {
    const ins = inRows.filter((r) => r.currency === ccy && r.kind !== "own_transfer" && r.kind !== "refund");
    const by_kind: Record<string, number> = {};
    for (const r of ins) by_kind[r.kind] = round2((by_kind[r.kind] ?? 0) + r.amount);
    const inTotal = round2(ins.reduce((a, b) => a + b.amount, 0));
    const outTotal = currencies[ccy]?.total ?? 0;
    cash_flow[ccy] = { in_total: inTotal, out_total: outTotal, net: round2(inTotal - outTotal), in_by_kind: by_kind, in_count: ins.length };
  }

  return {
    period: { name: period, ...range, days },
    combined: combine ? { currency: combine, fx_rate: fx?.rate, fx_date: fx?.date } : null,
    cash_flow,
    excluded,
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
    const entry = byKey.get(key) ?? { person_id: person?.id ?? null, name: person?.name ?? "Unknown", currency: row.currency, total: 0, items: [] };
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

// ── Edits (iOS app only; MCP stays read-only) ──────────────

const cleanTag = (t: string | null | undefined) => {
  const v = (t ?? "").trim().replace(/^#+/, "").toLowerCase();
  return v || null;
};

/** Tag one transaction, or every past and future transaction from its merchant. */
export async function setTag(transactionId: string, tag: string | null, applyToMerchant: boolean) {
  const value = cleanTag(tag);
  const { data: row, error } = await db().from("transactions").select("merchant").eq("id", transactionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("transaction not found");
  if (applyToMerchant && row.merchant) {
    // merchant_tags is what the email agent consults for new transactions.
    if (value) {
      const r1 = await db().from("merchant_tags").upsert({ merchant: row.merchant, user_tag: value }, { onConflict: "merchant" });
      if (r1.error) throw new Error(r1.error.message);
    } else {
      await db().from("merchant_tags").delete().eq("merchant", row.merchant);
    }
    const r2 = await db().from("transactions").update({ user_tag: value }).eq("merchant", row.merchant);
    if (r2.error) throw new Error(r2.error.message);
    const { count } = await db().from("transactions").select("id", { count: "exact", head: true }).eq("merchant", row.merchant);
    return { tag: value, updated: count ?? 0, merchant: row.merchant, future: true };
  }
  const r = await db().from("transactions").update({ user_tag: value }).eq("id", transactionId);
  if (r.error) throw new Error(r.error.message);
  return { tag: value, updated: 1, merchant: row.merchant, future: false };
}

/** Set a category on one transaction, or as a rule for its merchant (past + future). */
export async function setCategory(transactionId: string, category: string, applyToMerchant: boolean) {
  const { data: row, error } = await db().from("transactions").select("merchant").eq("id", transactionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("transaction not found");
  if (applyToMerchant && row.merchant) {
    await upsertRule(row.merchant, { category });
    const r = await db().from("transactions").update({ category }).eq("merchant", row.merchant);
    if (r.error) throw new Error(r.error.message);
    const { count } = await db().from("transactions").select("id", { count: "exact", head: true }).eq("merchant", row.merchant);
    return { category, updated: count ?? 0, future: true };
  }
  const r = await db().from("transactions").update({ category }).eq("id", transactionId);
  if (r.error) throw new Error(r.error.message);
  return { category, updated: 1, future: false };
}

/** Custom display name for a merchant; applies to all past and future transactions. Empty resets it. */
export async function renameMerchant(rawMerchant: string, displayName: string | null) {
  const name = displayName?.trim() || null;
  await upsertRule(rawMerchant, { display_name: name });
  const { count } = await db().from("transactions").select("id", { count: "exact", head: true }).eq("merchant", rawMerchant);
  return { merchant: rawMerchant, display_name: name, updated: count ?? 0 };
}

async function upsertRule(merchant: string, patch: Partial<Rule>) {
  await ensureRules();
  const current = _rules.get(merchant) ?? { display_name: null, category: null };
  const next = { merchant, ...current, ...patch, updated_at: new Date().toISOString() };
  const { error } = await db().from("merchant_rules").upsert(next, { onConflict: "merchant" });
  if (error) {
    throw new Error(
      error.message.includes("merchant_rules") ? "merchant_rules table missing: run supabase_merchant_rules.sql" : error.message
    );
  }
  _rules.set(merchant, { display_name: next.display_name, category: next.category, updated_at: next.updated_at });
}

// ── Splits (edit) ──────────────────────────────────────────

async function personId(name: string): Promise<number> {
  const clean = name.trim().replace(/\s+/g, " ");
  const { data, error } = await db().from("people").select("id, name, aliases");
  if (error) throw new Error(error.message);
  const key = clean.toLowerCase();
  const hit = (data ?? []).find(
    (p: any) => p.name.toLowerCase() === key || (p.aliases ?? []).some((a: string) => a.toLowerCase() === key)
  );
  if (hit) return hit.id;
  const ins = await db().from("people").insert({ name: clean }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data.id;
}

export async function listPeople() {
  const { data, error } = await db().from("people").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Replace the unsettled splits on a transaction. Settled ones are kept as history. */
export async function setSplits(transactionId: string, splits: { name: string; amount: number }[]) {
  const { data: txn, error } = await db().from("transactions").select("id, amount, currency").eq("id", transactionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!txn) throw new Error("transaction not found");
  const { data: settled } = await db().from("transaction_splits").select("share_amount").eq("transaction_id", transactionId).eq("status", "settled");
  const settledTotal = (settled ?? []).reduce((a: number, r: any) => a + Number(r.share_amount), 0);
  const clean = splits.filter((s) => s.name?.trim() && Number(s.amount) > 0).map((s) => ({ name: s.name, amount: round2(Number(s.amount)) }));
  const owed = clean.reduce((a, s) => a + s.amount, 0) + settledTotal;
  if (owed > Number(txn.amount) + 0.01) throw new Error("Others can't owe more than the total");

  const rows = [];
  for (const s of clean) rows.push({ transaction_id: transactionId, person_id: await personId(s.name), currency: txn.currency, share_amount: s.amount });
  const del = await db().from("transaction_splits").delete().eq("transaction_id", transactionId).eq("status", "pending");
  if (del.error) throw new Error(del.error.message);
  if (rows.length) {
    const ins = await db().from("transaction_splits").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
  }
  resetSplits();
  return { total: Number(txn.amount), owed_by_others: round2(owed), my_share: round2(Number(txn.amount) - owed), people: clean.length };
}

/** Mark everything a person owes (in one currency) as paid back. */
export async function settlePerson(personId: number, currency: string) {
  const { data, error } = await db()
    .from("transaction_splits")
    .update({ status: "settled", settled_at: new Date().toISOString() })
    .eq("person_id", personId)
    .eq("currency", currency)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  return { settled: data?.length ?? 0 };
}

// ── Money in ───────────────────────────────────────────────

export type Incoming = {
  id: string; card: string; currency: string; amount: number; counterparty: string | null;
  kind: "salary" | "transfer" | "refund" | "own_transfer"; txn_date: string; txn_time: string | null;
};
export const INCOMING_KINDS = ["salary", "transfer", "refund", "own_transfer"] as const;

async function fetchIncoming(f: { from?: string; to?: string; currency?: string; kind?: string }): Promise<Incoming[]> {
  let q = db().from("incoming").select("id, card, currency, amount, counterparty, kind, txn_date, txn_time");
  if (f.from) q = q.gte("txn_date", f.from);
  if (f.to) q = q.lte("txn_date", f.to);
  if (f.currency) q = q.eq("currency", f.currency);
  if (f.kind) q = q.eq("kind", f.kind);
  const { data, error } = await q.order("txn_date", { ascending: false }).limit(2000);
  return error ? [] : ((data ?? []) as Incoming[]); // table missing before migration → no income yet
}

export async function listIncoming(f: { from?: string; to?: string; currency?: string; kind?: string }) {
  const rows = await fetchIncoming(f);
  return { incoming: rows, total: rows.length };
}

/** Change what kind of money-in this is; optionally for everything from this sender, now and in future. */
export async function setIncomingKind(id: string, kind: string, applyToCounterparty: boolean) {
  if (!(INCOMING_KINDS as readonly string[]).includes(kind)) throw new Error("unknown kind");
  const { data: row, error } = await db().from("incoming").select("counterparty").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("not found");
  if (applyToCounterparty && row.counterparty) {
    const r1 = await db().from("incoming_rules").upsert({ counterparty: row.counterparty, kind, updated_at: new Date().toISOString() }, { onConflict: "counterparty" });
    if (r1.error) throw new Error(r1.error.message);
    const r2 = await db().from("incoming").update({ kind }).eq("counterparty", row.counterparty);
    if (r2.error) throw new Error(r2.error.message);
  } else {
    const r = await db().from("incoming").update({ kind }).eq("id", id);
    if (r.error) throw new Error(r.error.message);
  }
  return { kind, counterparty: row.counterparty, all: applyToCounterparty };
}

/** Money in that never arrives as an email (e.g. a stipend by GIRO with no alert). Stored like any other row, id "manual:…". */
export async function addIncoming(b: { amount: number; currency: string; counterparty: string; kind: string; txn_date: string; card?: string }) {
  if (!(b.amount > 0)) throw new Error("amount must be positive");
  if (!["SGD", "INR"].includes(b.currency)) throw new Error("currency must be SGD or INR");
  if (!(INCOMING_KINDS as readonly string[]).includes(b.kind)) throw new Error("unknown kind");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.txn_date ?? "")) throw new Error("txn_date must be YYYY-MM-DD");
  const name = (b.counterparty ?? "").trim().slice(0, 80);
  if (!name) throw new Error("who it came from is required");
  const row = { id: `manual:${crypto.randomUUID()}`, card: (b.card ?? "dbs").toLowerCase().slice(0, 20), currency: b.currency,
    amount: Math.round(b.amount * 100) / 100, counterparty: name, kind: b.kind, raw_desc: "Added by hand", txn_date: b.txn_date, txn_time: null };
  const { error } = await db().from("incoming").insert(row);
  if (error) throw new Error(error.message);
  return row;
}

/** Only hand-added rows can be deleted; alert-backed ones would just come back on the next scan. */
export async function deleteIncoming(id: string) {
  if (!id.startsWith("manual:")) throw new Error("only money in you added by hand can be deleted");
  const { error } = await db().from("incoming").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ── Insight builder + widgets ──────────────────────────────

/** Every merchant (custom names applied) with spend and visit count, most-visited first. */
export async function listMerchants() {
  const rows = await fetchAll({}, { includeExcluded: true });
  const m = new Map<string, { name: string; count: number; last: string; totals: Record<string, number>; renamed: boolean }>();
  for (const t of rows) {
    const name = t.merchant ?? "Unknown";
    const e = m.get(name) ?? { name, count: 0, last: t.txn_date, totals: {}, renamed: t.merchant !== t.raw_merchant };
    e.count += 1;
    e.last = t.txn_date > e.last ? t.txn_date : e.last;
    e.totals[t.currency] = round2((e.totals[t.currency] ?? 0) + t.amount);
    m.set(name, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 400);
}

/** Today / this week / this month totals, for widgets. One query from the earliest start. */
export async function summary(combine?: Combine) {
  const ranges = { today: resolvePeriod("today"), this_week: resolvePeriod("this_week"), this_month: resolvePeriod("this_month") };
  const from = [ranges.today.from, ranges.this_week.from, ranges.this_month.from].sort()[0];
  let rows = await fetchAll({ from });
  if (combine) rows = (await convertRows(rows, combine)).rows;
  const out: Record<string, Record<string, { total: number; count: number }>> = {};
  for (const [key, r] of Object.entries(ranges)) {
    for (const t of rows) {
      if (t.txn_date < r.from || t.txn_date > r.to) continue;
      const c = ((out[key] ??= {})[t.currency] ??= { total: 0, count: 0 });
      c.total = round2(c.total + t.amount);
      c.count += 1;
    }
  }
  return { as_of: new Date().toISOString(), today: todaySGT(), ranges, totals: out };
}

// ── Settlement history ─────────────────────────────────────
// A "Mark as paid" stamps one settled_at on every split it settles, so splits that
// share a person + settled_at are one settlement and can be undone together.

export async function settlementHistory(limit = 50) {
  const { data, error } = await db()
    .from("transaction_splits")
    .select("id, share_amount, currency, settled_at, transaction_id, people(id, name), transactions(merchant, txn_date)")
    .eq("status", "settled")
    .not("settled_at", "is", null)
    .order("settled_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  await ensureRules();
  const batches = new Map<string, any>();
  for (const r of data ?? []) {
    const p = r.people as any, t = r.transactions as any;
    const key = `${p?.id}|${r.settled_at}`;
    const b = batches.get(key) ?? { person_id: p?.id, name: p?.name ?? "Unknown", settled_at: r.settled_at, currency: r.currency, total: 0, items: [] };
    b.total = round2(b.total + Number(r.share_amount));
    const rule = t?.merchant ? _rules.get(t.merchant) : undefined;
    b.items.push({ split_id: r.id, merchant: rule?.display_name || t?.merchant || null, txn_date: t?.txn_date ?? null, share_amount: r.share_amount });
    batches.set(key, b);
  }
  return { settlements: [...batches.values()].slice(0, limit) };
}

/** Undo a settlement: its splits go back to "owes you". */
export async function unsettle(personId: number, settledAt: string) {
  const { data, error } = await db()
    .from("transaction_splits")
    .update({ status: "pending", settled_at: null })
    .eq("person_id", personId)
    .eq("settled_at", settledAt)
    .eq("status", "settled")
    .select("id");
  if (error) throw new Error(error.message);
  resetSplits();
  return { reopened: data?.length ?? 0 };
}

// ── Natural-language search ────────────────────────────────
// "august", "grab aug 2026", "food last month", ">50", "#coffee", "dbs yesterday"
// → structured filters. Whatever isn't understood is matched against merchant names.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const CATEGORY_WORDS: Record<string, string> = {
  food: "Food & Drink", drink: "Food & Drink", drinks: "Food & Drink", eating: "Food & Drink", dining: "Food & Drink", coffee: "Food & Drink",
  transport: "Transport", taxi: "Transport", ride: "Transport", rides: "Transport",
  shopping: "Shopping", subscriptions: "Subscriptions", subscription: "Subscriptions", subs: "Subscriptions",
  health: "Health & Fitness", fitness: "Health & Fitness", gym: "Health & Fitness",
  travel: "Travel", flights: "Travel", bills: "Utilities & Bills", utilities: "Utilities & Bills",
  rent: "Rent & Housing", housing: "Rent & Housing", entertainment: "Entertainment", education: "Education",
  transfers: "Transfers & Misc", transfer: "Transfers & Misc", misc: "Transfers & Misc", exclusions: "Exclusions", excluded: "Exclusions",
};

export type ParsedSearch = TxnFilters & { label: string[] };

export function parseSearch(raw: string, cards: string[] = []): ParsedSearch {
  const out: ParsedSearch = { label: [] };
  const today = todaySGT();
  let text = ` ${raw.toLowerCase().trim()} `;
  const take = (re: RegExp) => { const m = text.match(re); if (m) text = text.replace(m[0], " "); return m; };
  const range = (from: string, to: string, label: string) => { out.from = from; out.to = to > today ? today : to; out.label.push(label); };

  // Relative ranges
  const lastN = take(/\blast (\d{1,3}) days\b/);
  if (lastN) { const n = Number(lastN[1]); range(shiftDays(today, -(n - 1)), today, `Last ${n} days`); }
  const rel: [RegExp, () => void][] = [
    [/\btoday\b/, () => range(today, today, "Today")],
    [/\byesterday\b/, () => { const y = shiftDays(today, -1); range(y, y, "Yesterday"); }],
    [/\bthis week\b/, () => { const r = resolvePeriod("this_week"); range(r.from, r.to, "This week"); }],
    [/\blast week\b/, () => { const r = resolvePeriod("this_week"); range(shiftDays(r.from, -7), shiftDays(r.from, -1), "Last week"); }],
    [/\bthis month\b/, () => { const r = resolvePeriod("this_month"); range(r.from, r.to, "This month"); }],
    [/\blast month\b/, () => { const r = resolvePeriod("last_month"); range(r.from, r.to, "Last month"); }],
    [/\bthis year\b/, () => { const r = resolvePeriod("this_year"); range(r.from, r.to, "This year"); }],
  ];
  for (const [re, fn] of rel) { if (out.from) break; if (take(re)) fn(); }

  // Month name (+ optional year): "aug", "august 2025", "sept"
  if (!out.from) {
    const m = take(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+'?(\d{2,4}))?\b/);
    if (m && (m[0].trim().length >= 3)) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)));
      let year = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : Number(today.slice(0, 4));
      const ym = `${year}-${String(mi + 1).padStart(2, "0")}`;
      if (!m[2] && ym > today.slice(0, 7)) year -= 1; // "december" in October means last December
      const b = monthBounds(`${year}-${String(mi + 1).padStart(2, "0")}`);
      range(b.from, b.to, `${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${year}`);
    }
  }
  // ISO date / range: 2026-08-01, 2026-08-01..2026-08-15
  if (!out.from) {
    const m = take(/\b(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|to|-)\s*(\d{4}-\d{2}-\d{2}))?\b/);
    if (m) range(m[1], m[2] ?? m[1], m[2] ? `${m[1]} → ${m[2]}` : m[1]);
  }

  // Amounts: >50, <20, 10-30, =12.5
  let m = take(/(?:^|\s)([<>]=?)\s*(?:s\$|\$|₹|rs\.?)?\s*(\d+(?:\.\d+)?)/);
  if (m) { const v = Number(m[2]); m[1].startsWith(">") ? (out.min_amount = v) : (out.max_amount = v); out.label.push(`${m[1]}${v}`); }
  m = take(/(?:^|\s)(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)(?=\s)/);
  if (m) { out.min_amount = Number(m[1]); out.max_amount = Number(m[2]); out.label.push(`${m[1]}–${m[2]}`); }
  m = take(/(?:^|\s)(?:s\$|\$|₹|=)\s*(\d+(?:\.\d+)?)(?=\s)/);
  if (m) { const v = Number(m[1]); out.min_amount = v - 0.005; out.max_amount = v + 0.005; out.label.push(`= ${v}`); }
  // A bare number (not a year) is an exact amount: "12.50", "8".
  if (out.min_amount == null && out.max_amount == null && /^\s*\d+(?:\.\d+)?\s*$/.test(text) && !/^\s*(19|20)\d\d\s*$/.test(text)) {
    const v = Number(text.trim()); out.min_amount = v - 0.005; out.max_amount = v + 0.005; out.label.push(`= ${v}`); text = " ";
  }

  // Currency, card, tag
  m = take(/\b(sgd|inr)\b/); if (m) { out.currency = m[1].toUpperCase(); out.label.push(out.currency); }
  m = take(/#([\w-]+(?:\s[\w-]+)?)/); if (m) { out.tag = m[1]; out.label.push(`#${m[1]}`); }
  for (const c of cards) { const r = new RegExp(`\\b${c}\\b`); if (r.test(text)) { text = text.replace(r, " "); out.card = c; out.label.push(c.toUpperCase()); break; } }

  // Category: exact category name or a common word for it — only if it isn't also a merchant word we'd lose.
  for (const cat of CATEGORIES_ALL) {
    const r = new RegExp(`\\b${cat.toLowerCase().replace(/[&]/g, "\\&")}\\b`);
    if (r.test(text)) { text = text.replace(r, " "); out.category = cat; out.label.push(cat); break; }
  }
  if (!out.category) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    // Only treat a word as a category when it's the whole remaining query, so "coffee bean" stays a merchant search.
    if (words.length === 1 && CATEGORY_WORDS[words[0]]) { out.category = CATEGORY_WORDS[words[0]]; out.label.push(out.category); text = " "; }
  }

  const rest = text.replace(/\s+/g, " ").trim();
  if (rest) { out.merchant = rest; out.label.unshift(`“${rest}”`); }
  return out;
}

const CATEGORIES_ALL = [
  "Food & Drink", "Transport", "Shopping", "Subscriptions", "Health & Fitness", "Travel",
  "Utilities & Bills", "Rent & Housing", "Entertainment", "Education", "Transfers & Misc", "Exclusions",
];

let _cardSlugs: string[] = [];
let _cardsAt = 0;
async function cardSlugs() {
  if (Date.now() - _cardsAt > 300_000) {
    const { data } = await db().from("cards").select("card");
    _cardSlugs = (data ?? []).map((c: any) => c.card);
    _cardsAt = Date.now();
  }
  return _cardSlugs;
}

/** Transactions for a free-text query plus explicit filters (explicit ones win). */
export async function searchTransactions(q: string, f: TxnFilters & { limit?: number; offset?: number; sort?: "date_desc" | "date_asc" | "amount_desc" }) {
  const parsed = q.trim() ? parseSearch(q, await cardSlugs()) : { label: [] };
  const { label, ...pf } = parsed as ParsedSearch;
  const merged = { ...pf, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== "")) };
  // Sum of the matching set (your share; Exclusions left out) so "august" also answers "how much".
  // Only on the first page, and in parallel with the list.
  const [res, all] = await Promise.all([listTransactions(merged), f.offset ? Promise.resolve(null) : fetchAll(merged)]);
  const totals: Record<string, number> = {};
  for (const t of all ?? []) totals[t.currency] = round2((totals[t.currency] ?? 0) + t.amount);
  return { ...res, interpreted: label.length ? label.join(" · ") : null, totals };
}

// ── Multi-series insights ──────────────────────────────────
// Compare several things over time: e.g. category "Food & Drink" vs merchant "Anytime Fitness".
// One read of the range, then each series filters in memory.

export type SeriesDef = { kind: "all" | "category" | "merchant" | "tag"; value: string };

export async function compareSeries(opts: {
  series: SeriesDef[]; from: string; to: string; group_by: "day" | "week" | "month"; combine?: Combine;
}) {
  const wantsExcluded = opts.series.some((x) => x.kind === "category" && x.value === EXCLUDED);
  let rows = await fetchAll({ from: opts.from, to: opts.to }, { includeExcluded: wantsExcluded });
  if (opts.combine) rows = (await convertRows(rows, opts.combine)).rows;

  // Every bucket in the range, so empty days/weeks still show as zero.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let d = opts.from; d <= opts.to; d = shiftDays(d, 1)) {
    const k = bucket(d, opts.group_by);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }

  const matches = (t: Txn, def: SeriesDef) => {
    if (def.kind === "all") return t.category !== EXCLUDED;
    if (def.kind === "category") return t.category === def.value;
    if (def.kind === "tag") return (t.user_tag ?? "").toLowerCase() === def.value.toLowerCase();
    const v = def.value.toLowerCase();
    return (t.merchant ?? "").toLowerCase() === v || (t.raw_merchant ?? "").toLowerCase() === v;
  };

  const out: Record<string, { keys: string[]; series: { label: string; kind: string; total: number; count: number; points: number[] }[] }> = {};
  const currencies = new Set(rows.map((r) => r.currency));
  for (const ccy of currencies) {
    const inCcy = rows.filter((r) => r.currency === ccy);
    out[ccy] = {
      keys,
      series: opts.series.map((def) => {
        const pts = new Map<string, number>();
        let total = 0, count = 0;
        for (const t of inCcy) {
          if (!matches(t, def)) continue;
          const k = bucket(t.txn_date, opts.group_by);
          pts.set(k, (pts.get(k) ?? 0) + t.amount);
          total += t.amount; count += 1;
        }
        const label = def.kind === "all" ? "All spending" : def.kind === "tag" ? `#${def.value}` : def.value;
        return { label, kind: def.kind, total: round2(total), count, points: keys.map((k) => round2(pts.get(k) ?? 0)) };
      }),
    };
  }
  return out;
}

function bucket(date: string, g: "day" | "week" | "month") {
  if (g === "month") return date.slice(0, 7);
  if (g === "week") { const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; return shiftDays(date, -dow); }
  return date;
}
