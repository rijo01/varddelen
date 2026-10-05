import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase-admin";
import { getSupabaseAnon } from "./supabase";
import { SAJT, overlayRevalidatePaths } from "./overlay";
import { foretagSlug } from "./queries";
import {
  skapaKontaktsparrFilter,
  type Kontaktsparr,
  type KontaktsparrFilter,
  type OverlayProfilRow,
} from "./overlay-contract";

/**
 * Kontaktspärren (kontrakt 1.2): en kontaktuppgift som inte får visas.
 *
 * Ett GDPR-ärende — någon har begärt att ett nummer som felaktigt står på ett
 * bolag i registret ska bort. Spärren ligger i `kontaktsparr` i sajtens egen
 * databas, skrivs bara av /api/overlay/publish, och tillämpas HÄR, vid läsning:
 *
 *   kontaktfält (tel, e-post, telefon_override …) → null
 *   fritext (infotext, sökord, info_html …)       → uppgiften skrubbas bort
 *   sökning på uppgiften                           → noll träffar
 *
 * Registret (`foretag_publik` / `aesamtable`) rörs aldrig. Filtret sitter
 * efter källan, så en återimport av registret kan inte få tillbaka numret.
 *
 * Tabellen är INTE publikt läsbar — en lista över nummer som personer bett om
 * att få raderade är själv en personuppgift. Den läses med service role, på
 * servern, och lämnar aldrig servern annat än som ett redan tillämpat filter.
 *
 * FAIL-CLOSED: går listan inte att läsa döljs alla telefonnummer och
 * e-postadresser i den renderingen. En sida som visar för lite är ett mindre
 * fel än en sida som visar det någon begärt att få raderat.
 */

export const KONTAKTSPARR_TABLE = "kontaktsparr";

/** Spärrarna som gäller den här sajten: hela registret plus sajtens egna. */
async function lasSparrar(): Promise<Kontaktsparr[] | null> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error("[kontaktsparr] SUPABASE_SERVICE_ROLE_KEY saknas — fail-closed");
    return null;
  }
  const { data, error } = await admin
    .from(KONTAKTSPARR_TABLE)
    .select("typ,nyckel")
    .eq("status", "aktiv")
    .or(`sajt.is.null,sajt.eq.${SAJT}`);
  if (error) {
    console.error("[kontaktsparr] kunde inte läsa spärrarna — fail-closed:", error.message);
    return null;
  }
  return (data ?? []) as Kontaktsparr[];
}

/** Filtret för den här requesten. Läses en gång per rendering. */
export const kontaktsparrFilter = cache(
  async (): Promise<KontaktsparrFilter> => skapaKontaktsparrFilter(await lasSparrar()),
);

/** Overlay-raden genom filtret. Sajtens egna sålda fält är inte undantagna. */
export function filtreraOverlay<T extends OverlayProfilRow | null>(rad: T, f: KontaktsparrFilter): T {
  if (!rad || (f.antal === 0 && !f.failClosed)) return rad;
  const bas = rad.bas
    ? { ...rad.bas, telefon: f.falt(rad.bas.telefon) }
    : rad.bas;
  return {
    ...rad,
    telefon_override: f.falt(rad.telefon_override),
    epost_override: f.falt(rad.epost_override),
    kontaktperson: f.skrubba(rad.kontaktperson),
    info_html: f.skrubba(rad.info_html),
    keywords: (rad.keywords ?? []).map((k) => f.skrubba(k)?.trim() ?? "").filter(Boolean),
    bas,
  };
}

/** Sökord genom filtret: skrubbade, och tomma efter skrubbningen borttagna. */
export function filtreraSokord(sokord: string[], f: KontaktsparrFilter): string[] {
  if (f.antal === 0 && !f.failClosed) return sokord;
  return sokord.map((s) => f.skrubba(s)?.trim() ?? "").filter(Boolean);
}

// ── Revalidering när en spärr läggs eller hävs ─────────────────────────────

interface Berord {
  kalla: string;
  falt: string;
  cfarnr: number | null;
  sajt: string | null;
  entity_type: string | null;
  external_id: string | null;
}

/**
 * Var uppgiften står i klustret — källa, fält och identitet, aldrig värdet.
 * Se lib/sql/kontaktsparr-kluster.sql.
 */
export async function hamtaBerorda(
  admin: SupabaseClient,
  typ: string,
  nyckel: string,
): Promise<Berord[] | null> {
  const { data, error } = await admin.rpc("kontaktsparr_berorda", { p_typ: typ, p_nyckel: nyckel });
  if (error) {
    console.error("[kontaktsparr] kontaktsparr_berorda misslyckades:", error.message);
    return null;
  }
  return (data ?? []) as Berord[];
}

/**
 * Alla sidor som kan ha visat uppgiften.
 *
 * För varje berört arbetsställe: dess egna ytor (profil, kommun, kommun ×
 * bransch — samma som en overlay-publicering) OCH profilsidorna för grannarna i
 * samma kommun och bransch. "Liknande företag" på de sidorna är ett kort med
 * numret, och de ligger annars kvar i ISR-cachen i upp till ett dygn.
 *
 * För overlay-rader på DEN HÄR sajten: overlay-radens egna ytor.
 */
export async function kontaktsparrRevalidatePaths(
  berorda: Berord[],
  klient: SupabaseClient = getSupabaseAnon(),
): Promise<string[]> {
  const paths = new Set<string>();
  const cfarnrs = new Set<number>();

  for (const b of berorda) {
    if (b.kalla === "overlay_profil") {
      if (b.sajt !== SAJT || !b.entity_type || !b.external_id) continue;
      for (const p of await overlayRevalidatePaths(
        { entity_type: b.entity_type as OverlayProfilRow["entity_type"], external_id: b.external_id },
        klient,
      )) {
        paths.add(p);
      }
      continue;
    }
    if (b.cfarnr != null) cfarnrs.add(b.cfarnr);
  }

  for (const cfarnr of cfarnrs) {
    for (const p of await overlayRevalidatePaths(
      { entity_type: "arbetsstalle", external_id: String(cfarnr) },
      klient,
    )) {
      paths.add(p);
    }

    const { data: rad } = await klient
      .from("foretag_publik")
      .select("kommun,ng1")
      .eq("cfarnr", cfarnr)
      .limit(1)
      .maybeSingle();
    const r = rad as { kommun: string | null; ng1: number | null } | null;
    if (!r?.kommun || r.ng1 == null) continue;

    const { data: grannar } = await klient
      .from("foretag_publik")
      .select("cfarnr,firma,namn")
      .eq("kommun", r.kommun)
      .eq("ng1", r.ng1)
      .limit(500);
    for (const g of (grannar ?? []) as Array<{ cfarnr: number | null; firma: string | null; namn: string | null }>) {
      if (g.cfarnr == null) continue;
      paths.add(`/foretag/${foretagSlug({ firma: g.firma, namn: g.namn, cfarnr: g.cfarnr })}`);
    }
  }
  return [...paths];
}
