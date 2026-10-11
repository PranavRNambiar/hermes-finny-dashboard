"use client";

import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pin, PinOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Breakdown, compact, money, Mode, modeCombine, modeCurrency, prettyMerchant } from "@/lib/ui/finny";
import { Amount, Eyebrow } from "./ui";

export type Spec = {
  id: string; scope: "all" | "merchant" | "category" | "tag"; value: string;
  range: "today" | "last_7_days" | "this_month" | "last_30_days" | "this_quarter" | "this_year" | "custom";
  from?: string; to?: string; chart: "bar" | "line" | "pie"; pinned: boolean;
};
export const RANGES: { id: Spec["range"]; label: string }[] = [
  { id: "today", label: "Today" }, { id: "last_7_days", label: "7 days" }, { id: "this_month", label: "MTD" },
  { id: "last_30_days", label: "30 days" }, { id: "this_quarter", label: "Quarter" }, { id: "this_year", label: "Year" }, { id: "custom", label: "Custom" },
];

export const newSpec = (): Spec => ({ id: crypto.randomUUID(), scope: "all", value: "", range: "last_30_days", chart: "bar", pinned: true });

export function specTitle(s: Spec) {
  const what = s.scope === "all" ? "All spending" : s.scope === "tag" ? `#${s.value}` : s.value || "…";
  const when = s.range === "custom" ? `${s.from ?? "?"} – ${s.to ?? "?"}` : RANGES.find((r) => r.id === s.range)!.label;
  return `${what} · ${when}`;
}

function timeGroup(s: Spec) {
  if (["today", "last_7_days", "this_month", "last_30_days"].includes(s.range)) return "day";
  if (s.range === "this_quarter") return "week";
  if (s.range === "this_year") return "month";
  const days = s.from && s.to ? (Date.parse(s.to) - Date.parse(s.from)) / 864e5 : 30;
  return days <= 45 ? "day" : days <= 150 ? "week" : "month";
}

function query(s: Spec, mode: Mode) {
  const q: Record<string, string | undefined> = {
    group_by: s.chart === "pie" ? (s.scope === "category" || s.scope === "tag" ? "merchant" : "category") : timeGroup(s),
    combine: modeCombine(mode),
  };
  if (s.range === "custom") { q.from = s.from; q.to = s.to; } else q.period = s.range;
  if (s.scope === "merchant") q.merchant = s.value;
  if (s.scope === "category") q.category = s.value;
  if (s.scope === "tag") q.tag = s.value;
  return q;
}

export function useInsight(s: Spec, mode: Mode, enabled = true) {
  return useQuery({
    queryKey: ["insight", s.scope, s.value, s.range, s.from, s.to, s.chart, mode],
    enabled: enabled && (s.scope === "all" || !!s.value) && (s.range !== "custom" || (!!s.from && !!s.to)),
    queryFn: () => api<Record<string, Breakdown>>("breakdown", query(s, mode)),
    placeholderData: (prev) => prev,
  });
}

const SLICES = ["var(--mint)", "var(--ink)", "var(--coral)", "#7C6FE0", "#F2B544", "var(--muted)"];

export function InsightChart({ spec, data, currency, height = 190 }: { spec: Spec; data?: Breakdown; currency: string; height?: number }) {
  const groups = data?.groups ?? [];
  if (!groups.length) return <div className="flex items-center justify-center text-[13px] text-muted" style={{ height }}>No spending in this range</div>;
  if (spec.chart === "pie") {
    const top = groups.slice(0, 5);
    const rest = groups.slice(5);
    const slices = rest.length ? [...top, { key: "Other", total: rest.reduce((a, g) => a + g.total, 0), share_pct: rest.reduce((a, g) => a + g.share_pct, 0), count: 0 }] : top;
    return (
      <div className="flex items-center gap-5" style={{ height }}>
        <div className="relative h-full flex-1">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={slices} dataKey="total" nameKey="key" innerRadius="60%" outerRadius="95%" paddingAngle={2} cornerRadius={4} stroke="none">
                {slices.map((_, i) => <Cell key={i} fill={SLICES[i % SLICES.length]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="tabular absolute inset-0 flex items-center justify-center text-[15px] font-bold text-ink">{money(data!.total, currency)}</div>
        </div>
        <div className="w-[46%] space-y-1.5">
          {slices.map((g, i) => (
            <div key={g.key} className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SLICES[i % SLICES.length] }} />
              <span className="flex-1 truncate font-semibold text-ink">{prettyMerchant(g.key)}</span>
              <span className="tabular font-bold text-muted">{Math.round(g.share_pct)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const unit = timeGroup(spec);
  const fmt = (k: string) => {
    const d = new Date(`${k.length === 7 ? `${k}-01` : k}T00:00:00`);
    return unit === "month" ? d.toLocaleDateString("en-SG", { month: "short" }) : d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  };
  const tip = (
    <Tooltip cursor={{ fill: "var(--sunken)" }} content={({ active, payload }) => active && payload?.[0] ? (
      <div className="rounded-xl bg-ink px-3 py-1.5 text-[12px] font-semibold text-surface">{fmt(payload[0].payload.key)} · {money(payload[0].value as number, currency)}</div>
    ) : null} />
  );
  const axes = (
    <>
      <XAxis dataKey="key" tickFormatter={fmt} tick={{ fill: "var(--muted)", fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={24} />
      <YAxis orientation="right" tickFormatter={(v) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
    </>
  );
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        {spec.chart === "line" ? (
          <AreaChart data={groups}>
            <defs><linearGradient id="mintfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--mint)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--mint)" stopOpacity={0.02} /></linearGradient></defs>
            {axes}{tip}
            <Area type="monotone" dataKey="total" stroke="var(--mint)" strokeWidth={2.5} fill="url(#mintfade)" dot={groups.length <= 31 ? { r: 2.5, fill: "var(--mint)" } : false} />
          </AreaChart>
        ) : (
          <BarChart data={groups}>
            {axes}{tip}
            <Bar dataKey="total" fill="var(--mint)" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function InsightCard({ spec, mode, onEdit, onTogglePin, onDelete }: {
  spec: Spec; mode: Mode; onEdit: () => void; onTogglePin: () => void; onDelete: () => void;
}) {
  const ccy = modeCurrency(mode);
  const { data } = useInsight(spec, mode);
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (!menu) return; const c = () => setMenu(false); setTimeout(() => document.addEventListener("click", c, { once: true })); }, [menu]);
  return (
    <section className="card">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <Eyebrow>{specTitle(spec)}</Eyebrow>
          <div className="mt-1 text-ink"><Amount value={data?.[ccy]?.total ?? 0} currency={ccy} size={26} weight={700} /></div>
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
      <InsightChart spec={spec} data={data?.[ccy]} currency={ccy} />
    </section>
  );
}

const MenuBtn = ({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) => (
  <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold hover:bg-canvas ${danger ? "text-coral" : "text-ink"}`}>{icon}{children}</button>
);
