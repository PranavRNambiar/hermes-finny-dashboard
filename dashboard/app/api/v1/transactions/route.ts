import { listTransactions } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => {
    const p = new URL(req.url).searchParams;
    const s = (k: string) => p.get(k) || undefined;
    const n = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
    return listTransactions({
      from: s("from"),
      to: s("to"),
      card: s("card"),
      currency: s("currency"),
      category: s("category"),
      merchant: s("q"),
      tag: s("tag"),
      min_amount: n("min_amount"),
      max_amount: n("max_amount"),
      limit: n("limit"),
      offset: n("offset"),
      sort: s("sort") as any,
    });
  });
export const OPTIONS = preflight;
