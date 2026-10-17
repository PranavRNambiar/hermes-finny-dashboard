import { setSplits } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Body: { splits: [{ name: "Rutuja", amount: 30 }, ...] } — replaces the unsettled splits.
export const PUT = (req: Request, { params }: { params: { id: string } }) =>
  withAuth(
    req,
    async () => {
      const body = await req.json().catch(() => ({}));
      if (!Array.isArray(body.splits)) return json({ error: "splits must be an array" }, 400);
      try {
        return await setSplits(decodeURIComponent(params.id), body.splits);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    },
    "finny.write"
  );
export const OPTIONS = preflight;
