import { Combine, summary } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// Lightweight totals for widgets: today, this week (Mon–Sun), this month.
export const GET = (req: Request) =>
  withAuth(req, () => {
    const c = new URL(req.url).searchParams.get("combine");
    return summary(c === "SGD" || c === "INR" ? (c as Combine) : undefined);
  });
export const OPTIONS = preflight;
