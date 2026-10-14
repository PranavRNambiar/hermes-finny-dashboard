"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight, EyeOff, Merge, Pencil, Plane } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DailyBars } from "@/components/charts";
import { useApp, useHotkey } from "@/components/app";
import { CurrencyPicker } from "@/components/currency-picker";
import { TxnRow } from "@/components/txn-list";
import { Amount, Card, CategoryIcon, categoryColor, Empty, Eyebrow, Perf, Pills, ScreenHeader, Spinner, useDark } from "@/components/ui";
import { api, money, modeCombine, modeCurrency, Overview, OVERVIEW_PERIODS, Period, prettyMerchant, quip, Txn } from "@/lib/ui/finny";

export default function OverviewPage() {
  const { mode, openTxn } = useApp();
  const [period, setPeriod] = useState<Period | "custom">("this_month");
  const [custom, setCustom] = useState<CustomRange | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => setCustom(loadCustom()), []);
  const ccy = modeCurrency(mode);
  const dark = useDark();
  const isCustom = period === "custom" && !!custom;
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", isCustom ? custom : period, mode],
    enabled: period !== "custom" || !!custom,
    placeholderData: (prev) => prev,
    queryFn: () => api<Overview>("overview", isCustom
      ? { from: custom!.from, to: custom!.to, label: custom!.name, combine: modeCombine(mode) }
      : { period: period as Period, combine: modeCombine(mode) }),
  });
  const pick = (v: Period | "custom") => {
    // Custom: open the editor the first time, or when tapped again while selected; otherwise reuse the saved range.
    if (v === "custom" && (!custom || period === "custom")) setEditing(true);
    if (v !== "custom" || custom) setPeriod(v);
  };
  useHotkey("1", () => pick(OVERVIEW_PERIODS[0].id));
  useHotkey("2", () => pick(OVERVIEW_PERIODS[1].id));
  useHotkey("3", () => pick(OVERVIEW_PERIODS[2].id));
  useHotkey("4", () => pick(OVERVIEW_PERIODS[3].id));
  useHotkey("5", () => pick(OVERVIEW_PERIODS[4].id));
  useHotkey("6", () => pick("custom"));

  const s = data?.currencies[ccy];
  const cf = data?.cash_flow?.[ccy];
  const today = new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <ScreenHeader eyebrow={today} title="Overview" right={<CurrencyPicker />} />
      <Pills className={`${isCustom ? "mb-3" : "mb-5"} max-w-[640px]`} value={period} onChange={pick}
        options={[...OVERVIEW_PERIODS.map((p) => ({ id: p.id as Period | "custom", label: p.short })), { id: "custom", label: custom ? customShort(custom) : "Custom" }]} />
      {isCustom && (
        <div className="mb-5 flex max-w-[640px] items-center gap-3 rounded-2xl bg-surface px-4 py-2.5">
          <Plane size={16} className="text-mint" />
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-bold text-ink">{custom!.name || "Custom range"}</span>
            <span className="text-muted"> · {fmtDay(custom!.from)} → {custom!.to ? fmtDay(custom!.to) : "today (ongoing)"}{data ? ` · ${data.period.days} day${data.period.days === 1 ? "" : "s"}` : ""}</span>
          </div>
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[12px] font-bold text-ink-soft hover:text-ink"><Pencil size={12} /> Edit</button>
        </div>
      )}
      {editing && <CustomRangeDialog initial={custom} onClose={() => setEditing(false)}
        onSave={(r) => { saveCustom(r); setCustom(r); setPeriod(r ? "custom" : "this_month"); setEditing(false); }} />}
      {isLoading ? <Spinner /> : error ? <Empty emoji="🫠" title="Couldn't reach Finny" text={(error as Error).message} /> : !s ? (
        <Empty emoji="🧾" title="Clean slate" text={`No ${ccy} spend in this period.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-4">
            <section className="ink-card receipt relative overflow-hidden rounded-t-[26px] px-6 pt-6 text-white">
              <div className="pointer-events-none absolute -right-4 -top-10 text-[170px] font-black leading-none text-white/[0.03]">{ccy === "SGD" ? "S$" : "₹"}</div>
              <div className="eyebrow !text-[var(--mint)]">Spent · {data!.period.label}{data!.combined ? " · all cards" : ""}</div>
              <div className="mt-2"><Amount value={s.total} currency={ccy} size={46} weight={700} /></div>
              <div className="mt-1 text-[15px] font-medium text-white/70">{quip(s.change_pct)}</div>
              {data!.excluded?.[ccy]?.total ? (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/50"><EyeOff size={12} /> {money(data!.excluded[ccy].total, ccy)} in Exclusions not counted</div>
              ) : null}
              {data!.combined && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-white/50"><Merge size={12} /> SGD + INR combined at ₹{data!.combined.fx_rate.toFixed(2)}/S$ · {data!.combined.fx_date}</div>
              )}
              <div className="mt-4"><DailyBars daily={s.daily} ccy={ccy} /></div>
              <div className="perf perf-light my-4" />
              <div className="grid grid-cols-3">
                <Stat label="vs prior">{s.change_pct == null ? <span className="text-white/50">—</span> : (
                  <span className={`flex items-center gap-1 ${s.change_pct > 0 ? "text-[var(--coral)]" : "text-[var(--mint)]"}`}>
                    {s.change_pct > 0 ? <ArrowUpRight size={14} strokeWidth={3} /> : <ArrowDownRight size={14} strokeWidth={3} />}{Math.abs(Math.round(s.change_pct))}%
                  </span>)}</Stat>
                <Stat label="Txns">{s.count}</Stat>
                <Stat label="Per day">{money(s.avg_per_day, ccy)}</Stat>
              </div>
            </section>

            {cf && (
              <Card title="Money in vs out">
                <div className="grid grid-cols-2 gap-3">
                  <Flow label="In" value={`+${money(cf.in_total, ccy)}`} cls="text-mint" />
                  <Flow label="Out · your share" value={`−${money(cf.out_total, ccy)}`} cls="text-ink" />
                </div>
                {cf.in_total > 0 ? (
                  <>
                    <div className="mt-3 flex items-baseline justify-between">
                      <Eyebrow>{cf.net >= 0 ? "Net saved" : "Net overspent"}</Eyebrow>
                      <span className={`tabular text-[20px] font-bold ${cf.net >= 0 ? "text-mint" : "text-coral"}`}>{cf.net >= 0 ? "+" : "−"}{money(Math.abs(cf.net), ccy)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-mint-soft">
                      <div className={`h-full rounded-full ${cf.out_total >= cf.in_total ? "bg-coral" : "bg-ink"}`} style={{ width: `${Math.min(100, (cf.out_total / cf.in_total) * 100)}%` }} />
                    </div>
                  </>
                ) : <p className="mt-3 text-[12px] text-muted">No money in recorded for this period yet.</p>}
              </Card>
            )}

            <Card title="Big tickets">
              {s.largest.map((t: Txn) => <TxnRow key={t.id} t={t} onClick={() => openTxn(t.id)} />)}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Where it went">
              <div className="mb-4 flex h-2.5 gap-[3px] overflow-hidden rounded-full">
                {s.by_category.map((c) => <div key={c.key} style={{ width: `${(c.total / s.total) * 100}%`, background: categoryColor(c.key, dark) }} />)}
              </div>
              {s.by_category.map((c, i) => (
                <div key={c.key}>
                  <Link href={`/activity?category=${encodeURIComponent(c.key)}&from=${data!.period.from}&to=${data!.period.to}`}
                    className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-canvas">
                    <CategoryIcon category={c.key} size={36} />
                    <div className="flex-1">
                      <div className="text-[15px] font-semibold text-ink">{c.key}</div>
                      <div className="text-[12px] text-muted">{Math.round((c.total / s.total) * 100)}% of spend</div>
                    </div>
                    <Amount value={c.total} currency={ccy} size={16} className="text-ink" />
                    <ChevronRight size={14} className="text-muted" />
                  </Link>
                  {i < s.by_category.length - 1 && <Perf className="ml-12" />}
                </div>
              ))}
            </Card>
            <Card title="Usual suspects">
              {s.top_merchants.slice(0, 6).map((m, i) => (
                <Link key={m.key} href={`/activity?q=${encodeURIComponent(m.key)}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-canvas">
                  <span className={`w-6 font-mono text-[12px] font-bold ${i === 0 ? "text-mint" : "text-muted"}`}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate text-[15px] font-medium text-ink">{prettyMerchant(m.key)}</span>
                  <Amount value={m.total} currency={ccy} size={15} className="text-ink" />
                </Link>
              ))}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><div className="eyebrow !text-white/45">{label}</div><div className="tabular mt-1 text-[16px] font-bold">{children}</div></div>
);
const Flow = ({ label, value, cls }: { label: string; value: string; cls: string }) => (
  <div><Eyebrow>{label}</Eyebrow><div className={`tabular mt-1 text-[20px] font-bold ${cls}`}>{value}</div></div>
);

