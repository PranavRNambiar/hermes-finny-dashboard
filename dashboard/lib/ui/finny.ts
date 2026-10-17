// Client-side helpers shared by every page. Mirrors ios/Shared (Models + Theme).

export type Txn = {
  id: string; card: string; currency: string; amount: number; total_amount: number; split_with: number;
  merchant: string | null; raw_merchant: string | null; category: string; txn_date: string; txn_time: string | null;
  anomaly_flagged: boolean; user_tag: string | null; raw_desc?: string | null;
  orig_currency?: string | null; orig_amount?: number | null; fx_rate?: number | null;
  splits?: { split_id: number; person_id: number | null; person: string | null; share_amount: number; currency: string; status: string }[];
};
export type KeyTotal = { key: string; total: number };
export type CurrencySummary = {
  total: number; count: number; previous_period_total: number; change_pct: number | null; avg_per_day: number;
  by_category: KeyTotal[]; top_merchants: KeyTotal[]; by_card: KeyTotal[]; daily: { date: string; total: number }[]; largest: Txn[];
};
export type Overview = {
  period: { name: string; from: string; to: string; label: string; days: number };
  combined: { currency: string; fx_rate: number; fx_date: string } | null;
  cash_flow?: Record<string, { in_total: number; out_total: number; net: number; in_by_kind: Record<string, number>; in_count: number }>;
  excluded?: Record<string, { total: number; count: number }>;
  currencies: Record<string, CurrencySummary>;
};
export type Breakdown = { total: number; count: number; groups: { key: string; total: number; count: number; share_pct: number }[] };
export type Incoming = { id: string; card: string; currency: string; amount: number; counterparty: string | null; kind: string; txn_date: string; txn_time: string | null };

export const CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Subscriptions", "Health & Fitness", "Travel",
  "Utilities & Bills", "Rent & Housing", "Entertainment", "Education", "Gifts", "Transfers & Misc", "Exclusions",
];

// ── Currency mode (same four options as iOS) ───────────────

export type Mode = "SGD" | "INR" | "ALL_SGD" | "ALL_INR";
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "SGD", label: "SGD", hint: "SGD cards only" },
  { id: "INR", label: "INR", hint: "INR cards only" },
  { id: "ALL_SGD", label: "All in S$", hint: "Everything, converted" },
  { id: "ALL_INR", label: "All in ₹", hint: "Everything, converted" },
];
export const modeCurrency = (m: Mode) => (m.endsWith("INR") ? "INR" : "SGD");
export const modeCombine = (m: Mode) => (m.startsWith("ALL_") ? modeCurrency(m) : undefined);

// ── Periods ────────────────────────────────────────────────

export type Period = "today" | "last_7_days" | "this_week" | "this_month" | "last_month" | "last_30_days" | "this_quarter" | "this_year";
export const OVERVIEW_PERIODS: { id: Period; short: string }[] = [
  { id: "last_7_days", short: "7D" }, { id: "this_month", short: "Month" }, { id: "last_month", short: "Last mo" },
  { id: "last_30_days", short: "30D" }, { id: "this_year", short: "Year" },
];

// ── Money ──────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = { SGD: "S$", INR: "₹", USD: "US$", EUR: "€", GBP: "£", JPY: "¥", MYR: "RM", THB: "฿", AUD: "A$", HKD: "HK$", CHF: "CHF ", IDR: "Rp" };
export const symbol = (c: string) => SYMBOLS[c] ?? `${c} `;
/** "€21.46" for a foreign spend, else null. */
export const foreignLabel = (t: Pick<Txn, "orig_currency" | "orig_amount">) =>
  t.orig_currency && t.orig_amount != null ? `${symbol(t.orig_currency)}${Number(t.orig_amount).toFixed(2)}` : null;
