"use client";

import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, TitleComponent, CanvasRenderer]);

export type Tokens = { font: string; mint: string; coral: string; ink: string; inkSoft: string; muted: string; hairline: string; surface: string; sunken: string; series: string[] };

const read = (): Tokens => {
  const css = getComputedStyle(document.documentElement);
  const v = (k: string) => css.getPropertyValue(k).trim();
  const t = { font: getComputedStyle(document.body).fontFamily, mint: v("--mint"), coral: v("--coral"), ink: v("--ink"), inkSoft: v("--ink-soft"), muted: v("--muted"), hairline: v("--hairline"), surface: v("--surface"), sunken: v("--sunken") || v("--canvas") };
  return { ...t, series: [t.mint, "#7C6FE0", t.coral, "#3B82F6", "#F2B544", "#EC4899", t.inkSoft, "#14B8A6"] };
};

/** Design tokens resolved to real colours (canvas can't use CSS vars); follows light/dark switches. */
export function useTokens(): Tokens | null {
  const [t, setT] = useState<Tokens | null>(null);
  useEffect(() => {
    setT(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setT(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return t;
}

/** Shared tooltip look: ink pill, rounded, Nunito. */
export const tooltipStyle = (t: Tokens) => ({
  backgroundColor: t.ink, borderWidth: 0, padding: [8, 12],
  textStyle: { color: t.surface, fontFamily: t.font, fontSize: 12, fontWeight: 600 },
  extraCssText: "border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);",
});

export type ChartClick = { name: string; seriesIndex: number; dataIndex: number };

/** Minimal ECharts host: sizes to its box, re-applies options, forwards clicks. */
export function EChart({ option, height, onClick, className }: {
  option: object | null; height: number | string; onClick?: (e: ChartClick) => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p: any) => click.current?.({ name: p.name, seriesIndex: p.seriesIndex, dataIndex: p.dataIndex }));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);

  useEffect(() => { if (option) chart.current?.setOption(option as echarts.EChartsCoreOption, { notMerge: true }); }, [option]);

  return <div ref={el} className={className} style={{ height, width: "100%", cursor: onClick ? "pointer" : undefined }} />;
}
