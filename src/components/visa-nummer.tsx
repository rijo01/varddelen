"use client";

import { useState } from "react";
import { Phone } from "lucide-react";

/**
 * "Visa nummer". Sidan skickar bara cfarnr — numret finns inte i HTML:en
 * eller RSC-payloaden. Klicket hämtar det från POST /api/telefon/<cfarnr>
 * (som räknar visningen) och visar en tel:-länk.
 */
export function VisaNummer({ cfarnr, namn }: { cfarnr: number; namn: string }) {
  const [lage, setLage] = useState<"start" | "laddar" | "fel" | "inget">("start");
  const [nummer, setNummer] = useState<{ telefon: string; tel: string; kalla: string } | null>(null);

  async function visa() {
    setLage("laddar");
    try {
      const r = await fetch(`/api/telefon/${cfarnr}`, { method: "POST", cache: "no-store" });
      if (r.status === 404) return setLage("inget");
      if (!r.ok) return setLage("fel");
      setNummer(await r.json());
    } catch {
      setLage("fel");
    }
  }

  const knapp =
    "inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-[var(--brand)] px-6 text-[19px] font-semibold text-white transition-colors hover:bg-[var(--brand-2)] sm:w-auto";

  if (nummer) {
    return (
      <div className="space-y-1">
        <a href={`tel:${nummer.tel}`} className={knapp} aria-label={`Ring ${namn}, ${nummer.telefon}`}>
          <Phone aria-hidden className="size-5" />
          {nummer.telefon}
        </a>
        {nummer.kalla === "scb-afr" && (
          <p className="text-[13px] text-[var(--text-muted)]">Källa: SCB:s företagsregister</p>
        )}
      </div>
    );
  }
  if (lage === "inget") return <p className="text-[16px] text-[var(--text-muted)]">Inget telefonnummer att visa.</p>;
  return (
    <div className="space-y-1">
      <button type="button" onClick={visa} disabled={lage === "laddar"} className={knapp} aria-live="polite">
        <Phone aria-hidden className="size-5" />
        {lage === "laddar" ? "Hämtar nummer …" : "Visa nummer"}
      </button>
      {lage === "fel" && (
        <p className="text-[13px] text-[var(--text-muted)]">Numret kunde inte hämtas just nu. Försök igen om en stund.</p>
      )}
    </div>
  );
}
