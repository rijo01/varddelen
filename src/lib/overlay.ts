import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnon } from "./supabase";
import { getSupabaseAdmin } from "./supabase-admin";
import { branschPageSlug, foretagSlug } from "./queries";
import { VARD_BRANSCHER } from "./vard-branscher";
import { kommunByCode } from "./kommuner";
import { getBranschNamesBulk } from "./branscher";
import {
  CONTRACT_VERSION,
  arPubliktSynlig,
  publikOverlayMatch,
  verifieraPreviewToken,
  type EntityType,
  type OverlayProfilRow,
} from "./overlay-contract";

/**
 * Overlay-lagret: betald synlighet ovanpå read-only registerdata.
 *
 * Raderna ligger i SAJTENS egen databas (`overlay_profil`) och skrivs bara av
 * /api/overlay/publish. Sajten hämtar ALDRIG något från CRM:et — ligger CRM:et
 * nere renderar sidorna precis som vanligt, för allt vi behöver finns redan
 * här. Det är också det som gör sajten säljbar utan CRM:et.
 *
 * Källdata (`foretag_publik`, `aesamtable`, `sokordtable`) rörs ALDRIG av det
 * här lagret. Overlay äger affären; registret äger vem företaget är.
 *
 * DELAT KLUSTER: vårddelen, hantverkardelen och regionsdelen ligger i samma
 * Supabase-projekt och delar tabell. `sajt`-kolumnen skiljer raderna åt, och
 * VARJE query här filtrerar på den. En glömd `sajt`-filtrering skulle visa en
 * betald hantverkare som vårdgivare.
 *
 * LÄSREGEL: varje query filtrerar på status. Publik läsning går genom
 * publikOverlayMatch() (status = 'aktiv') plus arPubliktSynlig() för
 * giltighetstiden; förhandsvisningen filtrerar uttryckligen på 'utkast'. En
 * identitet kan ha TVÅ rader mellan förhandsvisning och publicering, och en
 * SELECT utan statusfilter skulle då kunna få utkastet — publikt.
 */

/** Sajtens namn i overlay-raderna. Måste matcha `sajter.slug` i CRM:et. */
export const SAJT = "varddelen";

export const OVERLAY_TABLE = "overlay_profil";

/** Sajtens egen bucket. Originallogotypen ligger kvar i CRM:ets crm-logos. */
export const LOGO_BUCKET = "overlay-logos";

/** Högsta kontraktsversion sajten kan ta emot. Högre payloads avvisas. */
export const STODD_CONTRACT_VERSION = CONTRACT_VERSION;

/**
 * TVÅ IDENTITETSNIVÅER, och båda behövs.
 *
 * Företagssidan är nycklad på cfarnr (/foretag/<namn>-<cfarnr>), alltså på
 * ARBETSSTÄLLET. Men ett bolag med tolv arbetsställen ska gå att sälja i ett
 * svep, och det är vad `bolag` är till för.
 *
 *   arbetsstalle → external_id = cfarnr → träffar EN företagssida
 *   bolag        → external_id = orgnr  → träffar ALLA arbetsställen med
 *                                          det orgnumret på sajten
 *
 * Finns båda för samma sida vinner arbetsstället: det mest specifika köpet är
 * det som beskriver just den här adressen.
 *
 * Nivåerna behövs också av ett tråkigare skäl. `foretag_publik` nollar `orgnr`
 * för enskild firma — där är källkolumnen ett personnummer, och vyn maskar bort
 * det av GDPR-skäl. En enskild firma har alltså INGET orgnr att sälja på, och
 * hade `bolag` varit enda nivån gick de inte att sälja alls.
 */
export const STODDA_ENTITY_TYPES: readonly EntityType[] = ["bolag", "arbetsstalle"];

/** Registervyn. Read-only härifrån, undantagslöst. */
const KATALOG_VY = "foretag_publik";

/**
 * Kolumn-allowlist. `preview_token` ingår ALDRIG i publik rendering — den är
 * en nyckel, inte data. Måste vara en enda strängliteral (supabase-js härleder
 * radtypen ur literalen; en konkatenering degraderar select()).
 */
const OVERLAY_COLUMNS =
  "id,sajt,entity_type,external_id,order_id,revision,payload_hash,status,giltig_from,giltig_till,featured,list_priority,keywords,logo_url,hemsida,telefon_override,epost_override,kontaktperson,adress_override,info_html,dolj_andra_nummer,preview_expires_at,contract_version,published_at,updated_at,popularnamn,telefon_typ,kategorier,adress_override_post,adress_override_besok,bas,skapa_om_saknas";

