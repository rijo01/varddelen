import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  LOGO_BUCKET,
  OVERLAY_TABLE,
  SAJT,
  STODD_CONTRACT_VERSION,
  arbetsstallenForRadering,
} from "@/lib/overlay";
import { SPARR_TAGG, arSaknadSparr } from "@/lib/foretag-sparr";
import { kontaktsparrRevalidatePaths } from "@/lib/kontaktsparr";
import {
  SIGNATURE_HEADER,
  SPARR_TABELL,
  logoSokvagUrUrl,
  provaRaderaAnrop,
  provaRaderaNyckel,
  type RaderaResponse,
} from "@/lib/overlay-contract";

/**
 * DELETE /api/overlay/<nyckel> — "Ta bort företag" (kontrakt 1.6).
 *
 * CRM:et har redan avpublicerat varje aktiv order med en vanlig `unpublish`.
 * Det här är andra steget: bolaget ska vara BORTA från sajten, också fast
 * basraden står kvar i klustret. Ordningen är kontraktets och spelar roll:
 *
 *   1. grinden        provaRaderaAnrop() — signatur, schema, sajt, nyckel,
 *                     sent_at, version → 401 / 400 / 409
 *   2. spärren FÖRST  overlay_foretag_sparr (sajt, nyckel). Från den stunden
 *                     svarar sidan 404, också om något nedan faller.
 *   3. radera         overlay_profil för identiteten (båda slotarna, alla
 *                     statusar) och logotypfilerna, live och utkast
 *   4. revalidera     profilsidorna, deras listor, grannarnas "liknande", sitemap
 *   5. 200            antal, aldrig innehåll. Ett återförsök ger nollor.
 *
 * VAD SAJTEN HAR ATT RADERA. Overlay-raderna och logotyperna — det är allt
 * sajten själv har skrivit. Berikning och sökindex finns inte här: sökningen
 * går på `search_vector` i den read-only vyn, och overlayns sökord ligger i
 * overlay-raden och försvinner med den. Därför är `berikning` och `sokindex`
 * alltid 0, och `skapa_om_saknas` skapar inga basrader på den här sajten.
 *
 * Saknas spärrtabellen (overlay-radera.sql ej körd) svarar endpointen 503 och
 * raderar INGENTING: en radering utan spärr vore en sida som kommer tillbaka.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

/** `.in()`-listorna hamnar i URL:en; ett bolag med många arbetsställen delas upp. */
const CHUNK = 300;

type Raderat = RaderaResponse["raderat"];
const NOLLOR: Raderat = { overlay: 0, logotyper: 0, berikning: 0, sokindex: 0 };

