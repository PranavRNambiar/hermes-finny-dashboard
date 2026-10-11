"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Hash, LayoutGrid, Pencil, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, CATEGORIES, cardLabel, displayMerchant, encId, money, prettyMerchant, send, symbol, Txn } from "@/lib/ui/finny";
import { useApp } from "./app";
import { Amount, CategoryIcon, CategoryTag, Eyebrow, Kbd, Perf } from "./ui";

type Panel = null | "tag" | "category" | "rename" | "split";

export function TxnDrawer() {
  const { txnId, closeTxn } = useApp();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { data: t } = useQuery({ queryKey: ["txn", txnId], enabled: !!txnId, queryFn: () => api<Txn>(`transactions/${encId(txnId!)}`) });

  useEffect(() => setPanel(null), [txnId]);

  // Drawer hotkeys (only while open and no editor is focused).
  useEffect(() => {
    if (!txnId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") { e.stopPropagation(); panel ? setPanel(null) : closeTxn(); return; }
      if (k === "t") { e.preventDefault(); setPanel("tag"); }
      if (k === "c") { e.preventDefault(); setPanel("category"); }
      if (k === "r") { e.preventDefault(); setPanel("rename"); }
      if (k === "s") { e.preventDefault(); setPanel("split"); }
      if (k === "x" && t) { e.preventDefault(); save(t.category === "Exclusions" ? "Category restored to Transfers & Misc" : "Moved to Exclusions — not counted in totals",
        () => send("PATCH", `transactions/${encId(t.id)}`, { category: t.category === "Exclusions" ? "Transfers & Misc" : "Exclusions", apply_to_merchant: false })); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnId, panel, t]);

  async function save(message: string, op: () => Promise<unknown>): Promise<string | null> {
    try {
      await op();
      setPanel(null);
      void qc.invalidateQueries(); // refresh in the background; don't hold the UI
      setToast(message);
      setTimeout(() => setToast(null), 2600);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  if (!txnId) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25 backdrop-blur-[1px]" onMouseDown={closeTxn}>
      <div className="flex h-full w-full max-w-[460px] flex-col overflow-y-auto bg-canvas p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>Transaction</Eyebrow>
          <button onClick={closeTxn} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink-soft hover:text-ink"><X size={16} /></button>
        </div>
        {!t ? <div className="py-20 text-center text-sm text-muted">Loading…</div> : (
          <>
            <div className="receipt rounded-t-[28px] bg-surface px-6 pt-7 text-center">
              <div className="flex justify-center"><CategoryIcon category={t.category} size={60} /></div>
              <button onClick={() => setPanel("rename")} className="mt-3 inline-flex items-center gap-1.5 text-[21px] font-semibold text-ink">
                {displayMerchant(t)} <Pencil size={13} className="text-muted" />
              </button>
              {t.raw_merchant && t.raw_merchant !== t.merchant && <div className="font-mono text-[11px] text-muted">Bank name: {t.raw_merchant}</div>}
              <div className="mt-2 text-ink"><Amount value={t.amount} currency={t.currency} size={44} weight={700} /></div>
              {t.split_with > 0 && <div className="mt-1 text-[13px] font-semibold text-mint">Your share · {money(t.total_amount, t.currency)} total, split with {t.split_with}</div>}
              <button onClick={() => setPanel("category")} className="mt-3"><CategoryTag category={t.category} /></button>
              {t.category === "Exclusions" && <div className="mt-2 text-[12px] text-muted">Not counted in any totals</div>}
              <Perf className="my-5" />
              <div className="space-y-3 pb-1 text-left">
                <Row label="Date" value={new Date(`${t.txn_date}T00:00:00`).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
                {t.txn_time && <Row label="Time" value={t.txn_time.slice(0, 5)} />}
                <Row label="Card" value={cardLabel(t.card)} />
                <div className="flex items-center justify-between">
                  <Eyebrow>Tag</Eyebrow>
                  <button onClick={() => setPanel("tag")} className="text-[15px] font-semibold text-mint">{t.user_tag ? `#${t.user_tag}` : "+ Add tag"}</button>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              <Action icon={<Users size={16} />} label="Split" k="S" on={panel === "split"} onClick={() => setPanel("split")} />
              <Action icon={<Hash size={16} />} label="Tag" k="T" on={panel === "tag"} onClick={() => setPanel("tag")} />
              <Action icon={<LayoutGrid size={16} />} label="Category" k="C" on={panel === "category"} onClick={() => setPanel("category")} />
              <Action icon={<Pencil size={16} />} label="Rename" k="R" on={panel === "rename"} onClick={() => setPanel("rename")} />
            </div>

            {panel === "tag" && <TagPanel t={t} save={save} />}
            {panel === "category" && <CategoryPanel t={t} save={save} />}
            {panel === "rename" && <RenamePanel t={t} save={save} />}
            {panel === "split" && <SplitPanel t={t} save={save} />}

            {!panel && !!t.splits?.length && (
              <div className="card mt-3">
                <div className="mb-3 flex justify-between"><Eyebrow>Split with</Eyebrow><Eyebrow>you: {money(t.amount, t.currency)}</Eyebrow></div>
                {t.splits.map((s) => (
                  <div key={s.split_id} className="flex items-center justify-between py-1.5 text-[14px]">
                    <span className="font-semibold text-ink">{s.person ?? "—"}</span>
                    <span className="flex items-center gap-2"><Amount value={s.share_amount} currency={s.currency} size={14} />
                      {s.status === "settled" ? <CheckCircle2 size={15} className="text-mint" /> : <Clock size={15} className="text-coral" />}</span>
                  </div>
                ))}
              </div>
            )}
            {!panel && t.raw_desc && (
              <div className="card mt-3">
                <Eyebrow className="mb-3">Original bank alert</Eyebrow>
                <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-soft">{t.raw_desc}</p>
              </div>
            )}
          </>
        )}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-surface shadow-lg">{toast}</div>
        )}
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between"><Eyebrow>{label}</Eyebrow><span className="text-[15px] font-semibold text-ink">{value}</span></div>
);

function Action({ icon, label, k, on, onClick }: { icon: React.ReactNode; label: string; k: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 rounded-[18px] py-3 ${on ? "bg-ink text-surface" : "bg-surface text-ink hover:bg-sunken"}`}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span>
      <span className={`text-[9px] font-bold ${on ? "text-surface/50" : "text-muted"}`}>{k}</span>
    </button>
  );
}

type Save = (message: string, op: () => Promise<unknown>) => Promise<string | null>;

function PanelFrame({ title, children, onSubmit, submitLabel, error, applyAll, setApplyAll, merchant }: {
  title: string; children: React.ReactNode; onSubmit: () => void | Promise<void>; submitLabel: string; error: string | null;
  applyAll?: boolean; setApplyAll?: (v: boolean) => void; merchant?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form className="card mt-3 space-y-4" onSubmit={async (e) => { e.preventDefault(); if (busy) return; setBusy(true); try { await onSubmit(); } finally { setBusy(false); } }}>
      <Eyebrow>{title}</Eyebrow>
      {children}
      {setApplyAll && (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-canvas px-4 py-3">
          <span>
            <span className="block text-[14px] font-semibold text-ink">Every {merchant} transaction</span>
            <span className="block text-[12px] text-muted">Past ones now, and future ones automatically</span>
          </span>
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="h-5 w-5 accent-[var(--mint)]" />
        </label>
      )}
      {error && <div className="text-[13px] text-coral">{error}</div>}
      <button disabled={busy} className="h-12 w-full rounded-2xl bg-ink text-[15px] font-bold text-surface disabled:opacity-70">
        {busy ? "Saving…" : <>{submitLabel} <span className="ml-1 text-[11px] opacity-50">↵</span></>}
      </button>
    </form>
  );
}

function TagPanel({ t, save }: { t: Txn; save: Save }) {
  const [tag, setTag] = useState(t.user_tag ?? "");
  const [all, setAll] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["meta"], queryFn: () => api<{ tags: { name: string }[] }>("meta"), staleTime: 300_000 });
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => setErr(await save(all ? `Tagged every ${displayMerchant(t)} transaction` : "Tag saved",
    () => send("PATCH", `transactions/${encId(t.id)}`, { tag: tag.trim() || null, apply_to_merchant: all })));
  return (
    <PanelFrame title="Tag" onSubmit={submit} submitLabel={tag.trim() ? "Save tag" : "Remove tag"} error={err} applyAll={all} setApplyAll={setAll} merchant={displayMerchant(t)}>
      <div className="flex h-12 items-center gap-2 rounded-2xl bg-canvas px-4">
        <span className="text-xl font-bold text-mint">#</span>
        <input ref={ref} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="date-night, work, trip-goa…"
          className="flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-muted" />
      </div>
      <div className="flex flex-wrap gap-2">
        {(data?.tags ?? []).slice(0, 12).map((x) => (
          <button type="button" key={x.name} onClick={() => setTag(x.name)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${tag === x.name ? "bg-mint text-white" : "bg-canvas text-ink"}`}>#{x.name}</button>
        ))}
      </div>
    </PanelFrame>
  );
}

