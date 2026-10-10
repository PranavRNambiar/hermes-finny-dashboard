import { Combine, overview, Period } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, () => {
    const p = new URL(req.url).searchParams;
    const combine = p.get("combine");
    return overview(
      (p.get("period") as Period) || "this_month",
      combine === "SGD" || combine === "INR" ? (combine as Combine) : undefined
    );
  });
export const OPTIONS = preflight;
