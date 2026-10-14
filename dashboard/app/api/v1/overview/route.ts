import { Combine, overview, Period } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ?period=this_month, or a custom range: ?from=YYYY-MM-DD[&to=YYYY-MM-DD][&label=Spain trip] (no `to` = up to today)
export const GET = (req: Request) =>
  withAuth(req, async () => {
    const p = new URL(req.url).searchParams;
    const combine = p.get("combine");
    const from = p.get("from"), to = p.get("to");
    if (from && (!ISO.test(from) || (to && (!ISO.test(to) || to < from)))) return json({ error: "from/to must be YYYY-MM-DD with from ≤ to" }, 400);
    return overview(
      (p.get("period") as Period) || "this_month",
      combine === "SGD" || combine === "INR" ? (combine as Combine) : undefined,
      from ? { from, to: to || undefined, label: p.get("label")?.slice(0, 40) || undefined } : undefined
    );
  });
export const OPTIONS = preflight;
