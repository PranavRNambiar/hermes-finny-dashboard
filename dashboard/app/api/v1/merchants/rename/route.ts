import { renameMerchant } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Body: { merchant: <raw merchant as sent by the bank>, display_name: string | null }
export const POST = (req: Request) =>
  withAuth(
    req,
    async () => {
      const body = await req.json().catch(() => ({}));
      if (typeof body.merchant !== "string" || !body.merchant) return json({ error: "merchant is required" }, 400);
      const name = typeof body.display_name === "string" ? body.display_name.slice(0, 60) : null;
      return renameMerchant(body.merchant, name);
    },
    "finny.write"
  );
export const OPTIONS = preflight;