// ── Custom range (e.g. a trip) ─────────────────────────────
// Kept on this device until edited, so switching to Today and back keeps it.

type CustomRange = { name: string; from: string; to: string | null };
const CUSTOM_KEY = "finny.customRange";
const loadCustom = (): CustomRange | null => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "null"); } catch { return null; } };
const saveCustom = (r: CustomRange | null) => { try { r ? localStorage.setItem(CUSTOM_KEY, JSON.stringify(r)) : localStorage.removeItem(CUSTOM_KEY); } catch {} };
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short" });
const customShort = (r: CustomRange) => (r.name ? (r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name) : `${fmtDay(r.from)}–${r.to ? fmtDay(r.to) : "now"}`);

function CustomRangeDialog({ initial, onClose, onSave }: { initial: CustomRange | null; onClose: () => void; onSave: (r: CustomRange | null) => void }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const [name, setName] = useState(initial?.name ?? "");
  const [from, setFrom] = useState(initial?.from ?? today);
  const [ongoing, setOngoing] = useState(initial ? initial.to == null : true);
  const [to, setTo] = useState(initial?.to ?? today);
  const ok = !!from && (ongoing || (!!to && to >= from));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  const field = "mt-1 w-full rounded-xl bg-canvas px-3 py-2.5 text-[15px] font-semibold text-ink outline-none";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: name.trim(), from, to: ongoing ? null : to }); }}
        className="w-full max-w-[420px] space-y-3 rounded-[24px] bg-surface p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="display text-[22px]">Custom range</div>
        <p className="text-[13px] text-ink-soft">Track a trip or any stretch of time. It stays saved until you change it.</p>
        <label className="block text-[12px] font-semibold text-muted">Name (optional)<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spain trip" maxLength={40} className={field} /></label>
        <div className="flex gap-2">
          <label className="flex-1 text-[12px] font-semibold text-muted">From<input required type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
          <label className="flex-1 text-[12px] font-semibold text-muted">To<input type="date" value={ongoing ? today : to} min={from} disabled={ongoing} onChange={(e) => setTo(e.target.value)} className={`${field} disabled:opacity-40`} /></label>
        </div>
        <label className="flex items-center justify-between rounded-2xl bg-canvas px-4 py-3 text-[14px] font-semibold text-ink">
          <span>Ongoing <span className="block text-[12px] font-medium text-muted">Keeps counting up to today, e.g. while you’re still travelling</span></span>
          <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="h-5 w-5 accent-[var(--mint)]" />
        </label>
        <button disabled={!ok} className="h-12 w-full rounded-2xl bg-ink font-bold text-surface disabled:opacity-40">Show this range</button>
        {initial && <button type="button" onClick={() => onSave(null)} className="h-10 w-full rounded-2xl text-[13px] font-bold text-coral hover:bg-canvas">Remove custom range</button>}
      </form>
    </div>
  );
}
