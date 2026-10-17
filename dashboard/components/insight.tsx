"use client";

import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pin, PinOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { graphic } from "echarts/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChartClick, EChart, Tokens, tooltipStyle, useTokens } from "./echart";
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

const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const shift = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The dates a spec covers (same rules as the server's periods). */
export function specRange(s: Spec): { from: string; to: string } {
  const today = iso(new Date());
  switch (s.range) {
    case "custom": return { from: s.from ?? today, to: s.to ?? today };
    case "today": return { from: today, to: today };
    case "last_7_days": return { from: shift(today, -6), to: today };
    case "last_30_days": return { from: shift(today, -29), to: today };
    case "this_month": return { from: `${today.slice(0, 7)}-01`, to: today };
    case "this_quarter": { const m = Number(today.slice(5, 7)); return { from: `${today.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`, to: today }; }
    case "this_year": return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Activity link for one series (optionally narrowed to a time bucket). */
export function drillHref(d: SeriesDef | null, from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  if (d?.kind === "category") q.set("category", d.value);
  if (d?.kind === "merchant") q.set("q", d.value);
  if (d?.kind === "tag") q.set("q", `#${d.value}`);
  return `/activity?${q}`;
}

function bucketRange(key: string, g: "day" | "week" | "month") {
  if (g === "month") { const [y, m] = key.split("-").map(Number); return { from: `${key}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; }
  return { from: key, to: g === "week" ? shift(key, 6) : key };
}

const keyLabel = (k: string, g: string, long = false) => {
  const dt = new Date(`${k.length === 7 ? `${k}-01` : k}T00:00:00`);
  if (g === "month") return dt.toLocaleDateString("en-SG", { month: long ? "long" : "short", year: long ? "numeric" : undefined });
  const s = dt.toLocaleDateString("en-SG", { day: "numeric", month: "short", weekday: long && g === "day" ? "short" : undefined });
  return g === "week" && long ? `Week of ${s}` : s;
};

export function InsightChart({ spec, mode, height = 230 }: { spec: Spec; mode: Mode; height?: number }) {
  const ccy = modeCurrency(mode);
  const router = useRouter();
  const t = useTokens();
  const { cmp, pie, ready } = useInsight(spec, mode);
  const range = specRange(spec);

  const view = useMemo(() => {
    if (!t || !ready) return null;
    if (pieByCategory(spec)) {
      const b = pie?.[ccy];
      if (!b?.groups.length) return null;
      const top = b.groups.slice(0, 7); const rest = b.groups.slice(7);
      const slices = rest.length ? [...top, { key: "Other", total: rest.reduce((a, g) => a + g.total, 0), count: 0, share_pct: 0 }] : top;
      const one = spec.series[0];
      return {
        option: pieOption(t, ccy, slices.map((g) => ({ name: g.key === "Other" ? "Other" : prettyMerchant(g.key), raw: g.key, value: g.total })), b.total),
        click: (e: ChartClick) => {
          const raw = slices[e.dataIndex]?.key; if (!raw || raw === "Other") return;
          // Slices are categories (for a merchant/all) or merchants (for a category/tag).
          const sub: SeriesDef = one.kind === "category" || one.kind === "tag" ? { kind: "merchant", value: raw } : { kind: "category", value: raw };
          router.push(drillHref(sub, range.from, range.to));
        },
      };
    }
    const d = cmp?.data[ccy];
    if (!d || d.series.every((x) => x.total === 0)) return null;
    const names = d.series.map((_, i) => seriesLabel(spec.series[i] ?? { kind: "all", value: "" }));
    if (spec.chart === "pie") {
      return {
        option: pieOption(t, ccy, d.series.map((x, i) => ({ name: names[i], raw: names[i], value: x.total })), d.series.reduce((a, x) => a + x.total, 0)),
        click: (e: ChartClick) => router.push(drillHref(spec.series[e.dataIndex] ?? null, cmp!.from, cmp!.to)),
      };
    }
    if (spec.chart === "totals") return { totals: d.series.map((x, i) => ({ ...x, name: names[i] })) };
    const g = cmp!.group_by;
    return {
      option: timeOption(t, ccy, spec.chart, g, d.keys, names, d.series.map((x) => x.points)),
      click: (e: ChartClick) => { const r = bucketRange(d.keys[e.dataIndex], g); router.push(drillHref(spec.series[e.seriesIndex] ?? null, r.from, r.to)); },
    };
  }, [t, ready, spec, pie, cmp, ccy, router, range.from, range.to]);

  if (!ready) return <Placeholder height={height} text="Pick what to show" />;
  if (!view) return <Placeholder height={height} text={cmp || pie ? "No spending in this range" : ""} />;
  if ("totals" in view && view.totals) {
    const max = Math.max(...view.totals.map((x) => x.total), 1);
    return (
      <div className="flex flex-col justify-center gap-2" style={{ minHeight: Math.min(height, 60 * view.totals.length + 20) }}>
        {view.totals.map((x, i) => (
          <button key={i} onClick={() => router.push(drillHref(spec.series[i] ?? null, cmp!.from, cmp!.to))}
            className="group -mx-2 rounded-xl px-2 py-1.5 text-left hover:bg-canvas" title="See these transactions">
            <div className="mb-1 flex justify-between text-[13px]">
              <span className="font-semibold text-ink">{x.name} <span className="text-muted">· {x.count}×</span></span>
              <span className="tabular font-bold text-ink">{money(x.total, ccy)}</span>
            </div>
            <div className="h-3 rounded-full bg-sunken"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(x.total / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
          </button>
        ))}
      </div>
    );
  }
  return <EChart option={view.option!} height={height} onClick={view.click} />;
}

function timeOption(t: Tokens, ccy: string, chart: ChartKind, g: string, keys: string[], names: string[], data: number[][]) {
  const multi = names.length > 1;
  const zoom = keys.length > 21;
  return {
    animationDuration: 600, animationEasing: "cubicOut",
    color: t.series,
    grid: { left: 4, right: 44, top: multi ? 34 : 12, bottom: zoom ? 34 : 4, containLabel: true },
    legend: multi ? { top: 0, left: 0, icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: t.inkSoft, fontFamily: t.font, fontWeight: 700, fontSize: 11 } } : undefined,
    tooltip: {
      trigger: "axis", ...tooltipStyle(t),
      axisPointer: chart === "line" ? { type: "line", lineStyle: { color: t.muted, type: "dashed" } } : { type: "shadow", shadowStyle: { color: t.sunken, opacity: 0.6 } },
      formatter: (ps: any[]) => {
        const rows = ps.map((p) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${p.marker}${p.seriesName}</span><b>${money(p.value, ccy)}</b></div>`).join("");
        const sum = multi && chart === "stacked" ? `<div style="margin-top:4px;opacity:.7;display:flex;justify-content:space-between"><span>Total</span><b>${money(ps.reduce((a, p) => a + p.value, 0), ccy)}</b></div>` : "";
        return `<div style="opacity:.6;margin-bottom:4px">${keyLabel(keys[ps[0].dataIndex], g, true)}</div>${rows}${sum}<div style="opacity:.5;margin-top:4px;font-size:10px">Click to see transactions</div>`;
      },
    },
    dataZoom: zoom ? [{ type: "inside", start: Math.max(0, 100 - (30 / keys.length) * 100), end: 100 }, { type: "slider", height: 14, bottom: 4, borderColor: "transparent", backgroundColor: t.sunken, fillerColor: t.hairline, handleSize: 14, showDetail: false, brushSelect: false, dataBackground: { lineStyle: { color: t.muted }, areaStyle: { color: t.hairline } } }] : undefined,
    xAxis: { type: "category", data: keys, boundaryGap: chart !== "line", axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.muted, fontFamily: t.font, fontWeight: 700, fontSize: 10, hideOverlap: true, formatter: (k: string) => keyLabel(k, g) } },
    yAxis: { type: "value", position: "right", splitNumber: 3, splitLine: { lineStyle: { color: t.hairline, type: "dashed" } },
      axisLabel: { color: t.muted, fontFamily: t.font, fontSize: 10, formatter: (v: number) => compact(v) } },
    series: data.map((pts, i) => chart === "line" ? {
      name: names[i], type: "line", data: pts, smooth: 0.35, symbol: "circle", symbolSize: 6, showSymbol: keys.length <= 31,
      lineStyle: { width: 2.5 }, emphasis: { focus: "series" },
      areaStyle: { opacity: multi ? 0.06 : 1, color: multi ? undefined : new graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(t.series[i], 0.35) }, { offset: 1, color: hexA(t.series[i], 0.02) }]) },
    } : {
      name: names[i], type: "bar", data: pts, stack: chart === "stacked" ? "a" : undefined, barMaxWidth: multi && chart === "bar" ? 14 : 26,
      itemStyle: { borderRadius: chart === "stacked" ? (i === data.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0] },
      emphasis: { focus: "series" },
    }),
  };
}

