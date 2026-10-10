import { overview, Period } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => overview((new URL(req.url).searchParams.get("period") as Period) || "this_month"));
export const OPTIONS = preflight;
