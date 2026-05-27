import { getSupabaseAnon } from "./supabase";
import { branschSlug } from "./branscher";
import { VARD_BRANSCHER, VARD_BRANSCHER_SET } from "./vard-branscher";
import { kommunCodesForLan } from "./lan";

type GeoFilter = { kommun?: string; postort?: string; lan?: string };

/**
 * Applicera geo-filter på en query-builder. Mutex — bara ett filter appliceras.
 * Prioritet (mest specifik vinner): kommun > postort > lan.
 *
 *   lan → .in("kommun", [alla kommuner i länet]) via kommuner.ts-mappningen.
 *     DB:s lan-kolumn har data-dirt (samma kommun har 2-4 olika lan-värden +
 *     NULL-rader), så vi går via auktoritativa SCB-koden i kommuner.ts.
 *     Bonus: använder existerande (kommun, ng1, aeant DESC)-index direkt.
 */
function applyGeoFilter<T>(q: T, opts: GeoFilter): T {
  if (opts.kommun) return (q as unknown as { eq(c: string, v: string): T }).eq("kommun", opts.kommun);
  if (opts.postort) return (q as unknown as { ilike(c: string, v: string): T }).ilike("postort", opts.postort);
  if (opts.lan) {
    const codes = kommunCodesForLan(opts.lan);
    if (codes.length > 0) return (q as unknown as { in(c: string, v: string[]): T }).in("kommun", codes);
  }
  return q;
}

/**
 * Datalager. Alla anrop går mot vyn `foretag_publik` via anon-nyckeln.
 *
 * Vårddelen-nisch: ALLA företagsqueries filtreras med .in("ng1", VARD_BRANSCHER)
 * så att enbart vård- och omsorgsföretag visas. Whitelist lever i
 * src/lib/vard-branscher.ts. Single-bransch-queries (.eq("ng1", X)) guardas
 * dessutom så att icke-vård-id ger tomt resultat innan vi når DB.
 *
 * GDPR: kolumnen `orgnr_masked` är redan maskad vid källan. Vi gör ingen
 * ytterligare maskning här — single source of truth är databasvyn.
 *
 * Prestandanot: anon-rollen kör genom RLS overhead. Sortering på okindexerad
 * kolumn (aeant) och `count: estimated` på filtrerade vyer triggar statement
 * timeout. Vi sorterar därför enbart på PK (id) och undviker count på vy.
 */

export type Foretag = {
  id: number;
  cfarnr: number;
  firma: string | null;
  namn: string | null;
  gatuadress: string | null;
  postnr: number | null;
  postort: string | null;
  tel: string | null;
  webb: string | null;
  epostadress: string | null;
  ng1: number | null;
  kommun: string | null;
  aeant: number | null;
  /**
   * Rått orgnr för juridiska personer. NULL för enskild firma och andra
   * fysisk-person-fall (då är källkolumnen ett personnummer som DB-vyn
   * filtrerar bort av GDPR-skäl).
   */
  orgnr: string | null;
  /** True om bolaget är en enskild firma — då döljer vi orgnr i UI. */
  arEnskildFirma: boolean;
  /** SCB juridisk form-kod, se lib/jurform.ts för mappning. */
  jurform: number | null;
  /** Premium-poäng — högt värde = betalkund, ska rankas överst. */
  poang: number | null;
  /** Företagsbeskrivning (HTML, behöver saneras innan rendering). */
  infotext: string | null;
  /** Logotyp-URL (kan vara relativ till gamla servern → validera innan visning). */
  logotyp: string | null;
  /** Kontaktperson — publikt namn, OK att visa. */
  kontaktperson: string | null;
};

