import { Combine, compareSeries, Period, resolvePeriod, SeriesDef } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// GET /api/v1/compare?s=category:Food%20%26%20Drink&s=merchant:Anytime%20Fitness&period=last_7_days&group_by=day&combine=SGD
export const GET = (req: Request) =>
  withAuth(req, async () => {
    const p = new URL(req.url).searchParams;
    const series: SeriesDef[] = p.getAll("s").slice(0, 8).map((x) => {
      const i = x.indexOf(":");
      const kind = (i > 0 ? x.slice(0, i) : "all") as SeriesDef["kind"];
      return { kind: ["all", "category", "merchant", "tag"].includes(kind) ? kind : "all", value: i > 0 ? x.slice(i + 1) : "" };
    });
    if (!series.length) series.push({ kind: "all", value: "" });
    const range = p.get("period") ? resolvePeriod(p.get("period") as Period) : { from: p.get("from"), to: p.get("to") };
    if (!range.from || !range.to) return json({ error: "period or from/to required" }, 400);
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 864e5;
    const g = p.get("group_by") as "day" | "week" | "month" | null;
    const group_by = g ?? (days <= 45 ? "day" : days <= 150 ? "week" : "month");
    const c = p.get("combine");
    return { from: range.from, to: range.to, group_by, data: await compareSeries({ series, from: range.from, to: range.to, group_by, combine: c === "SGD" || c === "INR" ? (c as Combine) : undefined }) };
  });
export const OPTIONS = preflight;
