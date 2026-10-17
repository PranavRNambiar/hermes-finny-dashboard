import { addIncoming, listIncoming, Period, resolvePeriod } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => {
    const p = new URL(req.url).searchParams;
    const range = p.get("period") ? resolvePeriod(p.get("period") as Period) : { from: p.get("from") ?? undefined, to: p.get("to") ?? undefined };
    return listIncoming({ ...range, currency: p.get("currency") ?? undefined, kind: p.get("kind") ?? undefined });
  });

// Body: { amount, currency: "SGD"|"INR", counterparty, kind, txn_date: "YYYY-MM-DD", card? }
export const POST = (req: Request) =>
  withAuth(
    req,
    async () => {
      try { return await addIncoming(await req.json()); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    },
    "finny.write"
  );
export const OPTIONS = preflight;