type PublikRow = {
  id: number;
  cfarnr: number;
  firma: string | null;
  namn: string | null;
  gatuadress: string | null;
  postnr: number | null;
  postort: string | null;
  tel: string | null;
  webb: string | null;
  epostadress: string | null;
  ng1: number | null;
  kommun: string | null;
  aeant: number | null;
  orgnr: string | null;
  ar_enskild_firma: boolean | null;
  jurform: number | null;
  poang: number | null;
  infotext: string | null;
  logotyp: string | null;
  kontaktperson: string | null;
};

const VIEW = "foretag_publik";

/**
 * Fullt kolumn-set inkl. tunga infotext. Använd för profil-sidan.
 */
const COLUMNS =
  "id,cfarnr,firma,namn,gatuadress,postnr,postort,tel,webb,epostadress,ng1,kommun,aeant,orgnr,ar_enskild_firma,jurform,poang,infotext,logotyp,kontaktperson";

/**
 * Lättviktigt kolumn-set för listvyer (söklistor, related, etc.) —
 * hoppar över `infotext` som kan vara flera kilobyte per rad.
 * Logotyp tas med så CompanyCard kan visa en bild om vi senare vill.
 */
const COLUMNS_LIST =
  "id,cfarnr,firma,namn,gatuadress,postnr,postort,tel,webb,epostadress,ng1,kommun,aeant,orgnr,ar_enskild_firma,jurform,poang,logotyp,kontaktperson";

function mapRow(row: Partial<PublikRow>): Foretag {
  // Type assertion via Partial: vi accepterar listrader som saknar tunga
  // fält (infotext m.fl.) och defaulta dem till null.
  return {
    id: row.id ?? 0,
    cfarnr: row.cfarnr ?? 0,
    firma: row.firma ?? null,
    namn: row.namn ?? null,
    gatuadress: row.gatuadress ?? null,
    postnr: row.postnr ?? null,
    postort: row.postort ?? null,
    tel: row.tel ?? null,
    webb: row.webb ?? null,
    epostadress: row.epostadress ?? null,
    ng1: row.ng1 ?? null,
    kommun: row.kommun ?? null,
    aeant: row.aeant ?? null,
    orgnr: row.orgnr ?? null,
    arEnskildFirma: row.ar_enskild_firma ?? false,
    jurform: row.jurform ?? null,
    poang: row.poang ?? null,
    infotext: row.infotext ?? null,
    logotyp: row.logotyp ?? null,
    kontaktperson: row.kontaktperson ?? null,
  };
}

