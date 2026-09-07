import type { Metadata } from "next";
import indexable from "@/data/indexable.json";

/**
 * EN källa till sanning för vad som får indexeras och vad som ligger i sitemapen.
 *
 * TVÅ GRINDAR — en per sidtyp. Till skillnad från travradarn, där substans och
 * aktualitet är två oberoende axlar, är grinden här densamma för robots-metan
 * och för sitemapen. Vårddelens katalog har ingen tidsaxel: ett företag är inte
 * "aktuellt" på ett sätt som skiljer sig från att det har innehåll. Följden är
 * att sitemapurvalet är IDENTISKT med det indexerbara, och en URL kan därför
 * aldrig ligga i sitemapen och samtidigt svara noindex.
 *
 *   1. HUBBGRIND — /kommun/[slug]/[bransch]
 *      Minst 5 listade företag — vilket sedan 2026-09-07 är samma sak som 5
 *      rader i databasen.
 *
 *      Så var det inte när grinden byggdes. Hubbfrågan bar då ett
 *      `.gte("aeant", 0)`, och eftersom NULL >= 0 är falskt i SQL renderades
 *      de 1 222 vårdföretag som saknar anställningsuppgift aldrig. Grinden
 *      räknade därför medvetet bara rader med aeant satt, för att inte
 *      släppa in hubbar som såg fyllda ut i databasen men var tomma på
 *      sidan. Rätt beslut givet filtret — men filtret självt var buggen.
 *
 *      Filtret är borta ur queries.ts (se applyAeantFilter där) och grinden
 *      räknar nu alla rader. Omräkningen: 1 296 → 1 321 indexerbara hubbar
 *      (+25, ingen bortfallen), och 545 hubbar hade dessförinnan ett
 *      undertalat antal — Stockholm/Hälso & sjukvård stod som 1 393 i stället
 *      för 1 454. Täckningen av företag i en indexerbar hubb går från
 *      30 278 (85,2 %) till 30 421 (85,6 %).
 *
 *   2. SUBSTANSGRIND — /foretag/[slug]
 *      Beskrivning, egen tjänstelista eller verifierad kontakt. Se
 *      MÄTNINGEN nedan för varför just de tre.
 *
 * Urvalet ligger precomputat i src/data/indexable.json (byggs av
 * scripts/build-index-set.mjs). Grindkollen blir ett Set-uppslag: noll extra
 * queries per sidvisning, och sitemapen slipper aggregat som ändå timeoutar
 * genom anon-rollen.
 *
 * Sidor under grinden får "noindex,follow" — de ligger kvar live, med fullt
 * innehåll och levande länkflöde. Ingenting tas bort.
 *
 * ---------------------------------------------------------------------------
 * MÄTNINGEN (7 sep 2026, dev-render av stickprov, 6–8 sidor per band)
 * ---------------------------------------------------------------------------
 * "Unika ord" = ord i <main> utöver mallen, där mallen är ordskärningen av fem
 * slumpvisa sidor av samma typ. För företagssidor är sektionen "Liknande
 * företag" bortklippt — den är andra entiteters data, inte sidans egen.
 *
 * FÖRETAGSSIDOR, unika ord min/median/max:
 *   ingen tel, ingen adress          (7 st)        14 /  16 /  20
 *   bara gatuadress               (3 807 st)       20 /  23 /  24
 *   tel + adress, aeant NULL        (983 st)       16 /  22 /  51
 *   tel + adress, aeant >= 1     (27 777 st)       17 /  20 /  50
 *   (Mätningen gjordes när aeant-filtret fortfarande fanns. Substansgrinden
 *   rör aldrig aeant, så siffrorna ovan gäller oförändrat — 737 företags-
 *   sidor passerar före som efter.)
 *   3–6 sökord                      (234 st)       21 /  26 /  31
 *   >= 8 sökord                      (57 st)       30 /  36 /  76
 *   beskrivning >= 20 ord           (114 st)       61 /  95 / 179
 *
 * Slutsatsen är obekväm men entydig: telefonnummer och gatuadress är
 * REGISTERDEFAULT (89,3 % respektive 96,2 % av 35 528 företag) och tillför
 * 2–7 unika ord. 27 777 sidor som skiljer sig åt på ett telefonnummer är
 * inte 27 777 dokument. Bara beskrivningen separerar på riktigt: 95 unika ord
 * i median mot 20 för registerraden — 4,75x.
 *
 * Därför är trösklarna satta så här:
 *   - beskrivning >= 20 ord   — den enda signalen som mätbart gör en sida till
 *     ett dokument. 20 ord är där infotext-fördelningen (median 18 ord) delar
 *     sig; av 237 rader med infotext klarar 114 gränsen.
 *   - >= 3 unika sökord       — "Tjänster & sökord"-listan är sidans egen text.
 *     Vid 3 sökord ligger medianen på 26 unika ord, tydligt över registerradens
 *     20; vid >= 8 på 36. 3 är golvet där bandet slutar överlappa registerraden.
 *   - verifierad kontakt (webb | epost | kontaktperson | logotyp | poäng > 0)
 *     Denna signal ligger med av ETT annat skäl än de två ovan, och det ska
 *     stå klart: den mäter INTE innehåll. Mätt ger den 21–27 unika ord i median
 *     — i praktiken samma som registerraden. Den är med som EFTERFRÅGE- och
 *     underhållsproxy: fälten är 0,2–1,2 % vanliga och finns bara på profiler
 *     som någon faktiskt hävdat och uppdaterat. De företagen söks på vid namn.
 *     Att indexera dem är ett vad på entiteten, inte på texten.
 *
 * HUBBSIDOR, unika ord min/median/max per antal listade företag:
 *   1 företag  (1 394 hubbar)   10 /  12 /  15
 *   2          (  666)          10 /  19 /  21
 *   3          (  415)          21 /  27 /  28
 *   4          (  276)          16 /  31 /  39
 *   5–6        (  337)          22 /  39 /  42
 *   7–10       (  316)          30 /  46 /  59
 *   11–25      (  390)          45 / 107 / 148
 *   26+        (  253)          45 / 154 / 171
 *
 * Vid 5 företag ligger medianen på 39 unika ord — 3,25x en enföretagshubb, och
 * sidan visar en lista i stället för ett ensamt kort. Under 5 är hubben en
 * omväg: besökaren hade lika gärna kunnat gå direkt till företaget.
 *
 * ---------------------------------------------------------------------------
 * TRAPPAN — hur grindarna ska luckras upp
 * ---------------------------------------------------------------------------
 * Steg 0 (nu) är avsiktligt hårt: 737 av 35 528 företagssidor och 1 321 av
 * 4 084 hubbar. Motivet är att sajten just har lagt om kanonisk host och att
 * crawlbudgeten ska gå till sidor som kan vinna, inte till 34 791 registerrader.
 *
 * Luckra upp ETT steg per GSC-avläsning, aldrig två — annars går det inte att
 * läsa vad som orsakade vad. Ändra trösklarna i scripts/build-index-set.mjs.
 *
 *   Steg 1 — SOKORD_MIN 3 → 1, INFOTEXT_MIN_ORD 20 → 10
 *     ~900 företagssidor. Provar om sökordslistan bär indexering.
 *   Steg 2 — hubbgrinden 5 → 3
 *     ~1 987 hubbar (+691), täcker 88,9 % av företagen i stället för 82,3 %.
 *     (Uppskattningen är från mätningen under aeant-filtret och ligger nu
 *     något lågt — räkna om med build-index-set.mjs innan steget tas.)
 *   Steg 3 — företagsgrinden får ett registerspår: tel + gatuadress + aeant >= 1
 *     ~28 400 företagssidor. Detta är ett helt annat vad än steg 1–2 och tas
 *     BARA om hubbarna dessförinnan indexeras rent.
 *
 * Utlösare för nästa steg: "Genomsökt – för närvarande inte indexerad" har
 * SJUNKIT i GSC OCH antalet indexerade sidor har ökat mot urvalet. Ett av två
 * räcker inte. Sjunker avvisningen inte alls på steg 0 är trösklarna inte
 * problemet — då är det mallen, och svaret är innehåll, inte fler URL:er.
 * ---------------------------------------------------------------------------
 */

