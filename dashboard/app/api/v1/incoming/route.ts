import { listIncoming, Period, resolvePeriod } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => {
    const p = new URL(req.url).searchParams;
    const range = p.get("period") ? resolvePeriod(p.get("period") as Period) : { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined };
    return listIncoming({ ...range, currency: p.get("currency") ?? undefined, kind: p.get("kind") ?? undefined });
  });
export const OPTIONS = preflight;