/** Samma allowlist plus token — ENDAST för förhandsvisningsuppslaget. */
const UTKAST_COLUMNS = `${OVERLAY_COLUMNS},preview_token` as const;

/** Loggas en gång, så en ej körd migration inte spammar hela bygget. */
let saknadTabellLoggad = false;

function hanteraFel(err: { message: string } | null): void {
  if (!err) return;
  if (!saknadTabellLoggad) {
    saknadTabellLoggad = true;
    console.warn(
      `[overlay] Kunde inte läsa ${OVERLAY_TABLE}: ${err.message}. ` +
        "Har lib/sql/overlay.sql och overlay-v1.1.sql körts i Supabase?",
    );
  }
}

/** YYYY-MM-DD i svensk lokaltid — samma dygnsgräns som giltig_till avser. */
export function idagISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

/** De två identiteter en registerrad kan bära. Ordningen är prioritetsordningen. */
export function identiteterFor(f: {
  cfarnr: number | null;
  orgnr: string | null;
}): Array<{ entity_type: EntityType; external_id: string }> {
  const ut: Array<{ entity_type: EntityType; external_id: string }> = [];
  if (f.cfarnr != null && f.cfarnr > 0) {
    ut.push({ entity_type: "arbetsstalle", external_id: String(f.cfarnr) });
  }
  // Orgnr normaliseras till enbart siffror — CRM:et lagrar det så, och
  // registret har både "556123-4567" och "5561234567" i omlopp.
  const orgnr = (f.orgnr ?? "").replace(/\D/g, "");
  if (orgnr.length >= 10) ut.push({ entity_type: "bolag", external_id: orgnr });
  return ut;
}

/**
 * Orgnumrets två skepnader.
 *
 * Overlay-nyckeln är rena siffror — så lagrar CRM:et det, och så normaliserar
 * identiteterFor(). Men REGISTRET lagrar `556033-9086`, med bindestreck. En
 * `.eq("orgnr", "5560339086")` mot `foretag_publik` träffar därför ingenting,
 * och ett bolagsköp hade revaliderat noll sidor och saknat förhandsvisningslänk
 * — utan att något såg trasigt ut.
 *
 * Båda formerna frågas alltså, alltid. Avläst mot riktiga rader 2026-09-16:
 * kolumnen bär bindestrecksformen.
 */
export function orgnrVarianter(externalId: string): string[] {
  const siffror = externalId.replace(/\D/g, "");
  if (siffror.length !== 10) return [externalId];
  const medBindestreck = `${siffror.slice(0, 6)}-${siffror.slice(6)}`;
  return Array.from(new Set([siffror, medBindestreck, externalId]));
}

// ── Uppslag för EN sida ─────────────────────────────────────────────────────

/**
 * Overlay för EN identitet — den AKTIVA och giltiga raden, eller null.
 *
 * Läses med anon-nyckeln: RLS släpper igenom status 'aktiv' och ingenting
 * annat, så även en bugg här kan inte visa ett utkast publikt.
 */
export async function getOverlay(
  entityType: EntityType,
  externalId: string,
): Promise<OverlayProfilRow | null> {
  if (!externalId) return null;

  const { data, error } = await getSupabaseAnon()
    .from(OVERLAY_TABLE)
    .select(OVERLAY_COLUMNS)
    .match(publikOverlayMatch(SAJT, { entity_type: entityType, external_id: externalId }))
    .maybeSingle();

  if (error) {
    hanteraFel(error);
    return null;
  }
  const rad = (data as unknown as OverlayProfilRow | null) ?? null;
  return rad && arPubliktSynlig(rad, idagISO()) ? rad : null;
}

/**
 * Overlay för en registerrad — båda nivåerna i EN rundtur, mest specifik vinner.
 *
 * En `.in()` på de två external_id:na i stället för två sekventiella uppslag:
 * företagssidan är den mest trafikerade sidtypen på sajten, och två rundturer
 * per sidvisning för en produkt som de allra flesta rader inte har köpt är ett
 * dåligt byte.
 *
 * Cachad per request: generateMetadata och sidan frågar båda, och de ska dela
 * ett uppslag — inte göra två.
 */
