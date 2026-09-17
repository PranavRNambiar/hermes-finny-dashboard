"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { getSupabase } from "@/lib/supabase";
import { CATEGORY_COLORS } from "@/lib/categories";

interface DailyTotal { date: string; total: number }
interface CategoryTotal { category: string; total: number }
interface CardTotal { card: string; total: number }

const CURRENCIES = [
  { key: "SGD", label: "SGD", symbol: "S$", color: "#6366f1", sub: "DBS Debit" },
  { key: "INR", label: "INR", symbol: "₹", color: "#14b8a6", sub: "Scapia + Axis Atlas" },
] as const;

function CurrencyPanel({ currency, symbol, color, sub }: { currency: "SGD" | "INR"; symbol: string; color: string; sub: string }) {
  const [daily, setDaily] = useState<DailyTotal[]>([]);
  const [mtd, setMtd] = useState(0);
  const [cats, setCats] = useState<CategoryTotal[]>([]);
  const [byCard, setByCard] = useState<CardTotal[]>([]);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 30);
    const fromStr = from.toISOString().split("T")[0];
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

    getSupabase()
      .from("transactions")
      .select("txn_date, amount")
      .eq("currency", currency)
      .gte("txn_date", fromStr)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.txn_date] = (map[r.txn_date] ?? 0) + r.amount; });
        const result: DailyTotal[] = [];
        for (let i = 30; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const key = d.toISOString().split("T")[0];
          result.push({ date: key, total: map[key] ?? 0 });
        }
        setDaily(result);
      });

    getSupabase()
      .from("transactions")
      .select("amount, card")
      .eq("currency", currency)
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => {
        const rows = data ?? [];
        setMtd(rows.reduce((s, r) => s + r.amount, 0));
        const cardMap: Record<string, number> = {};
        rows.forEach((r) => { cardMap[r.card] = (cardMap[r.card] ?? 0) + r.amount; });
        setByCard(Object.entries(cardMap).map(([card, total]) => ({ card, total })).sort((a, b) => b.total - a.total));
      });

    getSupabase()
      .from("transactions")
      .select("category, amount")
      .eq("currency", currency)
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.category] = (map[r.category] ?? 0) + r.amount; });
        setCats(Object.entries(map).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total));
      });
  }, [currency]);

  const catTotal = cats.reduce((s, c) => s + c.total, 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-gray-600 mb-0.5">
          {new Date(label + "T00:00:00").toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })}
        </p>
        <p className="font-bold text-gray-900">{symbol}{Number(payload[0].value).toFixed(2)}</p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Hero MTD card */}
      <div className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 10px 30px -10px ${color}55` }}>
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute right-8 bottom-0 w-16 h-16 rounded-full bg-white/10" />
        <p className="relative text-xs font-medium text-white/80 uppercase tracking-wider mb-1">Month to date · {sub}</p>
        <p className="relative text-4xl font-bold tracking-tight">{symbol}{mtd.toFixed(2)}</p>
      </div>

      {/* Trend chart */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">31-day trend</p>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={daily} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`trendGrad-${currency}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(d) => d.slice(8)} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }} />
            <Area type="monotone" dataKey="total" stroke={color} strokeWidth={2} fill={`url(#trendGrad-${currency})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Card breakdown (INR only really useful, but render generically) */}
      {byCard.length > 1 && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">By card</p>
          <div className="space-y-2.5">
            {byCard.map((c) => (
              <div key={c.card} className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{c.card.toUpperCase()}</span>
                <div className="flex items-center gap-2 flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${mtd > 0 ? (c.total / mtd) * 100 : 0}%`, backgroundColor: color }} />
                </div>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">{symbol}{c.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category donut */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Categories this month</p>
        {cats.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No spend yet this month</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={cats} dataKey="total" nameKey="category" cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
                    {cats.map((c) => (
                      <Cell key={c.category} fill={CATEGORY_COLORS[c.category] ?? "#9ca3af"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `${symbol}${Number(v).toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs text-gray-400">Total</span>
                <span className="text-sm font-bold text-gray-900">{symbol}{catTotal.toFixed(0)}</span>
              </div>
            </div>
            <ul className="flex-1 space-y-1.5 min-w-0">
              {cats.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: CATEGORY_COLORS[c.category] ?? "#9ca3af" }} />
                    <span className="text-gray-600 truncate">{c.category}</span>
                  </span>
                  <span className="font-semibold text-gray-900 tabular-nums shrink-0">{symbol}{c.total.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<"SGD" | "INR">("SGD");
  const active = CURRENCIES.find((c) => c.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 bg-white rounded-full p-1 border border-gray-100 shadow-sm w-fit">
        {CURRENCIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setTab(c.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              tab === c.key ? "text-white shadow-sm" : "text-gray-400 hover:text-gray-600"
            }`}
            style={tab === c.key ? { backgroundColor: c.color } : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>

      <CurrencyPanel currency={active.key} symbol={active.symbol} color={active.color} sub={active.sub} />
    </div>
  );
}
