import { getTransaction, setActualAmount, setCategory, setTag } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Subscriptions", "Health & Fitness", "Travel",
  "Utilities & Bills", "Rent & Housing", "Entertainment", "Education", "Gifts", "Transfers & Misc", "Exclusions",
];

type Params = { params: { id: string } };

export const GET = (req: Request, { params }: Params) =>
  withAuth(req, async () => (await getTransaction(decodeURIComponent(params.id))) ?? json({ error: "not_found" }, 404));

// Body: { tag?: string | null, category?: string, apply_to_merchant?: boolean, actual_amount?: number }
// actual_amount: the real SGD/INR charged for a foreign-currency spend.
export const PATCH = (req: Request, { params }: Params) =>
  withAuth(
    req,
    async () => {
      const id = decodeURIComponent(params.id);
      const body = await req.json().catch(() => ({}));
      const all = body.apply_to_merchant === true;
      const out: Record<string, unknown> = {};
      if ("tag" in body) out.tag = await setTag(id, body.tag ?? null, all);
      if ("category" in body) {
        if (!CATEGORIES.includes(body.category)) return json({ error: "unknown category" }, 400);
        out.category = await setCategory(id, body.category, all);
      }
      if ("actual_amount" in body) {
        try { out.actual = await setActualAmount(id, Number(body.actual_amount)); }
        catch (e) { return json({ error: (e as Error).message }, 400); }
      }
      return out;
    },
    "finny.write"
  );
export const OPTIONS = preflight;
