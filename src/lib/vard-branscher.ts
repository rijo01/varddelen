import { AR_PILOT } from "./datakalla";

/**
 * Vårddelen — nischfilter.
 *
 * Whitelist över SCB-branschid (ng1) som räknas som "vård & omsorg" på
 * denna sajt. Alla företagsqueries i src/lib/queries.ts och route-handlers
 * MÅSTE filtrera mot denna lista så att vi aldrig läcker bygg-, restaurang-
 * eller annan brus-bransch in i Vårddelens katalog.
 *
 * Källa: kuraterad av Rickard 2026-05-24 (initial scope för varddelen.se).
 * Justering: lägg till/ta bort branschid här — ingen annan plats behöver
 * röras, eftersom alla call-sites importerar VARD_BRANSCHER och
 * VARD_BRANSCHER_SET härifrån.
 */

/** Klustret (SNI 2007). Gäller när NEXT_PUBLIC_DATAKALLA inte är "pilot". */
export const VARD_BRANSCHER_KLUSTER: readonly number[] = [
  87201, // Boende med särskild service för personer med utvecklingsstörning
  87901, // Heldygnsvård med boende för barn och ungdomar med sociala problem
  87203, // Boende med särskild service för personer med psykiska funktionshinder
  88991, // Öppna sociala insatser för vuxna med missbruksproblem
  87100, // Vård och omsorg i särskilda boendeformer för äldre personer
  88992, // Övriga öppna sociala insatser
  87902, // Heldygnsvård med boende för vuxna med missbruksproblem
  87202, // Boende för personer med fysiska funktionshinder
  86230, // Tandläkarverksamhet
  86904, // Tandläkare (DB t_bransch.beskrivning — folktandvården m.fl. ligger här)
  86211, // Specialistläkarverksamhet vid sjukhus
  86212, // Specialistläkarverksamhet, ej vid sjukhus
  86905, // Sluten sjukvård, ej på sjukhus
  86909, // Övrig hälso- och sjukvård
  86102, // Specialiserad slutenvård
  86903, // Medicinsk laboratorieverksamhet m.m.
  86103, // Rehabilitering på sjukhus
  86222, // Specialistläkarverksamhet inom hudsjukvård
  86221, // Specialistläkarverksamhet inom kirurgi
  87302, // Vård och omsorg i särskilda boendeformer för funktionshindrade
  88101, // Öppna sociala insatser för äldre personer (hemtjänst) — bara privata, se nedan
  88102, // Öppna sociala insatser för personer med funktionshinder (personlig assistans m.m.) — bara privata
  88910, // Dagbarnvård och förskoleverksamhet (omsorg)
  86902, // Ambulans & sjuktransport. Tidigare kommenterad som "sjukgymnaster",
         // men mätt 21 okt 2026: av 176 verksamheter har 61 ambulans/sjuktransport
         // i namnet och ingen sjukgymnast/fysioterapi; resten är mest regioner.
  // Borttagna 2026-05-24 — båda labeled "Kroppsvård" i t_bransch
  // (gym/massage/frisör/solarium), hör inte hemma i en vårdkatalog:
  //   - branschid 96040
  //   - branschid 85510 (SCB-namn är "Sport- och fritidsutbildning" men i
  //     denna DB ligger samma typ av skönhetsverksamhet som 96040 här)
  // Borttagna 2026-05-26 — offentlig förvaltning, inte vårdgivare:
  //   - 84123  Offentlig förvaltning av vård och omsorg
  //            (drog in landsting/kommuner som "vårdföretag" — Malmö kommun,
  //            Västra Götalands läns landsting m.fl.)
  //   - 84124  Offentlig förvaltning av utbildning, kultur och socialt skydd
  //            (drog in Stockholms kommun 1 602 anst som "vårdföretag")
  2,     // Företagshälsovård (verifierat via t_bransch)
  56293, // Catering för catering till äldreomsorg m.m.
  47730, // Apotek
  47740, // Specialiserad butikshandel med medicinska och ortopediska artiklar
  46460, // Partihandel med farmaceutiska produkter
];

/**
 * Piloten (SNI 2025, arbetsstalle.sni_primar). Samma lista som VARD_SNI i
 * infofinder-enrichment/scripts/mata_varddelen.py — ändras de, ändras båda.
 *
 * SCB:s officiella nyckel SNI 2007 → SNI 2025 tillämpad på listan ovan, med
 * Rickards beslut 2026-11-04: 85100 och 86960 bort, 87301 med, intern kod 2
 * (Företagshälsovård) bort — SCB klassar den som 86212 eller 86999.
 * Benämningarna är SCB:s.
 */
