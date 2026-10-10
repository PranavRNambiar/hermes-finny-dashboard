import { pendingSplits } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => withAuth(req, pendingSplits);
export const OPTIONS = preflight;
