import { settlePerson } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Body: { person_id: number, currency: "SGD" | "INR" }
export const POST = (req: Request) =>
  withAuth(
    req,
    async () => {
      const body = await req.json().catch(() => ({}));
      if (typeof body.person_id !== "number" || typeof body.currency !== "string") return json({ error: "person_id and currency required" }, 400);
      return settlePerson(body.person_id, body.currency);
    },
    "finny.write"
  );
export const OPTIONS = preflight;