export const VARD_BRANSCHER_PILOT: readonly number[] = [
  86102, // Specialiserad sluten somatisk hälso- och sjukvård på sjukhus
  86103, // Specialiserad sluten psykiatrisk hälso- och sjukvård på sjukhus
  86211, // Primärvårdsmottagningar med läkare m.m.
  86212, // Annan allmän öppen hälso- och sjukvård, ej primärvård
  86221, // Specialistläkarverksamhet inom öppenvård, på sjukhus
  86222, // Specialistläkarverksamhet inom öppenvård, ej på sjukhus
  86230, // Tandläkarverksamhet
  86920, // Ambulanstransporter och ambulanssjukvård
  86930, // Psykologi- och psykoterapiverksamhet, utom läkare
  86940, // Sjuksköterske- och barnmorskeverksamhet
  86950, // Fysioterapeutisk verksamhet
  86991, // Tandhygienistverksamhet
  86999, // Annan övrig hälso- och sjukvård
  87100, // Boende med sjuksköterskevård
  87201, // Boende med särskild service för personer med psykisk funktionsnedsättning
  87202, // Boende med särskild service för barn och ungdomar med missbruksproblem
  87203, // Boende med särskild service för vuxna med missbruksproblem
  87301, // Vård och omsorg i särskilda boendeformer för äldre personer
  87302, // Vård och omsorg i särskilda boendeformer för personer med fysisk funktionsnedsättning
  87991, // Heldygnsvård med boende för barn och ungdomar med sociala problem
  87992, // Omsorg och sociala insatser i övriga boendeformer för vuxna
  88101, // Öppna sociala insatser för äldre personer — bara privata
  88102, // Öppna sociala insatser för personer med funktionsnedsättning — bara privata
  88910, // Dagbarnvård
  88991, // Öppna sociala insatser för barn och ungdomar med sociala problem
  88992, // Öppna sociala insatser för vuxna med missbruksproblem
  46460, // Partihandel med medicinsk utrustning och apoteksvaror
  47731, // Detaljhandel med apoteksvaror, utom via internet eller postorder
  47732, // Detaljhandel via internet eller postorder med apoteksvaror
  47741, // Detaljhandel med medicinska och ortopediska artiklar, utom glasögon och andra optiska artiklar
  56222, // Centralköksverksamhet för sjukhus, skolor, omsorgs- och andra institutioner
];

/** Listan sajten filtrerar på — vald av datakällan (lib/datakalla.ts). */
export const VARD_BRANSCHER: readonly number[] = AR_PILOT ? VARD_BRANSCHER_PILOT : VARD_BRANSCHER_KLUSTER;

/**
 * Branscher där bara privata utförare hör hemma i katalogen.
 *
 * I 88101/88102 är majoriteten kommunernas egen hemtjänst och LSS-verksamhet
 * (mätt 21 okt 2026: 2 357 av 3 783 rader har juridisk form 81–84, t.ex.
 * "STOCKHOLMS KOMMUN" en gång per hemtjänstområde). Samma skäl som när
 * 84123/84124 togs bort i maj: kommuner är inte vårdföretag. Kvar blir 1 426
 * privata utförare. Rader utan juridisk form behålls — alla 18 är privata
 * (Hemi Hemtjänst AB, Aman Care AB m.fl.).
 *
 * Övriga branscher påverkas inte: regioner under t.ex. 86902 ligger kvar som
 * förut.
 */
export const ENDAST_PRIVATA_BRANSCHER: readonly number[] = [88101, 88102];
/** 81 Statlig enhet, 82 Kommun, 83 Kommunalförbund, 84 Region. */
export const OFFENTLIGA_JURFORMER: readonly string[] = ["81", "82", "83", "84"];

/**
 * PostgREST-villkor att lägga på VARJE fråga mot foretag_publik bredvid
 * .in("ng1", VARD_BRANSCHER): "inte en av de privata-branscherna, eller inte
 * offentlig juridisk form, eller okänd form".
 */
export const NISCH_JURFORM_VILLKOR = `ng1.not.in.(${ENDAST_PRIVATA_BRANSCHER.join(",")}),jurform.not.in.(${OFFENTLIGA_JURFORMER.join(",")}),jurform.is.null`;

/** Set-version för O(1) lookup vid guard-kontroller. */
export const VARD_BRANSCHER_SET: ReadonlySet<number> = new Set(VARD_BRANSCHER);

/** True om branschid (ng1) tillhör vård/omsorgs-nischen. */
export function isVardBransch(ng1: number | null | undefined): boolean {
  if (ng1 == null) return false;
  return VARD_BRANSCHER_SET.has(ng1);
}
