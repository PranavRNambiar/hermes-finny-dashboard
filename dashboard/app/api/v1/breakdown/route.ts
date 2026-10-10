import { Combine, GroupBy, resolvePeriod, Period, spendingBreakdown } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => {
    const p = new URL(req.url).searchParams;
    const range = p.get("period") ? resolvePeriod(p.get("period") as Period) : { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined };
    const combine = p.get("combine");
    return spendingBreakdown({
      from: range.from,
      to: range.to,
      currency: p.get("currency") ?? undefined,
      category: p.get("category") ?? undefined,
      tag: p.get("tag") ?? undefined,
      merchant_exact: p.get("merchant") ?? undefined,
      group_by: (p.get("group_by") as GroupBy) ?? "category",
      combine: combine === "SGD" || combine === "INR" ? (combine as Combine) : undefined,
    });
  });
export const OPTIONS = preflight;