export const getOverlayForForetag = cache(async function getOverlayForForetag(f: {
  cfarnr: number | null;
  orgnr: string | null;
}): Promise<OverlayProfilRow | null> {
  const identiteter = identiteterFor(f);
  if (identiteter.length === 0) return null;

  const { data, error } = await getSupabaseAnon()
    .from(OVERLAY_TABLE)
    .select(OVERLAY_COLUMNS)
    .match(publikOverlayMatch(SAJT))
    .in("entity_type", identiteter.map((i) => i.entity_type))
    .in("external_id", identiteter.map((i) => i.external_id));

  if (error) {
    hanteraFel(error);
    return null;
  }

  const idag = idagISO();
  const rader = ((data ?? []) as unknown as OverlayProfilRow[]).filter((r) =>
    arPubliktSynlig(r, idag),
  );

  // `.in()` × `.in()` är en kryssprodukt: ett bolag vars orgnr råkar vara någon
  // annans cfarnr skulle matcha på fel nivå. Para ihop paren igen här.
  for (const id of identiteter) {
    const träff = rader.find(
      (r) => r.entity_type === id.entity_type && r.external_id === id.external_id,
    );
    if (träff) return träff;
  }
  return null;
});

// ── Listuppslag ─────────────────────────────────────────────────────────────

/**
 * Alla aktiva overlays på sajten, uppdelade per nivå.
 *
 * Cachad per request med React `cache()` så en listsida gör ETT uppslag även
 * när flera komponenter frågar. Ingen cache över requests: en publicering ska
 * synas direkt efter revalidate, inte när processen startas om.
 *
 * Hela mängden hämtas oberoende av vilka rader listan råkar visa. Det är
 * försvarbart just därför att detta är en SÅLD produkt: antalet aktiva rader
 * räknas i tiotal, inte tiotusental. Skulle det någon gång bli tusentals är
 * det här stället att byta strategi på.
 */
export const loadAktivaOverlays = cache(
  async (): Promise<OverlayLager> => {
    const lager: OverlayLager = { byCfar: new Map(), byOrgnr: new Map() };
    const { data, error } = await getSupabaseAnon()
      .from(OVERLAY_TABLE)
      .select(OVERLAY_COLUMNS)
      .match(publikOverlayMatch(SAJT))
      .in("entity_type", STODDA_ENTITY_TYPES as string[]);

    if (error) {
      hanteraFel(error);
      return lager;
    }
    const idag = idagISO();
    for (const rad of (data ?? []) as unknown as OverlayProfilRow[]) {
      if (!arPubliktSynlig(rad, idag)) continue;
      if (rad.entity_type === "arbetsstalle") lager.byCfar.set(rad.external_id, rad);
      else if (rad.entity_type === "bolag") lager.byOrgnr.set(rad.external_id, rad);
    }
    return lager;
  },
);

export interface OverlayLager {
  /** entity_type 'arbetsstalle' — nyckel är cfarnr som sträng. */
  byCfar: Map<string, OverlayProfilRow>;
  /** entity_type 'bolag' — nyckel är orgnr, enbart siffror. */
  byOrgnr: Map<string, OverlayProfilRow>;
}

/** Tomt lager. Används när overlay-uppslaget fallerar — sidan ska ändå renderas. */
export const TOMT_LAGER: OverlayLager = { byCfar: new Map(), byOrgnr: new Map() };

/**
 * Raden som gäller för en registerrad. Arbetsstället vinner över bolaget.
 *
 * REN funktion mot ett färdigladdat lager — därför testbar utan nycklar, och
 * därför går den att anropa en gång per rad i en lista utan att kosta något.
 */
export function overlayFor(
  f: { cfarnr: number | null; orgnr: string | null },
  lager: OverlayLager,
): OverlayProfilRow | null {
  for (const id of identiteterFor(f)) {
    const träff =
      id.entity_type === "arbetsstalle"
        ? lager.byCfar.get(id.external_id)
        : lager.byOrgnr.get(id.external_id);
    if (träff) return träff;
  }
  return null;
}

// ── Förhandsvisning ─────────────────────────────────────────────────────────

/**
 * Utkastraden bakom `?preview=<token>`, eller null.
 *
 * Token är signerad med sajtens egen hemlighet och bär sina anspråk själv:
 * identitet, revision och utgångstid. Vi litar alltså inte på databasen för att
 * avgöra om länken duger — vi räknar om signaturen och kontrollerar att
 * anspråken stämmer med raden vi hittade. En token för en annan identitet, för
 * en äldre revision, eller en som är över 24 timmar gammal ger null.
 *
 * Kräver service role: RLS visar aldrig utkast publikt. Använd ENDAST på en
 * noindex-sida.
 */
