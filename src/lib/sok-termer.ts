/**
 * Sökordens synonymer — det besökaren skriver mot det registret kallar saken.
 *
 * Registret använder ofta äldre eller andra ord än de som söks. Mätt mot
 * foretag_publik inom vårdnischen (21 okt 2026):
 *
 *   fysioterapeut     3   ·  sjukgymnastik  712  ·  sjukgymnast  154
 *   kiropraktor      54   ·  kiropraktik    105
 *   psykolog        281   ·  psykoterapi    427
 *
 * "fysioterapeut Kungälv" gav därför noll träffar trots att Kungälv har
 * sjukgymnaster. Kartan här skriver om sökordet till en OR-fråga innan det
 * når searchForetag — queries.ts rörs inte. Frågan går då genom fulltext-
 * vägen (websearch_to_tsquery förstår "or").
 *
 * Bara ord vars synonymer betyder samma sak hör hemma här. "omsorg" som
 * synonym till "hemtjänst" hade gett fler träffar, men fel träffar.
 */

export type SokTerm = {
  /** Det besökaren ser i förslag och snabbval. */
  label: string;
  /** Det som skrivs i sökfältet när termen väljs. */
  q: string;
  /** Alternativa ord som betyder samma sak i registret. */
  synonymer: readonly string[];
  /**
   * Kategorin ordet egentligen betyder. Hemtjänstföretag heter sällan
   * "hemtjänst" (Attendo Care AB), så fritext missar dem; kategorin gör det inte.
   */
  kategori?: string;
};

export const SOK_TERMER: ReadonlyArray<SokTerm> = [
  { label: "Tandläkare", q: "tandläkare", synonymer: [] },
  {
    label: "Fysioterapeut / sjukgymnast",
    q: "fysioterapeut",
    synonymer: ["fysioterapi", "sjukgymnast", "sjukgymnastik"],
  },
  {
    label: "Psykolog / psykoterapeut",
    q: "psykolog",
    synonymer: ["psykoterapeut", "psykoterapi"],
  },
  { label: "Kiropraktor", q: "kiropraktor", synonymer: ["kiropraktik"] },
  { label: "Naprapat", q: "naprapat", synonymer: ["naprapati"] },
  { label: "Vårdcentral", q: "vårdcentral", synonymer: [] },
  { label: "Tandhygienist", q: "tandhygienist", synonymer: [] },
  { label: "Logoped", q: "logoped", synonymer: [] },
  { label: "Hemtjänst", q: "hemtjänst", synonymer: ["hemvård", "hemomsorg"], kategori: "hemtjanst" },
];

/** Normaliserad nyckel: gemener, utan diakritiska tecken på å/ä/ö/é. */
function nyckel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e");
}

const TERM_FOR_ORD = new Map<string, SokTerm>();
for (const t of SOK_TERMER) {
  for (const ord of [t.q, ...t.synonymer]) TERM_FOR_ORD.set(nyckel(ord), t);
}

/** Termen ett enskilt sökord hör till, om något. */
export function termFor(query: string): SokTerm | null {
  return TERM_FOR_ORD.get(nyckel(query)) ?? null;
}

/**
 * Sökordet som ska skickas till searchForetag. Ett känt ord med synonymer
 * blir "a or b or c"; allt annat går igenom oförändrat. Rubriken och
 * sökfältet visar fortfarande det besökaren skrev.
 */
export function expanderaSokord(query: string): string {
  const term = termFor(query);
  if (!term || term.synonymer.length === 0) return query;
  return [term.q, ...term.synonymer].join(" or ");
}

/**
 * Kategorierna som förslag i sökfältet. Bara slug och namn: sökfältet är en
 * klientkomponent, och vard-kategorier.ts drar in hela räknesnapshoten.
 * vard-kategorier.ts kontrollerar vid start att listorna stämmer överens.
 */
export const KATEGORI_FORSLAG: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "halsovard", name: "Hälso- & sjukvård" },
  { slug: "lss", name: "LSS & funktionshinder" },
  { slug: "tandvard", name: "Tandvård" },
  { slug: "hvb", name: "HVB & Behandlingshem" },
  { slug: "apotek", name: "Apotek & medicinsk handel" },
  { slug: "aldreomsorg", name: "Äldreomsorg" },
  { slug: "hemtjanst", name: "Hemtjänst" },
];
