import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  LOGO_BUCKET,
  OVERLAY_TABLE,
  SAJT,
  STODDA_ENTITY_TYPES,
  STODD_CONTRACT_VERSION,
  idagISO,
  orgnrVarianter,
  overlayRevalidatePaths,
} from "@/lib/overlay";
import { foretagSlug } from "@/lib/queries";
import { hanteraKontaktsparr } from "./kontaktsparr";
import {
  arKontaktsparrPaket,
  OVERLAY_PROMOTE_ARG,
  OVERLAY_PROMOTE_RPC,
  SIGNATURE_HEADER,
  avkodaLogo,
  bedomRevision,
  overlayPayloadHash,
  overlayPublishRequestSchema,
  sanitizeInfoHtml,
  sentAtArFarsk,
  verifieraPreviewToken,
  verifyOverlaySignature,
  type EntityType,
  type OverlayPublishRequest,
  type OverlayPublishResponse,
} from "@/lib/overlay-contract";

/**
 * POST /api/overlay/publish — CRM:ets enda väg in i sajten.
 *
 * Sajten äger den här endpointen, hemligheten och tabellen. CRM:et har inga
 * databasnycklar hit: allt går via en HMAC-signerad body. Det är det som gör
 * sajten säljbar med sina overlay-rader utan att CRM:et följer med.
 *
 * Grindarna, i ordning:
 *   1. signatur      — fel eller manipulerad body → 401
 *   2. schema        — okänt fält, fel typ → 400
 *   3. contract_version, sajt, entity_type → 409 / 400
 *   4. sent_at       — gamla paket → 401
 *   5. revision      — omspelning eller konflikt → 409, återförsök → 200
 *   6. logotyp       — magic bytes och 500 kB → 400
 *
 * force-dynamic + klienter som initieras per anrop — en route handler får
 * aldrig fånga upp ett svar i byggcachen.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Klienterna initieras INNE i handlern, inte som modulsingletons.
 * En route handler får aldrig binda upp sig mot ett tillstånd från bygget —
 * env läses vid anropet, och en saknad nyckel blir ett 500 här och nu i stället
 * för ett tyst felaktigt beteende.
 */
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

