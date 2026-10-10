"use client";

import { useEffect, useState } from "react";

const INR_PER_SGD = 72;

type Period = "today" | "week" | "month" | "lastmonth" | "quarter" | "custom";

interface TagRow {
  tag: string;
  sgd: number;
  inr: number;
  totalSgd: number;
  count: number;
}

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "week",      label: "7 days" },
  { key: "month",     label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter",   label: "3 months" },
  { key: "custom",    label: "Custom" },
];

const TAG_PALETTE = [
  "#6366f1", "#14b8a6", "#f59e0b", "#22c55e", "#ec4899",
  "#3b82f6", "#f97316", "#a855f7", "#ef4444", "#06b6d4",
];

function getRange(period: Period, customFrom: string, customTo: string): [string, string] {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const t = fmt(today);
  if (period === "today") return [t, t];
  if (period === "week") {
    const d = new Date(today); d.setDate(today.getDate() - 6);
    return [fmt(d), t];
  }
  if (period === "month") {
    return [fmt(new Date(today.getFullYear(), today.getMonth(), 1)), t];
  }
  if (period === "lastmonth") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return [fmt(from), fmt(to)];
  }
  if (period === "quarter") {
    const d = new Date(today); d.setDate(today.getDate() - 89);
    return [fmt(d), t];
  }
  return [customFrom, customTo];
}

export default function TagsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<TagRow[]>([]);
  const [untagged, setUntagged] = useState<TagRow | null>(null);
  const [loading, setLoading] = useState(false);

  const [from, to] = getRange(period, customFrom, customTo);

  useEffect(() => {
    if (period === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);

    fetch(`/api/rows?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(({ rows: data }: { rows?: { user_tag: string | null; amount: number; currency: string }[] }) => {
        const map: Record<string, { sgd: number; inr: number; count: number }> = {};
        const untaggedBucket = { sgd: 0, inr: 0, count: 0 };

        for (const r of data ?? []) {
          const raw = (r.user_tag ?? "").trim().toLowerCase();
          const isTagged = raw && !raw.startsWith("__");
          const bucket = isTagged
            ? (map[raw] ??= { sgd: 0, inr: 0, count: 0 })
            : untaggedBucket;
          if (r.currency === "SGD") bucket.sgd += r.amount;
          else bucket.inr += r.amount;
          bucket.count++;
        }

        const result: TagRow[] = Object.entries(map)
          .map(([tag, b]) => ({ tag, sgd: b.sgd, inr: b.inr, totalSgd: b.sgd + b.inr / INR_PER_SGD, count: b.count }))
          .sort((a, b) => b.totalSgd - a.totalSgd);

        setRows(result);
        setUntagged({
          tag: "untagged",
          sgd: untaggedBucket.sgd,
          inr: untaggedBucket.inr,
          totalSgd: untaggedBucket.sgd + untaggedBucket.inr / INR_PER_SGD,
          count: untaggedBucket.count,
        });
        setLoading(false);
      });
  }, [period, from, to]);

  const taggedTotal = rows.reduce((s, r) => s + r.totalSgd, 0);
  const grandTotal = taggedTotal + (untagged?.totalSgd ?? 0);
  const taggedPct = grandTotal > 0 ? (taggedTotal / grandTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Period pills */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-0.5">
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              period === p.key
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-white text-gray-500 border border-gray-200 hover:border-gray-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-600 focus:outline-none hover:border-gray-300"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-600 focus:outline-none hover:border-gray-300"
          />
        </div>
      )}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white p-5 shadow-lg shadow-violet-600/20">
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute right-6 bottom-2 w-16 h-16 rounded-full bg-white/10" />
        <p className="relative text-xs font-medium text-violet-100 uppercase tracking-wider mb-3">
          Tagged spend
        </p>
        <div className="relative flex items-end gap-4">
          <div>
            <p className="text-3xl font-bold tracking-tight">S${taggedTotal.toFixed(2)}</p>
            <p className="text-xs text-violet-200 mt-1">
              {rows.length} tag{rows.length !== 1 ? "s" : ""}
            </p>
          </div>
          {grandTotal > 0 && (
            <>
              <div className="h-10 w-px bg-white/20" />
              <div>
                <p className="text-3xl font-bold tracking-tight">{taggedPct.toFixed(0)}%</p>
                <p className="text-xs text-violet-200 mt-1">of S${grandTotal.toFixed(2)} total</p>
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
      ) : rows.length === 0 && !untagged?.totalSgd ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-3">#</p>
          <p className="text-sm">No transactions in this period</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {rows.map((row, i) => {
            const color = TAG_PALETTE[i % TAG_PALETTE.length];
            const pct = grandTotal > 0 ? (row.totalSgd / grandTotal) * 100 : 0;

            return (
              <div key={row.tag} className="px-4 py-3.5 border-b border-gray-50 last:border-b-0">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-sm font-medium text-gray-900 truncate">#{row.tag}</span>
                    <span className="text-xs text-gray-400 shrink-0">{row.count} txn{row.count !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">S${row.totalSgd.toFixed(2)}</span>
                    <span className="text-xs text-gray-400 ml-1.5">{pct.toFixed(0)}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                {row.sgd > 0 && row.inr > 0 && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    S${row.sgd.toFixed(2)} SGD · ₹{row.inr.toFixed(2)} INR
                  </p>
                )}
              </div>
            );
          })}

          {untagged && untagged.totalSgd > 0 && (
            <div className="px-4 py-3.5 bg-gray-50/70">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                  <span className="text-sm font-medium text-gray-400">Untagged</span>
                  <span className="text-xs text-gray-300">{untagged.count} txn{untagged.count !== 1 ? "s" : ""}</span>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className="text-sm font-semibold text-gray-400 tabular-nums">S${untagged.totalSgd.toFixed(2)}</span>
                  <span className="text-xs text-gray-300 ml-1.5">
                    {grandTotal > 0 ? ((untagged.totalSgd / grandTotal) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gray-300"
                  style={{ width: `${grandTotal > 0 ? (untagged.totalSgd / grandTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