/** Klienterna initieras per anrop, som i publish — se kommentaren där. */
function klienter(): { anon: SupabaseClient; admin: SupabaseClient } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return {
    anon: createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    admin: createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

/** Svar i kontraktets form. Felet loggas serverside; inget innehåll till klienten. */
function svar(status: number, body: Partial<RaderaResponse> & Pick<RaderaResponse, "ok" | "nyckel">) {
  return NextResponse.json(
    { sparrad: false, raderat: NOLLOR, revalidated: [], ...body },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Overlay-raderna en nyckel träffar. Exakta id:n, aldrig namn. */
interface Urval {
  entity_type: string | null;
  external_ids: string[];
}

function urvalFor(nyckel: string, arbetsstallen: number[]): Urval[] {
  const cfar = /^cfar-(\d{1,8})$/.exec(nyckel);
  if (cfar) {
    // Sajten lagrar arbetsstället som rena siffror; handtagets egen form tas
    // med så att en rad i 1.3-form inte blir kvar.
    return [{ entity_type: "arbetsstalle", external_ids: [String(Number(cfar[1])), nyckel] }];
  }
  if (/^\d{10}$/.test(nyckel)) {
    return [
      { entity_type: "bolag", external_ids: [nyckel] },
      { entity_type: "arbetsstalle", external_ids: arbetsstallen.map(String) },
    ];
  }
  // ef-<hex>: finns aldrig i klustret, men en rad på exakt den nyckeln tas bort.
  return [{ entity_type: null, external_ids: [nyckel] }];
}

export async function DELETE(req: Request, ctx: { params: Promise<{ nyckel: string }> }) {
  const { nyckel: iSokvagen } = await ctx.params;
  // Nyckeln i svaret: bara en giltig raderingsnyckel citeras — aldrig ett
  // personnummer som någon skickat i sökvägen.
  let nyckelUt = "";
  try {
    const avkodad = decodeURIComponent(iSokvagen);
    if (provaRaderaNyckel(avkodad) === null) nyckelUt = avkodad;
  } catch {
    // Trasig procentkodning: grinden nedan svarar 400.
  }

  const secret = process.env.OVERLAY_PUBLISH_SECRET;
  if (
    !secret ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("[radera] OVERLAY_PUBLISH_SECRET eller Supabase-nycklar saknas i miljön");
    return svar(500, { ok: false, nyckel: nyckelUt, error: "Endpointen är inte konfigurerad" });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return svar(413, { ok: false, nyckel: nyckelUt, error: "Bodyn är för stor" });
  }

  // ── 1. Grinden ──────────────────────────────────────────────────────────
  let grind: Awaited<ReturnType<typeof provaRaderaAnrop>>;
  try {
    grind = await provaRaderaAnrop({
      raw,
      signatur: req.headers.get(SIGNATURE_HEADER),
      hemlighet: secret,
      sajt: SAJT,
      nyckelISokvagen: iSokvagen,
      stoddVersion: STODD_CONTRACT_VERSION,
    });
  } catch {
    // decodeURIComponent på en trasig sökväg kastar inne i grinden.
    return svar(400, { ok: false, nyckel: nyckelUt, error: "nyckeln i sökvägen går inte att avkoda" });
  }
  if (!grind.ok) {
    return svar(grind.status, { ok: false, nyckel: nyckelUt, error: grind.fel });
  }
  const { nyckel, radering_id } = grind.paket;
  const { anon, admin } = klienter();

  // ── 2. Spärren först ────────────────────────────────────────────────────
  // ignoreDuplicates: ett återförsök behåller den första raden — dess
  // radering_id och sparrad_at är beslutet som spärren spåras till.
  const { error: sparrFel } = await admin
    .from(SPARR_TABELL)
    .upsert({ sajt: SAJT, nyckel, radering_id }, { onConflict: "sajt,nyckel", ignoreDuplicates: true });
  if (sparrFel) {
    if (arSaknadSparr(sparrFel)) {
      return svar(503, { ok: false, nyckel, error: "spärrtabellen saknas (overlay-radera.sql)" });
    }
    console.error(`[radera] spärren kunde inte skrivas (${sparrFel.code}):`, sparrFel.message);
    const rattighet = sparrFel.code === "42501";
    return svar(500, {
      ok: false,
      nyckel,
      error: rattighet
        ? "service_role saknar rättighet i spärrtabellen (overlay-radera-grants.sql)"
        : "Kunde inte skriva spärren",
    });
  }
  // Spärren gäller nu. Taggen släpps direkt, så att också en radering som
  // faller längre ned ger 404 på nästa rendering.
  revalidateTag(SPARR_TAGG, { expire: 0 });

  // ── 3. Radera ───────────────────────────────────────────────────────────
  let arbetsstallen: { alla: number[]; iNischen: number[] };
  try {
    arbetsstallen = await arbetsstallenForRadering(anon, nyckel);
  } catch (e) {
    console.error("[radera]", (e as Error).message);
    return svar(500, { ok: false, nyckel, sparrad: true, error: "Kunde inte läsa registret" });
  }

  const raderat: Raderat = { ...NOLLOR };
  const loggor = new Set<string>();
  const radIds: string[] = [];

  for (const u of urvalFor(nyckel, arbetsstallen.alla)) {
    for (let i = 0; i < u.external_ids.length; i += CHUNK) {
      const ids = u.external_ids.slice(i, i + CHUNK);
      let q = admin
        .from(OVERLAY_TABLE)
        .select("id,entity_type,external_id,logo_url")
        .eq("sajt", SAJT)
        .in("external_id", ids);
      if (u.entity_type) q = q.eq("entity_type", u.entity_type);
      const { data, error } = await q;
      if (error) {
        console.error("[radera] läsfel overlay_profil", error.message);
        return svar(500, { ok: false, nyckel, sparrad: true, error: "Kunde inte läsa overlay-tabellen" });
      }
      for (const r of (data ?? []) as Array<{ id: string; entity_type: string; external_id: string; logo_url: string | null }>) {
        radIds.push(r.id);
        const fil = logoSokvagUrUrl(r.logo_url, LOGO_BUCKET);
        if (fil) loggor.add(fil);
        for (const f of await logofilerFor(admin, r.entity_type, r.external_id)) loggor.add(f);
      }
    }
  }

  for (let i = 0; i < radIds.length; i += CHUNK) {
    const { error, count } = await admin
      .from(OVERLAY_TABLE)
      .delete({ count: "exact" })
      .eq("sajt", SAJT)
      .in("id", radIds.slice(i, i + CHUNK));
    if (error) {
      console.error("[radera] overlay_profil kunde inte raderas", error.message);
      return svar(500, { ok: false, nyckel, sparrad: true, raderat, error: "Kunde inte radera overlay-raderna" });
    }
    raderat.overlay += count ?? 0;
  }

  // Bara sajtens egna filer: varje sökväg ligger under `<sajt>/` i den delade bucketen.
  const filer = [...loggor].filter((f) => f.startsWith(`${SAJT}/`));
  if (filer.length > 0) {
    const { data, error } = await admin.storage.from(LOGO_BUCKET).remove(filer);
    if (error) {
      console.error("[radera] logotyperna kunde inte raderas", error.message);
      return svar(500, { ok: false, nyckel, sparrad: true, raderat, error: "Kunde inte radera logotyperna" });
    }
    raderat.logotyper = (data ?? []).length;
  }

  // ── 4. Revalidera ───────────────────────────────────────────────────────
  // Varje arbetsställe med en sida här: profilen, kommun- och kommun × yrke-
  // listan, och grannarnas profiler, där bolaget stod under "liknande". Samma
  // ytor som en kontaktspärr — kontaktsparrRevalidatePaths() räknar fram dem.
  const revalidated = new Set<string>(["/sitemap.xml"]);
  try {
    const berorda = arbetsstallen.iNischen.map((cfarnr) => ({
      kalla: "overlay_foretag_sparr",
      falt: "",
      cfarnr,
      sajt: null,
      entity_type: null,
      external_id: null,
    }));
    for (const p of await kontaktsparrRevalidatePaths(berorda, anon)) revalidated.add(p);
  } catch (e) {
    // Inte fatalt: spärren gäller redan, och ISR-sidorna går ut inom ett dygn.
    console.warn("[radera] revalideringen ofullständig:", (e as Error).message);
  }
  for (const p of revalidated) revalidatePath(p);

  // ── 5. Kvittot ──────────────────────────────────────────────────────────
  console.info(
    `[radera] sajt=${SAJT} radering_id=${radering_id} overlay=${raderat.overlay} logotyper=${raderat.logotyper}`,
  );
  // Antal per tabell och bucket, för CRM:ets raderingslogg (kvittots per_tabell).
  // Sajten raderar inget annat: berikningen är crm_profiles, som inte rörs.
  const per_tabell = { [OVERLAY_TABLE]: raderat.overlay, [`bucket:${LOGO_BUCKET}`]: raderat.logotyper };
  return svar(200, { ok: true, nyckel, sparrad: true, raderat, per_tabell, revalidated: [...revalidated] });
}

/**
 * Logotypfiler för EN identitet, också de som ingen rad längre pekar på:
 * `<sajt>/<typ>/<id>.<ext>` och utkastens `<sajt>/<typ>/utkast/<id>-r<rev>.<ext>`.
 * Listningen söker på id:t, och varje träff prövas mot hela filnamnet — ett
 * cfarnr 123 tar aldrig med sig 1234.
 */
async function logofilerFor(admin: SupabaseClient, entityType: string, externalId: string): Promise<string[]> {
  const ut: string[] = [];
  const id = externalId.replace(/[^0-9a-z-]/gi, "");
  if (!id || id !== externalId) return ut;
  const mappar: Array<[string, RegExp]> = [
    [`${SAJT}/${entityType}`, new RegExp(`^${id}\\.[a-z0-9]+$`, "i")],
    [`${SAJT}/${entityType}/utkast`, new RegExp(`^${id}-r\\d+\\.[a-z0-9]+$`, "i")],
  ];
  for (const [mapp, exakt] of mappar) {
    const { data, error } = await admin.storage.from(LOGO_BUCKET).list(mapp, { search: id, limit: 100 });
    if (error) {
      console.warn("[radera] kunde inte lista logotyper", mapp, error.message);
      continue;
    }
    for (const f of data ?? []) if (exakt.test(f.name)) ut.push(`${mapp}/${f.name}`);
  }
  return ut;
}
