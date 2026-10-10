import { setIncomingKind } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Body: { kind: "salary" | "transfer" | "refund" | "own_transfer", apply_to_counterparty?: boolean }
export const PATCH = (req: Request, { params }: { params: { id: string } }) =>
  withAuth(
    req,
    async () => {
      const body = await req.json().catch(() => ({}));
      try {
        return await setIncomingKind(decodeURIComponent(params.id), body.kind, body.apply_to_counterparty === true);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    },
    "finny.write"
  );
export const OPTIONS = preflight;
