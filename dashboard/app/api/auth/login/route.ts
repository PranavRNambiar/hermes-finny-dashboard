import { NextResponse } from "next/server";
import { checkPassword } from "@/lib/finny/auth";
import { SESSION_COOKIE, SESSION_TTL_S, createSession } from "@/lib/finny/session";

export const dynamic = "force-dynamic";

// Only same-site relative paths are allowed as the post-login destination.
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const next = safeNext(form.get("next"));

  if (!checkPassword(form.get("password") ?? "")) {
    await new Promise((r) => setTimeout(r, 1500)); // slow down guessing
    const back = new URL("/login", req.url);
    back.searchParams.set("error", "1");
    if (next !== "/") back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return res;
}
