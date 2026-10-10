import { getTransaction } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request, { params }: { params: { id: string } }) =>
  withAuth(req, async () => (await getTransaction(decodeURIComponent(params.id))) ?? json({ error: "not_found" }, 404));
export const OPTIONS = preflight;
