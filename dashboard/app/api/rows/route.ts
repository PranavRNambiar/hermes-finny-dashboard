import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Lightweight transaction rows for client-side charts (home, tags, analytics).
// Replaces the browser querying Supabase directly with the anon key.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const currency = req.nextUrl.searchParams.get("currency");
  if (!from) return NextResponse.json({ error: "from is required" }, { status: 400 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabase.from("transactions").select("txn_date, amount, currency, card, category, user_tag").gte("txn_date", from);
    if (to) q = q.lte("txn_date", to);
    if (currency) q = q.eq("currency", currency);
    const { data, error } = await q.order("txn_date").order("id").range(offset, offset + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ rows });
}
