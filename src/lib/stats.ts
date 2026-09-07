import { kommunByCode, type Kommun } from "./kommuner";
import { branschPageSlug } from "./queries";
import { VARD_BRANSCHER } from "./vard-branscher";
import {
  TOTAL_FORETAG as SNAPSHOT_TOTAL,
  branschNamn,
  kommunTotal,
  toppBranscher,
  toppKommuner,
} from "./counts";

/**
 * Topplistor och totaler — HÄRLEDDA ur räknesnapshoten i lib/counts.ts.
 *
 * Modulen bar tidigare två handinklistrade listor (topp-25 kommuner, topp-12
 * branscher) med tal från `count=estimated`, uppdaterade genom att köra
 * scripts/fetch-vard-stats.mjs och klistra in resultatet. Två problem följde
 * av det, och båda syntes på sajten:
 *
 *   1. Talen var estimat, inte antal. Totalen låg 7,7 % fel och fem
 *      branschtal hade fastnat på estimatgolvet 1001 — /branscher visade
 *      alltså "1 001" på fyra rader i rad för branscher med 1 006, 1 403,
 *      1 571 och 2 057 företag.
 *   2. Listorna kunde inte hållas i synk med något annat. Kommunsidans
 *      totaltal kom härifrån medan fördelningen bredvid kom från en live-
 *      query — de summerade aldrig till varandra.
 *
 * Nu finns talen på ett ställe (src/data/counts.json, byggd med count=exact
 * och verifierade summeringsinvarianter) och listorna här är sorteringar av
 * den. Uppdatering sker med `node scripts/build-index-set.mjs` — ingen
 * inklistring, inget som kan glömmas halvvägs.
 */

/** Totalt antal vårdföretag. Exakt. */
export const TOTAL_FORETAG = SNAPSHOT_TOTAL;
export const TOTAL_KOMMUNER = 290;
/** Antal branscher i Vårddelens whitelist (single source: vard-branscher.ts). */
export const TOTAL_BRANSCHER = VARD_BRANSCHER.length;
export const TOTAL_LAN = 21;

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

const _TOP_KOMMUNER: KommunStat[] = toppKommuner(25)
  .map((r) => {
    const k = kommunByCode(r.code);
    // Snapshoten kan innehålla kommunkoder som inte finns i SCB-tabellen
    // (data-dirt i källan). De hör inte hemma i en topplista med länkar.
    return k ? { kommun: k, count: r.count, href: `/kommun/${k.slug}` } : null;
  })
  .filter((x): x is KommunStat => x !== null);

/**
 * Visningsnamn där t_bransch inte räcker.
 *
 * SCB:s beskrivningar är inte unika: sex vård-SNI heter "Hälso & sjukvård"
 * och åtta heter "Behandlingshem". En topplista med fyra rader som alla står
 * som "Hälso & sjukvård" är oläsbar, så de curerade etiketterna som tidigare
 * låg inklistrade tillsammans med talen behålls — men BARA som etiketter.
 *
 * Talen kommer alltid ur snapshoten, och SLUGGEN byggs alltid ur t_bransch-
 * namnet, aldrig ur etiketten här. Annars hade listan länkat till en URL som
 * hubbsidan sedan 308:ar bort, eftersom hubbens kanoniska slug kommer ur
 * t_bransch.
 */
const BRANSCH_LABEL: Readonly<Record<number, string>> = {
  86909: "Hälso- & sjukvård",
  86905: "Hälso- & sjukvård (slutenvård)",
  86212: "Specialistläkare",
  86222: "Specialistläkare (hudsjukvård)",
  86211: "Specialistläkare vid sjukhus",
  86221: "Specialistläkare (öppenvård)",
  86230: "Tandläkare",
  86904: "Tandvård (övrig)",
  86903: "Medicinsk laboratorieverksamhet",
  86902: "Ambulans & sjuktransport",
  86102: "Sjukhusvård",
  86103: "Sjukhusvård (övrig)",
  87201: "Behandlingshem (LSS)",
  87202: "Behandlingshem (fysisk funktionsnedsättning)",
  87203: "Behandlingshem (psykisk funktionsnedsättning)",
  87302: "Boende, funktionshinder",
  87901: "Heldygnsvård barn & ungdom",
  87902: "Heldygnsvård missbruk",
  87100: "Äldreomsorg med boende",
  88910: "Omsorg & dagverksamhet",
  88991: "Öppna insatser, missbruk",
  88992: "Öppna insatser, övriga",
  47730: "Apotek",
  47740: "Sjukvårdsartiklar",
  46460: "Partihandel med medicinsk utrustning",
  56293: "Centralkök för omsorgsinstitutioner",
  2: "Företagshälsovård",
};

const _TOP_BRANSCHER: BranschStat[] = toppBranscher(25)
  .map((r) => {
    const dbName = branschNamn(r.ng1);
    // Utan namn i t_bransch finns ingen kanonisk slug — hoppa över raden.
    if (!dbName) return null;
    return {
      id: r.ng1,
      name: BRANSCH_LABEL[r.ng1] ?? dbName,
      count: r.count,
      slug: branschPageSlug(dbName, r.ng1),
    };
  })
  .filter((x): x is BranschStat => x !== null);

export const TOP_KOMMUNER: ReadonlyArray<KommunStat> = _TOP_KOMMUNER;
export const TOP_BRANSCHER: ReadonlyArray<BranschStat> = _TOP_BRANSCHER;

/**
 * Exakt antal vårdföretag i en kommun. Till skillnad från förr täcker
 * snapshoten alla 290 kommuner, inte bara topp-25 — kommunsidan behöver
 * därför ingen live-räkning som reserv i normalfallet.
 */
export function kommunForetagCount(code: string): number | undefined {
  const n = kommunTotal(code);
  return n > 0 ? n : undefined;
}