function CategoryPanel({ t, save }: { t: Txn; save: Save }) {
  const [cat, setCat] = useState(t.category);
  const [all, setAll] = useState(t.category !== "Exclusions");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => setErr(await save(all ? `All ${displayMerchant(t)} transactions are now ${cat}` : "Category updated",
    () => send("PATCH", `transactions/${encId(t.id)}`, { category: cat, apply_to_merchant: all })));
  return (
    <PanelFrame title="Category" onSubmit={submit} submitLabel="Save" error={err} applyAll={all} setApplyAll={setAll} merchant={displayMerchant(t)}>
      <div className="grid grid-cols-2 gap-1.5">
        {CATEGORIES.map((c) => (
          <button type="button" key={c} onClick={() => setCat(c)}
            className={`flex items-center gap-2 rounded-2xl p-2 text-left text-[13px] font-semibold ${cat === c ? "bg-ink text-surface" : "bg-canvas text-ink"}`}>
            <CategoryIcon category={c} size={26} /> {c}
          </button>
        ))}
      </div>
      {cat === "Exclusions" && <div className="text-[12px] text-muted">Exclusions stay visible but never count towards totals, averages or run rates. Good for tuition and other big one-offs.</div>}
    </PanelFrame>
  );
}

function RenamePanel({ t, save }: { t: Txn; save: Save }) {
  const raw = t.raw_merchant ?? t.merchant ?? "";
  const [name, setName] = useState(t.raw_merchant && t.raw_merchant !== t.merchant ? t.merchant ?? "" : "");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => setErr(await save(name.trim() ? "Renamed everywhere, past and future" : "Name reset",
    () => send("POST", "merchants/rename", { merchant: raw, display_name: name.trim() || null })));
  return (
    <PanelFrame title="Rename merchant" onSubmit={submit} submitLabel={name.trim() ? "Rename" : "Reset to bank name"} error={err}>
      <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} placeholder={prettyMerchant(raw)}
        className="h-12 w-full rounded-2xl bg-canvas px-4 text-[16px] font-semibold text-ink outline-none placeholder:text-muted" />
      <div className="text-[12px] text-muted">Applies to every past and future transaction the bank sends as “{raw}”.</div>
    </PanelFrame>
  );
}

