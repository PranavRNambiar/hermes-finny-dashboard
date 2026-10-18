import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const supabase = getClient();
  const { searchParams } = req.nextUrl;
  const card = searchParams.get("card");
  const currency = searchParams.get("currency");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const category = searchParams.get("category");
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));

  let query = supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .order("txn_date", { ascending: false })
    .order("ingested_at", { ascending: false });

  if (card) query = query.eq("card", card);
  // Currency is always filtered explicitly — never mixed
  if (currency) query = query.eq("currency", currency);
  if (from) query = query.gte("txn_date", from);
  if (to) query = query.lte("txn_date", to);
  if (category) query = query.eq("category", category);

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ transactions: data, total: count, page });
}

export async function PATCH(req: NextRequest) {
  const supabase = getClient();
  const body = await req.json();

  if (body.action === "tag_one") {
    const { error } = await supabase
      .from("transactions")
      .update({ user_tag: body.tag ?? null })
      .eq("id", body.transaction_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "tag_merchant") {
    const { error: e1 } = await supabase
      .from("merchant_tags")
      .upsert({ merchant: body.merchant, user_tag: body.tag }, { onConflict: "merchant" });
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

    const { error: e2 } = await supabase
      .from("transactions")
      .update({ user_tag: body.tag })
      .eq("merchant", body.merchant);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
