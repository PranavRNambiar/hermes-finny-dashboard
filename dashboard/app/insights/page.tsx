"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp, useHotkey } from "@/components/app";
import { CurrencyPicker } from "@/components/currency-picker";
import { InsightCard, InsightChart, newSpec, RANGES, Spec, specTitle, useInsight } from "@/components/insight";
import { Amount, Card, Chip, Empty, Eyebrow, Kbd, Perf, Pills, ScreenHeader, Spinner } from "@/components/ui";
import { api, Breakdown, cardLabel, CATEGORIES, compact, MODES, money, modeCombine, modeCurrency, prettyMerchant } from "@/lib/ui/finny";

const KEY = "finny.insights";
const load = (): Spec[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const store = (s: Spec[]) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

export default function InsightsPage() {
  return <Suspense fallback={<Spinner />}><Insights /></Suspense>;
}

function Insights() {
  const { mode } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [editing, setEditing] = useState<Spec | null>(null);
  useEffect(() => setSpecs(load()), []);
  useEffect(() => {
    if (params.get("new")) {
      const s = newSpec();
      if (params.get("tag")) { s.scope = "tag"; s.value = params.get("tag")!; }
      setEditing(s);
      router.replace("/insights", { scroll: false });
    }
  }, [params, router]);
  useHotkey("n", (e) => { e.preventDefault(); setEditing(newSpec()); });

  const save = (s: Spec) => { const next = specs.some((x) => x.id === s.id) ? specs.map((x) => (x.id === s.id ? s : x)) : [s, ...specs]; setSpecs(next); store(next); };
  const remove = (s: Spec) => { const next = specs.filter((x) => x.id !== s.id); setSpecs(next); store(next); };
  const pinned = specs.filter((s) => s.pinned);
  const saved = specs.filter((s) => !s.pinned);

  return (
    <>
      <ScreenHeader eyebrow="The bigger picture" title="Insights" right={<CurrencyPicker />} />
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Your insights</Eyebrow>
        <button onClick={() => setEditing(newSpec())} className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-bold text-surface">
          <Plus size={14} strokeWidth={3} /> New <span className="ml-1 text-[10px] opacity-50">N</span>
        </button>
      </div>
      {pinned.length === 0 && (
        <button onClick={() => setEditing(newSpec())} className="card mb-4 block w-full text-left">
          <div className="text-[16px] font-bold text-ink">Build your own chart</div>
          <p className="mt-1 text-[13px] text-ink-soft">Pick a merchant, category or tag, a range (today to a custom window) and a pie, bar or line chart. Pin it here.</p>
        </button>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {pinned.map((s) => (
          <InsightCard key={s.id} spec={s} mode={mode} onEdit={() => setEditing(s)} onTogglePin={() => save({ ...s, pinned: false })} onDelete={() => remove(s)} />
        ))}
      </div>
      {saved.length > 0 && (
        <Card title={`Saved, not pinned (${saved.length})`} className="mb-4">
          {saved.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-1.5 text-[14px]">
              <button onClick={() => setEditing(s)} className="font-semibold text-ink">{specTitle(s)}</button>
              <button onClick={() => save({ ...s, pinned: true })} className="font-bold text-mint">Pin</button>
            </div>
          ))}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <MonthTrend />
        <TagsThisMonth />
        <OnRepeat />
      </div>
      {editing && <Builder spec={editing} onClose={() => setEditing(null)} onSave={(s) => { save(s); setEditing(null); }} />}
    </>
  );
}

function MonthTrend() {
  const { mode } = useApp();
  const ccy = modeCurrency(mode);
  const from = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return `${d.toISOString().slice(0, 7)}-01`; }, []);
  const { data } = useQuery({ queryKey: ["trend", mode, from], queryFn: () => api<Record<string, Breakdown>>("breakdown", { group_by: "month", from, combine: modeCombine(mode) }) });
  const groups = data?.[ccy]?.groups ?? [];
  const avg = groups.length ? groups.reduce((a, g) => a + g.total, 0) / groups.length : 0;
  const current = new Date().toISOString().slice(0, 7);
  return (
    <Card title="Month by month" trailing={MODES.find((m) => m.id === mode)!.label}>
      <Eyebrow>Monthly average</Eyebrow>
      <div className="mb-3 text-ink"><Amount value={avg} currency={ccy} size={30} weight={700} /></div>
      <div className="h-[200px]">
        <ResponsiveContainer>
          <BarChart data={groups}>
            <XAxis dataKey="key" tickFormatter={(k) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-SG", { month: "short" }).toUpperCase()}
              tick={{ fill: "var(--muted)", fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
            <YAxis orientation="right" tickFormatter={(v) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip cursor={{ fill: "var(--sunken)" }} content={({ active, payload }) => active && payload?.[0] ? (
              <div className="rounded-xl bg-ink px-3 py-1.5 text-[12px] font-semibold text-surface">{money(payload[0].value as number, ccy)}</div>) : null} />
            <ReferenceLine y={avg} stroke="var(--ink-soft)" strokeDasharray="2 5" />
            <Bar dataKey="total" radius={[6, 6, 0, 0]}>{groups.map((g) => <Cell key={g.key} fill={g.key === current ? "var(--mint)" : "var(--ink-soft)"} fillOpacity={g.key === current ? 1 : 0.35} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[12px] text-muted">Spikes are usually one-offs like tuition. Move them to Exclusions (open the transaction, press X) to keep months honest.</p>
    </Card>
  );
}

function TagsThisMonth() {
  const { mode } = useApp();
  const ccy = modeCurrency(mode);
  const { data } = useQuery({ queryKey: ["tags-month", mode], queryFn: () => api<Record<string, Breakdown>>("breakdown", { group_by: "tag", period: "this_month", combine: modeCombine(mode) }) });
  const b = data?.[ccy];
  const tagged = (b?.groups ?? []).filter((g) => g.key !== "(untagged)");
  const taggedTotal = tagged.reduce((a, g) => a + g.total, 0);
  return (
    <Card title="Tags · this month">
      {tagged.length === 0 ? <p className="text-[13px] text-ink-soft">No tags yet. Open any transaction and press T.</p> : (
        <>
          <div className="mb-3 flex items-baseline gap-2 text-ink"><Amount value={taggedTotal} currency={ccy} size={26} weight={700} />
            <span className="text-[12px] font-medium text-muted">tagged · {Math.round((taggedTotal / Math.max(b!.total, 1)) * 100)}% of spend</span></div>
          {tagged.slice(0, 8).map((g) => (
            <div key={g.key} className="flex items-center gap-2 py-1.5">
              <span className="text-[15px] font-semibold text-mint">#{g.key}</span><span className="text-[12px] text-muted">{g.count}×</span>
              <span className="flex-1" /><Amount value={g.total} currency={ccy} size={15} className="text-ink" />
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function OnRepeat() {
  const { data } = useQuery({ queryKey: ["subs"], queryFn: () => api<{ merchant: string; currency: string; avg_amount: number; avg_gap_days: number; card: string }[]>("subscriptions") });
  const subs = data ?? [];
  const totals = new Map<string, number>();
  subs.forEach((s) => totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.avg_amount));
  return (
    <Card title="On repeat">
      {subs.length === 0 ? <p className="text-[13px] text-ink-soft">No recurring charges detected.</p> : (
        <>
          {subs.map((s, i) => (
            <div key={`${s.currency}-${s.merchant}`}>
              <div className="flex items-baseline justify-between py-2.5">
                <div><div className="text-[15px] font-semibold text-ink">{prettyMerchant(s.merchant)}</div><Eyebrow>Every ~{s.avg_gap_days}d · {cardLabel(s.card)}</Eyebrow></div>
                <Amount value={s.avg_amount} currency={s.currency} size={16} className="text-ink" />
              </div>
              {i < subs.length - 1 && <Perf />}
            </div>
          ))}
          <div className="mt-2 border-t border-dashed border-ink/30 pt-2">
            {[...totals.entries()].map(([c, v]) => (
              <div key={c} className="flex justify-between py-1"><Eyebrow className="!text-ink">Per cycle · {c}</Eyebrow><Amount value={v} currency={c} size={18} weight={700} className="text-ink" /></div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ── Builder ────────────────────────────────────────────────

function Builder({ spec: initial, onClose, onSave }: { spec: Spec; onClose: () => void; onSave: (s: Spec) => void }) {
  const { mode } = useApp();
  const ccy = modeCurrency(mode);
  const [spec, setSpec] = useState<Spec>(initial);
  const [search, setSearch] = useState("");
  const set = (patch: Partial<Spec>) => setSpec((s) => ({ ...s, ...patch }));
  const { data } = useInsight(spec, mode);
  const merchants = useQuery({ queryKey: ["merchants"], staleTime: 300_000, queryFn: () => api<{ merchants: { name: string; count: number; last: string; renamed: boolean }[] }>("merchants") });
  const meta = useQuery({ queryKey: ["meta"], staleTime: 300_000, queryFn: () => api<{ tags: { name: string }[] }>("meta") });
  const ok = spec.scope === "all" || !!spec.value;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ok) onSave(spec);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [spec, ok, onClose, onSave]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onMouseDown={onClose}>
      <div className="flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-canvas p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-[22px]">Insight</h2>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 rounded-full bg-surface px-4 text-[13px] font-semibold text-ink-soft">Cancel</button>
            <button disabled={!ok} onClick={() => onSave(spec)} className="h-9 rounded-full bg-ink px-4 text-[13px] font-bold text-surface disabled:opacity-40">
              Save <span className="ml-1 text-[10px] opacity-50">⌘↵</span>
            </button>
          </div>
        </div>
        <section className="card mb-5">
          <Eyebrow>{specTitle(spec)}</Eyebrow>
          <div className="mb-2 mt-1 text-ink"><Amount value={data?.[ccy]?.total ?? 0} currency={ccy} size={28} weight={700} /></div>
          <InsightChart spec={spec} data={ok ? data?.[ccy] : undefined} currency={ccy} />
        </section>
        <Eyebrow className="mb-2">Chart</Eyebrow>
        <Pills className="mb-5" options={[{ id: "bar", label: "Bars" }, { id: "line", label: "Line" }, { id: "pie", label: "Pie" }]} value={spec.chart} onChange={(chart) => set({ chart })} />
        <Eyebrow className="mb-2">Range</Eyebrow>
        <div className="mb-3 flex flex-wrap gap-2">
          {RANGES.map((r) => <Chip key={r.id} on={spec.range === r.id} onClick={() => set(r.id === "custom" && !spec.from
            ? { range: "custom", from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } : { range: r.id })}>{r.label}</Chip>)}
        </div>
        {spec.range === "custom" && (
          <div className="card mb-5 flex gap-3 !p-3">
            <label className="flex-1 text-[12px] font-semibold text-muted">From<input type="date" value={spec.from} max={spec.to} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-full rounded-xl bg-canvas px-3 py-2 text-[14px] text-ink" /></label>
            <label className="flex-1 text-[12px] font-semibold text-muted">To<input type="date" value={spec.to} min={spec.from} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-full rounded-xl bg-canvas px-3 py-2 text-[14px] text-ink" /></label>
          </div>
        )}
        <Eyebrow className="mb-2 mt-2">Show</Eyebrow>
        <Pills className="mb-3" options={[{ id: "all", label: "All" }, { id: "merchant", label: "Merchant" }, { id: "category", label: "Category" }, { id: "tag", label: "Tag" }]}
          value={spec.scope} onChange={(scope) => set({ scope, value: "" })} />
        {spec.scope === "category" && <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => <Chip key={c} on={spec.value === c} onClick={() => set({ value: c })}>{c}</Chip>)}</div>}
        {spec.scope === "tag" && <div className="flex flex-wrap gap-2">{(meta.data?.tags ?? []).slice(0, 30).map((t) => <Chip key={t.name} on={spec.value === t.name} onClick={() => set({ value: t.name })}>#{t.name}</Chip>)}</div>}
        {spec.scope === "merchant" && (
          <>
            <div className="mb-2 flex h-11 items-center gap-2 rounded-2xl bg-surface px-3">
              <Search size={15} className="text-muted" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchants (your names too)"
                className="flex-1 bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-muted" />
            </div>
            <div className="card !py-2">
              {(merchants.data?.merchants ?? []).filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map((m) => (
                <button key={m.name} onClick={() => set({ value: m.name })} className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-xl px-2 py-2 text-left ${spec.value === m.name ? "bg-sunken" : "hover:bg-canvas"}`}>
                  <span className="flex-1">
                    <span className="flex items-center gap-1 text-[14px] font-semibold text-ink">{m.renamed ? m.name : prettyMerchant(m.name)}{m.renamed && <Pencil size={10} className="text-mint" />}</span>
                    <span className="text-[11px] text-muted">{m.count} visits · last {m.last}</span>
                  </span>
                  {spec.value === m.name && <span className="text-mint">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="mt-5 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-[14px] font-semibold text-ink">
          Pin to Insights <input type="checkbox" checked={spec.pinned} onChange={(e) => set({ pinned: e.target.checked })} className="h-5 w-5 accent-[var(--mint)]" />
        </label>
        <p className="mt-3 text-[12px] text-muted"><Kbd>esc</Kbd> close · <Kbd>⌘↵</Kbd> save</p>
      </div>
    </div>
  );
}
