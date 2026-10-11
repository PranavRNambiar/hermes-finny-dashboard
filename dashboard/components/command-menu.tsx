"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Coins, Download, Hash, Plus, RefreshCw, Search, Store, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, CATEGORIES, displayMerchant, MODES, prettyMerchant, Txn } from "@/lib/ui/finny";
import { NAV, useApp } from "./app";
import { Amount, CategoryIcon, Kbd } from "./ui";

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; right?: React.ReactNode };

export function CommandMenu({ open, initial, onClose }: { open: boolean; initial: string; onClose: () => void }) {
  const router = useRouter();
  const app = useApp();
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(initial); setDebounced(initial); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open, initial]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 160); return () => clearTimeout(t); }, [q]);

  const amount = /^[\d.,]+$/.test(debounced) ? Number(debounced.replace(/,/g, "")) : null;
  const txns = useQuery({
    queryKey: ["cmd-txns", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: () => api<{ transactions: Txn[] }>("transactions", amount != null
      ? { min_amount: amount - 0.005, max_amount: amount + 0.005, limit: 8 }
      : { q: debounced, limit: 8 }),
  });
  const merchants = useQuery({
    queryKey: ["merchants"], enabled: open, staleTime: 5 * 60_000,
    queryFn: () => api<{ merchants: { name: string; count: number; renamed: boolean }[] }>("merchants"),
  });
  const meta = useQuery({ queryKey: ["meta"], enabled: open, staleTime: 5 * 60_000, queryFn: () => api<{ tags: { name: string }[] }>("meta") });

  const go = (href: string) => () => { router.push(href); onClose(); };
  const items: Item[] = useMemo(() => {
    const needle = debounced.toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const out: Item[] = [];

    const actions: Item[] = [
      ...NAV.map((n) => ({ id: `nav-${n.href}`, group: "Go to", label: n.label, icon: <n.icon size={16} />, run: go(n.href), right: <Kbd>G {n.key.toUpperCase()}</Kbd> })),
      { id: "nav-received", group: "Go to", label: "Money in (Received)", icon: <Coins size={16} />, run: go("/activity?view=received"), right: <Kbd>G R</Kbd> },
      { id: "new-insight", group: "Actions", label: "New insight", hint: "Chart a merchant, category or tag", icon: <Plus size={16} />, run: go("/insights?new=1"), right: <Kbd>N</Kbd> },
      ...MODES.map((m) => ({ id: `mode-${m.id}`, group: "Currency", label: `Show ${m.label}`, hint: m.hint, icon: <Coins size={16} />,
        run: () => { app.setMode(m.id); onClose(); }, right: app.mode === m.id ? <span className="text-[11px] font-bold text-mint">ON</span> : undefined })),
      { id: "scan", group: "Actions", label: "Scan cards for new transactions", icon: <RefreshCw size={16} />,
        run: () => { fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); onClose(); } },
      { id: "export", group: "Actions", label: "Export this month as CSV", icon: <Download size={16} />, run: () => { window.location.href = "/api/export?period=monthly"; onClose(); } },
    ];
    out.push(...actions.filter((a) => match(a.label) || match(a.group)));

    if (needle) {
      for (const t of txns.data?.transactions ?? []) {
        out.push({
          id: `txn-${t.id}`, group: amount != null ? `Transactions of ${debounced}` : "Transactions",
          label: displayMerchant(t), hint: `${t.txn_date} · ${t.category}`,
          icon: <CategoryIcon category={t.category} size={26} />,
          right: <Amount value={t.amount} currency={t.currency} size={14} />,
          run: () => { app.openTxn(t.id); onClose(); },
        });
      }
      for (const m of (merchants.data?.merchants ?? []).filter((m) => match(m.name)).slice(0, 5)) {
        out.push({ id: `m-${m.name}`, group: "Merchants", label: m.renamed ? m.name : prettyMerchant(m.name), hint: `${m.count} visits · show activity`,
          icon: <Store size={16} />, run: go(`/activity?q=${encodeURIComponent(m.name)}`) });
      }
      for (const c of CATEGORIES.filter(match).slice(0, 4)) {
        out.push({ id: `c-${c}`, group: "Categories", label: c, icon: <CategoryIcon category={c} size={22} />, run: go(`/activity?category=${encodeURIComponent(c)}`) });
      }
      for (const t of (meta.data?.tags ?? []).filter((t) => match(t.name)).slice(0, 4)) {
        out.push({ id: `t-${t.name}`, group: "Tags", label: `#${t.name}`, icon: <Hash size={16} />, run: go(`/insights?new=1&tag=${encodeURIComponent(t.name)}`) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, txns.data, merchants.data, meta.data, app.mode]);

  useEffect(() => setSel(0), [debounced]);
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-[620px] overflow-hidden rounded-[22px] bg-surface shadow-2xl ring-1 ring-hairline" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4">
          <Search size={18} className="text-muted" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search transactions, merchants, amounts… or type a command"
            className="flex-1 bg-transparent text-[16px] font-medium text-ink outline-none placeholder:text-muted" />
          <Kbd>esc</Kbd>
        </div>
        <div className="perf" />
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-ink-soft">{txns.isFetching ? "Searching…" : `Nothing for “${debounced}”`}</div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {header && <div className="eyebrow px-3 pb-1 pt-3">{header}</div>}
                <button data-i={i} onMouseMove={() => setSel(i)} onClick={it.run}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${i === sel ? "bg-sunken" : ""}`}>
                  <span className="flex w-7 shrink-0 justify-center text-ink-soft">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{it.label}</span>
                    {it.hint && <span className="block truncate text-[12px] text-muted">{it.hint}</span>}
                  </span>
                  {it.right}
                  {i === sel && <ArrowRight size={14} className="text-muted" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-hairline px-5 py-2.5 text-[11px] font-semibold text-muted">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="flex items-center gap-1"><Tag size={11} /> type an amount like 12.50 to find it</span>
          <span className="ml-auto flex items-center gap-1"><BarChart3 size={11} /> finny</span>
        </div>
      </div>
    </div>
  );
}
