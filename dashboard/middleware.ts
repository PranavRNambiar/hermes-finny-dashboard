import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/finny/session";

// Everything is behind the owner session cookie except:
// - the login flow itself
// - bearer-token APIs (MCP, iOS v1) and the OAuth endpoints they rely on
// - app icons / manifest, which browsers fetch without cookies
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/api/mcp",
  "/api/v1/",
  "/oauth/",
  "/.well-known/",
  "/api/health",
];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals and static metadata files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|fonts/).*)"],
};