export async function getOverlayUtkast(
  entityType: EntityType,
  externalId: string,
  token: string | null | undefined,
): Promise<OverlayProfilRow | null> {
  if (!externalId || !token) return null;

  const secret = process.env.OVERLAY_PUBLISH_SECRET;
  if (!secret) {
    console.warn("[overlay] OVERLAY_PUBLISH_SECRET saknas — förhandsvisning avstängd");
    return null;
  }

  const anspråk = await verifieraPreviewToken(secret, token);
  if (!anspråk.ok) return null;
  if (anspråk.external_id !== externalId) return null;

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.warn("[overlay] SUPABASE_SERVICE_ROLE_KEY saknas — förhandsvisning avstängd");
    return null;
  }

  const { data, error } = await admin
    .from(OVERLAY_TABLE)
    .select(UTKAST_COLUMNS)
    .eq("sajt", SAJT)
    .eq("entity_type", entityType)
    .eq("external_id", externalId)
    .eq("status", "utkast")
    .maybeSingle();

  if (error) {
    hanteraFel(error);
    return null;
  }

  const rad = data as unknown as
    | (OverlayProfilRow & { preview_token: string | null })
    | null;
  if (!rad) return null;

  // Token måste vara DEN token raden bär, och gälla just den här revisionen.
  // Publiceras revision 4 slutar en länk för revision 3 att fungera.
  if (rad.preview_token !== token) return null;
  if (anspråk.revision !== rad.revision) return null;

  // Utkastet visas oavsett giltig_from/giltig_till — poängen är att se hur det
  // KOMMER att se ut, inte om avtalet löper just idag.
  const { preview_token: _token, ...utanToken } = rad;
  return utanToken as OverlayProfilRow;
}

/**
 * Utkastet för en registerrad, oavsett vilken nivå det köptes på.
 *
 * Företagssidan vet sitt cfarnr och sitt orgnr men inte vilken nivå säljaren
 * valde, så båda prövas — arbetsstället först, precis som i publik rendering.
 */
export async function getOverlayUtkastForForetag(
  f: { cfarnr: number | null; orgnr: string | null },
  token: string | null | undefined,
): Promise<OverlayProfilRow | null> {
  if (!token) return null;
  for (const id of identiteterFor(f)) {
    const rad = await getOverlayUtkast(id.entity_type, id.external_id, token);
    if (rad) return rad;
  }
  return null;
}

// ── Revalidering ────────────────────────────────────────────────────────────

/**
 * ALLA ytor en overlay-rad påverkar — det som endpointen revaliderar.
 *
 * Sajtens ytor: företagssidan, kommunsidan och kommun×bransch-sidan. `/sok`
 * finns MEDVETET inte med: söksidan är force-dynamic och har ingen cache att
 * rensa — att rapportera den som revaliderad vore att rapportera arbete som
 * inte utfördes.
 *
 * ETT BOLAGSKÖP KAN TRÄFFA MÅNGA SIDOR. `entity_type = 'bolag'` gäller varje
 * arbetsställe med det orgnumret, och var och ett har sin egen företagssida och
 * kan ligga i olika kommuner. Därför slås alla raderna upp, inte bara en.
 *
 * Slug och plats slås upp i registret, aldrig i overlay-raden: overlay äger
 * affären, källdatan äger var företaget hör hemma.
 */
export async function overlayRevalidatePaths(
  rad: Pick<OverlayProfilRow, "entity_type" | "external_id">,
  /** Route handlern skickar in sin egen klient (initierad per anrop). */
  klient: SupabaseClient = getSupabaseAnon(),
): Promise<string[]> {
  let q = klient.from(KATALOG_VY).select("cfarnr,firma,namn,kommun,ng1");
  q =
    rad.entity_type === "arbetsstalle"
      ? q.eq("cfarnr", Number(rad.external_id))
      : q.in("orgnr", orgnrVarianter(rad.external_id));

  const { data, error } = await q.limit(200);
  if (error || !data) return [];

  const rader = data as Array<{
    cfarnr: number | null;
    firma: string | null;
    namn: string | null;
    kommun: string | null;
    ng1: number | null;
  }>;

  // Branschnamnen hämtas i EN fråga. Ett bolagsköp kan träffa hundra
  // arbetsställen, och ett uppslag per rad hade gjort en publicering till
  // hundra rundturer mot databasen.
  const branschNamn = await getBranschNamesBulk(
    rader.map((r) => r.ng1).filter((n): n is number => n != null),
  );

  const paths = new Set<string>();

  // Sitemapen listar betalda profiler (se src/app/sitemap.ts). Routen tas med
  // för fullständighetens skull, men mätt mot produktion 2026-09-16 rör det
  // inte metadata-routens edge-cache — den verkliga uppdateringen sker via
  // sitemapens egen `revalidate`, inom en timme.
  paths.add("/sitemap.xml");

  for (const r of rader) {
    if (r.cfarnr == null) continue;
    paths.add(`/foretag/${foretagSlug({ firma: r.firma, namn: r.namn, cfarnr: r.cfarnr })}`);

    const kommun = r.kommun ? kommunByCode(r.kommun) : undefined;
    if (!kommun) continue;
    paths.add(`/kommun/${kommun.slug}`);
    const bransch = r.ng1 != null ? branschNamn.get(String(r.ng1)) : undefined;
    if (bransch && r.ng1 != null) {
      paths.add(`/kommun/${kommun.slug}/${branschPageSlug(bransch, r.ng1)}`);
    }
  }
  return [...paths];
}

