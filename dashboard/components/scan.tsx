"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Queues a Gmail scan (agent picks it up within ~15s) and polls until it finishes. */
export function ScanButton({ card, days, label = "Scan now", compact }: { card?: string; days?: number; label?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function start() {
    setState("busy"); setMsg("");
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card, days }) });
      const { id, error } = await res.json();
      if (!res.ok) throw new Error(error ?? "Couldn't queue scan");
      const began = Date.now();
      const poll = async () => {
        const r = await fetch(`/api/scan?id=${id}`).then((x) => x.json()).catch(() => null);
        if (r?.status === "done") { const n = r.result?.total ?? 0; setState("done"); setMsg(n ? `${n} new` : "Nothing new"); qc.invalidateQueries(); return; }
        if (r?.status === "error") { setState("error"); setMsg(r.result?.error ?? "Scan failed"); return; }
        if (Date.now() - began > 180_000) { setState("error"); setMsg("No response — is the agent running?"); return; }
        timer.current = setTimeout(poll, 4000);
      };
      timer.current = setTimeout(poll, 4000);
    } catch (e) { setState("error"); setMsg((e as Error).message); }
  }

  return (
    <button onClick={start} disabled={state === "busy"}
      className={`flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-bold ${compact ? "bg-surface text-ink" : "bg-ink text-surface"} disabled:opacity-70`}>
      <RefreshCw size={14} className={state === "busy" ? "animate-spin" : ""} />
      {state === "busy" ? "Scanning…" : msg && state !== "idle" ? msg : label}
    </button>
  );
}
