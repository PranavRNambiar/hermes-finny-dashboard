import { unsettle } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Body: { person_id: number, settled_at: string } — exactly as returned by /splits/history.
export const POST = (req: Request) =>
  withAuth(
    req,
    async () => {
      const body = await req.json().catch(() => ({}));
      if (typeof body.person_id !== "number" || typeof body.settled_at !== "string") return json({ error: "person_id and settled_at required" }, 400);
      return unsettle(body.person_id, body.settled_at);
    },
    "finny.write"
  );
export const OPTIONS = preflight;
