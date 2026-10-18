import { listMerchants } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => withAuth(req, async () => ({ merchants: await listMerchants() }));
export const OPTIONS = preflight;
