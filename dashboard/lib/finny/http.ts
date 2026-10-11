// Small helpers for the OAuth + v1 API routes.
import { NextResponse } from "next/server";
import { bearer, issuer, verifyAccessToken } from "./auth";
import { SESSION_COOKIE, isValidSession } from "./session";

function cookie(req: Request, name: string): string | undefined {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function sameOrigin(req: Request, iss: string): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) return false;
  try { return origin === iss || new URL(origin).host === host; } catch { return false; }
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-protocol-version",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...headers } });
}

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });

/** Runs `fn` only for a request carrying a valid Finny access token (with `scope`, if given). */
export async function withAuth(req: Request, fn: () => Promise<unknown>, scope?: string) {
  const iss = issuer(req);
  let token = await verifyAccessToken(bearer(req), iss);
  // The web dashboard calls the same API with its owner session cookie (read + write).
  // Writes must come from our own origin so other sites can't ride the cookie.
  if (!token && (await isValidSession(cookie(req, SESSION_COOKIE)))) {
    const write = req.method === "GET" || sameOrigin(req, iss);
    token = { clientId: "web", scopes: write ? ["finny.read", "finny.write"] : ["finny.read"], expiresAt: undefined };
  }
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
