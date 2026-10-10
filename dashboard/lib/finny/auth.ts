// Minimal OAuth 2.1 authorization server for a single owner.
//
// Claude and ChatGPT both connect to remote MCP servers via OAuth with Dynamic
// Client Registration + PKCE. Finny has one user, so instead of a user database
// the "login" is one owner password (FINNY_OWNER_PASSWORD) and every artefact —
// client_id, authorization code, access token, refresh token — is a JWT signed
// with FINNY_AUTH_SECRET. Nothing is stored. Rotating FINNY_AUTH_SECRET revokes
// every client and token at once.

import { SignJWT, jwtVerify, JWTPayload } from "jose";
import { createHash, timingSafeEqual } from "crypto";

export const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 60 * 60 * 24 * 90; // 90 days
const CODE_TTL_S = 5 * 60;

/** Public client baked into the iOS app. Uses PKCE; no secret. */
export const IOS_CLIENT_ID = "finny-ios";
const IOS_REDIRECT_URI = "finny://oauth/callback";

type Kind = "client" | "code" | "access" | "refresh";

function secret(): Uint8Array {
  const s = process.env.FINNY_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("FINNY_AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export function issuer(req: Request): string {
  if (process.env.FINNY_PUBLIC_URL) return process.env.FINNY_PUBLIC_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

async function sign(kind: Kind, claims: JWTPayload, ttl: number | null, iss: string): Promise<string> {
  let jwt = new SignJWT({ ...claims, kind }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setIssuer(iss);
  if (ttl) jwt = jwt.setExpirationTime(`${ttl}s`);
  return jwt.sign(secret());
}

async function verify(kind: Kind, token: string, iss: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: iss, algorithms: ["HS256"] });
    return payload.kind === kind ? payload : null;
  } catch {
    return null;
  }
}

// ── Clients ────────────────────────────────────────────────

function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    // Native/CLI clients (Claude Code, MCP Inspector) use a loopback callback.
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(
  body: any,
  iss: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const redirect_uris: unknown = body?.redirect_uris;
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || !redirect_uris.every((u) => typeof u === "string" && redirectAllowed(u))) {
    return { status: 400, json: { error: "invalid_redirect_uri", error_description: "redirect_uris must be https or loopback http" } };
  }
  const client_name = typeof body?.client_name === "string" ? body.client_name.slice(0, 100) : "MCP client";
  const client_id = await sign("client", { redirect_uris, client_name }, null, iss);
  return {
    status: 201,
    json: {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name,
      redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

export async function lookupClient(
  client_id: string,
  iss: string
): Promise<{ client_name: string; redirect_uris: string[] } | null> {
  if (client_id === IOS_CLIENT_ID) return { client_name: "Finny for iOS", redirect_uris: [IOS_REDIRECT_URI] };
  const p = await verify("client", client_id, iss);
  if (!p) return null;
  return { client_name: String(p.client_name), redirect_uris: p.redirect_uris as string[] };
}

// ── Owner password ─────────────────────────────────────────

export function checkPassword(candidate: string): boolean {
  const expected = process.env.FINNY_OWNER_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ── Codes & tokens ─────────────────────────────────────────

const clientRef = (client_id: string) => createHash("sha256").update(client_id).digest("base64url").slice(0, 32);

/** Scopes a client may hold: only the first-party iOS app can edit; everyone else reads. */
export function grantedScope(client_id: string, requested: string): string {
  const allowed = client_id === IOS_CLIENT_ID ? ["finny.read", "finny.write"] : ["finny.read"];
  const asked = requested.split(/\s+/).filter(Boolean);
  const granted = allowed.filter((s) => asked.includes(s));
  return (granted.length ? granted : ["finny.read"]).join(" ");
}

export function issueCode(
  p: { client_id: string; redirect_uri: string; code_challenge: string; scope: string },
  iss: string
) {
  return sign(
    "code",
    { cid: clientRef(p.client_id), redirect_uri: p.redirect_uri, cc: p.code_challenge, scope: grantedScope(p.client_id, p.scope) },
    CODE_TTL_S,
    iss
  );
}

async function tokenPair(cid: string, scope: string, iss: string) {
  return {
    access_token: await sign("access", { cid, scope, sub: "owner" }, ACCESS_TTL_S, iss),
    refresh_token: await sign("refresh", { cid, scope, sub: "owner" }, REFRESH_TTL_S, iss),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    scope,
  };
}

export async function exchangeToken(
  form: URLSearchParams,
  iss: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const err = (error: string, error_description?: string, status = 400) => ({
    status,
    json: { error, ...(error_description ? { error_description } : {}) },
  });
  const grant = form.get("grant_type");
  const client_id = form.get("client_id") ?? "";
  if (!(await lookupClient(client_id, iss))) return err("invalid_client", "unknown client_id", 401);

  if (grant === "authorization_code") {
    const code = await verify("code", form.get("code") ?? "", iss);
    if (!code || code.cid !== clientRef(client_id)) return err("invalid_grant", "code invalid or expired");
    if (code.redirect_uri !== form.get("redirect_uri")) return err("invalid_grant", "redirect_uri mismatch");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!verifier || challenge !== code.cc) return err("invalid_grant", "PKCE verification failed");
    return { status: 200, json: await tokenPair(String(code.cid), String(code.scope), iss) };
  }

  if (grant === "refresh_token") {
    const rt = await verify("refresh", form.get("refresh_token") ?? "", iss);
    if (!rt || rt.cid !== clientRef(client_id)) return err("invalid_grant", "refresh token invalid or expired");
    return { status: 200, json: await tokenPair(String(rt.cid), String(rt.scope), iss) };
  }

  return err("unsupported_grant_type");
}

/** Validates a bearer token; returns its claims or null. */
export async function verifyAccessToken(token: string | undefined, iss: string) {
  if (!token) return null;
  const p = await verify("access", token, iss);
  if (!p) return null;
  return { clientId: String(p.cid), scopes: String(p.scope ?? "finny.read").split(" "), expiresAt: p.exp };
}

export function bearer(req: Request): string | undefined {
  const h = req.headers.get("authorization");
  return h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : undefined;
}

// ── Discovery documents ────────────────────────────────────

export const SCOPES = ["finny.read", "finny.write"];

export function authServerMetadata(iss: string) {
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  };
}

export function protectedResourceMetadata(iss: string) {
  return {
    resource: `${iss}/api/mcp`,
    authorization_servers: [iss],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Finny",
  };
}
