import { authServerMetadata, issuer } from "@/lib/finny/auth";
import { json, preflight } from "@/lib/finny/http";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => json(authServerMetadata(issuer(req)));
export const OPTIONS = preflight;