/** Trösklarna urvalet byggdes med — för felsökning och rapportering. */
export const INDEX_RULES = indexable.rules;
export const INDEX_GENERATED_AT = indexable.generated_at;
export const INDEX_COUNTS = indexable.counts;

/**
 * Guardrail: sidor som bevisligen rankar. Bevisad efterfrågan väger tyngre än
 * vår mätning, så en post här tas med oavsett vad grinden säger.
 *
 * Posten bär BÅDE nyckeln och sökvägen, så att undantaget hamnar i sitemapen
 * och i robots-uppslaget samtidigt. Bara det ena hade brutit invarianten som
 * hela modulen vilar på.
 *
 * Tom vid steg 0 — vi har ingen GSC-avläsning efter host-omläggningen att
 * grunda undantag på. Fyll på när Search Console visar klick på en sida som
 * grinden valt bort.
 */
const PROVEN_DEMAND_HUB: ReadonlyArray<readonly [key: string, path: string]> = [];
const PROVEN_DEMAND_FORETAG: ReadonlyArray<readonly [cfarnr: number, slug: string]> = [];

type HubEntry = readonly [key: string, path: string];

/** Grindens urval + bevisad efterfrågan. Driver robots OCH sitemap. */
const HUB_ENTRIES: readonly HubEntry[] = [
  ...(indexable.hubs as unknown as readonly HubEntry[]),
  ...PROVEN_DEMAND_HUB,
];

