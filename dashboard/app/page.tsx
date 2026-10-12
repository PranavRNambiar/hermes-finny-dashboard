"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight, EyeOff, Merge } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DailyBars } from "@/components/charts";
import { useApp, useHotkey } from "@/components/app";
import { CurrencyPicker } from "@/components/currency-picker";
import { TxnRow } from "@/components/txn-list";
import { Amount, Card, CategoryIcon, categoryColor, Empty, Eyebrow, Perf, Pills, ScreenHeader, Spinner, useDark } from "@/components/ui";
import { api, money, modeCombine, modeCurrency, Overview, OVERVIEW_PERIODS, Period, prettyMerchant, quip, Txn } from "@/lib/ui/finny";

export default function OverviewPage() {
  const { mode, openTxn } = useApp();
  const [period, setPeriod] = useState<Period>("this_month");
  const ccy = modeCurrency(mode);
  const dark = useDark();
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", period, mode],
    queryFn: () => api<Overview>("overview", { period, combine: modeCombine(mode) }),
  });
  useHotkey("1", () => setPeriod(OVERVIEW_PERIODS[0].id));
  useHotkey("2", () => setPeriod(OVERVIEW_PERIODS[1].id));
  useHotkey("3", () => setPeriod(OVERVIEW_PERIODS[2].id));
  useHotkey("4", () => setPeriod(OVERVIEW_PERIODS[3].id));
  useHotkey("5", () => setPeriod(OVERVIEW_PERIODS[4].id));

  const s = data?.currencies[ccy];
  const cf = data?.cash_flow?.[ccy];
  const today = new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <ScreenHeader eyebrow={today} title="Overview" right={<CurrencyPicker />} />
      <Pills className="mb-5 max-w-[520px]" options={OVERVIEW_PERIODS.map((p) => ({ id: p.id, label: p.short }))} value={period} onChange={setPeriod} />
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
