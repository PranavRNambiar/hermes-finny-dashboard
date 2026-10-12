"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { compact, money } from "@/lib/ui/finny";
import { EChart, tooltipStyle, useTokens } from "./echart";

const day = (k: string, opts: Intl.DateTimeFormatOptions) => new Date(`${k}T00:00:00`).toLocaleDateString("en-SG", opts);

/** Overview hero: spend per day. Hover for the amount, click a day to see its transactions. */
export function DailyBars({ daily, ccy }: { daily: { date: string; total: number }[]; ccy: string }) {
  const t = useTokens();
  const router = useRouter();
  const option = useMemo(() => t && {
    animationDuration: 500,
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    tooltip: {
      trigger: "axis", ...tooltipStyle(t), backgroundColor: "#FFFFFF", textStyle: { ...tooltipStyle(t).textStyle, color: "#1C2547" },
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,.07)" } },
      formatter: (ps: any[]) => `${day(daily[ps[0].dataIndex].date, { weekday: "short", day: "numeric", month: "short" })} · <b>${money(ps[0].value, ccy)}</b>`,
    },
    xAxis: { type: "category", data: daily.map((d) => d.date), show: false },
    yAxis: { type: "value", show: false },
    series: [{ type: "bar", data: daily.map((d) => d.total), barMaxWidth: 18, itemStyle: { color: t.mint, borderRadius: [3, 3, 0, 0] },
      emphasis: { itemStyle: { color: "#FFFFFF" } } }],
  }, [t, daily, ccy]);
  return <EChart option={option} height={72} onClick={(e) => { const d = daily[e.dataIndex]?.date; if (d) router.push(`/activity?from=${d}&to=${d}`); }} />;
}

/** Insights: month-by-month spend with the average line; this month in mint. Click a month to open it. */
export function MonthBars({ groups, avg, ccy }: { groups: { key: string; total: number }[]; avg: number; ccy: string }) {
  const t = useTokens();
  const router = useRouter();
  const current = new Date().toISOString().slice(0, 7);
  const option = useMemo(() => t && {
    animationDuration: 600,
    grid: { left: 4, right: 40, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis", ...tooltipStyle(t), axisPointer: { type: "shadow", shadowStyle: { color: t.sunken, opacity: 0.6 } },
      formatter: (ps: any[]) => {
        const v = ps[0].value as number; const diff = avg ? Math.round(((v - avg) / avg) * 100) : 0;
        return `<div style="opacity:.6">${day(`${groups[ps[0].dataIndex].key}-01`, { month: "long", year: "numeric" })}</div><b>${money(v, ccy)}</b> <span style="opacity:.7">${diff >= 0 ? "+" : ""}${diff}% vs avg</span><div style="opacity:.5;font-size:10px;margin-top:2px">Click to see transactions</div>`;
      },
    },
    xAxis: { type: "category", data: groups.map((g) => g.key), axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.muted, fontFamily: t.font, fontWeight: 700, fontSize: 10, formatter: (k: string) => day(`${k}-01`, { month: "short" }).toUpperCase() } },
    yAxis: { type: "value", position: "right", splitNumber: 3, splitLine: { lineStyle: { color: t.hairline, type: "dashed" } },
      axisLabel: { color: t.muted, fontFamily: t.font, fontSize: 10, formatter: (v: number) => compact(v) } },
    series: [{
      type: "bar", barMaxWidth: 34,
      data: groups.map((g) => ({ value: g.total, itemStyle: { color: g.key === current ? t.mint : t.inkSoft, opacity: g.key === current ? 1 : 0.35, borderRadius: [6, 6, 0, 0] } })),
      emphasis: { itemStyle: { opacity: 1 } },
      markLine: { symbol: "none", silent: true, data: [{ yAxis: avg }], lineStyle: { color: t.inkSoft, type: [2, 5] },
        label: { position: "insideStartTop", color: t.muted, fontFamily: t.font, fontSize: 10, fontWeight: 700, formatter: () => `avg ${compact(avg)}` } },
    }],
  }, [t, groups, avg, ccy, current]);
  return <EChart option={option} height={210} onClick={(e) => {
    const k = groups[e.dataIndex]?.key; if (!k) return;
    const [y, m] = k.split("-").map(Number);
    router.push(`/activity?from=${k}-01&to=${new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)}`);
  }} />;
}
