"use client";

import { ChevronDown, Merge } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MODES } from "@/lib/ui/finny";
import { useApp } from "./app";
import { Kbd } from "./ui";

export function CurrencyPicker() {
  const { mode, setMode } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const combined = mode.startsWith("ALL_");
  const current = MODES.find((m) => m.id === mode)!;
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Currency (M)"
        className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold ${combined ? "bg-ink text-surface" : "bg-surface text-ink"}`}>
        {combined && <Merge size={12} />} {current.label} <ChevronDown size={12} strokeWidth={3} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl bg-surface p-1.5 shadow-xl ring-1 ring-hairline">
          {MODES.map((m, i) => (
            <div key={m.id}>
              {i === 2 && <div className="eyebrow px-3 pb-1 pt-2">Everything, converted</div>}
              {i === 0 && <div className="eyebrow px-3 pb-1 pt-1">Per card currency</div>}
              <button onClick={() => { setMode(m.id); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-[14px] font-semibold ${m.id === mode ? "bg-sunken text-ink" : "text-ink-soft hover:bg-canvas"}`}>
                {m.label} {m.id === mode && <span className="text-mint">✓</span>}
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1 px-3 py-2 text-[11px] text-muted">Press <Kbd>M</Kbd> to cycle</div>
        </div>
      )}
    </div>
  );
}
