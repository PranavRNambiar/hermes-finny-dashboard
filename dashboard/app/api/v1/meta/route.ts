import { fxRate, listCards, listCategoriesAndTags } from "@/lib/finny/data";
import { preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  withAuth(req, async () => ({
    cards: await listCards(),
    ...(await listCategoriesAndTags()),
    fx: await fxRate("SGD", "INR").catch(() => null),
  }));
export const OPTIONS = preflight;
