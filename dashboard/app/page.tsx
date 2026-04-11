"use client";

import { useEffect, useState } from "react";
import { CATEGORY_COLORS, CARD_COLORS, CATEGORIES } from "@/lib/categories";

interface Transaction {
  id: string;
  card: string;
  currency: string;
  amount: number;
  merchant: string | null;
  category: string;
  txn_date: string;
  anomaly_flagged: boolean;
}

const CARDS = ["dbs", "scapia", "axis"];

export default function TransactionFeed() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [filterCard, setFilterCard] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  useEffect(() => {
    setPage(1);
    setTransactions([]);
  }, [filterCard, filterCategory, filterFrom, filterTo]);

  useEffect(() => {
    fetchTransactions(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterCard, filterCategory, filterFrom, filterTo]);

  async function fetchTransactions(p: number) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "50" });
    if (filterCard) params.set("card", filterCard);
    if (filterCategory) params.set("category", filterCategory);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);

    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();
    setTransactions((prev) => p === 1 ? data.transactions : [...prev, ...data.transactions]);
    setTotal(data.total);
    setLoading(false);
  }

  const hasMore = transactions.length < total;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Finny — Transactions</h1>
          <a href="/analytics" className="text-sm text-blue-600 hover:underline">Analytics →</a>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg shadow-sm border p-4 mb-6 flex flex-wrap gap-3">
          <select
            className="border rounded px-3 py-1.5 text-sm"
            value={filterCard}
            onChange={(e) => setFilterCard(e.target.value)}
          >
            <option value="">All cards</option>
            {CARDS.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>

          <select
            className="border rounded px-3 py-1.5 text-sm"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <input
            type="date"
            className="border rounded px-3 py-1.5 text-sm"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
          <input
            type="date"
            className="border rounded px-3 py-1.5 text-sm"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />

          {(filterCard || filterCategory || filterFrom || filterTo) && (
            <button
              className="text-sm text-gray-500 hover:text-gray-700"
              onClick={() => { setFilterCard(""); setFilterCategory(""); setFilterFrom(""); setFilterTo(""); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Merchant</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Card</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{txn.txn_date}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {txn.merchant || "—"}
                    {txn.anomaly_flagged && (
                      <span className="ml-1.5" title="Anomaly flagged">⚠️</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-gray-900 whitespace-nowrap">
                    {txn.currency === "SGD" ? "S$" : "₹"}{txn.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CARD_COLORS[txn.card] ?? "bg-gray-100 text-gray-700"}`}>
                      {txn.card.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: CATEGORY_COLORS[txn.category] ?? "#9ca3af" }}
                    >
                      {txn.category}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && transactions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {(loading || hasMore) && (
            <div className="border-t p-4 text-center">
              {loading ? (
                <span className="text-sm text-gray-400">Loading…</span>
              ) : (
                <button
                  className="text-sm text-blue-600 hover:underline"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Load more ({total - transactions.length} remaining)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
