import counts from "@/data/counts.json";

/**
 * EN källa till alla tal sajten visar.
 *
 * Byggs av scripts/build-index-set.mjs ur en fullständig, keyset-paginerad
 * hämtning av foretag_publik som stäms av mot count=exact. Samma hämtning
 * driver indexerbarhetsgrinden, så grindens antal och sidornas antal kan
 * per konstruktion inte gå isär.
 *
 * ---------------------------------------------------------------------------
 * VARFÖR SNAPSHOT OCH INTE LIVE
 * ---------------------------------------------------------------------------
 * Inte prestanda — exakt count svarar på 0,3–1,1 s och hade dugt. Skälet är
 * KONSISTENS. Kommunsidan visar en total och en kategorifördelning bredvid
 * varandra; hämtas de var för sig kan de aldrig garanteras summera. Ur en
 * snapshot gäller invarianten alltid:
 *
 *     summa(kommunBransch för en kommun) === kommunTotal(kommun)
 *     summa(kommunTotal) + rader utan kommun/bransch === TOTAL_FORETAG
 *
 * Båda kollas när snapshoten byggs; bygget avbryter om de inte håller.
 *
 * ---------------------------------------------------------------------------
 * VAD SOM ERSATTES (2026-09-07)
 * ---------------------------------------------------------------------------
 * Talen kom tidigare från `count=estimated` och låg därför fel överallt:
 *
 *   totalt              32 793  →  35 528   (−7,7 %)
 *   Stockholm            5 019  →   5 546
 *   Specialistläkare vid sjukhus  1 001  →  1 302
 *   Omsorg & dagverksamhet        1 001  →  1 571
 *   Apotek                        1 001  →  1 006
 *   Partihandel med med. utr.     1 001  →  1 403
 *   Specialistläkare (hud)        1 001  →  2 057
 *
 * De fem 1 001:orna var inte data utan planner-estimatets golv — fem olika
 * branscher råkade visa exakt samma tal på /branscher. Dessutom var talen
 * handinklistrade i stats.ts, så de kunde inte uppdateras utan att någon kom
 * ihåg att köra ett skript och klistra rätt.
 */

type CountsShape = {
  generated_at: string;
  metod: string;
  total: number;
  utan_kommun_eller_bransch: number;
  kommun: Record<string, number>;
  bransch: Record<string, number>;
  bransch_namn: Record<string, string>;
  kommun_bransch: Record<string, number>;
};

const C = counts as CountsShape;

export const COUNTS_GENERATED_AT = C.generated_at;

/** Totalt antal vårdföretag. Exakt. */
export const TOTAL_FORETAG = C.total;

/** Exakt antal vårdföretag i en kommun (SCB-kod utan ledande nollor). */
export function kommunTotal(code: string): number {
  return C.kommun[normalizeKommun(code)] ?? 0;
}

/** Exakt antal vårdföretag i en bransch. */
export function branschTotal(ng1: number): number {
  return C.bransch[String(ng1)] ?? 0;
}

/** Branschnamn ur samma snapshot — slipper DB-uppslag för topplistorna. */
export function branschNamn(ng1: number): string | null {
  return C.bransch_namn[String(ng1)] ?? null;
}

/** Exakt antal i en kommun + bransch (en hubbsida). */
export function kommunBranschTotal(code: string, ng1: number): number {
  return C.kommun_bransch[`${normalizeKommun(code)}|${ng1}`] ?? 0;
}

/**
 * Branschfördelningen i en kommun, störst först. Summerar per konstruktion
 * till kommunTotal(code) när limit inte skär av listan.
 */
export function branschFordelning(
  code: string,
  limit = 20,
): Array<{ ng1: number; count: number }> {
  const prefix = `${normalizeKommun(code)}|`;
  const out: Array<{ ng1: number; count: number }> = [];
  for (const [key, count] of Object.entries(C.kommun_bransch)) {
    if (!key.startsWith(prefix)) continue;
    out.push({ ng1: Number(key.slice(prefix.length)), count });
  }
  out.sort((a, b) => b.count - a.count || a.ng1 - b.ng1);
  return out.slice(0, limit);
}

/** Kommuner sorterade på antal, störst först. */
export function toppKommuner(limit = 25): Array<{ code: string; count: number }> {
  return Object.entries(C.kommun)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/** Branscher sorterade på antal, störst först. */
export function toppBranscher(limit = 25): Array<{ ng1: number; count: number }> {
  return Object.entries(C.bransch)
    .map(([ng1, count]) => ({ ng1: Number(ng1), count }))
    .sort((a, b) => b.count - a.count || a.ng1 - b.ng1)
    .slice(0, limit);
}

/**
 * Snapshoten nycklas på kommunkoden som den står i foretag_publik, dvs. utan
 * ledande nollor ("180", inte "0180"). kommuner.ts bär SCB-koden i båda
 * formerna beroende på fält, så vi normaliserar här i stället för på varje
 * anropsställe.
 */
function normalizeKommun(code: string): string {
  return code.replace(/^0+/, "") || "0";
}
