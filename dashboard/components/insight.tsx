"use client";

import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pin, PinOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Breakdown, compact, money, Mode, modeCombine, modeCurrency, prettyMerchant } from "@/lib/ui/finny";
import { Amount, Eyebrow } from "./ui";

// ── Spec ───────────────────────────────────────────────────

export type SeriesDef = { kind: "all" | "category" | "merchant" | "tag"; value: string };
export type ChartKind = "bar" | "stacked" | "line" | "totals" | "pie";
export type Spec = {
  id: string; series: SeriesDef[];
  range: "today" | "last_7_days" | "this_month" | "last_30_days" | "this_quarter" | "this_year" | "custom";
  from?: string; to?: string; chart: ChartKind; pinned: boolean;
};
export const RANGES: { id: Spec["range"]; label: string }[] = [
  { id: "today", label: "Today" }, { id: "last_7_days", label: "7 days" }, { id: "this_month", label: "MTD" },
  { id: "last_30_days", label: "30 days" }, { id: "this_quarter", label: "Quarter" }, { id: "this_year", label: "Year" }, { id: "custom", label: "Custom" },
];
export const CHARTS: { id: ChartKind; label: string; hint: string }[] = [
  { id: "bar", label: "Bars", hint: "Side by side over time" },
  { id: "stacked", label: "Stacked", hint: "Combined over time" },
  { id: "line", label: "Lines", hint: "Trends over time" },
  { id: "totals", label: "Totals", hint: "Compare the totals" },
  { id: "pie", label: "Pie", hint: "Share of the whole" },
];

export const newSpec = (): Spec => ({ id: crypto.randomUUID(), series: [{ kind: "all", value: "" }], range: "last_30_days", chart: "bar", pinned: true });

/** Insights saved before multi-series used {scope, value}. */
export function migrate(s: any): Spec {
  if (Array.isArray(s.series)) return s;
  return { id: s.id, series: [{ kind: s.scope ?? "all", value: s.value ?? "" }], range: s.range, from: s.from, to: s.to, chart: s.chart ?? "bar", pinned: s.pinned ?? true };
}

export const seriesLabel = (d: SeriesDef) => (d.kind === "all" ? "All spending" : d.kind === "tag" ? `#${d.value}` : d.kind === "merchant" ? prettyMerchant(d.value) : d.value);
export function specTitle(s: Spec) {
  const what = s.series.map(seriesLabel).join(" vs ");
  const when = s.range === "custom" ? `${s.from ?? "?"} – ${s.to ?? "?"}` : RANGES.find((r) => r.id === s.range)!.label;
  return `${what} · ${when}`;
}

export const COLORS = ["var(--mint)", "#7C6FE0", "var(--coral)", "#3B82F6", "#F2B544", "#EC4899", "var(--ink-soft)", "#14B8A6"];

// ── Data ───────────────────────────────────────────────────

type Compare = { from: string; to: string; group_by: "day" | "week" | "month";
  data: Record<string, { keys: string[]; series: { label: string; kind: string; total: number; count: number; points: number[] }[] }> };

/** Single "all spending" pie keeps the old behaviour: split by category. */
const pieByCategory = (s: Spec) => s.chart === "pie" && s.series.length === 1;

export function useInsight(s: Spec, mode: Mode, enabled = true) {
  const ready = s.series.every((x) => x.kind === "all" || x.value) && (s.range !== "custom" || (!!s.from && !!s.to));
  const range = s.range === "custom" ? { from: s.from, to: s.to } : { period: s.range };
  const cmp = useQuery({
    queryKey: ["compare", s.series, s.range, s.from, s.to, mode],
    enabled: enabled && ready && !pieByCategory(s),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const q = new URLSearchParams();
      s.series.forEach((x) => q.append("s", `${x.kind}:${x.value}`));
      Object.entries({ ...range, combine: modeCombine(mode) }).forEach(([k, v]) => v && q.set(k, v));
      const res = await fetch(`/api/v1/compare?${q}`);
      if (!res.ok) throw new Error("Couldn't load chart");
      return (await res.json()) as Compare;
    },
  });
  const one = s.series[0];
  const pie = useQuery({
    queryKey: ["pie", one, s.range, s.from, s.to, mode],
    enabled: enabled && ready && pieByCategory(s),
    placeholderData: (prev) => prev,
    queryFn: () => api<Record<string, Breakdown>>("breakdown", {
      ...range, combine: modeCombine(mode),
      group_by: one.kind === "category" || one.kind === "tag" ? "merchant" : "category",
      category: one.kind === "category" ? one.value : undefined, tag: one.kind === "tag" ? one.value : undefined,
      merchant: one.kind === "merchant" ? one.value : undefined,
    }),
  });
  return { cmp: cmp.data, pie: pie.data, loading: cmp.isFetching || pie.isFetching, ready };
}

