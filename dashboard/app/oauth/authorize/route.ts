import { NextResponse } from "next/server";
import { checkPassword, issueCode, issuer, lookupClient, SCOPES } from "@/lib/finny/auth";

export const dynamic = "force-dynamic";

type Params = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  response_type: string;
};

function read(src: URLSearchParams): Params {
  const g = (k: string) => src.get(k) ?? "";
  return {
    client_id: g("client_id"),
    redirect_uri: g("redirect_uri"),
    state: g("state"),
    code_challenge: g("code_challenge"),
    code_challenge_method: g("code_challenge_method") || "S256",
    scope: g("scope") || SCOPES.join(" "),
    response_type: g("response_type"),
  };
}

/** Returns an error message, or null when the request is well-formed for a known client. */
async function validate(p: Params, iss: string): Promise<{ error: string | null; clientName: string }> {
  const client = await lookupClient(p.client_id, iss);
  if (!client) return { error: "Unknown client. Remove and re-add the connector.", clientName: "" };
  if (!client.redirect_uris.includes(p.redirect_uri))
    return { error: "redirect_uri is not registered for this client.", clientName: client.client_name };
  if (p.response_type !== "code") return { error: "response_type must be code.", clientName: client.client_name };
  if (!p.code_challenge || p.code_challenge_method !== "S256")
    return { error: "PKCE (S256) is required.", clientName: client.client_name };
  return { error: null, clientName: client.client_name };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(p: Params, clientName: string, message?: string, status = 200) {
  const hidden = Object.entries(p)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to Finny</title>
<style>
:root{color-scheme:light dark;--canvas:#F0F1F5;--surface:#fff;--ink:#1C2547;--soft:#5F6485;--muted:#979DB5;--line:#DDE0EA;--mint:#12B886;--coral:#E8590C}
@media (prefers-color-scheme:dark){:root{--canvas:#0B0F14;--surface:#151B23;--ink:#EEF1F8;--soft:#A3A9C2;--muted:#6B7290;--line:#263040;--mint:#3DDBA5}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;background:var(--canvas);color:var(--ink);font:16px/1.45 ui-rounded,-apple-system,BlinkMacSystemFont,"SF Pro Rounded","Segoe UI",sans-serif;padding:24px}
.wrap{width:100%;max-width:400px;margin:0 auto}
.brand{color:var(--mint);font-weight:800;font-size:20px;letter-spacing:-.4px}
h1{font-size:38px;line-height:1.05;letter-spacing:-1.3px;margin:10px 0 10px;font-weight:700}
.sub{color:var(--soft);margin:0 0 28px;font-size:15px}
.eyebrow{display:block;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
input[type=password]{width:100%;height:54px;padding:0 16px;border-radius:16px;border:1.5px solid transparent;background:var(--surface);color:inherit;font:inherit;font-size:17px;outline:none}
input[type=password]:focus{border-color:var(--mint)}
button{margin-top:14px;width:100%;height:54px;border:0;border-radius:16px;background:var(--ink);color:var(--surface);font:inherit;font-weight:700;font-size:16px;cursor:pointer}
.perf{border:0;border-top:1.5px dashed var(--line);margin:22px 0 14px}
.fine{color:var(--muted);font-size:12px}
.err{color:var(--coral);font-size:14px;margin:0 0 10px}
</style></head><body><form class="wrap" method="post">
<div class="brand">finny</div>
<h1>Let ${esc(clientName)} in?</h1>
<p class="sub">Read-only access to your transactions, spending and splits. It can look, not touch.</p>
${message ? `<div class="err">${esc(message)}</div>` : ""}
${hidden}
<label class="eyebrow" for="pw">Owner password</label>
<input id="pw" type="password" name="password" autocomplete="current-password" autofocus required>
<button type="submit">Allow access</button>
<hr class="perf">
<div class="fine">Revoke anytime by rotating FINNY_AUTH_SECRET.</div>
</form></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}

export async function GET(req: Request) {
  const iss = issuer(req);
  const p = read(new URL(req.url).searchParams);
  const { error, clientName } = await validate(p, iss);
  if (error) return new NextResponse(error, { status: 400 });
  return page(p, clientName);
}

export async function POST(req: Request) {
  const iss = issuer(req);
  const form = new URLSearchParams(await req.text());
  const p = read(form);
  const { error, clientName } = await validate(p, iss);
  if (error) return new NextResponse(error, { status: 400 });

  if (!checkPassword(form.get("password") ?? "")) {
    // Slow down guessing; the password is the only gate.
    await new Promise((r) => setTimeout(r, 1500));
    return page(p, clientName, "Wrong password.", 401);
  }

  const code = await issueCode(p, iss);
  const target = new URL(p.redirect_uri);
  target.searchParams.set("code", code);
  if (p.state) target.searchParams.set("state", p.state);
  target.searchParams.set("iss", iss);
  return NextResponse.redirect(target.toString(), 302);
}
