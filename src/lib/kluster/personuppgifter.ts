/**
 * Personuppgifter i registret — EN regel, för varje yta.
 *
 * Registret (`aesamtable` via `foretag_publik`) är ett uttag från omkring
 * 2008–2011. Numren i det är enligt DE.82 interna (skiffer-crm README,
 * GDPR-regeln): de får användas i CRM:ets ringläge men visas aldrig publikt
 * (beslut 2026-11-01, strikt tolkning). Det här lagret tar bort:
 *
 *   - VARJE telefonnummer ur registret, fast som mobilt — telefon visas bara
 *     från kunder och overlay-profiler
 *   - e-postadresser hos privata leverantörer (hotmail, gmail, telia …)
 *   - kontaktperson — ett namngivet personnamn från 2011
 *   - samma nummer och adresser i fritext (infotext, sökord)
 *   - en enskild firmas personnamn ("BRINK, STEFAN") när firman saknar
 *     firmanamn — den visas som "Enskild firma i <ort>"
 *
 * UNDANTAGNA är kunderna. En rad med `poang > 0` är en kund ur det gamla
 * betalsystemet: uppgifterna är dem kunden själv lämnade för att synas, och
 * de profilerna ska fungera precis som förut. Overlay-profiler (CRM:ets köp)
 * ligger i ett eget lager och passerar aldrig den här funktionen.
 *
 * Källan rörs aldrig. Allt sker vid läsning (queries.ts → mapRow), efter
 * kontaktspärren, så en återimport av registret kan inte få tillbaka något.
 *
 * Beroendefri med flit: CompanyCard och /api/suggest ska kunna använda samma
 * regel utan att dra in server-only-moduler, och filen ska vara identisk på
 * alla klustrets sajter (se README.md i den här katalogen).
 */

/** Enskild firma (10), enkelt bolag (21), oskiftat dödsbo (91): orgnr = personnummer. */
function arPersonligJurform(jurform: number | null | undefined): boolean {
  return jurform === 10 || jurform === 21 || jurform === 91;
}

/** En kund ur det gamla betalsystemet. Deras egna uppgifter rörs inte. */
export function arKund(f: { poang?: number | null }): boolean {
  return (f.poang ?? 0) > 0;
}

// ---- Telefon ---------------------------------------------------------------

/**
 * Är numret ett svenskt mobilnummer? Mobilserierna är 070, 072, 073, 076 och
 * 079. 077x (servicenummer) och 074x räknas inte.
 */
export function arMobilnummer(tel: string | null | undefined): boolean {
  if (!tel) return false;
  const siffror = tel.replace(/[^\d+]/g, "");
  return /^(?:0|\+46|0046)7[02369]\d{7}$/.test(siffror);
}

/**
 * Mobilnummer i löptext. Tål registrets alla skrivsätt: "070-123 45 67",
 * "070 - 1234567", "+46 70 123 45 67", "0701234567". Kräver exakt sju
 * siffror efter 07x så att ett postnummer, ett organisationsnummer eller ett
 * 0771-nummer inte fångas.
 */
const MOBIL_I_TEXT = /(?<![\d+])(?:(?:\+46|0046)[\s-]*\(?0?\)?\s*|0)7[02369](?:[\s\-/.]*\d){7}(?!\d)/g;

/**
 * Vilket svenskt telefonnummer som helst i löptext, fast eller mobilt:
 * "08-123 45 67", "031 - 12 34 56", "0480-123 45", "+46 8 123 456". Kräver
 * inledande 0 eller landsnummer och 7–10 siffror totalt efter nollan, så att
 * postnummer ("123 45") och organisationsnummer ("556948-3141") inte fångas.
 */
const TELEFON_I_TEXT = /(?<![\d+])(?:(?:\+46|0046)[\s-]*\(?0?\)?\s*|0)[1-9](?:[\s\-/.()]*\d){6,9}(?![\d-])/g;

// ---- E-post ----------------------------------------------------------------

/**
 * E-posttjänster för privatpersoner — webbmejl och internetleverantörernas
 * adresser. En adress på företagets egen domän är företagets och ligger kvar.
 */
const PRIVATA_EPOSTDOMANER = [
  "hotmail", "gmail", "googlemail", "yahoo", "ymail", "live", "outlook", "msn",
  "icloud", "me", "mac", "aol", "gmx", "yandex", "protonmail", "proton", "mail",
  "telia", "spray", "bredband", "bredband2", "bbb", "comhem", "tele2", "tele2sverige",
  "passagen", "swipnet", "glocalnet", "home", "telenordia", "tiscali", "algonet",
  "chello", "bahnhof", "ownit", "euromail", "tdcnet", "privat", "jippii",
  "boxer", "telenor", "bostream",
];
const PRIVAT_DOMAN = new RegExp(
  `@(?:[\\w-]+\\.)*(?:${PRIVATA_EPOSTDOMANER.join("|")})\\.[a-z]{2,4}$`,
  "i",
);

export function arPrivatEpost(epost: string | null | undefined): boolean {
  const e = epost?.trim();
  if (!e || !e.includes("@")) return false;
  return PRIVAT_DOMAN.test(e);
}

const EPOST_I_TEXT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// ---- Fritext ---------------------------------------------------------------

/**
 * Tar bort telefonnummer (alla, DE.82) och privata e-postadresser ur fritext.
 * Företagets egna e-postadresser står kvar. Returnerar null för en text som
 * blir tom.
 */
export function skrubbaFritext(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  const ut = text
    .replace(MOBIL_I_TEXT, "")
    .replace(TELEFON_I_TEXT, "")
    .replace(EPOST_I_TEXT, (m) => (arPrivatEpost(m) ? "" : m));
  return ut.trim() ? ut : null;
}

