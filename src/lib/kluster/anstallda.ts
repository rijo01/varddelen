import { REGISTER_AR } from "./register";

/**
 * Antal anställda — som SCB:s storleksklass, alltid ett intervall.
 *
 * Registrets `aeant` är antalet arbetsställen bolaget har, inte antalet
 * anställda: NCC AB har aeant 56 och 57 rader i registret, Skanska Sverige 138
 * och 139, och för 9 992 av 10 682 bolag med flera arbetsställen ligger aeant
 * inom 10 % av radantalet (mätt 2026-11-01). Det enda anställdatal registret
 * har är arbetsställets storleksklass, `aesamtable.anstkl`, med SCB:s kodlista
 * (`anstkltable`). Den visas här som det den är: ett intervall, från omkring
 * 2011.
 *
 * Källdatan rörs inte; varje sajt läser klassen ur en egen ögonblicksbild.
 */

/** SCB:s kodlista för storleksklass, ordagrant ur `anstkltable`. Kod 0 = uppgift saknas. */
const KLASSER: Readonly<Record<number, { min: number; max: number | null }>> = {
  1: { min: 0, max: 0 },
  2: { min: 1, max: 4 },
  3: { min: 5, max: 9 },
  4: { min: 10, max: 19 },
  5: { min: 20, max: 49 },
  6: { min: 50, max: 99 },
  7: { min: 100, max: 199 },
  8: { min: 200, max: 499 },
  9: { min: 500, max: 999 },
  10: { min: 1000, max: 1499 },
  11: { min: 1500, max: 1999 },
  12: { min: 2000, max: 2999 },
  13: { min: 3000, max: 3999 },
  14: { min: 4000, max: 4999 },
  15: { min: 5000, max: 9999 },
  16: { min: 10000, max: null },
};

/**
 * Uppslag cfarnr → storleksklass ur sajtens ögonblicksbild (genererad av
 * scripts/hamta-storleksklass.mjs). Packas upp vid första anropet.
 */
export function skapaStorleksuppslag(
  packad: Readonly<Record<number, string>>,
): (cfarnr: number) => number | null {
  let karta: Map<number, number> | null = null;
  return (cfarnr) => {
    if (!karta) {
      karta = new Map();
      for (const [kod, rad] of Object.entries(packad)) {
        let c = 0;
        for (const d of rad.split(",")) {
          c += parseInt(d, 36);
          karta.set(c, Number(kod));
        }
      }
    }
    return karta.get(cfarnr) ?? null;
  };
}

export type Anstallda = {
  /** "1–4 anställda", "0 anställda", "10 000+ anställda". */
  label: string;
  min: number;
  max: number | null;
};

const fmt = (n: number) => n.toLocaleString("sv-SE");

export function anstallda(klass: number | null | undefined): Anstallda | null {
  if (klass == null) return null;
  const k = KLASSER[klass];
  if (!k) return null;
  const spann =
    k.max == null ? `${fmt(k.min)}+` : k.min === k.max ? fmt(k.min) : `${fmt(k.min)}–${fmt(k.max)}`;
  return { label: `${spann} anställda`, min: k.min, max: k.max };
}

/** Meningen som används i beskrivning och FAQ. */
export function anstalldaMening(namn: string, a: Anstallda): string {
  return `Enligt registret från omkring ${REGISTER_AR} hade ${namn} ${a.label} på arbetsstället.`;
}

/** schema.org numberOfEmployees som ett intervall, aldrig ett exakt tal. */
export function anstalldaSchema(a: Anstallda) {
  return {
    "@type": "QuantitativeValue",
    minValue: a.min,
    ...(a.max != null ? { maxValue: a.max } : {}),
  };
}
