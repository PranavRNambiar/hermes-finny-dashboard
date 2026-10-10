import { listPeople } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => withAuth(req, async () => ({ people: await listPeople() }));
export const OPTIONS = preflight;
