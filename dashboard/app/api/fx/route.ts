import { NextResponse } from "next/server";

const FALLBACK_RATE = 72;

// SGD→INR via Frankfurter (ECB reference rates, no API key).
// Cached for 6 hours — FX precision beyond that doesn't matter for spend summaries.
export async function GET() {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=SGD&to=INR", {
      next: { revalidate: 21600 },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.INR;
    if (!rate || typeof rate !== "number") throw new Error("no INR rate in response");
    return NextResponse.json({ rate, date: data.date, source: "frankfurter" });
  } catch {
    return NextResponse.json({ rate: FALLBACK_RATE, fallback: true });
  }
}
