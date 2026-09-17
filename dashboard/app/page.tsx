"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { CATEGORY_COLORS, CATEGORIES, cardBadgeClass } from "@/lib/categories";
import { getSupabase } from "@/lib/supabase";
import { DownloadIcon, XIcon, ArrowUpRightIcon, ChevronRightIcon, TagIcon, EyeIcon, EyeOffIcon } from "@/components/Icons";

interface Transaction {
  id: string;
  card: string;
  currency: string;
  amount: number;
  merchant: string | null;
  category: string;
  txn_date: string;
  txn_time: string | null;
  anomaly_flagged: boolean;
  user_tag: string | null;
}

interface DailyBar { date: string; sgd: number; inr: number }

const DEFAULT_CARDS = ["wise", "scapia", "axis", "ixigo", "dbs"];
const INR_PER_SGD = 72;

type CombineMode = "split" | "SGD" | "INR";
const COMBINE_MODE_KEY = "finny_combine_mode";
const FX_LIVE_KEY = "finny_fx_live";

function formatDate(dateStr: string): string {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function groupByDate(txns: Transaction[]): [string, Transaction[]][] {
  const groups: Record<string, Transaction[]> = {};
  for (const t of txns) {
    if (!groups[t.txn_date]) groups[t.txn_date] = [];
    groups[t.txn_date].push(t);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

function ExportButton({ filterFrom, filterTo }: { filterFrom: string; filterTo: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function download(period: string) {
    setOpen(false);
    let url = `/api/export?period=${period}`;
    if (period === "custom" && filterFrom && filterTo) {
      url = `/api/export?from=${filterFrom}&to=${filterTo}`;
    }
    window.location.href = url;
  }

  const options = [
    { key: "daily",     label: "Today" },
    { key: "monthly",   label: "This month" },
    { key: "quarterly", label: "This quarter" },
    ...(filterFrom && filterTo ? [{ key: "custom", label: `${filterFrom} → ${filterTo}` }] : []),
  ];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Export CSV"
        className="flex items-center justify-center w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-all"
      >
        <DownloadIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-20">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => download(o.key)}
              className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SpendingChart({ mode, rate }: { mode: CombineMode; rate: number }) {
  const [data, setData] = useState<DailyBar[]>([]);

  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() - 13);
    const fromStr = from.toISOString().split("T")[0];

    getSupabase()
      .from("transactions")
      .select("txn_date, amount, currency")
      .gte("txn_date", fromStr)
      .then(({ data: rows }) => {
        const map: Record<string, { sgd: number; inr: number }> = {};
        (rows ?? []).forEach((r) => {
          if (!map[r.txn_date]) map[r.txn_date] = { sgd: 0, inr: 0 };
          if (r.currency === "SGD") map[r.txn_date].sgd += r.amount;
          else map[r.txn_date].inr += r.amount;
        });
        const result: DailyBar[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const key = d.toISOString().split("T")[0];
          result.push({ date: key, sgd: map[key]?.sgd ?? 0, inr: map[key]?.inr ?? 0 });
        }
        setData(result);
      });
  }, []);

  // Series derived per mode — conversion happens at render time so one fetch serves all views
  const chartData = useMemo(() =>
    data.map((d) => ({
      ...d,
      inr_as_sgd: d.inr / rate,
      combined: mode === "INR" ? d.inr + d.sgd * rate : d.sgd + d.inr / rate,
    })),
  [data, mode, rate]);

  const sym = mode === "INR" ? "₹" : "S$";

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const day = chartData.find((d) => d.date === label);
    if (!day) return null;
    const dateStr = new Date(label + "T00:00:00").toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });

    if (mode !== "split") {
      const sgdPart = mode === "SGD" ? day.sgd : day.sgd * rate;
      const inrPart = mode === "SGD" ? day.inr / rate : day.inr;
      return (
        <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
          <p className="font-semibold text-gray-600 mb-1">{dateStr}</p>
          {day.sgd > 0 && <p className="text-indigo-600 font-medium">SGD {mode === "SGD" ? "" : "≈"}{sym}{sgdPart.toFixed(2)}</p>}
          {day.inr > 0 && <p className="text-teal-600 font-medium">INR {mode === "INR" ? "" : "≈"}{sym}{inrPart.toFixed(2)}</p>}
          <p className="text-gray-900 font-bold mt-0.5">Total ≈{sym}{(sgdPart + inrPart).toFixed(2)}</p>
        </div>
      );
    }

    const inrSgd = day.inr / rate;
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-gray-600 mb-1">{dateStr}</p>
        {day.sgd > 0 && <p className="text-indigo-600 font-medium">SGD S${day.sgd.toFixed(2)}</p>}
        {inrSgd > 0 && <p className="text-teal-600 font-medium">INR ≈S${inrSgd.toFixed(2)}</p>}
        <p className="text-gray-900 font-bold mt-0.5">Total ≈S${(day.sgd + inrSgd).toFixed(2)}</p>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          14-day spend{mode !== "split" && <span className="normal-case tracking-normal"> · combined in {mode === "SGD" ? "S$" : "₹"}</span>}
        </p>
        {mode === "split" ? (
          <div className="flex gap-3">
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> SGD
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" /> INR
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-400">₹{Number.isInteger(rate) ? rate : rate.toFixed(2)}/S$</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="sgdGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="inrGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(d) => d.slice(8)} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }} />
          {mode === "split" ? (
            <>
              <Area type="monotone" dataKey="sgd" stroke="#6366f1" strokeWidth={2} fill="url(#sgdGrad)" stackId="1" />
              <Area type="monotone" dataKey="inr_as_sgd" stroke="#14b8a6" strokeWidth={2} fill="url(#inrGrad)" stackId="1" />
            </>
          ) : (
            <Area type="monotone" dataKey="combined" stroke="#6366f1" strokeWidth={2} fill="url(#sgdGrad)" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TagPicker({
  existingTags,
  currentTag,
  onSave,
  onCancel,
}: {
  existingTags: string[];
  currentTag: string;
  onSave: (tag: string) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState(currentTag);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const norm = input.toLowerCase().trim();
  const filtered = existingTags
    .filter((t) => !norm || t.includes(norm))
    .slice(0, 8);
  const isNew = norm.length > 0 && !existingTags.includes(norm);
  const showDropdown = filtered.length > 0 || isNew;

  function commit(tag: string) {
    onSave(tag.toLowerCase().trim());
  }

  useEffect(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({ top: rect.bottom + 4, left: rect.left });
    }
  }, [showDropdown]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      const dropdown = document.getElementById("tag-picker-dropdown");
      if (dropdown?.contains(target)) return;
      commit(norm);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [norm]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(norm); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        placeholder="tag…"
        className="text-xs border border-indigo-300 rounded-full px-2 py-0.5 w-20 outline-none focus:border-indigo-500"
      />
      {showDropdown && typeof window !== "undefined" && (
        <div
          id="tag-picker-dropdown"
          style={{ position: "fixed", top: dropdownStyle.top, left: dropdownStyle.left, zIndex: 9999 }}
          className="bg-white rounded-xl shadow-lg border border-gray-100 min-w-[130px] py-1 overflow-hidden"
        >
          {filtered.map((tag) => (
            <button
              key={tag}
              onMouseDown={(e) => { e.preventDefault(); commit(tag); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            >
              #{tag}
            </button>
          ))}
          {isNew && (
            <button
              onMouseDown={(e) => { e.preventDefault(); commit(norm); }}
              className={`w-full text-left px-3 py-1.5 text-xs text-indigo-500 hover:bg-indigo-50 transition-colors ${filtered.length > 0 ? "border-t border-gray-100" : ""}`}
            >
              + Add &ldquo;{norm}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TransactionFeed() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterCard, setFilterCard] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [owed, setOwed] = useState({ SGD: 0, INR: 0, count: 0 });
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [offerMerchant, setOfferMerchant] = useState<{ merchant: string; tag: string } | null>(null);
  const [cards, setCards] = useState<string[]>(DEFAULT_CARDS);

  useEffect(() => {
    fetch("/api/cards")
      .then((r) => r.json())
      .then((d) => {
        const names = (d.cards ?? []).filter((c: any) => c.active).map((c: any) => c.card);
        if (names.length) setCards(names);
      })
      .catch(() => {});
  }, []);

  const [combineMode, setCombineMode] = useState<CombineMode>("split");
  const [fxLive, setFxLive] = useState(false);
  const [liveRate, setLiveRate] = useState<number | null>(null);

  useEffect(() => {
    const hideOnLoad = localStorage.getItem("finny_hide_on_load") === "true";
    setAmountsHidden(hideOnLoad);
    const savedMode = localStorage.getItem(COMBINE_MODE_KEY);
    if (savedMode === "SGD" || savedMode === "INR") setCombineMode(savedMode);
    setFxLive(localStorage.getItem(FX_LIVE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (!fxLive || liveRate !== null) return;
    fetch("/api/fx")
      .then((r) => r.json())
      .then((d) => {
        if (d.rate && !d.fallback) setLiveRate(d.rate);
      })
      .catch(() => {});
  }, [fxLive, liveRate]);

  // Rate used for every INR↔SGD conversion on this page
  const rate = fxLive && liveRate ? liveRate : INR_PER_SGD;

  function changeCombineMode(mode: CombineMode) {
    setCombineMode(mode);
    localStorage.setItem(COMBINE_MODE_KEY, mode);
  }

  function toggleFxLive() {
    const next = !fxLive;
    setFxLive(next);
    localStorage.setItem(FX_LIVE_KEY, String(next));
  }

  useEffect(() => {
    fetch("/api/tags").then(r => r.json()).then(d => setAllTags(d.tags ?? []));
  }, []);

  useEffect(() => {
    if (!offerMerchant) return;
    const t = setTimeout(() => setOfferMerchant(null), 6000);
    return () => clearTimeout(t);
  }, [offerMerchant]);

  useEffect(() => {
    fetch("/api/splits")
      .then((r) => r.json())
      .then((data) => {
        const totals = { SGD: 0, INR: 0, count: 0 };
        for (const g of data.by_person ?? []) {
          totals[g.currency as "SGD" | "INR"] += g.total;
          totals.count += g.count;
        }
        setOwed(totals);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
    setTransactions([]);
  }, [filterCard, filterCategory, filterFrom, filterTo]);

  useEffect(() => {
    fetchTransactions(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterCard, filterCategory, filterFrom, filterTo]);

  async function saveTag(txnId: string, merchant: string | null, tag: string) {
    setEditingTag(null);
    const cleanTag = tag.trim().replace(/^#+/, "").toLowerCase();
    await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tag_one", transaction_id: txnId, tag: cleanTag || null }),
    });
    setTransactions((prev) =>
      prev.map((t) => t.id === txnId ? { ...t, user_tag: cleanTag || null } : t)
    );
    if (cleanTag && !allTags.includes(cleanTag)) {
      setAllTags((prev) => [...prev, cleanTag].sort());
    }
    if (cleanTag && merchant) setOfferMerchant({ merchant, tag: cleanTag });
  }

  async function applyToMerchant(merchant: string, tag: string) {
    setOfferMerchant(null);
    await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tag_merchant", merchant, tag }),
    });
    setTransactions((prev) =>
      prev.map((t) => t.merchant === merchant ? { ...t, user_tag: tag } : t)
    );
  }

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

  const grouped = useMemo(() => groupByDate(transactions), [transactions]);
  const hasMore = transactions.length < total;
  const sgdTotal = transactions.filter(t => t.currency === "SGD").reduce((s, t) => s + t.amount, 0);
  const inrTotal = transactions.filter(t => t.currency === "INR").reduce((s, t) => s + t.amount, 0);
  const sgdCount = transactions.filter(t => t.currency === "SGD").length;
  const inrCount = transactions.filter(t => t.currency === "INR").length;

  function clearFilters() {
    setFilterCard(""); setFilterCategory(""); setFilterFrom(""); setFilterTo("");
  }

  const hasFilters = !!(filterCard || filterCategory || filterFrom || filterTo);

  return (
    <div className="space-y-4">
      {/* Hero spend card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-5 shadow-lg shadow-indigo-600/20">
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute right-6 bottom-2 w-16 h-16 rounded-full bg-white/10" />
        <div className="relative flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-indigo-100 uppercase tracking-wider">
            {hasFilters ? "Filtered spend" : "Total spend"}
          </p>
          <div className="flex items-center gap-2">
            {/* Combine currency toggle */}
            <div className="flex bg-white/10 rounded-full p-0.5">
              {([
                { mode: "split" as CombineMode, label: "Split" },
                { mode: "SGD" as CombineMode, label: "S$" },
                { mode: "INR" as CombineMode, label: "₹" },
              ]).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => changeCombineMode(mode)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                    combineMode === mode
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-indigo-100 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAmountsHidden((h) => !h)}
              className="text-indigo-200 hover:text-white transition-colors"
              aria-label={amountsHidden ? "Show amounts" : "Hide amounts"}
            >
              {amountsHidden
                ? <EyeOffIcon className="w-4 h-4" />
                : <EyeIcon className="w-4 h-4" />
              }
            </button>
          </div>
        </div>
        {combineMode === "split" ? (
          <div className="relative flex items-end gap-6">
            <div>
              <p className="text-3xl font-bold tracking-tight">
                {amountsHidden ? "S$••••" : `S$${sgdTotal.toFixed(2)}`}
              </p>
              <p className="text-xs text-indigo-200 mt-1">{sgdCount} SGD txn{sgdCount !== 1 ? "s" : ""}</p>
            </div>
            <div className="h-10 w-px bg-white/20" />
            <div>
              <p className="text-3xl font-bold tracking-tight">
                {amountsHidden ? "₹••••" : `₹${inrTotal.toFixed(2)}`}
              </p>
              <p className="text-xs text-indigo-200 mt-1">{inrCount} INR txn{inrCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
        ) : (
          <div className="relative">
            <p className="text-3xl font-bold tracking-tight">
              {amountsHidden
                ? `${combineMode === "SGD" ? "S$" : "₹"}••••`
                : combineMode === "SGD"
                ? `S$${(sgdTotal + inrTotal / rate).toFixed(2)}`
                : `₹${(inrTotal + sgdTotal * rate).toFixed(2)}`}
            </p>
            <p className="text-xs text-indigo-200 mt-1 flex items-center gap-2 flex-wrap">
              <span>
                {sgdCount + inrCount} txn{sgdCount + inrCount !== 1 ? "s" : ""} · combined at ₹
                {fxLive && liveRate ? rate.toFixed(2) : rate}/S${fxLive && liveRate ? " (live)" : ""}
              </span>
              <button
                onClick={toggleFxLive}
                className="px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-[11px] font-medium text-white transition-colors"
              >
                {fxLive ? `Use fixed ₹${INR_PER_SGD}` : "Use live rate"}
              </button>
            </p>
          </div>
        )}
      </div>

      {/* Owed to you */}
      {(owed.SGD > 0 || owed.INR > 0) && (
        <Link
          href="/splits"
          className="flex items-center justify-between bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-gray-200 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <ArrowUpRightIcon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Owed to you</p>
              <p className="text-xs text-gray-400">{owed.count} pending split{owed.count !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              {owed.SGD > 0 && <p className="text-sm font-bold text-gray-900 tabular-nums">S${owed.SGD.toFixed(2)}</p>}
              {owed.INR > 0 && <p className="text-sm font-bold text-gray-900 tabular-nums">₹{owed.INR.toFixed(2)}</p>}
            </div>
            <ChevronRightIcon className="w-4 h-4 text-gray-300" />
          </div>
        </Link>
      )}

      {/* 14-day spending chart */}
      <SpendingChart mode={combineMode} rate={rate} />

      {/* Tags CTA */}
      <Link
        href="/tags"
        className="flex items-center justify-between bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-gray-200 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center text-violet-600 shrink-0">
            <TagIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Tag breakdown</p>
            <p className="text-xs text-gray-400">See spend by tag</p>
          </div>
        </div>
        <ChevronRightIcon className="w-4 h-4 text-gray-300" />
      </Link>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1 py-0.5">
            <button
              onClick={() => setFilterCard("")}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterCard === ""
                  ? "bg-gray-900 text-white shadow-sm"
                  : "bg-white text-gray-500 border border-gray-200 hover:border-gray-300"
              }`}
            >
              All
            </button>
            {cards.map((c) => (
              <button
                key={c}
                onClick={() => setFilterCard(filterCard === c ? "" : c)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filterCard === c
                    ? "bg-gray-900 text-white shadow-sm"
                    : "bg-white text-gray-500 border border-gray-200 hover:border-gray-300"
                }`}
              >
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
          <ExportButton filterFrom={filterFrom} filterTo={filterTo} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-600 focus:outline-none hover:border-gray-300 appearance-none cursor-pointer"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="date"
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-600 focus:outline-none hover:border-gray-300 cursor-pointer"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-600 focus:outline-none hover:border-gray-300 cursor-pointer"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
            >
              <XIcon className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Transaction groups */}
      <div className="space-y-5">
        {grouped.map(([date, txns]) => {
          const daySGD = txns.filter(t => t.currency === "SGD").reduce((s, t) => s + t.amount, 0);
          const dayINR = txns.filter(t => t.currency === "INR").reduce((s, t) => s + t.amount, 0);

          return (
            <div key={date}>
              <div className="sticky top-14 z-10 -mx-4 px-4 py-1.5 bg-[#F6F6F9]/95 backdrop-blur-sm">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {formatDate(date)}
                </span>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                {txns.map((txn) => {
                  const color = CATEGORY_COLORS[txn.category] ?? "#9ca3af";
                  const initial = (txn.merchant || "?")[0].toUpperCase();
                  const sym = txn.currency === "SGD" ? "S$" : "₹";
                  const isPending = txn.user_tag?.startsWith("__pending__") ?? false;
                  const realTag = txn.user_tag && !txn.user_tag.startsWith("__pending__") && txn.user_tag !== "__skip__" ? txn.user_tag : null;

                  return (
                    <div
                      key={txn.id}
                      className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-b-0"
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                        style={{ backgroundColor: color + "1a" }}
                      >
                        <span style={{ color }}>{initial}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {txn.merchant || "Unknown"}
                          </span>
                          {txn.anomaly_flagged && (
                            <span className="text-xs" title="Unusual spend">⚠️</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs text-gray-400">{txn.category}</span>
                          <span className="text-gray-200 text-xs">·</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${cardBadgeClass(txn.card)}`}>
                            {txn.card.toUpperCase()}
                          </span>
                          {isPending && (
                            <>
                              <span className="text-gray-200 text-xs">·</span>
                              <span className="text-xs bg-amber-50 text-amber-500 font-medium px-1.5 py-0.5 rounded-full">Pending</span>
                            </>
                          )}
                          <span className="text-gray-200 text-xs">·</span>
                          {editingTag === txn.id ? (
                            <TagPicker
                              existingTags={allTags}
                              currentTag={tagInput}
                              onSave={(tag) => saveTag(txn.id, txn.merchant, tag)}
                              onCancel={() => setEditingTag(null)}
                            />
                          ) : (
                            <button
                              onClick={() => { setEditingTag(txn.id); setTagInput(realTag ?? ""); }}
                              className={realTag
                                ? "text-xs bg-indigo-50 text-indigo-600 font-medium px-1.5 py-0.5 rounded-full"
                                : "text-xs border border-dashed border-gray-300 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 px-1.5 py-0.5 rounded-full transition-colors"}
                            >
                              {realTag ? `#${realTag}` : "+ tag"}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          {sym}{txn.amount.toFixed(2)}
                        </p>
                        {txn.currency === "INR" && (
                          <p className="text-xs text-gray-400 tabular-nums">S${(txn.amount / rate).toFixed(2)}</p>
                        )}
                        {txn.txn_time && (
                          <p className="text-xs text-gray-400 mt-0.5">{txn.txn_time}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/80">
                  <span className="text-xs font-medium text-gray-400">
                    {txns.length} transaction{txns.length !== 1 ? "s" : ""}
                  </span>
                  <div className="flex items-center gap-3">
                    {daySGD > 0 && (
                      <span className="text-xs font-semibold text-indigo-600 tabular-nums">S${daySGD.toFixed(2)}</span>
                    )}
                    {dayINR > 0 && (
                      <span className="text-xs font-semibold text-teal-600 tabular-nums">
                        ₹{dayINR.toFixed(2)}
                        <span className="text-gray-400 font-normal ml-1">(S${(dayINR / rate).toFixed(2)})</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {!loading && transactions.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-3xl mb-3">💸</p>
          <p className="text-sm">No transactions found</p>
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <button
          className="w-full py-3 text-sm text-gray-500 bg-white rounded-2xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
          onClick={() => setPage((p) => p + 1)}
        >
          Load {Math.min(50, total - transactions.length)} more
          <span className="text-gray-400 ml-1">({total - transactions.length} remaining)</span>
        </button>
      )}

      {loading && (
        <div className="text-center text-sm text-gray-400 py-4">Loading…</div>
      )}

      {offerMerchant && (
        <div className="fixed bottom-4 left-4 right-4 z-50 bg-gray-900 text-white rounded-2xl px-4 py-3 shadow-xl flex items-center justify-between gap-3">
          <p className="text-sm min-w-0">
            Tag <span className="font-semibold">#{offerMerchant.tag}</span> for all{" "}
            <span className="font-semibold truncate">{offerMerchant.merchant}</span>?
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => applyToMerchant(offerMerchant.merchant, offerMerchant.tag)}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Apply all
            </button>
            <button
              onClick={() => setOfferMerchant(null)}
              className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
