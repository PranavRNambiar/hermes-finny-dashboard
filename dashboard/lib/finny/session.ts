// Browser session for the web dashboard: an httpOnly cookie holding a JWT signed
// with FINNY_AUTH_SECRET. Edge-safe (no node:crypto) because middleware imports it.
// API clients (Claude, ChatGPT, iOS) use OAuth bearer tokens instead; see auth.ts.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "finny_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const s = process.env.FINNY_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("FINNY_AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export function createSession(): Promise<string> {
  return new SignJWT({ kind: "session", sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secret());
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.kind === "session";
  } catch {
    return false;
  }
}
