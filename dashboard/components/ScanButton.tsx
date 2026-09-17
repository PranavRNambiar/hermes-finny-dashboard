"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshIcon } from "./Icons";

type ScanState = "idle" | "queued" | "scanning" | "done" | "error" | "timeout";

const POLL_MS = 4000;
const TIMEOUT_MS = 3 * 60 * 1000;

export default function ScanButton({
  card,
  days,
  label = "Scan now",
  className = "",
  onDone,
}: {
  card?: string;          // scan one card; omit for all cards
  days?: number;          // how far back; agent default is 7
  label?: string;
  className?: string;
  onDone?: (saved: number) => void;
}) {
  const [state, setState] = useState<ScanState>("idle");
  const [saved, setSaved] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function start() {
    setState("queued");
    setErrorMsg("");
    let id: number;
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card, days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to queue scan");
      id = data.id;
    } catch (e: any) {
      setState("error");
      setErrorMsg(e.message ?? "Failed to queue scan");
      return;
    }

    setState("scanning");
    const startedAt = Date.now();

    async function poll() {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        setState("timeout");
        return;
      }
      try {
        const res = await fetch(`/api/scan?id=${id}`);
        const data = await res.json();
        if (data.status === "done") {
          const total = data.result?.total ?? 0;
          setSaved(total);
          setState("done");
          onDone?.(total);
          return;
        }
        if (data.status === "error") {
          setState("error");
          setErrorMsg(data.result?.error ?? "Scan failed");
          return;
        }
      } catch {
        // transient — keep polling
      }
      timers.current.push(setTimeout(poll, POLL_MS));
    }
    timers.current.push(setTimeout(poll, POLL_MS));
  }

  const busy = state === "queued" || state === "scanning";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={start}
        disabled={busy}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
          busy
            ? "bg-indigo-50 text-indigo-400 cursor-wait"
            : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
        }`}
      >
        <RefreshIcon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Scanning…" : state === "done" || state === "error" || state === "timeout" ? "Scan again" : label}
      </button>

      {state === "scanning" && (
        <span className="text-xs text-gray-400">checking {card ? `${card} emails` : "all cards"}…</span>
      )}
      {state === "done" && (
        <span className="text-xs font-medium text-emerald-600">
          {saved > 0 ? `${saved} new transaction${saved !== 1 ? "s" : ""} added` : "Up to date — nothing new"}
        </span>
      )}
      {state === "error" && (
        <span className="text-xs text-red-500">{errorMsg}</span>
      )}
      {state === "timeout" && (
        <span className="text-xs text-amber-600">No response — is the Finny agent running?</span>
      )}
    </div>
  );
}