/**
 * Innehåller texten ett telefonnummer eller en privat e-postadress? Används
 * för sökord och för sökfrågor, så att ett nummer inte kan slås upp baklänges.
 */
export function harPrivatKontakt(text: string | null | undefined): boolean {
  if (!text) return false;
  MOBIL_I_TEXT.lastIndex = 0;
  TELEFON_I_TEXT.lastIndex = 0;
  if (MOBIL_I_TEXT.test(text) || TELEFON_I_TEXT.test(text)) return true;
  return (text.match(EPOST_I_TEXT) ?? []).some(arPrivatEpost);
}

// ---- Namn ------------------------------------------------------------------

/** Ord som visar att namnet är ett bolags, inte en persons. */
const BOLAGSORD =
  /\b(AB|HB|KB|AKTIEBOLAG|HANDELSBOLAG|KOMMANDITBOLAG|F(Ö|O)RENING|STIFTELSE|BYGG|EL|VVS|M(Å|A)LERI|SNICKERI|SERVICE|TJ(Ä|A)NST)\b/i;

type NamnRad = {
  firma: string | null;
  namn: string | null;
  jurform: number | null;
  poang?: number | null;
};

/**
 * Är radens enda namn en privatpersons namn?
 *
 * En enskild firma utan registrerat firmanamn heter i registret som ägaren,
 * "EFTERNAMN, FÖRNAMN". Har firman ett eget namn ("INGEMARS GLASERI") är det
 * firmanamnet som visas, och då gäller ingenting här.
 *
 * Bara namn med registrets personform, "EFTERNAMN, FÖRNAMN", räknas. Rader
 * utan jurform räknas dessutom bara när namnet saknar bolagsord.
 */
export function arPersonnamn(f: NamnRad): boolean {
  if (arKund(f)) return false;
  if (f.firma?.trim()) return false;
  const namn = f.namn?.trim();
  if (!namn) return false;
  // Registret skriver en person "EFTERNAMN, FÖRNAMN". Ett namn utan den formen
  // ("MÅLERI JAN LUNDBERG") är ett firmanamn, även när fältet heter namn.
  if (!PERSONNAMNSFORM.test(namn)) return false;
  if (arPersonligJurform(f.jurform)) return true;
  if (f.jurform != null) return false;
  return !BOLAGSORD.test(namn);
}

const PERSONNAMNSFORM = /^[^,\d]+,\s*[^,\d]+$/;

/** "KUNGÄLV" → "Kungälv". */
function ortnamn(postort: string | null | undefined): string | null {
  const s = postort?.trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, f: string, c: string) => f + c.toUpperCase());
}

/**
 * Får en NAMNSÖKNING träffa raden?
 *
 * `search_vector` innehåller registrets namn. För en enskild firma utan
 * firmanamn är det ägarens namn, så en sökning på "skogsberg" hittade den
 * maskerade firman och kopplade ihop personen med firman — fast namnet aldrig
 * visades. En sådan rad får bara hittas på firmanamnet, och den har inget.
 * Den hittas därför aldrig på namn, bara via bransch, ort och sökord.
 *
 * Används på varje träff från en textsökning mot search_vector (söksidan och
 * sökförslagen), efter frågan och före visning.
 */
export function namnsokFarTraffa(f: NamnRad): boolean {
  return !arPersonnamn(f);
}

/** Namnet en enskild firma utan firmanamn visas med. */
export function enskildFirmaNamn(postort: string | null | undefined): string {
  const ort = ortnamn(postort);
  return ort ? `Enskild firma i ${ort}` : "Enskild firma";
}

/**
 * Raden med personnamnet ersatt. `firma` får visningsnamnet och `namn` blir
 * null, så att varje yta — rubrik, lista, slug, JSON-LD — får samma sak utan
 * att behöva känna till regeln.
 */
export function publiktNamn<T extends NamnRad & { postort?: string | null }>(
  f: T,
): T {
  if (!arPersonnamn(f)) return f;
  return { ...f, firma: enskildFirmaNamn(f.postort), namn: null };
}

/**
 * Sluggens namndel. En personnamnsrad får en slug utan namn —
 * "/foretag/enskild-firma-12345" — så att personnamnet inte står i en länk på
 * en indexerad sida. Ortnamnet tas inte med: sluggen ska bara bero på det
 * cfarnr-routen ändå matchar på, och på namnregeln.
 */
export function slugNamn(f: NamnRad): string | null {
  if (arPersonnamn(f)) return "enskild firma";
  return f.firma || f.namn || null;
}

// ---- Hela raden ------------------------------------------------------------

type KontaktRad = NamnRad & {
  postort?: string | null;
  tel: string | null;
  epostadress: string | null;
  infotext?: string | null;
  kontaktperson?: string | null;
};

/**
 * Registerraden som den får visas. Kunder (`poang > 0`) passerar orörda.
 * För alla andra visas inget telefonnummer ur registret (DE.82).
 */
export function rensaRegisterrad<T extends KontaktRad>(f: T): T {
  if (arKund(f)) return f;
  const ut: T = {
    ...publiktNamn(f),
    tel: null,
    epostadress: arPrivatEpost(f.epostadress) ? null : f.epostadress,
  };
  if ("infotext" in f) ut.infotext = skrubbaFritext(f.infotext);
  if ("kontaktperson" in f) ut.kontaktperson = null;
  return ut;
}

/** Sökord ur sokordtable: för en icke-kund faller ord som bär en privat uppgift bort. */
export function rensaSokord(ord: string[], kund: boolean): string[] {
  if (kund) return ord;
  return ord.filter((o) => !harPrivatKontakt(o));
}
