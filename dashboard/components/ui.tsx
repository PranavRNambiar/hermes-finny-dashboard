"use client";

// Finny primitives — web twins of ios/Shared/Theme.swift.

import {
  ArrowLeftRight, BookOpen, Bus, Coffee, EyeOff, Film, Gift, HeartPulse, Home, Plane, Repeat, ShoppingBag, Zap,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { chip, number, symbol } from "@/lib/ui/finny";

export function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(m.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return dark;
}

export const Eyebrow = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`eyebrow ${className}`}>{children}</div>
);

/** Receipt-style amount: small raised currency mark, big tabular digits. */
export function Amount({ value, currency, size = 17, weight = 600, className = "", tone }: {
  value: number; currency: string; size?: number; weight?: number; className?: string; tone?: string;
}) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap ${className}`} style={{ color: tone }}>
      <span style={{ fontSize: size * 0.5, fontWeight: 600, opacity: 0.55, transform: `translateY(-${size * 0.32}px)` }}>
        {symbol(currency)}
      </span>
      <span className="tabular" style={{ fontSize: size, fontWeight: weight, marginLeft: size * 0.08, letterSpacing: size > 30 ? -size * 0.03 : 0 }}>
        {number(value, currency)}
      </span>
    </span>
  );
}

export function Card({ title, trailing, children, className = "" }: { title?: string; trailing?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <Eyebrow>{title}</Eyebrow>
          {trailing && <div className="eyebrow">{trailing}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export const Perf = ({ className = "" }: { className?: string }) => <div className={`perf ${className}`} />;

const ICONS: Record<string, typeof Coffee> = {
  "Food & Drink": Coffee, Transport: Bus, Shopping: ShoppingBag, Subscriptions: Repeat, "Health & Fitness": HeartPulse,
  Travel: Plane, "Utilities & Bills": Zap, "Rent & Housing": Home, Entertainment: Film, Education: BookOpen, Gifts: Gift, Exclusions: EyeOff,
};

export function CategoryIcon({ category, size = 40 }: { category: string; size?: number }) {
  const dark = useDark();
  const c = chip(category, dark);
  const Icon = ICONS[category] ?? ArrowLeftRight;
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: size * 0.34, background: c.bg, color: c.fg }}>
      <Icon size={size * 0.42} strokeWidth={2.4} />
    </div>
  );
}

export function CategoryTag({ category }: { category: string }) {
  const dark = useDark();
  const c = chip(category, dark);
  return (
    <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.09em]" style={{ background: c.bg, color: c.fg }}>
      {category}
    </span>
  );
}

export function categoryColor(category: string, dark: boolean) {
  return chip(category, dark).fg;
}

/** Pill segmented control (same as iOS PillPicker). */
export function Pills<T extends string>({ options, value, onChange, className = "" }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`flex gap-1 rounded-full bg-sunken p-1 ${className}`}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors ${
            o.id === value ? "bg-ink text-surface" : "text-ink-soft hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors ${
        on ? "bg-ink text-surface" : "bg-surface text-ink-soft hover:text-ink"}`}>
      {children}
    </button>
  );
}

export function ScreenHeader({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="display mt-1 text-[32px] leading-none tracking-[-0.025em]">{title}</h1>
      </div>
      {right}
    </div>
  );
}

export function Empty({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <div className="text-[40px]">{emoji}</div>
      <div className="display mt-2 text-lg">{title}</div>
      <div className="mt-1 max-w-sm text-sm text-ink-soft">{text}</div>
    </div>
  );
}

export const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-hairline border-t-ink" />
  </div>
);

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;
