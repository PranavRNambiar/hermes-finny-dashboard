import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

export async function GET() {
  const supabase = getClient();
  const { data } = await supabase
    .from("transactions")
    .select("user_tag")
    .not("user_tag", "is", null);

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const row of data ?? []) {
    const raw = (row.user_tag as string).trim();
    if (!raw || raw.startsWith("__")) continue;
    const norm = raw.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      tags.push(norm);
    }
  }

  return NextResponse.json({ tags: tags.sort() });
}
