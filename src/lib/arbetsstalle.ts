import { GENERISKA, NAMN, PACKAD } from "./arbetsstallenamn-snapshot";

/**
 * Vårdställen med offentlig huvudman visas med arbetsställets eget namn.
 *
 * Registret har kommunernas, regionernas och statens vårdställen under
 * huvudmannens namn: VÄSTRA GÖTALANDS LÄNS LANDSTING 428 gånger, STOCKHOLMS
 * KOMMUN 351. Arbetsställets namn ("HÖGLANDSSJUKHUSET EKSJÖKLINIKEN",
 * "TANDVÅRDSAVDELNING SÄVAST") ligger i aesamtable.ben, som vyn inte har; det
 * läses ur en ögonblicksbild (scripts/hamta-arbetsstallenamn.mjs).
 *
 * Arbetsställets namn blir `firma` — det namn varje yta visar och som sluggen
 * byggs av — och huvudmannen följer med som `huvudman`, den sekundära raden.
 * Ett namn som bara är en typ av ställe ("GRUPPBOSTAD", 458 gånger) får orten
 * efter sig så att raderna går att skilja åt.
 *
 * Gäller bara de cfarnr som finns i ögonblicksbilden, alltså offentlig
 * huvudman. Privata vårdföretag rörs inte.
 */

type Post = { visning: string | null; huvudman: string };
let karta: Map<number, Post> | null = null;
const generiska = new Set(GENERISKA);

function packaUpp(): Map<number, Post> {
  const m = new Map<number, Post>();
  let cfarnr = 0;
  for (const post of PACKAD.split(",")) {
    const [d, v, h] = post.split(":");
    cfarnr += parseInt(d, 36);
    m.set(cfarnr, { visning: v ? NAMN[parseInt(v, 36)] : null, huvudman: NAMN[parseInt(h, 36)] });
  }
  return m;
}

/** Arbetsställets namn och huvudman, eller null om raden inte har offentlig huvudman. */
export function arbetsstalleFor(cfarnr: number): Post | null {
  karta ??= packaUpp();
  return karta.get(cfarnr) ?? null;
}

type Rad = {
  cfarnr: number;
  firma: string | null;
  namn: string | null;
  postort?: string | null;
  huvudman?: string | null;
};

/**
 * Raden med arbetsställets namn som `firma` och huvudmannen i `huvudman`.
 * Har raden redan ett eget namn (och huvudmannen i registrets `ben`) står
 * namnet kvar och bara `huvudman` läggs till. Idempotent.
 */
export function medArbetsstallenamn<T extends Rad>(f: T): T {
  if (f.huvudman) return f;
  const p = arbetsstalleFor(f.cfarnr);
  if (!p) return f;
  if (!p.visning) return { ...f, huvudman: p.huvudman };
  const ort = f.postort?.trim().toUpperCase();
  const visas =
    generiska.has(p.visning) && ort && !p.visning.includes(ort) ? `${p.visning}, ${ort}` : p.visning;
  return { ...f, firma: visas, huvudman: p.huvudman };
}

/** Ord som skrivs med liten bokstav i ett huvudmannanamn. */
const SMA_ORD = new Set(["kommun", "läns", "landsting", "kommunalförbund", "och", "i", "för", "av"]);

/** "VÄSTRA GÖTALANDS LÄNS LANDSTING" → "Västra Götalands läns landsting". */
export function huvudmanText(huvudman: string): string {
  const s = huvudman.trim();
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((ord, i) =>
      i > 0 && SMA_ORD.has(ord) ? ord : ord.charAt(0).toUpperCase() + ord.slice(1),
    )
    .join("");
}

// ---- Sök ------------------------------------------------------------------

/** Gemener, utan diakritiska tecken: "Ängåsgatan" → "angasgatan". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

let sokindex: Array<{ cfarnr: number; ord: string[]; fras: string }> | null = null;

function byggSokindex() {
  karta ??= packaUpp();
  const ut: Array<{ cfarnr: number; ord: string[]; fras: string }> = [];
  for (const [cfarnr, p] of karta) {
    // Bara egna namn: en rad som behåller sitt namn finns redan i
    // search_vector, och ett typnamn ("GRUPPBOSTAD") är ingen namnträff.
    if (!p.visning || generiska.has(p.visning)) continue;
    const fras = norm(p.visning);
    ut.push({ cfarnr, ord: fras.split(/[^\p{L}\p{N}]+/u).filter(Boolean), fras });
  }
  return ut;
}

/**
 * Vårdställen vars eget namn matchar frågan — namnen finns inte i
 * search_vector (vyn har bara registrets namn, alltså huvudmannen), så de
 * söks här, i ögonblicksbilden, och slås ihop med vyns träffar.
 *
 * Varje ord i frågan ska börja ett ord i namnet ("marstrand vård" hittar
 * MARSTRAND VÅRDCENTRAL). Exakt fras först, sedan kortast namn.
 */
export function sokArbetsstallen(fraga: string, max = 10): number[] {
  const q = norm(fraga).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (q.length === 0 || !q.some((o) => o.length >= 3)) return [];
  sokindex ??= byggSokindex();
  const fras = q.join(" ");
  const traffar = sokindex.filter((e) => q.every((t) => e.ord.some((o) => o.startsWith(t))));
  traffar.sort(
    (a, b) =>
      Number(b.fras.includes(fras)) - Number(a.fras.includes(fras)) ||
      a.ord.length - b.ord.length ||
      a.cfarnr - b.cfarnr,
  );
  return traffar.slice(0, max).map((e) => e.cfarnr);
}
