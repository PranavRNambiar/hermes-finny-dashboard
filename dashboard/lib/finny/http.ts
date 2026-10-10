// Small helpers for the OAuth + v1 API routes.
import { NextResponse } from "next/server";
import { bearer, issuer, verifyAccessToken } from "./auth";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-protocol-version",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...headers } });
}

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

/** Runs `fn` only for a request carrying a valid Finny access token. */
export async function withAuth(req: Request, fn: () => Promise<unknown>) {
  const iss = issuer(req);
  if (!(await verifyAccessToken(bearer(req), iss))) {
    return json({ error: "invalid_token" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${iss}/.well-known/oauth-protected-resource"`,
    });
  }
  try {
    return json(await fn());
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
