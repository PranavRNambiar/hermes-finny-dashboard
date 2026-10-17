import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

// Queue a scan. The agent's scan worker (gmail_watch.py) polls scan_requests
// every ~15s, runs scan_once.py and writes the result back onto the row.
export async function POST(req: NextRequest) {
  const supabase = getClient();
  const body = await req.json().catch(() => ({}));

  const row: { card?: string; days?: number } = {};
  if (body.card) row.card = String(body.card);
  if (body.days) row.days = Math.min(365, Math.max(1, Number(body.days)));

  const { data, error } = await supabase
    .from("scan_requests")
    .insert(row)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, status: "pending" });
}

export async function GET(req: NextRequest) {
  const supabase = getClient();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("scan_requests")
    .select("id, card, days, status, result, requested_at, completed_at")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
