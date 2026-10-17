import { findSubscriptions } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => withAuth(req, () => findSubscriptions(180));
export const OPTIONS = preflight;
