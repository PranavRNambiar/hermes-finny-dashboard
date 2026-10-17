import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function GET() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("transaction_splits")
    .select("id, share_amount, currency, transaction_id, external_ref, people(id, name, divide_user_id), transactions(merchant, txn_date, amount)")
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byPerson: Record<string, any> = {};
  for (const row of data ?? []) {
    const person = row.people as any;
    const txn = row.transactions as any;
    const key = `${person.id}:${row.currency}`;
    if (!byPerson[key]) {
      byPerson[key] = {
        person_id: person.id,
        name: person.name,
        currency: row.currency,
        divide_linked: !!person.divide_user_id,
        total: 0,
        count: 0,
        splits: [],
      };
    }
    byPerson[key].total += row.share_amount;
    byPerson[key].count += 1;
    byPerson[key].splits.push({
      id: row.id,
      transaction_id: row.transaction_id,
      merchant: txn?.merchant ?? null,
      txn_date: txn?.txn_date ?? null,
      amount: txn?.amount ?? null,
      share_amount: row.share_amount,
      divide_synced: !!row.external_ref,
    });
  }

  // Currency separation: never combine SGD and INR totals
  const by_person = Object.values(byPerson).sort((a: any, b: any) => {
    if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
    return b.total - a.total;
  });

  // Cashflow / cash conversion cycle — from settled splits.
  const { data: settled } = await supabase
    .from("transaction_splits")
    .select("share_amount, currency, created_at, settled_at")
    .eq("status", "settled");

  const settled_lifetime_by_currency: Record<string, number> = {};
  const durations: number[] = [];
  for (const row of settled ?? []) {
    settled_lifetime_by_currency[row.currency] =
      (settled_lifetime_by_currency[row.currency] ?? 0) + row.share_amount;
    if (row.created_at && row.settled_at) {
      const d = (new Date(row.settled_at).getTime() - new Date(row.created_at).getTime()) / 86400000;
      if (!Number.isNaN(d)) durations.push(d);
    }
  }
  const avg_days_to_settle =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const cashflow = {
    settled_lifetime_by_currency,
    avg_days_to_settle,
    settled_count: (settled ?? []).length,
  };

  return NextResponse.json({ by_person, cashflow });
}

export async function POST(req: NextRequest) {
  const supabase = getClient();
  const body = await req.json();
  const now = new Date().toISOString();

  if (body.action === "settle_split") {
    const { error } = await supabase
      .from("transaction_splits")
      .update({ status: "settled", settled_at: now })
      .eq("id", body.split_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "settle_person") {
    let query = supabase
      .from("transaction_splits")
      .update({ status: "settled", settled_at: now })
      .eq("person_id", body.person_id)
      .eq("status", "pending");
    if (body.currency) query = query.eq("currency", body.currency);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
