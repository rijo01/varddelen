import Link from "next/link";
import { Info } from "lucide-react";
import type { ProfilMarkning } from "@/lib/foretag-format";

/**
 * Små, återkommande sanningar som sajten måste säga på samma sätt överallt:
 * vart man vänder sig med vårdfrågor, och vad en märkning i listan betyder.
 */

/** Hänvisning till 112/1177. Vårddelen ger aldrig egna råd. */
export function AkutNotis({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2.5 rounded-lg bg-[var(--surface-soft)] px-4 py-3 text-[15px] leading-snug text-[var(--text-muted)] ${className}`}
    >
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--text-dim)]" />
      <span>
        Vårddelen är en söktjänst och ger inga medicinska råd. Akut:{" "}
        <a href="tel:112" className="font-semibold text-[var(--text-strong)] underline">
          ring 112
        </a>
        . Sjukvårdsrådgivning: ring{" "}
        <a href="tel:1177" className="font-semibold text-[var(--text-strong)] underline">
          1177
        </a>{" "}
        eller gå till{" "}
        <a
          href="https://www.1177.se"
          rel="noopener"
          className="font-semibold text-[var(--text-strong)] underline"
        >
          1177.se
        </a>
        .
      </span>
    </p>
  );
}

/**
 * Etiketten för en betald placering eller en komplett registerprofil.
 * Utseendet är medvetet sakligt: ingen stjärna, ingen bock, inget som kan
 * läsas som ett omdöme om vården.
 */
export function ProfilEtikett({ markning }: { markning: ProfilMarkning }) {
  if (markning === "betald") {
    return (
      <Link
        href="#om-ordningen"
        className="inline-flex items-center gap-1 rounded border border-[var(--brand)]/35 bg-white px-1.5 py-0.5 text-[13px] font-semibold leading-none text-[var(--brand-ink)] hover:underline"
        title="Företaget betalar för att synas högre. Det är ingen bedömning av vården."
      >
        Betald placering
        <Info aria-hidden className="size-3.5" />
      </Link>
    );
  }
  if (markning === "komplett") {
    return (
      <span
        className="inline-flex items-center rounded border border-[var(--rule-strong)] px-1.5 py-0.5 text-[13px] font-medium leading-none text-[var(--text-muted)]"
        title="Profilen har fler uppgifter än registrets grunddata. Det är ingen bedömning av vården."
      >
        Komplett profil
      </span>
    );
  }
  return null;
}

/** Raden under resultaträkningen: ordningen förklaras där den syns. */
export function OrdningsNotis() {
  return (
    <p className="text-[15px] text-[var(--text-dim)]">
      Ordningen påverkas av hur komplett profilen är och av betalda profiler.{" "}
      <Link href="#om-ordningen" className="text-[var(--brand-ink)] underline">
        Så fungerar det
      </Link>
    </p>
  );
}