/** Svar utan interna detaljer. Felet loggas serverside, aldrig till klienten. */
function svar(
  status: number,
  body: Partial<OverlayPublishResponse> & Pick<OverlayPublishResponse, "ok">,
) {
  return NextResponse.json(
    { revision: 0, revalidated: [], ...body },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Raderna för EN identitet. Intern query — enda stället som ser båda slotarna. */
interface Slot {
  id: string;
  order_id: string;
  revision: number;
  payload_hash: string | null;
  status: string;
  logo_url: string | null;
}

export async function POST(req: Request) {
  const secret = process.env.OVERLAY_PUBLISH_SECRET;
  if (
    !secret ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("[overlay] OVERLAY_PUBLISH_SECRET eller Supabase-nycklar saknas i miljön");
    return svar(500, { ok: false, error: "Endpointen är inte konfigurerad" });
  }
  const { anon, admin } = klienter();

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return svar(413, { ok: false, error: "Payloaden är för stor" });
  }

  // Signaturen räknas på EXAKT de bytes som kom in — aldrig på ett
  // omserialiserat objekt. Kontrollen sker före JSON.parse: en okänd avsändare
  // ska inte ens få sin syntax granskad.
  if (!(await verifyOverlaySignature(raw, secret, req.headers.get(SIGNATURE_HEADER)))) {
    return svar(401, { ok: false, error: "Ogiltig signatur" });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return svar(400, { ok: false, error: "Bodyn är inte giltig JSON" });
  }

  // Kontrakt 1.2: en kontaktspärr har eget schema och egen tabell, men samma
  // signatur, samma tidsfönster och samma revisionsregel. Se ./kontaktsparr.ts.
  if (arKontaktsparrPaket(json)) {
    return hanteraKontaktsparr(json, admin, anon, svar);
  }

  const parsed = overlayPublishRequestSchema.safeParse(json);
  if (!parsed.success) {
    return svar(400, {
      ok: false,
      error: `Payloaden matchar inte kontraktet: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(rot)"}: ${i.message}`)
        .slice(0, 5)
        .join("; ")}`,
    });
  }
  const body: OverlayPublishRequest = parsed.data;

  // Ett kontrakt vi inte förstår avvisas hellre än tolkas till hälften.
  if (body.contract_version > STODD_CONTRACT_VERSION) {
    return svar(409, {
      ok: false,
      error: `Sajten stödjer kontraktsversion ${STODD_CONTRACT_VERSION}, fick ${body.contract_version}`,
    });
  }
  if (body.sajt !== SAJT) {
    return svar(400, { ok: false, error: `Payloaden gäller sajten ${body.sajt}, inte ${SAJT}` });
  }
  // Två nivåer stöds, se STODDA_ENTITY_TYPES i lib/overlay.ts. `forening` och
  // `verksamhet` hör till andra sajter och har inget register här att peka på.
  if (!(STODDA_ENTITY_TYPES as readonly string[]).includes(body.entity_type)) {
    return svar(400, {
      ok: false,
      error: `Sajten hanterar entity_type ${STODDA_ENTITY_TYPES.join(" och ")}, fick ${body.entity_type}`,
    });
  }
  // sent_at ligger i bodyn och skyddas av signaturen. Det stoppar GAMLA PAKET;
  // revisionen nedan stoppar OMSPELNING. De skyddar olika saker.
  if (!sentAtArFarsk(body.sent_at)) {
    return svar(401, { ok: false, error: "sent_at ligger utanför tillåtet tidsfönster" });
  }

  const forUtkast = body.action === "preview";

  // Logotypen granskas före första DB-rundturen: magic bytes och 500 kB-taket
  // är ren CPU, och en payload vi ändå ska avvisa ska inte kosta ett anrop.
  // Content-Type får aldrig avgöra ensamt — se avkodaLogo() i kontraktet.
  const bild = body.logo ? avkodaLogo(body.logo) : null;
  if (bild && !bild.ok) {
    return svar(400, { ok: false, error: bild.error });
  }

  // Förhandsvisningstoken är signerad och bunden till identitet + revision, och
  // lever 24 h. Kontrolleras före första DB-rundturen.
  let previewExpiresAt: string | null = null;
  if (forUtkast) {
    const t = await verifieraPreviewToken(secret, body.preview_token);
    if (!t.ok) {
      return svar(400, { ok: false, error: `preview_token: ${t.orsak}` });
    }
    if (t.external_id !== body.external_id || t.revision !== body.revision) {
      return svar(400, {
        ok: false,
        error: "preview_token gäller en annan identitet eller revision",
      });
    }
    previewExpiresAt = t.expires_at;
  }

  // ── Befintliga rader för identiteten ──────────────────────────────────────
  // Intern query med service role — det ENDA stället som läser båda slotarna.
  // All publik läsning filtrerar på status = 'aktiv' (se lib/overlay.ts).
  const { data: slotData, error: lasFel } = await admin
    .from(OVERLAY_TABLE)
    .select("id,order_id,revision,payload_hash,status,logo_url")
    .eq("sajt", SAJT)
    .eq("entity_type", body.entity_type)
    .eq("external_id", body.external_id);

  if (lasFel) {
    console.error("[overlay] läsfel", lasFel.message);
    return svar(500, { ok: false, error: "Kunde inte läsa overlay-tabellen" });
  }

  const slots = (slotData ?? []) as Slot[];
  const publicerad = slots.find((s) => s.status !== "utkast") ?? null;
  const utkast = slots.find((s) => s.status === "utkast") ?? null;

  const payloadHash = await overlayPayloadHash(body);

  // Ett utkast får aldrig vara äldre än det som faktiskt ligger live.
  if (forUtkast && publicerad && body.revision < publicerad.revision) {
    return svar(409, {
      ok: false,
      revision: publicerad.revision,
      error: `revision ${body.revision} är äldre än den publicerade raden (${publicerad.revision})`,
    });
  }

  // publish/unpublish mäts mot den publicerade raden, preview mot utkastet.
  // Se bedomRevision() i kontraktet för varför uppdelningen behövs.
  const beslut = bedomRevision(
    { revision: body.revision, payload_hash: payloadHash },
    forUtkast ? utkast : publicerad,
  );

  if (beslut.typ === "konflikt") {
    return svar(409, { ok: false, revision: beslut.aktuell, error: beslut.orsak });
  }
  if (beslut.typ === "oforandrad") {
    // Samma revision, samma innehåll: ett återförsök ur kön. Svara som förra
    // gången och skriv ingenting.
    return svar(200, { ok: true, revision: body.revision, revalidated: [] });
  }

  // ── unpublish ─────────────────────────────────────────────────────────────
  if (body.action === "unpublish") {
    if (!publicerad) {
      // Inget att ta ner. Ett lyckat "det är redan borta" är rätt svar på en retry.
      return svar(200, { ok: true, revision: body.revision, revalidated: [] });
    }
    // Skillnaden mellan avpublicerad och utgången är avtalet, inte handlingen.
    const nyStatus =
      body.giltig_till && body.giltig_till < idagISO() ? "utgangen" : "inaktiv";

    // Logotypfilen rörs ALDRIG här: en kund som publiceras igen ska få tillbaka
    // sin logotyp utan att CRM:et behöver skicka om bilden.
    const { error } = await admin
      .from(OVERLAY_TABLE)
      .update({ status: nyStatus, revision: body.revision, payload_hash: payloadHash })
      .eq("id", publicerad.id);
    if (error) {
      console.error("[overlay] unpublish misslyckades", error.message);
      return svar(500, { ok: false, error: "Kunde inte avpublicera" });
    }

    const revalidated = await revalidera(anon, body.entity_type, body.external_id);
    return svar(200, { ok: true, revision: body.revision, revalidated });
  }

  // ── Logotyp ───────────────────────────────────────────────────────────────
  // Semantiken ligger i kontraktet: utelämnat fält = behåll filen,
  // remove_logo = ta bort, objekt = ersätt. Nyckeln utelämnas ur raden när
  // filen ska behållas — overlay_publicera() COALESCE:ar då mot befintligt värde.
  let logoFalt: { logo_url: string | null } | Record<string, never> = {};

  if (body.remove_logo) {
    const gammal = publicerad?.logo_url ?? utkast?.logo_url ?? null;
    if (gammal) await raderaLogo(admin, gammal);
    logoFalt = { logo_url: null };
  } else if (bild?.ok) {
    // Filnamnet bär nivån. Utan prefixet skulle ett orgnr och ett cfarnr kunna
    // kollidera på samma filnamn i en bucket som tre sajter delar.
    const path = `${SAJT}/${body.entity_type}/${body.external_id}.${bild.ext}`;
    const { error } = await admin.storage.from(LOGO_BUCKET).upload(path, bild.bytes, {
      contentType: bild.mime,
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) {
      console.error("[overlay] logotyp-uppladdning misslyckades", error.message);
      return svar(502, { ok: false, error: "Kunde inte spara logotypen" });
    }
    const { data } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);
    // ?v=<revision>: filnamnet är stabilt (en identitet = en logotyp), och utan
    // versionsparametern skulle CDN:en fortsätta servera den gamla bilden.
    logoFalt = { logo_url: `${data.publicUrl}?v=${body.revision}` };
  }

  const rad = {
    sajt: SAJT,
    entity_type: body.entity_type,
    external_id: body.external_id,
    order_id: body.order_id,
    revision: body.revision,
    payload_hash: payloadHash,
    status: forUtkast ? "utkast" : "aktiv",
    giltig_from: body.giltig_from,
    giltig_till: body.giltig_till,
    featured: body.featured,
    list_priority: body.list_priority,
    keywords: body.keywords,
    hemsida: body.hemsida,
    telefon_override: body.telefon_override,
    epost_override: body.epost_override,
    kontaktperson: body.kontaktperson,
    adress_override: body.adress_override,
    // Saneras HÄR, i mottagaren. Sajten litar aldrig på att avsändaren städat.
    info_html: sanitizeInfoHtml(body.info_html),
    dolj_andra_nummer: body.dolj_andra_nummer,
    preview_token: forUtkast ? body.preview_token : null,
    preview_expires_at: previewExpiresAt,
    contract_version: body.contract_version,
    // ── 1.1. Alltid med, även som null: en kund som tagit bort sitt
    // populärnamn ska bli av med det, inte behålla det för att nyckeln
    // utelämnades. En 1.0-payload ger null rakt igenom, vilket är rätt.
    popularnamn: body.popularnamn ?? null,
    telefon_typ: body.telefon_typ ?? null,
    kategorier: body.kategorier ?? [],
    adress_override_post: body.adress_override_post ?? null,
    adress_override_besok: body.adress_override_besok ?? null,
    // `bas` LAGRAS, men skriver aldrig i registret. Se OVERLAY.md.
    bas: body.bas ?? null,
    skapa_om_saknas: body.skapa_om_saknas ?? false,
    ...logoFalt,
    ...(forUtkast ? {} : { published_at: new Date().toISOString() }),
  };

  // ── preview: skriv utkastet, rör aldrig live-raden ────────────────────────
  if (forUtkast) {
    const { error } = utkast
      ? await admin.from(OVERLAY_TABLE).update(rad).eq("id", utkast.id)
      : await admin.from(OVERLAY_TABLE).insert(rad);
    if (error) {
      console.error("[overlay] utkast misslyckades", error.message);
      return svar(500, { ok: false, error: "Kunde inte spara utkastet" });
    }

    const url = await previewUrl(anon, body.entity_type, body.external_id, body.preview_token!);
    return svar(200, {
      ok: true,
      revision: body.revision,
      // Ett utkast syns bara bakom ?preview= på en force-dynamic-sida. Det
      // finns ingen cache att rensa, och vi rapporterar därför inget.
      revalidated: [],
      ...(url ? { preview_url: url } : {}),
    });
  }

  // ── publish: promote i EN transaktion ─────────────────────────────────────
  // Databasfunktionen skriver live-raden OCH raderar utkastet atomärt. Görs det
  // i två anrop finns ett fönster där identiteten har två rader.
  const { error: promoteFel } = await admin.rpc(OVERLAY_PROMOTE_RPC, {
    [OVERLAY_PROMOTE_ARG]: rad,
  });
  if (promoteFel) {
    console.error("[overlay] publicering misslyckades", promoteFel.message);
    return svar(500, { ok: false, error: "Kunde inte publicera overlay-raden" });
  }

  const revalidated = await revalidera(anon, body.entity_type, body.external_id);
  return svar(200, { ok: true, revision: body.revision, revalidated });
}

/** Alla ytor raden påverkar. Deklareras i lib/overlay.ts, inte här. */
async function revalidera(
  klient: SupabaseClient,
  entityType: EntityType,
  externalId: string,
): Promise<string[]> {
  const paths = await overlayRevalidatePaths(
    { entity_type: entityType, external_id: externalId },
    klient,
  );
  for (const p of paths) revalidatePath(p);
  return paths;
}

/**
 * Länken säljaren skickar till kunden.
 *
 * Ett bolagsköp kan träffa flera arbetsställen; förhandsvisningen pekar på det
 * första vi hittar. Att välja ett av dem är rätt: kunden ska se hur profilen
 * ser ut, och den ser likadan ut på alla sina sidor.
 */
async function previewUrl(
  klient: SupabaseClient,
  entityType: EntityType,
  externalId: string,
  token: string,
): Promise<string | null> {
  const bas = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se").replace(
    /\/$/,
    "",
  );
  let q = klient.from("foretag_publik").select("cfarnr,firma,namn");
  q =
    entityType === "arbetsstalle"
      ? q.eq("cfarnr", Number(externalId))
      : q.in("orgnr", orgnrVarianter(externalId));

  const { data } = await q.limit(1).maybeSingle();
  const rad = data as { cfarnr: number | null; firma: string | null; namn: string | null } | null;
  if (!rad?.cfarnr) return null;

  const slug = foretagSlug({ firma: rad.firma, namn: rad.namn, cfarnr: rad.cfarnr });
  return `${bas}/foretag/${slug}/forhandsvisning?preview=${encodeURIComponent(token)}`;
}

/**
 * Tar bort logotypfilen ur sajtens bucket. Anropas ENDAST för remove_logo —
 * aldrig vid unpublish, där filen ska överleva till nästa publicering.
 */
async function raderaLogo(admin: SupabaseClient, logoUrl: string): Promise<void> {
  // logo_url är `<publicUrl>/<sajt>/<typ>/<id>.<ext>?v=<rev>`. Vi behöver
  // sökvägen INOM bucketen, alltså allt efter bucketnamnet.
  const utanFraga = logoUrl.split("?")[0];
  const i = utanFraga.indexOf(`/${LOGO_BUCKET}/`);
  if (i === -1) return;
  const path = utanFraga.slice(i + LOGO_BUCKET.length + 2);
  if (!path) return;

  const { error } = await admin.storage.from(LOGO_BUCKET).remove([path]);
  if (error) {
    // Inte fatalt: raden pekar inte längre på filen, och en föräldralös fil i
    // bucketen är ett städproblem, inte ett publiceringsfel.
    console.warn("[overlay] kunde inte radera logotyp", path, error.message);
  }
}
