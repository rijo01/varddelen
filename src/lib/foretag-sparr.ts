import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "./supabase-admin";
import { getSupabaseAnon } from "./supabase";
import { SAJT } from "./overlay";
import { SPARR_TABELL, arSparradRad } from "./overlay-contract";

/**
 * Raderade bolag (kontrakt 1.6, "Ta bort företag").
 *
 * Ett bolag som begärt att försvinna ska vara borta från sajten, men basraden
 * står kvar i klustret — `foretag_publik` och `aesamtable` är read-only. Sajten
 * minns därför själv vilka bolag som är borta, i `overlay_foretag_sparr`
 * (lib/sql/overlay-radera.sql). Raderna skrivs bara av DELETE
 * /api/overlay/<nyckel>, och läses HÄR:
 *
 *   profilsidan                      → 404
 *   listor, sök, liknande, sitemap   → raden filtreras bort
 *   /api/suggest                     → raden filtreras bort
 *
 * Nyckeln är CRM:ets identitet: orgnr (tio siffror), `cfar-<nr>` eller
 * `ef-<24 hex>`. En orgnr-nyckel tar med sig ALLA bolagets arbetsställen — se
 * arSparradRad() i kontraktet, som är den enda regeln här.
 *
 * TÅL ATT TABELLEN SAKNAS. SQL:en körs efter koden. Till dess är spärren tom
 * och sajten renderar som förut; DELETE svarar 503 och raderar ingenting.
 *
 * FAIL-OPEN, till skillnad från kontaktspärren. Går listan inte att läsa
 * renderas sidan som om spärren vore tom — det finns inget "dölj allt" att
 * falla tillbaka på för en katalog. Felet loggas och cachas inte, så nästa
 * rendering försöker igen.
 */

/** Cachetaggen som DELETE-endpointen revaliderar. */
export const SPARR_TAGG = "overlay-foretag-sparr";

/** Saknas tabellen eller funktionen, dvs. har overlay-radera.sql inte körts? */
export function arSaknadSparr(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // 42P01/42883: tabell/funktion saknas i Postgres. PGRST205/PGRST202: samma
  // sak sett från PostgREST:s schemacache.
  if (["42P01", "42883", "PGRST205", "PGRST202"].includes(err.code ?? "")) return true;
  const m = err.message ?? "";
  return m.includes(SPARR_TABELL) && /does not exist|schema cache/i.test(m);
}

/**
 * Spärrade nycklar, cachade över requests tills DELETE revaliderar taggen.
 *
 * Läses genom overlay_sparrade_nycklar() — security definer, så läsningen
 * fungerar oberoende av tabellrättigheterna i klustret. Ett läsfel KASTAS, så
 * att unstable_cache inte sparar en tom lista som aldrig var sann. En saknad
 * tabell är däremot sann: då ÄR spärren tom, och den första raderingen
 * revaliderar taggen.
 */
const lasSparradeNycklar = unstable_cache(
  async (): Promise<string[]> => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      console.warn("[sparr] SUPABASE_SERVICE_ROLE_KEY saknas — spärren läses som tom");
      return [];
    }
    const { data, error } = await admin.rpc("overlay_sparrade_nycklar", { p_sajt: SAJT });
    if (error) {
      if (arSaknadSparr(error)) return [];
      throw new Error(`overlay_sparrade_nycklar: ${error.message}`);
    }
    // `returns setof text` kommer som en lista av strängar; formen med ett
    // objekt per rad tolereras ändå, så ett PostgREST-byte inte tömmer spärren.
    const nycklar = ((data ?? []) as unknown[])
      .map((r) => (typeof r === "string" ? r : String(Object.values(r as object)[0] ?? "")))
      .filter(Boolean);
    if (nycklar.length >= 1000) {
      console.warn("[sparr] 1000 spärrade nycklar eller fler — PostgREST kan ha kapat listan");
    }
    return nycklar;
  },
  ["overlay-foretag-sparr"],
  { tags: [SPARR_TAGG], revalidate: 3600 },
);

/** Spärren för den här requesten, som mängd. Läses en gång per rendering. */
export const sparradeNycklar = cache(async (): Promise<ReadonlySet<string>> => {
  try {
    return new Set(await lasSparradeNycklar());
  } catch (e) {
    console.error("[sparr] kunde inte läsa spärren — renderar utan:", (e as Error).message);
    return new Set();
  }
});

/**
 * Arbetsställena spärren omfattar, som cfarnr — för ytor som bara känner
 * cfarnr, t.ex. ett förberäknat sitemap-urval. En orgnr-nyckel slås upp i
 * klustret (båda orgnr-skepnaderna); `cfar-<nr>` är sitt eget tal; `ef-…`
 * finns aldrig i klustret. Samma tagg, så DELETE släpper båda listorna.
 */
const lasSparradeCfarnr = unstable_cache(
  async (): Promise<number[]> => {
    const nycklar = await lasSparradeNycklar();
    const ut = new Set<number>();
    const orgnr: string[] = [];
    for (const n of nycklar) {
      const cfar = /^cfar-(\d{1,8})$/.exec(n);
      if (cfar) ut.add(Number(cfar[1]));
      else if (/^\d{10}$/.test(n)) orgnr.push(n, `${n.slice(0, 6)}-${n.slice(6)}`);
    }
    const klient = getSupabaseAnon();
    for (let i = 0; i < orgnr.length; i += 200) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await klient
          .from("foretag_publik")
          .select("cfarnr")
          .in("orgnr", orgnr.slice(i, i + 200))
          .order("cfarnr", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw new Error(`sparradeCfarnr: ${error.message}`);
        const rader = (data ?? []) as Array<{ cfarnr: number | null }>;
        for (const r of rader) if (r.cfarnr != null) ut.add(r.cfarnr);
        if (rader.length < 1000) break;
      }
    }
    return [...ut];
  },
  ["overlay-foretag-sparr-cfarnr"],
  { tags: [SPARR_TAGG], revalidate: 3600 },
);

/** Spärrade arbetsställen för den här requesten. Fail-open, som spärren. */
export const sparradeCfarnr = cache(async (): Promise<ReadonlySet<number>> => {
  try {
    return new Set(await lasSparradeCfarnr());
  } catch (e) {
    console.error("[sparr] kunde inte läsa spärrade arbetsställen — renderar utan:", (e as Error).message);
    return new Set();
  }
});

/** En registerrad i klustret: orgnr (med eller utan bindestreck) och cfarnr. */
type Registerrad = { orgnr?: string | null; cfarnr?: number | null };

/** Är registerraden raderad? */
export function arSparrad(rad: Registerrad, sparrade: ReadonlySet<string>): boolean {
  return arSparradRad({ orgnr: rad.orgnr, cfar: rad.cfarnr }, sparrade);
}

/** Raderna utan de raderade. Ordningen behålls. */
export function utanSparrade<T extends Registerrad>(rader: T[], sparrade: ReadonlySet<string>): T[] {
  if (sparrade.size === 0) return rader;
  return rader.filter((r) => !arSparrad(r, sparrade));
}