// ── Chart ──────────────────────────────────────────────────

export function InsightChart({ spec, mode, height = 210 }: { spec: Spec; mode: Mode; height?: number }) {
  const ccy = modeCurrency(mode);
  const { cmp, pie, ready } = useInsight(spec, mode);
  if (!ready) return <Placeholder height={height} text="Pick what to show" />;

  if (pieByCategory(spec)) {
    const b = pie?.[ccy];
    if (!b?.groups.length) return <Placeholder height={height} text="No spending in this range" />;
    const top = b.groups.slice(0, 5); const rest = b.groups.slice(5);
    const slices = rest.length ? [...top, { key: "Other", total: rest.reduce((a, g) => a + g.total, 0) }] : top;
    return <Donut height={height} total={b.total} ccy={ccy} slices={slices.map((g) => ({ label: prettyMerchant(g.key), total: g.total }))} />;
  }

  const d = cmp?.data[ccy];
  if (!d || d.series.every((x) => x.total === 0)) return <Placeholder height={height} text="No spending in this range" />;

  if (spec.chart === "pie") return <Donut height={height} total={d.series.reduce((a, x) => a + x.total, 0)} ccy={ccy} slices={d.series.map((x) => ({ label: x.label, total: x.total }))} />;

  if (spec.chart === "totals") {
    const max = Math.max(...d.series.map((x) => x.total), 1);
    return (
      <div className="flex flex-col justify-center gap-3" style={{ minHeight: height }}>
        {d.series.map((x, i) => (
          <div key={x.label}>
            <div className="mb-1 flex justify-between text-[13px]">
              <span className="font-semibold text-ink">{seriesLabel(spec.series[i])} <span className="text-muted">· {x.count}×</span></span>
              <span className="tabular font-bold text-ink">{money(x.total, ccy)}</span>
            </div>
            <div className="h-3 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(x.total / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
          </div>
        ))}
      </div>
    );
  }

  const rows = d.keys.map((k, ki) => Object.fromEntries([["key", k], ...d.series.map((x, si) => [`s${si}`, x.points[ki]])]));
  const fmt = (k: string) => {
    const dt = new Date(`${k.length === 7 ? `${k}-01` : k}T00:00:00`);
    return cmp!.group_by === "month" ? dt.toLocaleDateString("en-SG", { month: "short" }) : dt.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  };
  const common = (
    <>
      <XAxis dataKey="key" tickFormatter={fmt} tick={{ fill: "var(--muted)", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={20} />
      <YAxis orientation="right" tickFormatter={(v) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
      <Tooltip cursor={{ fill: "var(--sunken)" }} content={({ active, payload, label }) => active && payload?.length ? (
        <div className="rounded-xl bg-ink px-3 py-2 text-[12px] font-semibold text-surface">
          <div className="mb-1 opacity-60">{fmt(String(label))}</div>
          {payload.map((p, i) => <div key={i} className="flex justify-between gap-4"><span style={{ color: p.color }}>● {seriesLabel(spec.series[Number(String(p.dataKey).slice(1))])}</span><span>{money(Number(p.value), ccy)}</span></div>)}
        </div>) : null} />
      {d.series.length > 1 && <Legend formatter={(v) => <span className="text-[11px] font-semibold text-ink-soft">{seriesLabel(spec.series[Number(String(v).slice(1))])}</span>} iconType="circle" iconSize={7} />}
    </>
  );
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        {spec.chart === "line" ? (
          <AreaChart data={rows}>
            {common}
            {d.series.map((_, i) => (
              <Area key={i} type="monotone" dataKey={`s${i}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5}
                fill={COLORS[i % COLORS.length]} fillOpacity={d.series.length > 1 ? 0.06 : 0.15} dot={rows.length <= 31 ? { r: 2 } : false} />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={rows}>
            {common}
            {d.series.map((_, i) => (
              <Bar key={i} dataKey={`s${i}`} fill={COLORS[i % COLORS.length]} stackId={spec.chart === "stacked" ? "a" : undefined}
                radius={spec.chart === "stacked" ? (i === d.series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

const Placeholder = ({ height, text }: { height: number; text: string }) => (
  <div className="flex items-center justify-center text-[13px] text-muted" style={{ height }}>{text}</div>
);

function Donut({ height, total, ccy, slices }: { height: number; total: number; ccy: string; slices: { label: string; total: number }[] }) {
  const sum = slices.reduce((a, x) => a + x.total, 0) || 1;
  return (
    <div className="flex items-center gap-5" style={{ height }}>
      <div className="relative h-full flex-1">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="total" nameKey="label" innerRadius="60%" outerRadius="95%" paddingAngle={2} cornerRadius={4} stroke="none">
              {slices.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="tabular absolute inset-0 flex items-center justify-center text-[15px] font-bold text-ink">{money(total, ccy)}</div>
      </div>
      <div className="w-[46%] space-y-1.5">
        {slices.map((g, i) => (
          <div key={g.label} className="flex items-center gap-2 text-[12px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="flex-1 truncate font-semibold text-ink">{g.label}</span>
            <span className="tabular font-bold text-muted">{Math.round((g.total / sum) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Headline number for a spec: one series → its total; several → each, compactly. */
export function SpecTotals({ spec, mode, size = 26 }: { spec: Spec; mode: Mode; size?: number }) {
  const ccy = modeCurrency(mode);
  const { cmp, pie } = useInsight(spec, mode);
  if (pieByCategory(spec)) return <div className="text-ink"><Amount value={pie?.[ccy]?.total ?? 0} currency={ccy} size={size} weight={700} /></div>;
  const s = cmp?.data[ccy]?.series ?? [];
  if (s.length <= 1) return <div className="text-ink"><Amount value={s[0]?.total ?? 0} currency={ccy} size={size} weight={700} /></div>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {s.map((x, i) => (
        <div key={i} className="flex items-baseline gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
          <span className="tabular text-[18px] font-bold text-ink">{money(x.total, ccy)}</span>
        </div>
      ))}
    </div>
  );
}

export function InsightCard({ spec, mode, onEdit, onTogglePin, onDelete }: {
  spec: Spec; mode: Mode; onEdit: () => void; onTogglePin: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (!menu) return; const c = () => setMenu(false); setTimeout(() => document.addEventListener("click", c, { once: true })); }, [menu]);
  return (
    <section className="card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow className="truncate">{specTitle(spec)}</Eyebrow>
          <div className="mt-1"><SpecTotals spec={spec} mode={mode} /></div>
        </div>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-canvas hover:text-ink"><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-2xl bg-surface p-1.5 shadow-xl ring-1 ring-hairline">
              <MenuBtn icon={<SlidersHorizontal size={14} />} onClick={onEdit}>Edit</MenuBtn>
              <MenuBtn icon={spec.pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={onTogglePin}>{spec.pinned ? "Unpin" : "Pin"}</MenuBtn>
              <MenuBtn icon={<Trash2 size={14} />} onClick={onDelete} danger>Delete</MenuBtn>
            </div>
          )}
        </div>
      </div>
      <InsightChart spec={spec} mode={mode} />
    </section>
  );
}

const MenuBtn = ({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) => (
  <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold hover:bg-canvas ${danger ? "text-coral" : "text-ink"}`}>{icon}{children}</button>
);
