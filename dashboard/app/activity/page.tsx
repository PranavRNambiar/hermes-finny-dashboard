"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, Briefcase, RotateCcw, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useHotkey } from "@/components/app";
import { TxnGroups } from "@/components/txn-list";
import { Amount, Chip, Empty, Eyebrow, Perf, Pills, ScreenHeader, Spinner } from "@/components/ui";
import { api, cardLabel, CATEGORIES, encId, Incoming, OVERVIEW_PERIODS, Period, prettyMerchant, send, Txn } from "@/lib/ui/finny";

export default function ActivityPage() {
  return <Suspense fallback={<Spinner />}><Activity /></Suspense>;
}

function Activity() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const view = params.get("view") === "received" ? "received" : "spent";
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    v ? p.set(k, v) : p.delete(k);
    router.replace(`${path}?${p}`, { scroll: false });
  };
  return (
    <>
      <ScreenHeader eyebrow={view === "spent" ? "Every transaction" : "Money in"} title="Activity" />
      <Pills className="mb-4 max-w-[360px]" options={[{ id: "spent", label: "Spent" }, { id: "received", label: "Received" }]}
        value={view} onChange={(v) => setParam("view", v === "received" ? "received" : null)} />
      {view === "spent" ? <Spent params={params} setParam={setParam} /> : <Received />}
    </>
  );
}

function Spent({ params, setParam }: { params: URLSearchParams; setParam: (k: string, v: string | null) => void }) {
  const q = params.get("q") ?? "";
  const currency = params.get("currency");
  const category = params.get("category");
  const card = params.get("card");
  const from = params.get("from");
  const to = params.get("to");
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(q), [q]);
  useHotkey("f", (e) => { e.preventDefault(); input.current?.focus(); });

  const { data: meta } = useQuery({ queryKey: ["meta"], staleTime: 300_000, queryFn: () => api<{ cards: { card: string; label: string }[] }>("meta") });
  const feed = useInfiniteQuery({
    queryKey: ["activity", q, currency, category, card, from, to],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ transactions: Txn[]; total: number }>("transactions", { q, currency, category, card, from, to, offset: pageParam, limit: 50 }),
    getNextPageParam: (last, pages) => { const n = pages.reduce((a, p) => a + p.transactions.length, 0); return n < last.total ? n : undefined; },
  });
  const items = feed.data?.pages.flatMap((p) => p.transactions) ?? [];
  const total = feed.data?.pages[0]?.total ?? 0;

  // Infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); });
    io.observe(el); return () => io.disconnect();
  }, [feed]);

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); setParam("q", text.trim() || null); }}
        className="mb-3 flex h-12 items-center gap-3 rounded-2xl bg-surface px-4">
        <Search size={17} className="text-muted" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Search merchants — your custom names too" className="flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted" />
        {q && <button type="button" onClick={() => setParam("q", null)} className="text-muted"><X size={16} /></button>}
        <kbd className="kbd">F</kbd>
      </form>
      <div className="scrollbar-hide mb-5 flex gap-2 overflow-x-auto">
        <Chip on={!currency} onClick={() => setParam("currency", null)}>All</Chip>
        <Chip on={currency === "SGD"} onClick={() => setParam("currency", "SGD")}>SGD</Chip>
        <Chip on={currency === "INR"} onClick={() => setParam("currency", "INR")}>INR</Chip>
        <select value={category ?? ""} onChange={(e) => setParam("category", e.target.value || null)}
          className={`h-8 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.08em] outline-none ${category ? "bg-ink text-surface" : "bg-surface text-ink-soft"}`}>
          <option value="">Category</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={card ?? ""} onChange={(e) => setParam("card", e.target.value || null)}
          className={`h-8 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.08em] outline-none ${card ? "bg-ink text-surface" : "bg-surface text-ink-soft"}`}>
          <option value="">Card</option>{(meta?.cards ?? []).map((c) => <option key={c.card} value={c.card}>{c.label}</option>)}
        </select>
        {(from || to) && <Chip on onClick={() => { setParam("from", null); setParam("to", null); }}>{from} → {to} ✕</Chip>}
      </div>
      <div className="mb-2 px-1 text-[12px] text-muted">{total} transactions · <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> to move, <kbd className="kbd">↵</kbd> to open</div>
      {feed.isLoading ? <Spinner /> : items.length === 0 ? <Empty emoji="🔍" title="Nothing here" text="Either you were good, or the bank was slow." /> : (
        <TxnGroups items={items} onEnd={() => feed.hasNextPage && feed.fetchNextPage()} />
      )}
      <div ref={sentinel} className="h-10" />
      {feed.isFetchingNextPage && <Spinner />}
    </>
  );
}

