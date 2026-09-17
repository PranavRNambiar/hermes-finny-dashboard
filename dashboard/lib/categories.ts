export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Drink":      "#22c55e",  // green
  "Transport":         "#3b82f6",  // blue
  "Shopping":          "#f97316",  // coral/orange
  "Subscriptions":     "#a855f7",  // purple
  "Health & Fitness":  "#14b8a6",  // teal
  "Travel":            "#f59e0b",  // amber
  "Utilities & Bills": "#6b7280",  // gray
  "Rent & Housing":    "#ef4444",  // red
  "Entertainment":     "#ec4899",  // pink
  "Education":         "#6366f1",  // indigo
  "Transfers & Misc":  "#9ca3af",  // neutral gray
};

export const CATEGORIES = Object.keys(CATEGORY_COLORS);

export const CARD_COLORS: Record<string, string> = {
  wise:   "bg-green-100 text-green-800",
  dbs:    "bg-blue-100 text-blue-800",
  scapia: "bg-orange-100 text-orange-800",
  axis:   "bg-purple-100 text-purple-800",
  ixigo:  "bg-amber-100 text-amber-800",
  ocbc:   "bg-red-100 text-red-800",
};

// Deterministic badge colors for cards added later from the dashboard
const EXTRA_CARD_COLORS = [
  "bg-teal-100 text-teal-800",
  "bg-pink-100 text-pink-800",
  "bg-cyan-100 text-cyan-800",
  "bg-lime-100 text-lime-800",
  "bg-rose-100 text-rose-800",
  "bg-sky-100 text-sky-800",
];

export function cardBadgeClass(card: string): string {
  if (CARD_COLORS[card]) return CARD_COLORS[card];
  let hash = 0;
  for (const ch of card) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return EXTRA_CARD_COLORS[Math.abs(hash) % EXTRA_CARD_COLORS.length];
}
