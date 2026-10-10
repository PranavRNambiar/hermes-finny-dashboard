import { exchangeToken, issuer } from "@/lib/finny/auth";
import { json, preflight } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const form = type.includes("application/json")
    ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await req.text());
  const { status, json: out } = await exchangeToken(form, issuer(req));
  return json(out, status);
}
export const OPTIONS = preflight;