// ── Indexerbarhet ───────────────────────────────────────────────────────────

/**
 * Sidorna som en BETALD PROFIL gör indexerbara, som sitemap-sökvägar.
 *
 * VARFÖR DEN HÄR FUNKTIONEN FINNS, och varför den är ett runtime-uppslag och
 * inte en post i src/data/indexable.json:
 *
 * Vårddelens indexerbarhet byggde på ett förberäknat urval — 737 av 35 528
 * företagssidor — och en overlay-kund utanför det urvalet fick en publicerad,
 * betald profil på en sida märkt `noindex, follow`. Kunden betalar för
 * synlighet i Google och fick en sida som uttryckligen bad Google att inte
 * visa den. Det är inte en avvägning, det är en produkt som inte levereras.
 *
 * En post i snapshoten hade inte räckt: snapshoten byggs av
 * scripts/build-index-set.mjs och fryses vid deploy, så varje ny kund hade
 * legat noindex ända till nästa bygge. "Aldrig" tål inte ett sådant fönster.
 *
 * Invarianten som hela indexability.ts vilar på — att SAMMA regel driver både
 * robots-metan och sitemapen — hålls därför genom att båda frågar overlay:
 * robotsForForetagMedOverlay() på sidan, den här funktionen i sitemapen.
 *
 * NISCHGRINDEN GÄLLER FORTFARANDE. getForetagByCfarnr() filtrerar på
 * VARD_BRANSCHER och 404:ar allt utanför; en URL i sitemapen som svarar 404
 * vore ett sämre fel än det vi just löste. Därför samma filter här.
 */
export async function overlayIndexerbaraSokvagar(): Promise<string[]> {
  const lager = await loadAktivaOverlays();

  // Bara rader som faktiskt BÄR något. En tom overlay-rad gör inte en naken
  // registerrad värd att indexera — då är vi tillbaka i tunt innehåll.
  const cfarnr: string[] = [];
  const orgnr: string[] = [];
  for (const [nyckel, rad] of lager.byCfar) {
    if (harInnehall(rad)) cfarnr.push(nyckel);
  }
  for (const [nyckel, rad] of lager.byOrgnr) {
    if (harInnehall(rad)) orgnr.push(nyckel);
  }
  if (cfarnr.length === 0 && orgnr.length === 0) return [];

  const klient = getSupabaseAnon();
  const träffar: Array<{ cfarnr: number | null; firma: string | null; namn: string | null }> = [];

  if (cfarnr.length > 0) {
    const { data } = await klient
      .from(KATALOG_VY)
      .select("cfarnr,firma,namn")
      .in("cfarnr", cfarnr.map(Number))
      .in("ng1", VARD_BRANSCHER);
    träffar.push(...((data ?? []) as typeof träffar));
  }

  if (orgnr.length > 0) {
    // Ett bolagsköp gäller varje arbetsställe med det orgnumret. Båda
    // orgnr-formerna frågas — registret lagrar bindestrecksvarianten.
    const former = orgnr.flatMap(orgnrVarianter);
    const { data } = await klient
      .from(KATALOG_VY)
      .select("cfarnr,firma,namn")
      .in("orgnr", former)
      .in("ng1", VARD_BRANSCHER)
      .limit(500);
    träffar.push(...((data ?? []) as typeof träffar));
  }

  const ut = new Set<string>();
  for (const r of träffar) {
    if (r.cfarnr == null) continue;
    ut.add(`/foretag/${foretagSlug({ firma: r.firma, namn: r.namn, cfarnr: r.cfarnr })}`);
  }
  return [...ut];
}

/** Bär raden något besökaren faktiskt kan läsa? */
function harInnehall(rad: OverlayProfilRow): boolean {
  return Boolean(
    rad.info_html ||
      rad.hemsida ||
      rad.logo_url ||
      (rad.keywords?.length ?? 0) > 0 ||
      (rad.kategorier?.length ?? 0) > 0,
  );
}
