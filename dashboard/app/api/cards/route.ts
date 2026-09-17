import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Fallback while the cards table doesn't exist yet (pre-migration)
const FALLBACK_CARDS = [
  { card: "wise",   label: "Wise",       currency: "SGD", active: true },
  { card: "scapia", label: "Scapia",     currency: "INR", active: true },
  { card: "axis",   label: "Axis Atlas", currency: "INR", active: true },
  { card: "ixigo",  label: "Ixigo",      currency: "INR", active: true },
  { card: "dbs",    label: "DBS",        currency: "SGD", active: true },
];

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function GET() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("created_at");

  if (error) {
    // cards table missing → serve the static list so the UI still works
    return NextResponse.json({ cards: FALLBACK_CARDS, fallback: true });
  }
  return NextResponse.json({ cards: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = getClient();
  const body = await req.json();

  const card = String(body.card ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const label = String(body.label ?? "").trim();
  const currency = String(body.currency ?? "").toUpperCase();

  if (!card || !label) {
    return NextResponse.json({ error: "Card name and Gmail label are required" }, { status: 400 });
  }
  if (currency !== "SGD" && currency !== "INR") {
    return NextResponse.json({ error: "Currency must be SGD or INR" }, { status: 400 });
  }

  const { error } = await supabase
    .from("cards")
    .upsert({ card, label, currency, active: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, card: { card, label, currency, active: true } });
}

export async function PATCH(req: NextRequest) {
  const supabase = getClient();
  const body = await req.json();

  if (!body.card) return NextResponse.json({ error: "card is required" }, { status: 400 });

  const { error } = await supabase
    .from("cards")
    .update({ active: !!body.active })
    .eq("card", body.card);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
