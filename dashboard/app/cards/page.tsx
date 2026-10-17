"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useState } from "react";
import { ScanButton } from "@/components/scan";
import { Card, Eyebrow, Perf, ScreenHeader, Spinner } from "@/components/ui";
import { cardLabel } from "@/lib/ui/finny";

type C = { card: string; label: string; currency: string; active: boolean };

export default function CardsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["cards"], queryFn: () => fetch("/api/cards").then((r) => r.json() as Promise<{ cards: C[]; fallback?: boolean }>) });
  const [name, setName] = useState(""); const [label, setLabel] = useState(""); const [currency, setCurrency] = useState("SGD");
  const [err, setErr] = useState(""); const [added, setAdded] = useState<C | null>(null);
  const cards = data?.cards ?? [];

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const res = await fetch("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: name, label, currency }) });
    const d = await res.json();
    if (!res.ok) return setErr(d.error ?? "Couldn't add card");
    setAdded(d.card); setName(""); setLabel(""); qc.invalidateQueries({ queryKey: ["cards"] });
  }
  async function toggle(c: C) {
    await fetch("/api/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: c.card, active: !c.active }) });
    qc.invalidateQueries({ queryKey: ["cards"] });
  }

  return (
    <>
      <ScreenHeader eyebrow="Where Finny listens" title="Cards" right={<ScanButton label="Scan all" />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Watching">
          {isLoading ? <Spinner /> : cards.map((c, i) => (
            <div key={c.card}>
              <div className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-mint-soft text-mint"><CreditCard size={17} /></div>
                <div className="flex-1">
                  <div className="text-[15px] font-semibold text-ink">{cardLabel(c.card)} <span className="ml-1 rounded-full bg-sunken px-2 py-0.5 text-[10px] font-bold text-ink-soft">{c.currency}</span></div>
                  <div className="text-[12px] text-muted">Gmail label “{c.label}”{c.active ? "" : " · paused"}</div>
                </div>
                <button onClick={() => toggle(c)} disabled={data?.fallback} aria-label={c.active ? "Pause" : "Resume"}
                  className={`relative h-7 w-12 rounded-full transition-colors ${c.active ? "bg-mint" : "bg-hairline"}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${c.active ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              {i < cards.length - 1 && <Perf className="ml-[52px]" />}
            </div>
          ))}
        </Card>
        <Card title="Add a card">
          <p className="mb-4 text-[13px] text-ink-soft">Create a Gmail filter that labels the bank's alert emails, then register the label here. Finny starts watching within ~5 minutes.</p>
          <form onSubmit={add} className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Card name, e.g. hdfc" className="h-11 w-full rounded-2xl bg-canvas px-4 text-[15px] font-medium text-ink outline-none placeholder:text-muted" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gmail label, e.g. HDFC Alerts" className="h-11 w-full rounded-2xl bg-canvas px-4 text-[15px] font-medium text-ink outline-none placeholder:text-muted" />
            <div className="flex gap-2">
              {["SGD", "INR"].map((c) => (
                <button type="button" key={c} onClick={() => setCurrency(c)} className={`h-9 flex-1 rounded-full text-[12px] font-bold ${currency === c ? "bg-ink text-surface" : "bg-canvas text-ink-soft"}`}>{c}</button>
              ))}
            </div>
            {err && <div className="text-[13px] text-coral">{err}</div>}
            <button disabled={data?.fallback} className="h-11 w-full rounded-2xl bg-ink text-[14px] font-bold text-surface disabled:opacity-40">Add card</button>
          </form>
          {added && (
            <div className="mt-4 space-y-2 rounded-2xl bg-mint-soft p-4">
              <p className="text-[13px] text-ink"><b>{cardLabel(added.card)}</b> added. Scan now to pull the last 90 days.</p>
              <ScanButton card={added.card} days={90} label={`Scan ${cardLabel(added.card)}`} compact />
            </div>
          )}
          <Eyebrow className="mt-5">Heads up</Eyebrow>
          <p className="mt-1 text-[12px] text-muted">A new bank's email format may need parser rules. If a scan finds emails but saves nothing, the format isn't recognised yet.</p>
        </Card>
      </div>
    </>
  );
}
