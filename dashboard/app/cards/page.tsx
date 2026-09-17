"use client";

import { useEffect, useState } from "react";
import { cardBadgeClass } from "@/lib/categories";
import { CardIcon } from "@/components/Icons";
import ScanButton from "@/components/ScanButton";

interface Card {
  card: string;
  label: string;
  currency: string;
  active: boolean;
}

export default function CardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [fallback, setFallback] = useState(false);
  const [loading, setLoading] = useState(true);

  // Add form
  const [name, setName] = useState("");
  const [gmailLabel, setGmailLabel] = useState("");
  const [currency, setCurrency] = useState("SGD");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [justAdded, setJustAdded] = useState<Card | null>(null);

  useEffect(() => {
    fetch("/api/cards")
      .then((r) => r.json())
      .then((d) => {
        setCards(d.cards ?? []);
        setFallback(!!d.fallback);
        setLoading(false);
      });
  }, []);

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: name, label: gmailLabel, currency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add card");
      setCards((prev) => [...prev.filter((c) => c.card !== data.card.card), data.card]);
      setJustAdded(data.card);
      setName("");
      setGmailLabel("");
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(card: Card) {
    setCards((prev) =>
      prev.map((c) => (c.card === card.card ? { ...c, active: !c.active } : c))
    );
    await fetch("/api/cards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card: card.card, active: !card.active }),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Cards</h1>
        <ScanButton label="Scan all cards" />
      </div>

      {fallback && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-2xl px-4 py-3">
          The <code>cards</code> table doesn&apos;t exist yet — run the migration in
          <code> schema.sql</code> via the Supabase SQL Editor to enable adding cards from here.
        </div>
      )}

      {/* Card list */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        {loading && <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>}
        {!loading && cards.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">No cards yet</div>
        )}
        {cards.map((c) => (
          <div key={c.card} className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-b-0">
            <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 shrink-0">
              <CardIcon className="w-4.5 h-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cardBadgeClass(c.card)}`}>
                  {c.card.toUpperCase()}
                </span>
                <span className="text-xs text-gray-400">{c.currency}</span>
                {!c.active && (
                  <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">Paused</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Gmail label: <span className="font-medium text-gray-500">{c.label}</span>
              </p>
            </div>
            <button
              onClick={() => toggleActive(c)}
              disabled={fallback}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 ${
                c.active ? "bg-indigo-600" : "bg-gray-200"
              }`}
              aria-label={c.active ? "Pause card" : "Resume card"}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                  c.active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Add card */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Add a card</h2>
        <p className="text-xs text-gray-400 mb-4">
          First, set up a Gmail filter that applies a label to the bank&apos;s transaction alert
          emails. Then register that label here — Finny starts watching it within ~5 minutes.
        </p>
        <form onSubmit={addCard} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="card name, e.g. hdfc"
              className="flex-1 min-w-[130px] bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-indigo-400"
            />
            <input
              value={gmailLabel}
              onChange={(e) => setGmailLabel(e.target.value)}
              placeholder="Gmail label, e.g. HDFC Alerts"
              className="flex-1 min-w-[150px] bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-indigo-400"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none cursor-pointer"
            >
              <option value="SGD">SGD</option>
              <option value="INR">INR</option>
            </select>
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <button
            type="submit"
            disabled={saving || fallback}
            className="px-4 py-2 rounded-full bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add card"}
          </button>
        </form>

        {justAdded && (
          <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 space-y-2">
            <p className="text-xs text-emerald-700">
              <span className="font-semibold">{justAdded.card.toUpperCase()}</span> added — new
              emails under &ldquo;{justAdded.label}&rdquo; will be picked up automatically.
              Scan now to fetch this card&apos;s existing transactions (last 90 days).
            </p>
            <ScanButton
              card={justAdded.card}
              days={90}
              label={`Scan ${justAdded.card} now`}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 px-1">
        Note: the parser may need bank-specific rules for a new bank&apos;s email format. If a
        scan finds emails but saves nothing, the format likely isn&apos;t recognised yet.
      </p>
    </div>
  );
}