export function number(n: number, c: string) {
  const digits = c === "INR" || n >= 10_000 ? 0 : 2;
  return n.toLocaleString(c === "INR" ? "en-IN" : "en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const money = (n: number, c: string) => symbol(c) + number(n, c);
export const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Bank alerts shout. Title-case ALL-CAPS names; keep short acronyms (SMU, DBS). */
export function prettyMerchant(raw: string) {
  if (raw !== raw.toUpperCase() || !/[A-Z]/.test(raw)) return raw;
  return raw.split(" ").map((w) => {
    const letters = w.replace(/[^A-Z]/g, "");
    if (letters.length > 0 && letters.length <= 3 && !["THE", "AND", "PTE", "LTD"].includes(letters)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(" ");
}
export const displayMerchant = (t: Pick<Txn, "merchant" | "raw_merchant">) =>
  !t.merchant ? "Unknown merchant" : t.raw_merchant && t.raw_merchant !== t.merchant ? t.merchant : prettyMerchant(t.merchant);

export const cardLabel = (c: string) => (c === "dbs" ? "DBS" : c === "ocbc" ? "OCBC" : c.charAt(0).toUpperCase() + c.slice(1));

export function quip(pct: number | null) {
  if (pct == null) return "Every dollar, accounted for.";
  if (pct < -25) return "Restraint looks good on you.";
  if (pct < -5) return "Trending the right way. Quietly.";
  if (pct < 5) return "Steady. Suspiciously steady.";
  if (pct < 25) return "A little looser than last time.";
  return "Someone's been treating themselves.";
}

export function dayLabel(iso: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  const d = new Date(`${iso}T00:00:00`);
  const y = new Date(`${today}T00:00:00`); y.setDate(y.getDate() - 1);
  if (iso === today) return "Today";
  if (d.getTime() === y.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
}

// ── Category chips (same pastel pairs as iOS) ──────────────

const CHIPS: Record<string, [string, string, string, string]> = {
  "Food & Drink": ["#FFF0DB", "#B25E09", "#3A2A12", "#FFB45C"],
  Transport: ["#E1ECFF", "#2457C5", "#152540", "#8AB4FF"],
  Shopping: ["#FFE3EC", "#C2255C", "#3A1724", "#FF8FB3"],
  Subscriptions: ["#EDE5FF", "#6741D9", "#241C3D", "#B49CFF"],
  "Health & Fitness": ["#DDF6EC", "#0C8A62", "#113A2E", "#5FE0B2"],
  Travel: ["#DFF5FA", "#0B7285", "#0F3038", "#66D9EF"],
  "Utilities & Bills": ["#E9ECF2", "#495074", "#222A36", "#B3BAD4"],
  "Rent & Housing": ["#FFE8E3", "#C92A2A", "#3D1A17", "#FF8F87"],
  Entertainment: ["#FBE4FF", "#A61E9E", "#351838", "#F08CEB"],
  Education: ["#E5E8FF", "#3B49C9", "#1D2140", "#9CA6FF"],
  Gifts: ["#FFF4D1", "#9A6A00", "#3A3013", "#FFD25E"],
  Exclusions: ["#ECEDF1", "#8A8FA8", "#20252E", "#7D839C"],
};
const FALLBACK: [string, string, string, string] = ["#EDEEF2", "#5F6485", "#232A35", "#A3A9C2"];
export function chip(category: string, dark = false) {
  const [bg, fg, dbg, dfg] = CHIPS[category] ?? FALLBACK;
  return dark ? { bg: dbg, fg: dfg } : { bg, fg };
}

// ── Fetching ───────────────────────────────────────────────

export async function api<T>(path: string, params: Record<string, string | number | undefined | null> = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  const res = await fetch(`/api/v1/${path}${q.size ? `?${q}` : ""}`, { cache: "no-store" });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("signed out"); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
  return res.json();
}

export async function send<T = unknown>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Couldn't save (${res.status})`);
  return res.json();
}

/** Transaction ids are email message ids (may contain / < > @). */
export const encId = (id: string) => encodeURIComponent(id);
