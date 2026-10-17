"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarDays, Coins, CreditCard, Send, Sunset, Zap } from "lucide-react";
import { Card, Empty, Eyebrow, Perf, ScreenHeader, Spinner } from "@/components/ui";
import { api, send } from "@/lib/ui/finny";

type Job = { id: number; kind: string; status: "pending" | "running" | "done" | "error"; result: string | null; created_at: string; completed_at: string | null };
type Status = { ready: boolean; error?: string; settings: Record<string, boolean>; jobs: Job[] };

const MESSAGES = [
  { key: "transactions", job: "transactions", icon: CreditCard, title: "Transaction alerts", text: "A message for every card or PayNow spend, with a reply to tag or split it.", sendLabel: "Resend latest" },
  { key: "incoming", job: "incoming", icon: Coins, title: "Money in alerts", text: "Salary, PayNow received and refunds as they arrive.", sendLabel: "Resend latest" },
  { key: "nudges", job: null, icon: Zap, title: "Spend nudges", text: "When today runs 1.5× your usual, or you cross 80% of a day budget.", sendLabel: null },
  { key: "daily_digest", job: "daily_digest", icon: Sunset, title: "Daily summary", text: "Yesterday's spend, what stood out and how the month is pacing. Every morning at 8:00 (Tue–Sun).", sendLabel: "Send now" },
  { key: "weekly_review", job: "weekly_review", icon: CalendarDays, title: "Weekly summary", text: "Last week vs your usual, top categories and merchants. Mondays at 8:00.", sendLabel: "Send now" },
] as const;

const LABEL: Record<string, string> = { transactions: "Latest transaction", incoming: "Latest money in", daily_digest: "Daily summary", weekly_review: "Weekly summary", test: "Test message" };

export default function BotPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bot"],
    queryFn: () => api<Status>("bot"),
    // Poll while a send is in flight so its status updates on its own.
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === "pending" || j.status === "running") ? 2000 : false),
  });
  const toggle = useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) => send("PUT", "bot", v),
    onMutate: (v) => qc.setQueryData<Status>(["bot"], (d) => d && { ...d, settings: { ...d.settings, [v.key]: v.enabled } }),
    onError: () => qc.invalidateQueries({ queryKey: ["bot"] }),
  });
  const trigger = useMutation({
    mutationFn: (kind: string) => send<Job>("POST", "bot", { kind }),
    onSuccess: (job) => qc.setQueryData<Status>(["bot"], (d) => d && { ...d, jobs: [job as Job, ...d.jobs] }),
  });

  if (isLoading) return <Spinner />;
  if (!data?.ready) {
    return (
      <>
        <ScreenHeader eyebrow="Telegram" title="Finny bot" />
        <Empty emoji="🛠️" title="One-time setup" text="Run supabase_bot.sql in the Supabase SQL Editor, then refresh this page." />
      </>
    );
  }
  const s = data.settings;
  const master = s.bot;
  const busy = (kind: string) => data.jobs.some((j) => j.kind === kind && (j.status === "pending" || j.status === "running"));

  return (
    <>
      <ScreenHeader eyebrow="Telegram" title="Finny bot" />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <section className={`card flex items-center gap-4 ${master ? "" : "ring-1 ring-coral/40"}`}>
            <div className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${master ? "bg-mint-soft text-mint" : "bg-sunken text-muted"}`}><BellRing size={20} /></div>
            <div className="flex-1">
              <div className="text-[16px] font-bold text-ink">{master ? "Finny bot is on" : "Finny bot is off"}</div>
              <div className="text-[13px] text-ink-soft">{master ? "Sending the messages switched on below." : "No Telegram messages and no replies. Claude and ChatGPT keep working."}</div>
            </div>
            <Switch on={master} onChange={(v) => toggle.mutate({ key: "bot", enabled: v })} label="Finny bot" />
          </section>

          <Card title="Messages">
            {MESSAGES.map((m, i) => {
              const on = s[m.key];
              return (
                <div key={m.key}>
                  <div className={`flex items-center gap-3 py-3 ${master ? "" : "opacity-50"}`}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-canvas text-ink-soft"><m.icon size={17} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-ink">{m.title}</div>
                      <div className="text-[12px] text-muted">{m.text}</div>
                    </div>
                    {m.job && (
                      <button disabled={busy(m.job)} onClick={() => trigger.mutate(m.job!)}
                        className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-canvas px-3 text-[12px] font-bold text-ink hover:bg-sunken disabled:opacity-50">
                        <Send size={12} /> {busy(m.job) ? "Sending…" : m.sendLabel}
                      </button>
                    )}
                    <Switch on={on} onChange={(v) => toggle.mutate({ key: m.key, enabled: v })} label={m.title} />
                  </div>
                  {i < MESSAGES.length - 1 && <Perf className="ml-[52px]" />}
                </div>
              );
            })}
          </Card>
          <p className="px-1 text-[12px] text-muted">Switches take effect within about 20 seconds. “Send now” always sends, even if that message is switched off. These only affect the Telegram bot, not your Claude or ChatGPT connection.</p>
        </div>

        <Card title="Recent sends" trailing={
          <button onClick={() => trigger.mutate("test")} disabled={busy("test")} className="text-[12px] font-bold text-mint disabled:opacity-50">Send a test</button>
        }>
          {data.jobs.length === 0 ? <p className="text-[13px] text-ink-soft">Nothing sent on demand yet.</p> : data.jobs.map((j, i) => (
            <div key={j.id}>
              <div className="flex items-center gap-3 py-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${j.status === "done" ? "bg-mint" : j.status === "error" ? "bg-coral" : "animate-pulse bg-muted"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">{LABEL[j.kind] ?? j.kind}</div>
                  <div className="truncate text-[12px] text-muted">
                    {j.status === "pending" ? "Queued — the bot picks it up within a few seconds" : j.status === "running" ? "Sending…" : j.status === "error" ? `Failed: ${j.result}` : "Sent"}
                  </div>
                </div>
                <Eyebrow>{new Date(j.created_at).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Eyebrow>
              </div>
              {i < data.jobs.length - 1 && <Perf />}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-mint" : "bg-sunken"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
