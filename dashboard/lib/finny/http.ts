// Small helpers for the OAuth + v1 API routes.
import { NextResponse } from "next/server";
import { bearer, issuer, verifyAccessToken } from "./auth";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-protocol-version",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...headers } });
}

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

/** Runs `fn` only for a request carrying a valid Finny access token (with `scope`, if given). */
export async function withAuth(req: Request, fn: () => Promise<unknown>, scope?: string) {
  const iss = issuer(req);
  const token = await verifyAccessToken(bearer(req), iss);
  if (!token) {
    return json({ error: "invalid_token" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${iss}/.well-known/oauth-protected-resource"`,
    });
  }
  if (scope && !token.scopes.includes(scope)) {
    return json({ error: "insufficient_scope", error_description: `requires ${scope}` }, 403);
  }
  try {
    const out = await fn();
    return out instanceof Response ? out : json(out);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
