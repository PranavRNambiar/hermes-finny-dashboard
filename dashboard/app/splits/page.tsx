"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon, UsersIcon } from "@/components/Icons";

interface SplitEntry {
  id: number;
  transaction_id: string;
  merchant: string | null;
  txn_date: string | null;
  amount: number | null;
  share_amount: number;
  divide_synced: boolean;
}

interface PersonGroup {
  person_id: number;
  name: string;
  currency: string;
  divide_linked: boolean;
  total: number;
  count: number;
  splits: SplitEntry[];
}

interface Cashflow {
  settled_lifetime_by_currency: Record<string, number>;
  avg_days_to_settle: number | null;
  settled_count: number;
}

const AVATAR_COLORS = ["#6366f1", "#14b8a6", "#f97316", "#ec4899", "#8b5cf6", "#22c55e", "#f59e0b"];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash)];
}

function fmt(amount: number, currency: string): string {
  return currency === "SGD" ? `S$${amount.toFixed(2)}` : `₹${amount.toFixed(2)}`;
}

export default function SplitsPage() {
  const [groups, setGroups] = useState<PersonGroup[]>([]);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/splits");
    const data = await res.json();
    setGroups(data.by_person ?? []);
    setCashflow(data.cashflow ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function settlePerson(group: PersonGroup) {
    const key = `${group.person_id}:${group.currency}`;
    setSettling(key);
    await fetch("/api/splits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "settle_person",
        person_id: group.person_id,
        currency: group.currency,
      }),
    });
    await load();
    setSettling(null);
  }

  const totals: Record<string, number> = {};
  let totalCount = 0;
  groups.forEach((g) => {
    totals[g.currency] = (totals[g.currency] ?? 0) + g.total;
    totalCount += g.count;
  });

  return (
    <div className="space-y-4">
      {/* Hero summary card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-5 shadow-lg shadow-emerald-600/20">
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute right-6 bottom-2 w-16 h-16 rounded-full bg-white/10" />
        <div className="relative flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-emerald-100 uppercase tracking-wider">Owed to you</p>
          <button
            onClick={load}
            disabled={loading}
            className="text-emerald-200 hover:text-white transition-colors disabled:opacity-40"
            aria-label="Refresh"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <div className="relative flex items-end gap-6">
          <div>
            <p className="text-3xl font-bold tracking-tight">S${(totals.SGD ?? 0).toFixed(2)}</p>
          </div>
          <div className="h-10 w-px bg-white/20" />
          <div>
            <p className="text-3xl font-bold tracking-tight">₹{(totals.INR ?? 0).toFixed(2)}</p>
          </div>
        </div>
        <p className="relative text-xs text-emerald-100 mt-2">
          {totalCount} pending split{totalCount !== 1 ? "s" : ""} across {groups.length} group{groups.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Per-person groups */}
      <div className="space-y-3">
        {groups.map((g) => {
          const key = `${g.person_id}:${g.currency}`;
          const color = avatarColor(g.name);
          return (
            <div key={key} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ backgroundColor: color + "1a", color }}
                  >
                    {g.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                      {g.divide_linked && (
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 rounded-full px-1.5 py-0.5">
                          Divide
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {g.count} transaction{g.count !== 1 ? "s" : ""} · {g.currency}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 tabular-nums mb-1">{fmt(g.total, g.currency)}</p>
                  <button
                    onClick={() => settlePerson(g)}
                    disabled={settling === key}
                    className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:text-gray-300 transition-colors ml-auto"
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    {settling === key ? "Settling…" : "Mark settled"}
                  </button>
                </div>
              </div>

              {g.splits.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-b-0"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm text-gray-700">{s.merchant || "Unknown"}</p>
                      {s.divide_synced && (
                        <span className="text-[9px] font-semibold text-violet-500 bg-violet-50 rounded-full px-1.5 py-0.5 leading-none">
                          ÷ Divide
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{s.txn_date}</p>
                  </div>
                  <p className="text-sm font-medium text-gray-900 tabular-nums">{fmt(s.share_amount, g.currency)}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Cashflow / cash conversion cycle */}
      {cashflow && cashflow.settled_count > 0 && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Cashflow</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {cashflow.avg_days_to_settle != null ? cashflow.avg_days_to_settle.toFixed(1) : "—"}
                <span className="text-sm font-medium text-gray-400 ml-1">days</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Avg to get paid back</p>
            </div>
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {Object.entries(cashflow.settled_lifetime_by_currency).map(([cur, amt]) => (
                  <p key={cur} className="text-2xl font-bold text-gray-900 tabular-nums">
                    {fmt(amt, cur)}
                  </p>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Collected lifetime</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && groups.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="w-14 h-14 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center mx-auto mb-3">
            <UsersIcon className="w-6 h-6 text-gray-300" />
          </div>
          <p className="text-sm">No outstanding splits</p>
        </div>
      )}

      {loading && (
        <div className="text-center mt-6 text-sm text-gray-400 py-4">Loading…</div>
      )}
    </div>
  );
}
