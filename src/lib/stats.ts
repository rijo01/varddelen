import { kommunByCode, type Kommun } from "./kommuner";
import { branschPageSlug } from "./queries";
import { VARD_BRANSCHER } from "./vard-branscher";

/**
 * Förberäknad statistik från `foretag_publik` — Vårddelen-nisch.
 *
 * Counts mot vyn timeoutar för storstäder via anon-nyckeln, så vi snapshotar
 * tunga aggregat här istället för att räkna live på varje sidvisning.
 *
 * Datan uppdateras manuellt:
 *   node scripts/fetch-vard-stats.mjs > /tmp/vard-stats.json
 * Klistra därefter in nya värden i listorna nedan.
 *
 * Genererad: 2026-05-26 (efter whitelist-rensning: bort 84123, 84124).
 */

/** Total ⌀ estimated count(*) från foretag_publik filtrerat på vård-branscher. */
export const TOTAL_FORETAG = 35476;
export const TOTAL_KOMMUNER = 290;
/** Antal branscher i Vårddelens whitelist (single source: vard-branscher.ts). */
export const TOTAL_BRANSCHER = VARD_BRANSCHER.length;
export const TOTAL_LAN = 21;

type RawKommunStat = { code: string; count: number };
type RawBranschStat = { id: number; name: string; count: number };

const TOP_KOMMUNER_RAW: ReadonlyArray<RawKommunStat> = [
  { code: "180", count: 5019 },   // Stockholm
  { code: "1480", count: 2086 },  // Göteborg
  { code: "1280", count: 1161 },  // Malmö
  { code: "380", count: 1001 },   // Uppsala
  { code: "1281", count: 644 },   // Lund
  { code: "182", count: 558 },    // Nacka
  { code: "1283", count: 538 },   // Helsingborg
  { code: "1880", count: 524 },   // Örebro
  { code: "580", count: 514 },    // Linköping
  { code: "1980", count: 506 },   // Västerås
  { code: "2480", count: 476 },   // Umeå
  { code: "160", count: 430 },    // Täby
  { code: "581", count: 418 },    // Norrköping
  { code: "1380", count: 397 },   // Halmstad
  { code: "186", count: 388 },    // Lidingö
  { code: "680", count: 377 },    // Jönköping
  { code: "184", count: 366 },    // Solna
  { code: "1490", count: 362 },   // Borås
  { code: "126", count: 358 },    // Huddinge
  { code: "163", count: 345 },    // Sollentuna
  { code: "162", count: 343 },    // Danderyd
  { code: "181", count: 313 },    // Södertälje
  { code: "1780", count: 313 },   // Karlstad
  { code: "780", count: 293 },    // Växjö
  { code: "1290", count: 285 },   // Kristianstad
];

const TOP_BRANSCHER_RAW: ReadonlyArray<RawBranschStat> = [
  { id: 86909, name: "Hälso- & sjukvård", count: 7330 },
  { id: 86905, name: "Hälso- & sjukvård (slutenvård)", count: 5846 },
  { id: 86212, name: "Specialistläkare", count: 4421 },
  { id: 86230, name: "Tandläkare", count: 4095 },
  { id: 87201, name: "Behandlingshem", count: 4065 },
  { id: 86222, name: "Specialistläkare (hudsjukvård)", count: 2137 },
  { id: 86211, name: "Specialistläkare vid sjukhus", count: 1001 },
  { id: 88910, name: "Omsorg & dagverksamhet", count: 1001 },
  { id: 47730, name: "Apotek", count: 1001 },
  { id: 46460, name: "Partihandel med medicinsk utrustning", count: 1001 },
  { id: 87901, name: "Heldygnsvård barn & ungdom", count: 722 },
  { id: 86903, name: "Medicinsk laboratorieverksamhet", count: 377 },
];

export type KommunStat = {
  kommun: Kommun;
  count: number;
  href: string;
};

export type BranschStat = {
  id: number;
  name: string;
  count: number;
  /** SNI-slug — använd kombinerat med en kommun: /kommun/{slug}/{branschSlug} */
  slug: string;
};

const _TOP_KOMMUNER: KommunStat[] = TOP_KOMMUNER_RAW.map((r) => {
  const k = kommunByCode(r.code);
  if (!k) throw new Error(`Unknown kommun code in stats: ${r.code}`);
  return { kommun: k, count: r.count, href: `/kommun/${k.slug}` };
});

const _TOP_BRANSCHER: BranschStat[] = TOP_BRANSCHER_RAW.map((r) => ({
  id: r.id,
  name: r.name,
  count: r.count,
  slug: branschPageSlug(r.name, r.id),
}));

export const TOP_KOMMUNER: ReadonlyArray<KommunStat> = _TOP_KOMMUNER;
export const TOP_BRANSCHER: ReadonlyArray<BranschStat> = _TOP_BRANSCHER;

/** Statistik för en kommun om vi har snapshot — annars undefined. */
const _BY_CODE = new Map(TOP_KOMMUNER_RAW.map((r) => [r.code, r.count]));
export function kommunForetagCount(code: string): number | undefined {
  return _BY_CODE.get(code);
}