const FORETAG_ENTRIES: ReadonlyArray<readonly [number, string]> = [
  ...Object.entries(indexable.foretag).map(
    ([cfarnr, slug]) => [Number(cfarnr), slug as string] as const,
  ),
  ...PROVEN_DEMAND_FORETAG,
];

const HUB_KEYS: ReadonlySet<string> = new Set(HUB_ENTRIES.map(([key]) => key));
const FORETAG_CFARNR: ReadonlySet<number> = new Set(FORETAG_ENTRIES.map(([cfarnr]) => cfarnr));

/** Nyckel för en hubb: kommunkod utan ledande nollor + branschid. */
export function hubKey(kommunCode: string, ng1: number): string {
  return `${kommunCode.replace(/^0+/, "") || "0"}|${ng1}`;
}

/** Får /kommun/[slug]/[bransch] indexeras? Ett Set-uppslag — ingen DB-träff. */
export function isIndexableHub(kommunCode: string, ng1: number): boolean {
  return HUB_KEYS.has(hubKey(kommunCode, ng1));
}

/** Får /foretag/[slug] indexeras? Ett Set-uppslag — ingen DB-träff. */
export function isIndexableForetag(cfarnr: number): boolean {
  return FORETAG_CFARNR.has(cfarnr);
}

/** noindex men behåll follow — sidan lever, länkflödet lever, Google släpper den. */
export const NOINDEX_FOLLOW: Pick<Metadata, "robots"> = {
  robots: { index: false, follow: true },
};

/**
 * robots-metan för en hubbsida. Kvarhållna sidor får inget robots-fält alls
 * (= index,follow via robots.txt-defaulten).
 */
export function robotsForHub(kommunCode: string, ng1: number): Pick<Metadata, "robots"> {
  return isIndexableHub(kommunCode, ng1) ? {} : NOINDEX_FOLLOW;
}

/** robots-metan för en företagssida. */
export function robotsForForetag(cfarnr: number): Pick<Metadata, "robots"> {
  return isIndexableForetag(cfarnr) ? {} : NOINDEX_FOLLOW;
}

/**
 * Sökvägar till sitemapen. Per konstruktion exakt de sidor som är indexerbara —
 * samma två arrayer driver både robots-uppslaget och listorna nedan.
 */
export function hubSitemapPaths(): string[] {
  return HUB_ENTRIES.map(([, path]) => path);
}

export function foretagSitemapPaths(): string[] {
  return FORETAG_ENTRIES.map(([, slug]) => `/foretag/${slug}`);
}
