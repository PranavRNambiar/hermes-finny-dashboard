"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Undo2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/app";
import { Amount, Card, Empty, Eyebrow, Perf, ScreenHeader, Spinner } from "@/components/ui";
import { api, money, prettyMerchant, send } from "@/lib/ui/finny";

type Person = { person_id: number | null; name: string; currency: string; total: number;
  items: { split_id: number; transaction_id: string; merchant: string | null; txn_date: string | null; share_amount: number }[] };
type Settlement = { person_id: number; name: string; settled_at: string; currency: string; total: number;
  items: { split_id: number; merchant: string | null; txn_date: string | null; share_amount: number }[] };

const initials = (n: string) => n.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export default function SplitsPage() {
  const qc = useQueryClient();
  const { openTxn } = useApp();
  const owed = useQuery({ queryKey: ["splits"], queryFn: () => api<{ owed_to_me: Person[]; totals_by_currency: Record<string, number> }>("splits") });
  const history = useQuery({ queryKey: ["settlements"], queryFn: () => api<{ settlements: Settlement[] }>("splits/history") });
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Person | null>(null);
  const [undo, setUndo] = useState<{ name: string; person_id: number; at: string } | null>(null);

  async function markPaid(p: Person) {
    setConfirm(null);
    await send("POST", "splits/settle", { person_id: p.person_id, currency: p.currency });
    await qc.invalidateQueries();
    const h = await api<{ settlements: Settlement[] }>("splits/history");
    const s = h.settlements.find((x) => x.person_id === p.person_id);
    if (s) { setUndo({ name: p.name, person_id: s.person_id, at: s.settled_at }); setTimeout(() => setUndo((u) => (u?.at === s.settled_at ? null : u)), 8000); }
  }
  async function revive(person_id: number, at: string) {
    await send("POST", "splits/unsettle", { person_id, settled_at: at });
    setUndo(null);
    await qc.invalidateQueries();
  }

  const people = owed.data?.owed_to_me ?? [];
  return (
    <>
      <ScreenHeader eyebrow="Bills you fronted" title="Splits" />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Who owes you" trailing={Object.entries(owed.data?.totals_by_currency ?? {}).map(([c, v]) => money(v, c)).join(" · ")}>
          {owed.isLoading ? <Spinner /> : people.length === 0 ? (
            <Empty emoji="🤝" title="All square" text="Nobody owes you a thing. Rare. Split a bill from any transaction (press S)." />
          ) : people.map((p, i) => {
            const key = `${p.person_id}-${p.currency}`;
            return (
              <div key={key}>
                <div className="flex items-center gap-3 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mint-soft text-[14px] font-bold text-mint">{initials(p.name)}</div>
                  <button onClick={() => setOpen(open === key ? null : key)} className="flex flex-1 items-center gap-1.5 text-left">
                    <span><span className="block text-[15px] font-semibold text-ink">{p.name}</span><span className="text-[12px] text-muted">{p.items.length} unsettled</span></span>
                    <ChevronDown size={14} className={`text-muted transition-transform ${open === key ? "rotate-180" : ""}`} />
                  </button>
                  <Amount value={p.total} currency={p.currency} size={17} className="text-ink" />
                  {p.person_id != null && (
                    <button onClick={() => setConfirm(p)} className="ml-2 h-8 rounded-full bg-mint-soft px-3 text-[12px] font-bold text-mint hover:bg-mint hover:text-white">Paid</button>
                  )}
                </div>
                {open === key && (
                  <div className="mb-2 ml-[52px] space-y-1">
                    {p.items.map((it) => (
                      <button key={it.split_id} onClick={() => openTxn(it.transaction_id)} className="flex w-full justify-between rounded-lg px-2 py-1 text-[13px] text-ink-soft hover:bg-canvas">
                        <span className="truncate">{prettyMerchant(it.merchant ?? "—")} <span className="text-muted">· {it.txn_date}</span></span>
                        <span className="tabular">{money(it.share_amount, p.currency)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {i < people.length - 1 && <Perf className="ml-[52px]" />}
              </div>
            );
          })}
        </Card>

        <Card title="Settled history">
          {(history.data?.settlements ?? []).length === 0 ? <p className="text-[13px] text-ink-soft">Nothing settled yet.</p> :
            history.data!.settlements.slice(0, 20).map((h, i) => (
              <div key={`${h.person_id}|${h.settled_at}`}>
                <div className="flex items-center gap-3 py-2.5">
                  <CheckCircle2 size={20} className="shrink-0 text-mint" />
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold text-ink">{h.name}</div>
                    <div className="text-[12px] text-muted">Paid {new Date(h.settled_at).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {h.items.length} item{h.items.length === 1 ? "" : "s"}</div>
                  </div>
                  <span className="text-ink-soft"><Amount value={h.total} currency={h.currency} size={15} /></span>
                  <button onClick={() => revive(h.person_id, h.settled_at)} title="Mark as unpaid"
                    className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold text-coral hover:bg-canvas"><Undo2 size={13} /> Unpaid</button>
                </div>
                {i < Math.min(20, history.data!.settlements.length) - 1 && <Perf />}
              </div>
            ))}
        </Card>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={() => setConfirm(null)}>
          <div className="w-full max-w-[380px] rounded-[24px] bg-surface p-6 text-center" onMouseDown={(e) => e.stopPropagation()}>
            <Eyebrow>Mark as paid</Eyebrow>
            <div className="display mt-2 text-[22px]">{confirm.name} paid you</div>
            <div className="my-2 text-mint"><Amount value={confirm.total} currency={confirm.currency} size={34} weight={700} /></div>
            <p className="text-[13px] text-ink-soft">Clears {confirm.items.length} item{confirm.items.length === 1 ? "" : "s"}. You can undo this from Settled history.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirm(null)} className="h-11 flex-1 rounded-2xl bg-canvas font-semibold text-ink">Cancel</button>
              <button autoFocus onClick={() => markPaid(confirm)} className="h-11 flex-1 rounded-2xl bg-ink font-bold text-surface">Mark paid</button>
            </div>
          </div>
        </div>
      )}
      {undo && (
        <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-surface shadow-lg md:bottom-8">
          {undo.name} marked as paid
          <button onClick={() => revive(undo.person_id, undo.at)} className="font-bold text-[var(--mint)]">Undo</button>
        </div>
      )}
    </>
  );
}
