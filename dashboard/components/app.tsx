"use client";

import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CreditCard, LayoutGrid, List, LogOut, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, Mode, modeCombine, MODES } from "@/lib/ui/finny";
import { CommandMenu } from "./command-menu";
import { ShortcutsHelp } from "./shortcuts-help";
import { TxnDrawer } from "./txn-drawer";
import { Kbd } from "./ui";

// ── Global state ───────────────────────────────────────────

type Ctx = {
  mode: Mode; setMode: (m: Mode) => void; cycleMode: () => void;
  openTxn: (id: string) => void; closeTxn: () => void; txnId: string | null;
  openCommand: (initial?: string) => void;
  refresh: () => void;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

// ── Shortcuts (Linear-style) ───────────────────────────────

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid, key: "o" },
  { href: "/activity", label: "Activity", icon: List, key: "a" },
  { href: "/insights", label: "Insights", icon: BarChart3, key: "i" },
  { href: "/splits", label: "Splits", icon: Users, key: "s" },
  { href: "/cards", label: "Cards", icon: CreditCard, key: "c" },
];

type Handler = (e: KeyboardEvent) => void;
const listeners = new Set<{ key: string; fn: Handler }>();

/** Page-level single-key shortcuts (j/k, t, c…). Ignored while typing or when a modal owns the keyboard. */
export function useHotkey(key: string, fn: Handler, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const entry = { key, fn: (e: KeyboardEvent) => ref.current(e) };
    listeners.add(entry);
    return () => { listeners.delete(entry); };
  }, [key, enabled]);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

// ── Providers + shell ──────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } } }));
  const path = usePathname();
  if (path === "/login") return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return (
    <QueryClientProvider client={client}>
      <Shell>{children}</Shell>
    </QueryClientProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [mode, setModeState] = useState<Mode>("SGD");
  const [txnId, setTxnId] = useState<string | null>(null);
  const [cmd, setCmd] = useState<{ open: boolean; initial: string }>({ open: false, initial: "" });
  const [help, setHelp] = useState(false);
  const [goPending, setGoPending] = useState(false);

  useEffect(() => {
    try { const m = localStorage.getItem("finny.mode") as Mode | null; if (m && MODES.some((x) => x.id === m)) setModeState(m); } catch {}
  }, []);
  const setMode = useCallback((m: Mode) => { setModeState(m); try { localStorage.setItem("finny.mode", m); } catch {} }, []);
  const cycleMode = useCallback(() => {
    setModeState((cur) => {
      const next = MODES[(MODES.findIndex((x) => x.id === cur) + 1) % MODES.length].id;
      try { localStorage.setItem("finny.mode", next); } catch {}
      return next;
    });
  }, []);

  // Warm the main screens so tab switches render from cache instantly.
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["overview", "this_month", mode], queryFn: () => api("overview", { period: "this_month", combine: modeCombine(mode) }) });
    qc.prefetchQuery({ queryKey: ["splits"], queryFn: () => api("splits") });
    qc.prefetchQuery({ queryKey: ["meta"], queryFn: () => api("meta") });
    qc.prefetchQuery({ queryKey: ["merchants"], queryFn: () => api("merchants") });
  }, [qc, mode]);

  const ctx: Ctx = {
    mode, setMode, cycleMode,
    txnId, openTxn: setTxnId, closeTxn: () => setTxnId(null),
    openCommand: (initial = "") => setCmd({ open: true, initial }),
    refresh: () => qc.invalidateQueries(),
  };

  // Global keyboard: ⌘K, ?, G-then-X, M, /, plus page hotkeys.
  useEffect(() => {
    let goTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((c) => ({ open: !c.open, initial: "" })); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setHelp((h) => !h); return; }
      if (cmd.open || help || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (goPending) {
        setGoPending(false); clearTimeout(goTimer);
        const dest = NAV.find((n) => n.key === k) ?? (k === "r" ? { href: "/activity?view=received" } : null);
        if (dest) { e.preventDefault(); router.push(dest.href); }
        return;
      }
      if (txnId) {
        if (e.key === "Escape") { setTxnId(null); return; }
      }
      if (k === "g") { setGoPending(true); goTimer = setTimeout(() => setGoPending(false), 1200); return; }
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setHelp(true); return; }
      if (e.key === "/") { e.preventDefault(); setCmd({ open: true, initial: "" }); return; }
      if (k === "m" && !txnId) { cycleMode(); return; }
      for (const l of listeners) if (l.key === k || l.key === e.key) { l.fn(e); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(goTimer); };
  }, [cmd.open, help, goPending, txnId, router, cycleMode]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="min-h-screen">
        <ProgressBar />
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 hidden w-[232px] flex-col px-4 py-6 md:flex">
          <Link href="/" className="mb-6 px-3 text-[22px] font-extrabold tracking-tight text-mint">finny</Link>
          <button onClick={() => ctx.openCommand()}
            className="mb-5 flex items-center gap-2 rounded-2xl bg-surface px-3 py-2.5 text-left text-[13px] font-medium text-muted hover:text-ink">
            <Search size={15} /> <span className="flex-1">Search…</span> <Kbd>⌘K</Kbd>
          </button>
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => {
              const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href}
                  className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                    on ? "bg-ink text-surface" : "text-ink-soft hover:bg-surface hover:text-ink"}`}>
                  <Icon size={17} strokeWidth={2.3} />
                  <span className="flex-1">{n.label}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${on ? "text-surface/50" : "text-muted opacity-0 group-hover:opacity-100"}`}>G {n.key.toUpperCase()}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-2 px-3">
            <button onClick={() => setHelp(true)} className="flex items-center gap-2 text-[12px] font-semibold text-muted hover:text-ink">
              <Kbd>?</Kbd> Keyboard shortcuts
            </button>
            <form method="post" action="/api/auth/logout">
              <button className="flex items-center gap-2 text-[12px] font-semibold text-muted hover:text-coral"><LogOut size={13} /> Sign out</button>
            </form>
          </div>
        </aside>

        <main className="mx-auto max-w-[1060px] px-4 pb-28 pt-6 md:ml-[232px] md:px-8 md:pb-12 md:pt-8">{children}</main>

        {/* Mobile tab bar */}
        <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-[28px] bg-surface/90 p-1.5 shadow-lg backdrop-blur-xl md:hidden">
          {NAV.slice(0, 4).map((n) => {
            const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={`flex flex-1 flex-col items-center gap-0.5 rounded-3xl py-2 text-[11px] font-semibold ${on ? "bg-sunken text-ink" : "text-ink-soft"}`}>
                <Icon size={19} strokeWidth={2.3} /> {n.label}
              </Link>
            );
          })}
        </nav>

        {goPending && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12px] font-bold text-surface">
            Go to… <span className="opacity-60">O A I S C R</span>
          </div>
        )}
      </div>
      <CommandMenu open={cmd.open} initial={cmd.initial} onClose={() => setCmd({ open: false, initial: "" })} />
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
      <TxnDrawer />
    </AppCtx.Provider>
  );
}

/** Thin mint bar at the top while anything is loading or saving — instant feedback on every click. */
function ProgressBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div className={`fixed inset-x-0 top-0 z-[60] h-[2px] overflow-hidden transition-opacity duration-200 ${busy ? "opacity-100" : "opacity-0"}`}>
      <div className="h-full w-1/3 animate-[finny-load_1s_ease-in-out_infinite] rounded-full bg-[var(--mint)]" />
    </div>
  );
}
