"use client";

import { useEffect } from "react";
import { Kbd } from "./ui";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: "General", rows: [
    [["⌘", "K"], "Command menu & search"], [["/"], "Search"], [["?"], "This cheat sheet"], [["M"], "Cycle currency: SGD → INR → All in S$ → All in ₹"], [["Esc"], "Close"],
  ] },
  { title: "Go to", rows: [
    [["G", "O"], "Overview"], [["G", "A"], "Activity"], [["G", "R"], "Money in"], [["G", "I"], "Insights"], [["G", "S"], "Splits"], [["G", "C"], "Cards"], [["G", "B"], "Finny bot"],
  ] },
  { title: "Lists", rows: [
    [["J"], "Next transaction"], [["K"], "Previous transaction"], [["↵"], "Open"], [["1"], "→ [5]  Switch period (Overview)"],
  ] },
  { title: "Transaction", rows: [
    [["T"], "Tag"], [["C"], "Category"], [["R"], "Rename merchant"], [["S"], "Split bill"], [["X"], "Move to Exclusions"],
  ] },
  { title: "Insights", rows: [[["N"], "New insight"]] },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="max-h-[85vh] w-full max-w-[720px] overflow-y-auto rounded-[24px] bg-surface p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="eyebrow">Keyboard</div>
            <h2 className="display text-[24px]">Shortcuts</h2>
          </div>
          <Kbd>esc</Kbd>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="eyebrow mb-2">{g.title}</div>
              {g.rows.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between border-b border-hairline py-2 text-[13px] last:border-0">
                  <span className="text-ink-soft">{label.replace(/→ \[5\]\s+/, "")}</span>
                  <span className="flex gap-1">
                    {label.includes("→ [5]") ? <><Kbd>1</Kbd><span className="text-muted">–</span><Kbd>5</Kbd></> : keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">{i > 0 && keys[0] === "G" && <span className="text-[10px] text-muted">then</span>}<Kbd>{k}</Kbd></span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
