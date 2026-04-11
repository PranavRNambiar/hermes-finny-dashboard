"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { getSupabase } from "@/lib/supabase";
import { CATEGORY_COLORS } from "@/lib/categories";

interface DailyTotal { date: string; total: number }
interface CategoryTotal { category: string; total: number }
interface CardTotal { card: string; total: number }

// ── SGD Panel (DBS only) ─────────────────────────────────────────────────────

function SGDPanel() {
  const [daily, setDaily] = useState<DailyTotal[]>([]);
  const [mtd, setMtd] = useState(0);
  const [cats, setCats] = useState<CategoryTotal[]>([]);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 30);
    const fromStr = from.toISOString().split("T")[0];
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

    // Daily totals — SGD only
    getSupabase()
      .from("transactions")
      .select("txn_date, amount")
      .eq("currency", "SGD")
      .gte("txn_date", fromStr)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.txn_date] = (map[r.txn_date] ?? 0) + r.amount; });
        setDaily(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total })));
      });

    // MTD — SGD only
    getSupabase()
      .from("transactions")
      .select("amount")
      .eq("currency", "SGD")
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => setMtd((data ?? []).reduce((s, r) => s + r.amount, 0)));

    // Category breakdown — SGD only
    getSupabase()
      .from("transactions")
      .select("category, amount")
      .eq("currency", "SGD")
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.category] = (map[r.category] ?? 0) + r.amount; });
        setCats(Object.entries(map).map(([category, total]) => ({ category, total })));
      });
  }, []);

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">SGD Spend — DBS Debit</h2>
        <span className="text-2xl font-mono font-bold text-blue-600">S${mtd.toFixed(2)} MTD</span>
      </div>

      <p className="text-sm text-gray-500 mb-3">Daily spend — last 30 days (S$)</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={daily}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `S$${v}`} />
          <Tooltip formatter={(v) => [`S$${Number(v).toFixed(2)}`, "Spend"]} />
          <Bar dataKey="total" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <p className="text-sm text-gray-500 mt-6 mb-3">Categories this month (SGD)</p>
      <div className="flex gap-8 items-center">
        <ResponsiveContainer width={220} height={180}>
          <PieChart>
            <Pie data={cats} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={80}>
              {cats.map((c) => (
                <Cell key={c.category} fill={CATEGORY_COLORS[c.category] ?? "#9ca3af"} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `S$${Number(v).toFixed(2)}`} />
          </PieChart>
        </ResponsiveContainer>
        <ul className="text-xs space-y-1">
          {cats.sort((a, b) => b.total - a.total).map((c) => (
            <li key={c.category} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CATEGORY_COLORS[c.category] ?? "#9ca3af" }} />
              {c.category}: S${c.total.toFixed(2)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── INR Panel (Scapia + Axis Atlas) ─────────────────────────────────────────

function INRPanel() {
  const [daily, setDaily] = useState<DailyTotal[]>([]);
  const [mtd, setMtd] = useState(0);
  const [cats, setCats] = useState<CategoryTotal[]>([]);
  const [byCard, setByCard] = useState<CardTotal[]>([]);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 30);
    const fromStr = from.toISOString().split("T")[0];
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

    // Daily totals — INR only
    getSupabase()
      .from("transactions")
      .select("txn_date, amount")
      .eq("currency", "INR")
      .gte("txn_date", fromStr)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.txn_date] = (map[r.txn_date] ?? 0) + r.amount; });
        setDaily(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total })));
      });

    // MTD — INR only
    getSupabase()
      .from("transactions")
      .select("amount, card")
      .eq("currency", "INR")
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => {
        const rows = data ?? [];
        setMtd(rows.reduce((s, r) => s + r.amount, 0));
        const cardMap: Record<string, number> = {};
        rows.forEach((r) => { cardMap[r.card] = (cardMap[r.card] ?? 0) + r.amount; });
        setByCard(Object.entries(cardMap).map(([card, total]) => ({ card, total })));
      });

    // Category breakdown — INR only
    getSupabase()
      .from("transactions")
      .select("category, amount")
      .eq("currency", "INR")
      .gte("txn_date", firstOfMonth)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach((r) => { map[r.category] = (map[r.category] ?? 0) + r.amount; });
        setCats(Object.entries(map).map(([category, total]) => ({ category, total })));
      });
  }, []);

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900">INR Spend — Scapia + Axis Atlas</h2>
        <span className="text-2xl font-mono font-bold text-teal-600">₹{mtd.toFixed(2)} MTD</span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        {byCard.map((c) => `${c.card.toUpperCase()}: ₹${c.total.toFixed(2)}`).join("  ·  ")}
      </p>

      <p className="text-sm text-gray-500 mb-3">Daily spend — last 30 days (₹)</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={daily}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}`} />
          <Tooltip formatter={(v) => [`₹${Number(v).toFixed(2)}`, "Spend"]} />
          <Bar dataKey="total" fill="#14b8a6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <p className="text-sm text-gray-500 mt-6 mb-3">Categories this month (INR)</p>
      <div className="flex gap-8 items-center">
        <ResponsiveContainer width={220} height={180}>
          <PieChart>
            <Pie data={cats} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={80}>
              {cats.map((c) => (
                <Cell key={c.category} fill={CATEGORY_COLORS[c.category] ?? "#9ca3af"} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)}`} />
          </PieChart>
        </ResponsiveContainer>
        <ul className="text-xs space-y-1">
          {cats.sort((a, b) => b.total - a.total).map((c) => (
            <li key={c.category} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CATEGORY_COLORS[c.category] ?? "#9ca3af"}} />
              {c.category}: ₹{c.total.toFixed(2)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <a href="/" className="text-sm text-blue-600 hover:underline">← Transactions</a>
        </div>
        <SGDPanel />
        <INRPanel />
      </div>
    </div>
  );
}
