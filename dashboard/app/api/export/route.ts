import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INR_PER_SGD = 72;

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return "date,time,card,merchant,currency,amount,sgd_equivalent,category,tag\n";
  const headers = ["date", "time", "card", "merchant", "currency", "amount", "sgd_equivalent", "category", "tag"];
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    const sgdEquiv = r.currency === "SGD" ? r.amount : (r.amount / INR_PER_SGD);
    lines.push([
      r.txn_date,
      r.txn_time ?? "",
      r.card,
      r.merchant ?? "",
      r.currency,
      r.amount,
      sgdEquiv.toFixed(2),
      r.category,
      r.user_tag && r.user_tag !== "__skip__" ? r.user_tag : "",
    ].map(escape).join(","));
  }
  return lines.join("\n") + "\n";
}

function periodDates(period: string): { from: string; to: string; label: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = fmt(today);

  if (period === "daily") {
    return { from: todayStr, to: todayStr, label: todayStr };
  }
  if (period === "monthly") {
    const from = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
    return { from, to: todayStr, label: `${today.getFullYear()}-${pad(today.getMonth() + 1)}` };
  }
  if (period === "quarterly") {
    const q = Math.floor(today.getMonth() / 3);
    const from = fmt(new Date(today.getFullYear(), q * 3, 1));
    const qNum = q + 1;
    return { from, to: todayStr, label: `${today.getFullYear()}-Q${qNum}` };
  }
  return { from: todayStr, to: todayStr, label: todayStr };
}

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { searchParams } = req.nextUrl;
  const period = searchParams.get("period") ?? "monthly";
  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");

  let from: string, to: string, label: string;
  if (customFrom && customTo) {
    from = customFrom; to = customTo; label = `${customFrom}_${customTo}`;
  } else {
    ({ from, to, label } = periodDates(period));
  }

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .gte("txn_date", from)
    .lte("txn_date", to)
    .order("txn_date", { ascending: true })
    .order("txn_time", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const csv = toCSV(data ?? []);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="finny_${label}.csv"`,
    },
  });
}
