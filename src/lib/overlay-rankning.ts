import type { OverlayProfilRow } from "./overlay-contract";
import { overlayFor, type OverlayLager } from "./overlay";

/**
 * Listordningen — REN logik, ingen databas.
 *
 * Egen fil just för att gå att resonera om och testa utan nycklar: ordningen i
 * en träfflista är det som avgör om en betald placering faktiskt levereras.
 *
 * TVÅ BETALLAGER SAMTIDIGT, och allt här måste känna båda:
 *
 *   • `poang` i registret — det ÄLDRE lagret. Sätts direkt på raden i
 *     `foretag_publik` och driver redan sajtens `isFeatured()` och varje
 *     `.order("poang", ...)` i queries.ts.
 *   • overlay — CRM:ets publicering.
 *
 * En overlay-kund som bara syntes i det ena lagret hade rankats som ett
 * gratisföretag, och då är produkten inte såld.
 */

/** Det registret redan kallar en kund. Bevaras oförändrat. */
function harPoang(f: { poang: number | null }): boolean {
  return (f.poang ?? 0) > 0;
}

/** Är företaget kund — i något av lagren? */
export function arKund(
  f: { cfarnr: number | null; orgnr: string | null; poang: number | null },
  lager: OverlayLager,
): boolean {
  return harPoang(f) || overlayFor(f, lager) != null;
}

/**
 * Vikten inom kundsegmentet: `featured desc, list_priority desc`.
 *
 * Returnerar 0 när raderna väger lika — då tar sajtens ordinarie sortering
 * (poang, aeant, cfarnr) vid, oförändrad.
 */
export function jamforOverlayVikt(
  a: { cfarnr: number | null; orgnr: string | null },
  b: { cfarnr: number | null; orgnr: string | null },
  lager: OverlayLager,
): number {
  const oa = overlayFor(a, lager);
  const ob = overlayFor(b, lager);
  const fa = oa?.featured ? 1 : 0;
  const fb = ob?.featured ? 1 : 0;
  if (fa !== fb) return fb - fa;
  return (ob?.list_priority ?? 0) - (oa?.list_priority ?? 0);
}

/**
 * Lägg overlay-vikten ovanpå en redan sorterad lista.
 *
 * `Array.prototype.sort` är stabil, så fallbackens ordning överlever oavgjorda
 * jämförelser: ett företag utan featured/list_priority hamnar exakt där det
 * hade hamnat utan overlay-lagret. Det är hela poängen — overlay ska lyfta det
 * som köpts, inte kasta om listan.
 *
 * RÄCKVIDDEN ÄR SIDAN, INTE TRÄFFMÄNGDEN, och det ska sägas rakt ut: raderna
 * kommer redan paginerade från PostgREST (`.range(from, to)`), så en featured
 * kund som DB-ordningen lagt på sidan 3 lyfts till toppen av sidan 3 — inte
 * till sidan 1. Så fungerar också åkeriguidens ordnaBoostade().
 *
 * Det är rätt avvägning så länge kunder också har `poang` i registret, för
 * `poang` sorteras i databasen och avgör alltså vilken sida de hamnar på. Ska
 * en overlay-kund UTAN poang garanterat nå sidan 1 måste lyftet ske i frågan,
 * inte här. Se OVERLAY.md, "Vad lyftet inte gör".
 */
export function ordnaBoostade<T extends { cfarnr: number | null; orgnr: string | null }>(
  rader: T[],
  lager: OverlayLager,
): T[] {
  return [...rader].sort((a, b) => jamforOverlayVikt(a, b, lager));
}

/**
 * Kundens EGNA ord om vad de gör.
 *
 * Overlay-radens `keywords` är samma sorts uppgift som `sokordtable.sokord`
 * och ska väga likadant. Overlay vinner där båda finns — samma rangordning som
 * på företagssidan och i kortet.
 */
export function kundensSokord(
  f: { cfarnr: number | null; orgnr: string | null },
  lager: OverlayLager,
  registretsSokord: string[],
): string[] {
  const ov = overlayFor(f, lager);
  if (ov?.keywords?.length) return ov.keywords;
  return registretsSokord;
}

/**
 * Har företaget något att visa utöver den nakna registerraden?
 *
 * Komplement till `foretagHarSubstans()` i seo.ts, som bara känner registret.
 * En overlay-kund har per definition substans: de har lämnat en beskrivning,
 * en hemsida eller sökord. Utan det här skulle en betald profil kunna ligga
 * kvar som `noindex` — sålt, publicerat och osynligt i Google.
 */
export function overlayGerSubstans(rad: OverlayProfilRow | null): boolean {
  if (!rad) return false;
  return Boolean(
    rad.info_html ||
      rad.hemsida ||
      rad.logo_url ||
      (rad.keywords?.length ?? 0) > 0 ||
      (rad.kategorier?.length ?? 0) > 0,
  );
}
