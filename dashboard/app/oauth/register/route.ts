import { issuer, registerClient } from "@/lib/finny/auth";
import { json, preflight } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// RFC 7591 dynamic client registration — Claude and ChatGPT call this automatically.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { status, json: out } = await registerClient(body, issuer(req));
  return json(out, status);
}
export const OPTIONS = preflight;