function SplitPanel({ t, save }: { t: Txn; save: Save }) {
  type R = { id: number; name: string; amount: string };
  const pending = (t.splits ?? []).filter((s) => s.status !== "settled");
  const [rows, setRows] = useState<R[]>(pending.length ? pending.map((s, i) => ({ id: i, name: s.person ?? "", amount: s.share_amount.toFixed(2) })) : [{ id: 0, name: "", amount: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: { id: number; name: string }[] }>("people"), staleTime: 300_000 });
  const total = t.total_amount;
  const owed = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const mine = total - owed;
  const equal = (n: number) => {
    const each = Math.round((total / n) * 100) / 100;
    setRows((rs) => Array.from({ length: n - 1 }, (_, i) => ({ id: rs[i]?.id ?? Date.now() + i, name: rs[i]?.name ?? "", amount: each.toFixed(2) })));
  };
  const valid = rows.filter((r) => r.name.trim() && Number(r.amount) > 0);
  const submit = async () => {
    if (mine < -0.005) return setErr("Others can't owe more than the total.");
    if (rows.some((r) => !r.name.trim() && Number(r.amount) > 0)) return setErr("Add a name for everyone who owes you.");
    setErr(await save(valid.length ? "Split saved · your share updated" : "Split removed",
      () => send("PUT", `transactions/${encId(t.id)}/splits`, { splits: valid.map((r) => ({ name: r.name.trim(), amount: Number(r.amount) })) })));
  };
  const names = useMemo(() => (data?.people ?? []).map((p) => p.name), [data]);
  return (
    <PanelFrame title="Split bill" onSubmit={submit} submitLabel={valid.length ? "Save split" : "Remove split"} error={err}>
      <div>
        <Eyebrow>Your share</Eyebrow>
        <div className={mine < -0.005 ? "text-coral" : "text-ink"}><Amount value={Math.max(0, mine)} currency={t.currency} size={34} weight={700} /></div>
        <div className="text-[12px] text-muted">of {money(total, t.currency)} total · only your share counts in your spending</div>
      </div>
      <div className="flex gap-1.5">
        {[2, 3, 4, 5, 6].map((n) => (
          <button type="button" key={n} onClick={() => equal(n)} className="h-9 flex-1 rounded-full bg-canvas text-[13px] font-bold text-ink hover:bg-sunken">÷{n}</button>
        ))}
      </div>
      <datalist id="people">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex h-11 items-center gap-2 rounded-2xl bg-canvas px-3">
            <input list="people" value={r.name} placeholder="Name" onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x))}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:text-muted" />
            <span className="text-muted">{symbol(t.currency)}</span>
            <input inputMode="decimal" value={r.amount} placeholder="0.00" onChange={(e) => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, amount: e.target.value } : x))}
              className="tabular w-20 bg-transparent text-right text-[15px] font-semibold text-ink outline-none placeholder:text-muted" />
            <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="text-muted hover:text-coral"><X size={15} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, { id: Date.now(), name: "", amount: "" }])} className="text-[14px] font-semibold text-mint">+ Add person</button>
      </div>
    </PanelFrame>
  );
}
