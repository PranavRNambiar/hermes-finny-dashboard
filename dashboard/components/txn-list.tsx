"use client";

import { AlertCircle, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cardLabel, dayLabel, displayMerchant, foreignLabel, money, Txn } from "@/lib/ui/finny";
import { useApp, useHotkey } from "./app";
import { Amount, CategoryIcon, Eyebrow, Perf } from "./ui";

export function TxnRow({ t, selected, onClick }: { t: Txn; selected?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const sub = `${dayLabel(t.txn_date)}${t.txn_time ? `, ${t.txn_time.slice(0, 5)}` : ""} · ${cardLabel(t.card)}`;
  return (
    <button ref={ref} onClick={onClick}
      className={`-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors ${selected ? "bg-sunken ring-[1.5px] ring-[var(--mint)]" : "hover:bg-canvas"}`}>
      <CategoryIcon category={t.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-[15px] font-semibold ${t.category === "Exclusions" ? "text-muted line-through decoration-1" : "text-ink"}`}>{displayMerchant(t)}</span>
          {t.anomaly_flagged && <AlertCircle size={13} className="shrink-0 text-coral" />}
        </div>
        <div className="truncate text-[12px] text-muted">{sub}</div>
        {t.split_with > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-mint"><Users size={11} /> your share of {money(t.total_amount, t.currency)}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Amount value={t.amount} currency={t.currency} size={16} className="text-ink" />
        {foreignLabel(t) && <span className="tabular text-[11px] font-semibold text-muted" title="Paid in a foreign currency; converted for your totals">{foreignLabel(t)}</span>}
        {t.user_tag && <span className="text-[11px] font-semibold text-mint">#{t.user_tag}</span>}
      </div>
    </button>
  );
}

/** Day-grouped cards with J/K/Enter keyboard navigation. */
export function TxnGroups({ items, onEnd }: { items: Txn[]; onEnd?: () => void }) {
  const { openTxn } = useApp();
  const [sel, setSel] = useState(-1);
  useEffect(() => setSel(-1), [items.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkey("j", () => setSel((s) => { const n = Math.min(items.length - 1, s + 1); if (n >= items.length - 3) onEnd?.(); return n; }));
  useHotkey("k", () => setSel((s) => Math.max(0, s - 1)));
  useHotkey("Enter", () => { if (sel >= 0 && items[sel]) openTxn(items[sel].id); });

  const groups = useMemo(() => {
    const m = new Map<string, { t: Txn; i: number }[]>();
    items.forEach((t, i) => m.set(t.txn_date, [...(m.get(t.txn_date) ?? []), { t, i }]));
    return [...m.entries()];
  }, [items]);

  return (
    <div className="space-y-5">
      {groups.map(([day, rows]) => {
        const byCcy = new Map<string, number>();
        rows.forEach(({ t }) => { if (t.category !== "Exclusions") byCcy.set(t.currency, (byCcy.get(t.currency) ?? 0) + t.amount); });
        return (
          <div key={day}>
            <div className="mb-2 flex justify-between px-1">
              <Eyebrow>{dayLabel(day)}</Eyebrow>
              <span className="tabular text-[12px] font-semibold text-ink-soft">{[...byCcy.entries()].sort().reverse().map(([c, v]) => money(v, c)).join("  ·  ")}</span>
            </div>
            <div className="card !py-2">
              {rows.map(({ t, i }, j) => (
                <div key={t.id}>
                  <TxnRow t={t} selected={i === sel} onClick={() => { setSel(i); openTxn(t.id); }} />
                  {j < rows.length - 1 && <Perf className="ml-[52px]" />}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