/** Antal vårdföretag i en kommun (estimated, inom Vårddelen-nischen). */
export async function countForetagInKommun(kommunCode: string): Promise<number> {
  const supa = getSupabaseAnon();
  const { count, error } = await supa
    .from(VIEW)
    .select("id", { count: "estimated", head: true })
    .eq("kommun", kommunCode)
    .in("ng1", VARD_BRANSCHER);
  if (error) {
    console.error("countForetagInKommun", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Största arbetsgivare i en kommun. Utnyttjar indexet
 * `aesamtable(kommun, aeant DESC NULLS LAST)` så att Postgres kan ta
 * topp-N direkt från indexet utan att materialisera hela resultset.
 * Sekundär sort på cfarnr säkrar deterministisk tie-break.
 */
export async function listForetagInKommun(
  kommunCode: string,
  limit = 10,
): Promise<Foretag[]> {
  const supa = getSupabaseAnon();
  // Why ingen poang-sort här: indexet är (kommun, aeant DESC NULLS LAST) —
  // poang som primär nyckel triggar full-scan på storstäder. "Största
  // arbetsgivare" är dessutom en objektiv stat, inte search-relevans, så
  // aeant DESC är rätt sortering.
  const { data, error } = await supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .eq("kommun", kommunCode)
    .in("ng1", VARD_BRANSCHER)
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .limit(limit);
  if (error || !data) {
    console.error("listForetagInKommun", error);
    return [];
  }
  return (data as Partial<PublikRow>[]).map(mapRow);
}

/**
 * Branschfördelning i en kommun. Samplar upp till 5000 rader och räknar
 * i app-lagret — representativt för topp-N i UI.
 */
export async function getBranschFordelning(
  kommunCode: string,
  limit = 20,
): Promise<Array<{ ng1: number; count: number }>> {
  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from(VIEW)
    .select("ng1")
    .eq("kommun", kommunCode)
    .in("ng1", VARD_BRANSCHER)
    .limit(5000);
  if (error || !data) {
    console.error("getBranschFordelning", error);
    return [];
  }
  const counts = new Map<number, number>();
  for (const row of data as Array<{ ng1: number | null }>) {
    if (row.ng1 == null || row.ng1 === 0) continue;
    // Dubbelkolla mot whitelist (defensiv — DB-filtret bör räcka).
    if (!VARD_BRANSCHER_SET.has(row.ng1)) continue;
    counts.set(row.ng1, (counts.get(row.ng1) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([ng1, count]) => ({ ng1, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Företag i kommun + bransch, paginerat.
 *
 * Returnerar `hasMore` i stället för exakt total — exakt count på vyn
 * triggar statement timeout via anon. Vi hämtar pageSize+1 rader och kollar
 * om den sista returnerades.
 */
export async function listForetagInKommunByBransch(
  kommunCode: string,
  ng1: number,
  opts: {
    page?: number;
    pageSize?: number;
    aeantMin?: number;
    aeantMax?: number;
  } = {},
): Promise<{ rows: Foretag[]; hasMore: boolean; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize; // inclusive — hämtar pageSize+1 rader

  // Guard: blocka icke-vård-id helt — vi vill aldrig att en användare
  // navigerar till /kommun/X/bygg-12345 och får faktiska bygg-företag.
  if (!VARD_BRANSCHER_SET.has(ng1)) {
    return { rows: [], hasMore: false, page, pageSize };
  }

  const supa = getSupabaseAnon();
  // Primär sort: aeant DESC (störst arbetsgivare först).
  // Sekundär: cfarnr ASC — deterministisk tie-break så att samma företag
  // aldrig dyker upp på flera sidor.
  //
  // Why .gte("aeant", 0): indexet på (kommun, aeant DESC NULLS LAST) räcker
  // för kommun-sample men inte för kombinationen kommun + ng1 — Postgres
  // tappar sort-shortcut och försöker materialisera hela kommun-resultset
  // innan filter på ng1, vilket triggar statement timeout på storstäder.
  // Genom att exkludera rader med aeant=null kan planneren använda
  // ng1-filter på en mindre datamängd och sorten blir billig.
  let q = supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .eq("kommun", kommunCode)
    .eq("ng1", ng1)
    .gte("aeant", Math.max(0, opts.aeantMin ?? 0));
  if (opts.aeantMax && opts.aeantMax > 0) q = q.lte("aeant", opts.aeantMax);

  // Poäng primärt (betalkunder överst), sedan storlek, sedan cfarnr.
  const { data, error } = await q
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .range(from, to);
  if (error || !data) {
    console.error("listForetagInKommunByBransch", error);
    return { rows: [], hasMore: false, page, pageSize };
  }
  const rows = data as Partial<PublikRow>[];
  const hasMore = rows.length > pageSize;
  return {
    rows: rows.slice(0, pageSize).map(mapRow),
    hasMore,
    page,
    pageSize,
  };
}

/**
 * Slå upp branschid:n vars beskrivning matchar query.
 *
 * Tiered match — vi vill ha tighta resultat, inte över-inkludera:
 *   1. Exakt-match (case-insensitive): "byggmästare" → bara "Byggmästare"-rader
 *      (3 ids), skär bort "Partihandel med byggmaterial" m.fl.
 *   2. Om inga exakta: prefix-match ("byggm" → "Byggmästare", "Byggmaterial")
 *   3. Om inga prefix: substring-fallback (sista utvägen)
 *
 * Why: samma bransch ("Byggmästare") finns på flera SNI-koder (16231, 41200,
 * 43999) eftersom SCB:s mappning är 1→N. Vi vill matcha alla varianter med
 * samma namn men inte semantiskt olika branscher som råkar dela substräng.
 */
export async function findBranschIdsForQuery(
  query: string,
): Promise<{ ids: number[]; primaryName: string | null }> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return { ids: [], primaryName: null };

  const supa = getSupabaseAnon();
  // Escape % och _ för säker ilike
  const safe = cleaned.replace(/[%_]/g, " ").trim();
  const { data, error } = await supa
    .from("t_bransch")
    .select("branschid, beskrivning")
    .ilike("beskrivning", `%${safe}%`)
    .in("branschid", VARD_BRANSCHER)
    .limit(30);
  if (error || !data) return { ids: [], primaryName: null };

  const rows = (
    data as Array<{ branschid: number; beskrivning: string | null }>
  ).filter((r): r is { branschid: number; beskrivning: string } =>
    Boolean(r.beskrivning),
  );

  const lower = cleaned.toLowerCase();
  const exact = rows.filter((r) => r.beskrivning.toLowerCase() === lower);
  if (exact.length > 0) {
    return {
      ids: Array.from(new Set(exact.map((r) => r.branschid))),
      primaryName: exact[0]!.beskrivning,
    };
  }

  const prefix = rows.filter((r) =>
    r.beskrivning.toLowerCase().startsWith(lower),
  );
  if (prefix.length > 0) {
    return {
      ids: Array.from(new Set(prefix.map((r) => r.branschid))),
      primaryName: prefix[0]!.beskrivning,
    };
  }

  return {
    ids: Array.from(new Set(rows.map((r) => r.branschid))),
    primaryName: rows[0]?.beskrivning ?? null,
  };
}

/**
 * Smart fritextsök.
 *
 * Strategi:
 *   1. För enord (t.ex. "byggmästare") slå upp branschid:n i t_bransch.
 *   2. Om bransch-match finns: kör TVÅ parallella queries och slå ihop:
 *        A) ng1.in.(ids) — sorterat på aeant desc (största arbetsgivarna först)
 *        B) textSearch på search_vector — namn-träffar (t.ex. "Byggmästare AB"
 *           som inte ligger i en byggbransch-kod)
 *      Dedupa på cfarnr så samma arbetsställe inte syns två gånger.
 *   3. Annars ren textSearch på search_vector.
 *
 * Why aeant >= 2 (inte 1) för ng1.in()-queryn:
 *   PostgreSQLs partiella index på aeant exkluderar de allra vanligaste
 *   värdena (0, 1) eftersom de täcker majoriteten av raderna. Med
 *   aeant >= 1 tvingas planneren göra full scan av ng1-filtrerad delmängd
 *   och triggar statement_timeout för stora branscher (Byggmästare,
 *   Företagskonsulter m.fl.). aeant >= 2 håller sig inom indexet och
 *   svarar på ~500ms. Trade-off: solo-firmor (1 anställd) syns inte i
 *   bransch-resultaten — men de är ändå "brus" i en topp-N-vy som
 *   sorterar på storlek.
 */
export async function searchForetag(
  query: string,
  opts: {
    kommun?: string;
    lan?: string;
    postort?: string;
    ng1?: number;
    /**
     * Lista av ng1 (för kategori-sök från startsidan). Måste vara en delmängd
     * av VARD_BRANSCHER — kommer från vard-kategorier.ts. När detta finns
     * skippar vi bransch-uppslag på sökordet och filtrerar direkt på listan.
     */
    ng1List?: readonly number[];
    aeantMin?: number;
    aeantMax?: number;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ rows: Foretag[]; hasMore: boolean; page: number; pageSize: number; matchedBransch?: string | null }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize;
  const cleaned = query.trim();

  // När kategori-filter är aktivt och söktermen är tom — lista hela kategorin
  // sorterat på poang+aeant. Detta är "browse a category"-fallet från start-
  // sidans kategori-kort.
  if (opts.ng1List && opts.ng1List.length > 0 && cleaned.length < 2) {
    return runKategoriBrowse(opts.ng1List, opts, page, pageSize, from, to);
  }

  if (cleaned.length < 2) {
    return { rows: [], hasMore: false, page, pageSize };
  }

  // 1. Smart bransch-uppslag — endast för enord (annars riskerar vi att
  //    "Stockholm restaurang" hijackas av Restaurang-branschen och returnerar
  //    21000 träffar istället för den specifika krogen användaren letar efter).
  //    Hoppa även om kategori-filter är aktivt — kategorin styr bransch.
  const isSingleWord = !/\s/.test(cleaned);
  const branschInfo =
    !opts.ng1 && !opts.ng1List && isSingleWord
      ? await findBranschIdsForQuery(cleaned)
      : { ids: [] as number[], primaryName: null as string | null };

  if (branschInfo.ids.length > 0) {
    return runBranschSearch(cleaned, branschInfo, opts, page, pageSize, from, to);
  }

  // Ren fulltext-sökning (företagsnamn, multi-word, eller bransch saknas)
  return runTextSearch(cleaned, opts, page, pageSize, from, to);
}

/**
 * Browse en hel kategori utan söktext — t.ex. när användaren klickar på
 * kategori-kortet "HVB & Behandlingshem" på startsidan. Listar företag i
 * de ng1 som ingår i kategorin, sorterat på poäng (premium först) sedan
 * antal anställda.
 */
async function runKategoriBrowse(
  ng1List: readonly number[],
  opts: { kommun?: string; lan?: string; postort?: string; aeantMin?: number; aeantMax?: number },
  page: number,
  pageSize: number,
  from: number,
  to: number,
): Promise<{
  rows: Foretag[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  matchedBransch: null;
}> {
  const supa = getSupabaseAnon();
  // Använd aeant >= 2 av samma index-skäl som ng1.in()-queryn i runBranschSearch.
  const minAeant = Math.max(0, opts.aeantMin ?? 0);
  let q = supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .in("ng1", ng1List as number[])
    .gte("aeant", minAeant);
  q = applyGeoFilter(q, opts);
  if (opts.aeantMax && opts.aeantMax > 0) q = q.lte("aeant", opts.aeantMax);
  const { data, error } = await q
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .range(from, to);
  if (error || !data) {
    console.error("runKategoriBrowse", error);
    return { rows: [], hasMore: false, page, pageSize, matchedBransch: null };
  }
  const rows = data as Partial<PublikRow>[];
  const hasMore = rows.length > pageSize;
  return {
    rows: rows.slice(0, pageSize).map(mapRow),
    hasMore,
    page,
    pageSize,
    matchedBransch: null,
  };
}

async function runBranschSearch(
  cleaned: string,
  branschInfo: { ids: number[]; primaryName: string | null },
  opts: {
    kommun?: string;
    lan?: string;
    postort?: string;
    aeantMin?: number;
    aeantMax?: number;
  },
  page: number,
  pageSize: number,
  from: number,
  to: number,
): Promise<{
  rows: Foretag[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  matchedBransch: string | null;
}> {
  // Bransch-queryn kräver aeant >= 2 för att hålla sig inom partial-indexet
  // och svara snabbt. Användarens aeantMin höjs vid behov.
  const branschMin = Math.max(0, opts.aeantMin ?? 0);

  const supa = getSupabaseAnon();
  // Bransch-uppslaget ger redan ids från vård-whitelist (findBranschIdsForQuery
  // filtrerar mot VARD_BRANSCHER), men vi dubbel-konstraint:ar för säkerhet.
  let qA = supa.from(VIEW).select(COLUMNS_LIST).in("ng1", branschInfo.ids);
  qA = applyGeoFilter(qA, opts);
  qA = qA.gte("aeant", branschMin);
  if (opts.aeantMax && opts.aeantMax > 0) qA = qA.lte("aeant", opts.aeantMax);
  const branschQuery = qA
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .range(from, to);

  // Namn-sök kör vi bara på sida 1 — där tillför den nya träffar utöver
  // bransch-listan. På efterföljande sidor paginerar vi bransch-resultaten.
  // Måste filtreras på vård-whitelist så att "tand" inte drar in t.ex.
  // tandlagade möbler eller liknande namn-träffar utanför nischen.
  const wantNameSupplement = page === 1;
  const nameQuery = wantNameSupplement
    ? (() => {
        let qB = supa
          .from(VIEW)
          .select(COLUMNS_LIST)
          .textSearch("search_vector", cleaned, {
            type: "websearch",
            config: "swedish_unaccent",
          })
          .in("ng1", VARD_BRANSCHER);
        qB = applyGeoFilter(qB, opts);
        const nameMin = Math.max(0, opts.aeantMin ?? 0);
        qB = qB.gte("aeant", nameMin);
        if (opts.aeantMax && opts.aeantMax > 0) qB = qB.lte("aeant", opts.aeantMax);
        return qB
          .order("poang", { ascending: false, nullsFirst: false })
          .order("aeant", { ascending: false, nullsFirst: false })
          .order("cfarnr", { ascending: true })
          .limit(8);
      })()
    : null;

  // Sökord-sök: hitta cfarnr via sokordtable, hämta sedan från foretag_publik.
  const sokordQuery = wantNameSupplement ? searchSokordCfarnrs(cleaned) : Promise.resolve([] as number[]);

  const [branschRes, nameRes, sokordCfarnrs] = await Promise.all([
    branschQuery,
    nameQuery ?? Promise.resolve({ data: [] as Partial<PublikRow>[], error: null }),
    sokordQuery,
  ]);

  if (branschRes.error || !branschRes.data) {
    console.error("searchForetag branschQuery", branschRes.error);
    // Fallback: kör ren textSearch så användaren får något
    return runTextSearch(cleaned, opts, page, pageSize, from, to, branschInfo.primaryName);
  }

  const branschRows = branschRes.data as Partial<PublikRow>[];
  const nameRows =
    nameRes && !nameRes.error && nameRes.data ? (nameRes.data as Partial<PublikRow>[]) : [];

  const hasMoreFromBransch = branschRows.length > pageSize;
  const pageBransch = branschRows.slice(0, pageSize);
  const seen = new Set<number>(
    pageBransch.map((r) => r.cfarnr).filter((c): c is number => c != null),
  );
  const extras: Partial<PublikRow>[] = [];
  for (const r of nameRows) {
    if (r.cfarnr == null || seen.has(r.cfarnr)) continue;
    seen.add(r.cfarnr);
    extras.push(r);
  }

  // Sökord-träffar — hämta bara de cfarnr som inte redan visas
  if (sokordCfarnrs.length > 0) {
    const newCfarnrs = sokordCfarnrs.filter((c) => !seen.has(c)).slice(0, 8);
    if (newCfarnrs.length > 0) {
      const sokordRows = await fetchByCfarnrs(newCfarnrs, opts);
      for (const r of sokordRows) {
        if (r.cfarnr == null || seen.has(r.cfarnr)) continue;
        seen.add(r.cfarnr);
        extras.push(r);
      }
    }
  }

  // Bransch-träffar först, sedan namn + sökord-träffar (max upp till pageSize totalt)
  const merged = [...pageBransch, ...extras].slice(0, pageSize);

  return {
    rows: merged.map(mapRow),
    hasMore: hasMoreFromBransch,
    page,
    pageSize,
    matchedBransch: branschInfo.primaryName,
  };
}

async function runTextSearch(
  cleaned: string,
  opts: { kommun?: string; lan?: string; postort?: string; ng1?: number; aeantMin?: number; aeantMax?: number },
  page: number,
  pageSize: number,
  from: number,
  to: number,
  matchedBransch: string | null = null,
): Promise<{
  rows: Foretag[];
  hasMore: boolean;
  page: number;
  pageSize: number;
  matchedBransch: string | null;
}> {
  const supa = getSupabaseAnon();
  let q = supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .textSearch("search_vector", cleaned, {
      type: "websearch",
      config: "swedish_unaccent",
    })
    .in("ng1", VARD_BRANSCHER);
  q = applyGeoFilter(q, opts);
  // Användarens ng1-filter måste också ligga inom vård-whitelist.
  if (opts.ng1 && VARD_BRANSCHER_SET.has(opts.ng1)) q = q.eq("ng1", opts.ng1);
  q = q.gte("aeant", Math.max(0, opts.aeantMin ?? 0));
  if (opts.aeantMax && opts.aeantMax > 0) q = q.lte("aeant", opts.aeantMax);

  const textQuery = q
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .range(from, to);

  // Komplettera med sökord-träffar bara på sida 1
  const wantSokord = page === 1;
  const sokordQuery = wantSokord
    ? searchSokordCfarnrs(cleaned)
    : Promise.resolve([] as number[]);

  const [textRes, sokordCfarnrs] = await Promise.all([textQuery, sokordQuery]);

  if (textRes.error || !textRes.data) {
    console.error("searchForetag textSearch", textRes.error);
    return { rows: [], hasMore: false, page, pageSize, matchedBransch };
  }
  const rows = textRes.data as Partial<PublikRow>[];
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const seen = new Set<number>(
    pageRows.map((r) => r.cfarnr).filter((c): c is number => c != null),
  );

  const extras: Partial<PublikRow>[] = [];
  if (sokordCfarnrs.length > 0) {
    const newCfarnrs = sokordCfarnrs.filter((c) => !seen.has(c)).slice(0, 8);
    if (newCfarnrs.length > 0) {
      const sokordRows = await fetchByCfarnrs(newCfarnrs, opts);
      for (const r of sokordRows) {
        if (r.cfarnr == null || seen.has(r.cfarnr)) continue;
        seen.add(r.cfarnr);
        extras.push(r);
      }
    }
  }

  const merged = [...pageRows, ...extras].slice(0, pageSize);
  return {
    rows: merged.map(mapRow),
    hasMore,
    page,
    pageSize,
    matchedBransch,
  };
}

/**
 * Liknande företag — samma kommun + bransch, exklusive aktuellt.
 * Använder samma index-shortcut som listForetagInKommunByBransch.
 */
export async function listRelatedForetag(
  kommunCode: string,
  ng1: number,
  excludeCfarnr: number,
  limit = 6,
): Promise<Foretag[]> {
  // Guard — vi vill aldrig visa "liknande" från en bransch utanför nischen.
  if (!VARD_BRANSCHER_SET.has(ng1)) return [];
  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .eq("kommun", kommunCode)
    .eq("ng1", ng1)
    .neq("cfarnr", excludeCfarnr)
    .gte("aeant", 0)
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false })
    .order("cfarnr", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (data as Partial<PublikRow>[]).map(mapRow);
}

/**
 * Hitta ett enskilt företag via cfarnr — inkluderar tunga infotext-fält.
 *
 * Returnerar null om företaget ligger utanför vård-nischen, så att profil-
 * route:n får 404 istället för att läcka bygg-, restaurang- m.fl. företag
 * via direkta URL:er.
 */
export async function getForetagByCfarnr(cfarnr: number): Promise<Foretag | null> {
  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from(VIEW)
    .select(COLUMNS)
    .eq("cfarnr", cfarnr)
    .in("ng1", VARD_BRANSCHER)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error && error.code !== "PGRST116") console.error("getForetagByCfarnr", error);
    return null;
  }
  return mapRow(data as PublikRow);
}

/**
 * Hitta cfarnr som matchar en sökterm via sokordtable.
 *
 * sokordtable är cfarnr → sokord-mappning (~45k rader). Vi gör ilike-sök
 * och returnerar unika cfarnr. Anon har GRANT SELECT.
 *
 * Om sokordtable är RLS-skyddad utan policy returneras tom array. Det är
 * en mjuk fail — bransch + namn-sök fortsätter fungera.
 */
async function searchSokordCfarnrs(query: string): Promise<number[]> {
  const cleaned = query.trim();
  if (cleaned.length < 3) return []; // för kort → för många träffar
  const safe = cleaned.replace(/[%_]/g, " ").trim();

  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from("sokordtable")
    .select("cfarnr")
    .ilike("sokord", `%${safe}%`)
    .limit(40);
  if (error || !data) {
    if (error) console.warn("searchSokordCfarnrs (RLS?)", error.message);
    return [];
  }
  const ids = new Set<number>();
  for (const row of data as Array<{ cfarnr: number | null }>) {
    if (row.cfarnr != null) ids.add(row.cfarnr);
  }
  return Array.from(ids);
}

/**
 * Hämta alla sökord för ett enskilt företag (för profil-sidans
 * "Tjänster & sökord"-sektion). Cappar vid 50 unika strängar för att
 * hålla payload liten — bolag med produktkataloger kan ha 100+.
 */
export async function listSokordForCfarnr(cfarnr: number): Promise<string[]> {
  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from("sokordtable")
    .select("sokord")
    .eq("cfarnr", cfarnr)
    .not("sokord", "is", null)
    .limit(60);
  if (error || !data) {
    if (error) console.warn("listSokordForCfarnr", error.message);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of data as Array<{ sokord: string | null }>) {
    const s = (row.sokord ?? "").trim();
    if (!s) continue;
    // Case-insensitiv dedupe — behåll första casningen vi ser
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Hämta foretag_publik-rader för givna cfarnr-id:n med sortering &
 * normal filtrering. Använder COLUMNS_LIST.
 */
async function fetchByCfarnrs(
  cfarnrs: number[],
  opts: { kommun?: string; lan?: string; postort?: string; aeantMin?: number; aeantMax?: number },
): Promise<Partial<PublikRow>[]> {
  if (cfarnrs.length === 0) return [];
  const supa = getSupabaseAnon();
  let q = supa
    .from(VIEW)
    .select(COLUMNS_LIST)
    .in("cfarnr", cfarnrs)
    .in("ng1", VARD_BRANSCHER);
  q = applyGeoFilter(q, opts);
  if (opts.aeantMin && opts.aeantMin > 0) q = q.gte("aeant", opts.aeantMin);
  if (opts.aeantMax && opts.aeantMax > 0) q = q.lte("aeant", opts.aeantMax);
  const { data, error } = await q
    .order("poang", { ascending: false, nullsFirst: false })
    .order("aeant", { ascending: false, nullsFirst: false });
  if (error || !data) {
    if (error) console.warn("fetchByCfarnrs", error.message);
    return [];
  }
  return data as Partial<PublikRow>[];
}

/**
 * URL-slug för ett företag. cfarnr är ett internt SCB-id och inte
 * personuppgift — säkert att exponera i URL:en.
 */
export function foretagSlug(f: Pick<Foretag, "firma" | "namn" | "cfarnr">): string {
  const name = f.firma || f.namn || "foretag";
  const base = name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "foretag"}-${f.cfarnr}`;
}

/** Tolka cfarnr ur en företags-slug. */
export function parseCfarnrFromSlug(slug: string): number | null {
  const m = slug.match(/-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Slug för bransch-länk i kommun (kombinerar namn + ng1 för stabilitet). */
export function branschPageSlug(name: string, ng1: number): string {
  return `${branschSlug(name)}-${ng1}`;
}

/** Tolka ng1 ur bransch-slug. */
export function parseBranschSlug(slug: string): number | null {
  const m = slug.match(/-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