function pieOption(t: Tokens, ccy: string, slices: { name: string; raw: string; value: number }[], total: number) {
  return {
    animationDuration: 700, color: t.series,
    tooltip: { trigger: "item", ...tooltipStyle(t), formatter: (p: any) => `${p.marker}${p.name}<br/><b>${money(p.value, ccy)}</b> · ${Math.round(p.percent)}%<div style="opacity:.5;font-size:10px;margin-top:2px">Click to see transactions</div>` },
    legend: { type: "scroll", orient: "vertical", right: 0, top: "middle", icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 9,
      textStyle: { color: t.ink, fontFamily: t.font, fontWeight: 700, fontSize: 12, width: 120, overflow: "truncate" },
      pageTextStyle: { color: t.muted }, pageIconColor: t.inkSoft },
    title: { text: money(total, ccy), left: "29%", top: "middle", textAlign: "center", textStyle: { color: t.ink, fontFamily: t.font, fontSize: 16, fontWeight: 800 } },
    series: [{
      type: "pie", radius: ["58%", "88%"], center: ["30%", "50%"], padAngle: 2, itemStyle: { borderRadius: 5 },
      label: { show: false }, emphasis: { scale: true, scaleSize: 6 }, data: slices.map((s) => ({ name: s.name, value: s.value })),
    }],
  };
}

const hexA = (c: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

const Placeholder = ({ height, text }: { height: number; text: string }) => (
  <div className="flex items-center justify-center text-[13px] text-muted" style={{ height }}>{text}</div>
);

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
