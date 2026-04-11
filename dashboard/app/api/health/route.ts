import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  const { count } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true });

  const { data: lastEmail } = await supabase
    .from("processed_emails")
    .select("processed_at")
    .order("processed_at", { ascending: false })
    .limit(1);

  return NextResponse.json({
    status: "ok",
    lastPoll: lastEmail?.[0]?.processed_at ?? null,
    txnCount: count ?? 0,
  });
}
