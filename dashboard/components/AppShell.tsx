"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HomeIcon, UsersIcon, ChartIcon, TagIcon, SettingsIcon, CardIcon, RefreshIcon } from "./Icons";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/splits", label: "Splits", icon: UsersIcon },
  { href: "/tags", label: "Tags", icon: TagIcon },
  { href: "/analytics", label: "Analytics", icon: ChartIcon },
  { href: "/cards", label: "Cards", icon: CardIcon },
];

const HIDE_ON_LOAD_KEY = "finny_hide_on_load";

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [hideOnLoad, setHideOnLoad] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHideOnLoad(localStorage.getItem(HIDE_ON_LOAD_KEY) === "true");
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  function toggle() {
    const next = !hideOnLoad;
    setHideOnLoad(next);
    localStorage.setItem(HIDE_ON_LOAD_KEY, String(next));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        ref={sheetRef}
        className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 pb-8 sm:pb-6"
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5 sm:hidden" />
        <h2 className="text-base font-semibold text-gray-900 mb-4">Settings</h2>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-800">Hide on load</p>
            <p className="text-xs text-gray-400 mt-0.5">Hide spend totals when the app opens</p>
          </div>
          <button
            onClick={toggle}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
              hideOnLoad ? "bg-indigo-600" : "bg-gray-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                hideOnLoad ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function HeaderScanButton() {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);

  function showToast(text: string, tone: "ok" | "warn" | "err") {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 6000);
  }

  async function scan() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const { id, error } = await res.json();
      if (!res.ok) throw new Error(error ?? "Failed to queue scan");

      const startedAt = Date.now();
      const poll = async (): Promise<void> => {
        if (Date.now() - startedAt > 3 * 60 * 1000) {
          showToast("Scan queued but no response — is the Finny agent running?", "warn");
          setBusy(false);
          return;
        }
        const r = await fetch(`/api/scan?id=${id}`).then((x) => x.json()).catch(() => null);
        if (r?.status === "done") {
          const n = r.result?.total ?? 0;
          showToast(n > 0 ? `Scan complete — ${n} new transaction${n !== 1 ? "s" : ""}` : "Scan complete — nothing new", "ok");
          setBusy(false);
          if (n > 0) setTimeout(() => window.location.reload(), 1500);
          return;
        }
        if (r?.status === "error") {
          showToast(r.result?.error ?? "Scan failed", "err");
          setBusy(false);
          return;
        }
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 4000);
    } catch (e: any) {
      showToast(e.message ?? "Failed to queue scan", "err");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={scan}
        disabled={busy}
        className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
          busy
            ? "text-indigo-500 bg-indigo-50 cursor-wait"
            : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        }`}
        aria-label="Scan all cards for new transactions"
        title="Scan all cards for new transactions"
      >
        <RefreshIcon className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
      </button>
      {toast && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-xl text-xs font-medium ${
            toast.tone === "ok"
              ? "bg-gray-900 text-white"
              : toast.tone === "warn"
              ? "bg-amber-500 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F6F6F9]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">F</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm tracking-tight">Finny</span>
          </Link>

          <div className="flex items-center gap-1">
            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1 mr-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      active
                        ? "bg-indigo-50 text-indigo-600"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {/* Scan all cards */}
            <HeaderScanButton />

            {/* Settings gear */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center w-8 h-8 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label="Settings"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-5 pb-24 md:pb-10">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/90 backdrop-blur-lg border-t border-gray-100">
        <div className="max-w-3xl mx-auto flex items-stretch justify-around px-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5"
              >
                <Icon className={`w-5 h-5 transition-colors ${active ? "text-indigo-600" : "text-gray-400"}`} />
                <span className={`text-[11px] font-medium transition-colors ${active ? "text-indigo-600" : "text-gray-400"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