const KINDS = [
  { id: "salary", label: "Salary", icon: Briefcase }, { id: "transfer", label: "Transfer in", icon: ArrowDownLeft },
  { id: "refund", label: "Refund", icon: RotateCcw }, { id: "own_transfer", label: "Own transfer", icon: ArrowLeftRight },
];

function Received() {
  const [period, setPeriod] = useState<Period>("this_month");
  const [editing, setEditing] = useState<Incoming | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["incoming", period], queryFn: () => api<{ incoming: Incoming[] }>("incoming", { period }) });
  const items = data?.incoming ?? [];
  const totals = new Map<string, number>();
  items.filter((i) => i.kind !== "own_transfer").forEach((i) => totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.amount));

  return (
    <>
      <Pills className="mb-4 max-w-[520px]" options={OVERVIEW_PERIODS.map((p) => ({ id: p.id, label: p.short }))} value={period} onChange={setPeriod} />
      {isLoading ? <Spinner /> : items.length === 0 ? <Empty emoji="💸" title="Nothing came in" text="Salary, PayNow received, refunds and top-ups appear here as their alerts arrive." /> : (
        <>
          <div className="mb-4 flex gap-3">
            {[...totals.entries()].map(([c, v]) => (
              <div key={c} className="card flex-1"><Eyebrow>Received · {c}</Eyebrow><div className="mt-1 text-mint"><Amount value={v} currency={c} size={26} weight={700} /></div></div>
            ))}
          </div>
          <div className="card !py-2">
            {items.map((i, n) => {
              const k = KINDS.find((x) => x.id === i.kind) ?? KINDS[1];
              const own = i.kind === "own_transfer";
              return (
                <div key={i.id}>
                  <button onClick={() => setEditing(i)} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-canvas">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-mint-soft text-mint"><k.icon size={16} strokeWidth={2.5} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-ink">{prettyMerchant(i.counterparty ?? "Unknown")}</div>
                      <div className="text-[12px] text-muted">{k.label} · {new Date(`${i.txn_date}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short" })} · {cardLabel(i.card)}</div>
                    </div>
                    <span className={own ? "text-muted" : "text-mint"}>+<Amount value={i.amount} currency={i.currency} size={16} /></span>
                  </button>
                  {n < items.length - 1 && <Perf className="ml-[52px]" />}
                </div>
              );
            })}
          </div>
        </>
      )}
      {editing && <KindDialog item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries(); }} />}
    </>
  );
}

function KindDialog({ item, onClose, onSaved }: { item: Incoming; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(item.kind);
  const [always, setAlways] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const name = prettyMerchant(item.counterparty ?? "Unknown");
  const save = async () => {
    try { await send("PATCH", `incoming/${encId(item.id)}`, { kind, apply_to_counterparty: always }); onSaved(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-[420px] space-y-4 rounded-[24px] bg-surface p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div><Eyebrow>From {name}</Eyebrow><div className="text-mint"><Amount value={item.amount} currency={item.currency} size={32} weight={700} /></div></div>
        <div className="space-y-1.5">
          {KINDS.map((k) => (
            <button key={k.id} onClick={() => setKind(k.id)} className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left text-[14px] font-semibold ${kind === k.id ? "bg-ink text-surface" : "bg-canvas text-ink"}`}>
              <k.icon size={16} /> {k.label} {k.id === "own_transfer" && <span className="text-[11px] opacity-60">not counted as income</span>}
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between rounded-2xl bg-canvas px-4 py-3 text-[14px] font-semibold text-ink">
          Always for {name}
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="h-5 w-5 accent-[var(--mint)]" />
        </label>
        {err && <div className="text-[13px] text-coral">{err}</div>}
        <button onClick={save} className="h-12 w-full rounded-2xl bg-ink font-bold text-surface">Save</button>
      </div>
    </div>
  );
}
