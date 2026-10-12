"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { MonthBars } from "@/components/charts";
import { useApp, useHotkey } from "@/components/app";
import { CurrencyPicker } from "@/components/currency-picker";
import { CHARTS, COLORS, InsightCard, InsightChart, migrate, newSpec, RANGES, SeriesDef, seriesLabel, Spec, SpecTotals, specTitle } from "@/components/insight";
import { Amount, Card, Chip, Empty, Eyebrow, Kbd, Perf, Pills, ScreenHeader, Spinner } from "@/components/ui";
import { api, Breakdown, cardLabel, CATEGORIES, compact, MODES, money, modeCombine, modeCurrency, prettyMerchant } from "@/lib/ui/finny";

const KEY = "finny.insights";
const load = (): Spec[] => { try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as any[]).map(migrate); } catch { return []; } };
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
      if (params.get("tag")) s.series = [{ kind: "tag", value: params.get("tag")! }];
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
      <MonthBars groups={groups} avg={avg} ccy={ccy} />
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

const PRESETS: { label: string; series: SeriesDef[] }[] = [
  { label: "Food vs Fitness", series: [{ kind: "category", value: "Food & Drink" }, { kind: "category", value: "Health & Fitness" }] },
  { label: "Food vs Transport vs Shopping", series: [{ kind: "category", value: "Food & Drink" }, { kind: "category", value: "Transport" }, { kind: "category", value: "Shopping" }] },
  { label: "Everything vs Food", series: [{ kind: "all", value: "" }, { kind: "category", value: "Food & Drink" }] },
];

function Builder({ spec: initial, onClose, onSave }: { spec: Spec; onClose: () => void; onSave: (s: Spec) => void }) {
  const { mode } = useApp();
  const [spec, setSpec] = useState<Spec>(initial);
  const [adding, setAdding] = useState<SeriesDef["kind"]>("category");
  const [search, setSearch] = useState("");
  const set = (patch: Partial<Spec>) => setSpec((s) => ({ ...s, ...patch }));
  const merchants = useQuery({ queryKey: ["merchants"], staleTime: 300_000, queryFn: () => api<{ merchants: { name: string; count: number; last: string; renamed: boolean }[] }>("merchants") });
  const meta = useQuery({ queryKey: ["meta"], staleTime: 300_000, queryFn: () => api<{ tags: { name: string }[] }>("meta") });
  const ok = spec.series.length > 0 && spec.series.every((x) => x.kind === "all" || x.value);
  const has = (d: SeriesDef) => spec.series.some((x) => x.kind === d.kind && x.value === d.value);
  const toggle = (d: SeriesDef) => {
    if (has(d)) set({ series: spec.series.filter((x) => !(x.kind === d.kind && x.value === d.value)) });
    else set({ series: [...spec.series.filter((x) => x.kind !== "all" || d.kind === "all"), d].slice(0, 8) });
  };

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
      <div className="flex h-full w-full max-w-[600px] flex-col overflow-y-auto bg-canvas p-5" onMouseDown={(e) => e.stopPropagation()}>
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
          <Eyebrow className="truncate">{specTitle(spec)}</Eyebrow>
          <div className="mb-3 mt-1"><SpecTotals spec={spec} mode={mode} size={24} /></div>
          <InsightChart spec={spec} mode={mode} />
        </section>

        <Eyebrow className="mb-2">Comparing</Eyebrow>
        <div className="mb-3 flex flex-wrap gap-2">
          {spec.series.map((d, i) => (
            <button key={`${d.kind}:${d.value}`} onClick={() => toggle(d)}
              className="flex h-8 items-center gap-1.5 rounded-full bg-surface pl-2.5 pr-3 text-[12px] font-bold text-ink">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {seriesLabel(d)} <span className="text-muted">✕</span>
            </button>
          ))}
          {spec.series.length === 0 && <span className="text-[13px] text-muted">Add at least one thing below.</span>}
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <span className="eyebrow self-center">Quick:</span>
          {PRESETS.map((p) => <button key={p.label} onClick={() => set({ series: p.series })} className="rounded-full bg-mint-soft px-3 py-1.5 text-[12px] font-bold text-mint">{p.label}</button>)}
        </div>

        <Eyebrow className="mb-2">Add to chart</Eyebrow>
        <Pills className="mb-3" options={[{ id: "category", label: "Category" }, { id: "merchant", label: "Merchant" }, { id: "tag", label: "Tag" }, { id: "all", label: "All" }]}
          value={adding} onChange={setAdding} />
        {adding === "all" && <Chip on={has({ kind: "all", value: "" })} onClick={() => toggle({ kind: "all", value: "" })}>All spending</Chip>}
        {adding === "category" && <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => <Chip key={c} on={has({ kind: "category", value: c })} onClick={() => toggle({ kind: "category", value: c })}>{c}</Chip>)}</div>}
        {adding === "tag" && <div className="flex flex-wrap gap-2">{(meta.data?.tags ?? []).slice(0, 30).map((t) => <Chip key={t.name} on={has({ kind: "tag", value: t.name })} onClick={() => toggle({ kind: "tag", value: t.name })}>#{t.name}</Chip>)}</div>}
        {adding === "merchant" && (
          <>
            <div className="mb-2 flex h-11 items-center gap-2 rounded-2xl bg-surface px-3">
              <Search size={15} className="text-muted" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchants (your names too)"
                className="flex-1 bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-muted" />
            </div>
            <div className="card max-h-[300px] overflow-y-auto !py-2">
              {(merchants.data?.merchants ?? []).filter((m) => !search || m.name.toLowerCase().includes(search.toLowerCase())).slice(0, 40).map((m) => {
                const on = has({ kind: "merchant", value: m.name });
                return (
                  <button key={m.name} onClick={() => toggle({ kind: "merchant", value: m.name })}
                    className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-xl px-2 py-2 text-left ${on ? "bg-sunken" : "hover:bg-canvas"}`}>
                    <span className="flex-1">
                      <span className="flex items-center gap-1 text-[14px] font-semibold text-ink">{m.renamed ? m.name : prettyMerchant(m.name)}{m.renamed && <Pencil size={10} className="text-mint" />}</span>
                      <span className="text-[11px] text-muted">{m.count} visits · last {m.last}</span>
                    </span>
                    {on && <span className="font-bold text-mint">✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <Eyebrow className="mb-2 mt-6">Range</Eyebrow>
        <div className="mb-3 flex flex-wrap gap-2">
          {RANGES.map((r) => <Chip key={r.id} on={spec.range === r.id} onClick={() => set(r.id === "custom" && !spec.from
            ? { range: "custom", from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } : { range: r.id })}>{r.label}</Chip>)}
        </div>
        {spec.range === "custom" && (
          <div className="card mb-3 flex gap-3 !p-3">
            <label className="flex-1 text-[12px] font-semibold text-muted">From<input type="date" value={spec.from} max={spec.to} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-full rounded-xl bg-canvas px-3 py-2 text-[14px] text-ink" /></label>
            <label className="flex-1 text-[12px] font-semibold text-muted">To<input type="date" value={spec.to} min={spec.from} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-full rounded-xl bg-canvas px-3 py-2 text-[14px] text-ink" /></label>
          </div>
        )}

        <Eyebrow className="mb-2 mt-3">Chart</Eyebrow>
        <div className="grid grid-cols-5 gap-2">
          {CHARTS.map((c) => (
            <button key={c.id} onClick={() => set({ chart: c.id })} title={c.hint}
              className={`rounded-2xl px-2 py-2.5 text-center text-[12px] font-bold ${spec.chart === c.id ? "bg-ink text-surface" : "bg-surface text-ink-soft"}`}>{c.label}</button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">{CHARTS.find((c) => c.id === spec.chart)!.hint}{spec.range === "today" && spec.chart !== "totals" && spec.chart !== "pie" ? " — for Today, Totals or Pie read best." : ""}</p>

        <label className="mt-5 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-[14px] font-semibold text-ink">
          Pin to Insights <input type="checkbox" checked={spec.pinned} onChange={(e) => set({ pinned: e.target.checked })} className="h-5 w-5 accent-[var(--mint)]" />
        </label>
        <p className="mt-3 text-[12px] text-muted"><Kbd>esc</Kbd> close · <Kbd>⌘↵</Kbd> save</p>
      </div>
    </div>
  );
}
