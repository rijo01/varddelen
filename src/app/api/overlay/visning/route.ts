import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SAJT, STODDA_ENTITY_TYPES, STODD_CONTRACT_VERSION, identitetFinns } from "@/lib/overlay";
import { overlayGerSubstans } from "@/lib/overlay-rankning";
import { overlayVisning, tillampaNiva } from "@/lib/overlay-visning";
import {
  SIGNATURE_HEADER,
  overlayPublishRequestSchema,
  sentAtArFarsk,
  verifyOverlaySignature,
  type OverlayProfilRow,
} from "@/lib/overlay-contract";

/**
 * POST /api/overlay/visning — TORRKÖRNING av profilnivån (kontrakt 1.7).
 *
 * Tar emot ett publiceringspaket med samma signatur, schema och versionsgrind
 * som /api/overlay/publish, och svarar med vad sajten SKULLE göra med det —
 * utan att skriva något. Besluten kommer ur samma två funktioner som sidorna
 * läser genom (lib/overlay-visning.ts): tillampaNiva() vid läsningen och
 * overlayVisning() för märke, etikett, rankning, indexering och säljväg.
 *
 * Finns för CRM:ets prova:kontraktsform: provdata får aldrig bli en rad på en
 * riktig sajt, men nivåernas beteende ska ändå kunna provas mot produktionen.
 * Därför prövas inte provpaketsregeln här — ingenting skrivs, ingenting
 * revalideras, och `sida` säger bara om sajten har en sida för identiteten.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FALT = [
  "hemsida", "telefon_override", "epost_override", "kontaktperson", "info_html", "keywords",
  "kategorier", "popularnamn", "telefon_typ", "adress_override", "adress_override_post",
  "adress_override_besok", "logo_url", "featured", "list_priority", "dolj_andra_nummer",
] as const;

function svar(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const secret = process.env.OVERLAY_PUBLISH_SECRET;
  if (!secret || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return svar(500, { ok: false, error: "Endpointen är inte konfigurerad" });
  }
  const raw = await req.text();
  if (raw.length > 4 * 1024 * 1024) return svar(413, { ok: false, error: "Payloaden är för stor" });
  if (!(await verifyOverlaySignature(raw, secret, req.headers.get(SIGNATURE_HEADER)))) {
    return svar(401, { ok: false, error: "Ogiltig signatur" });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return svar(400, { ok: false, error: "Bodyn är inte giltig JSON" });
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
  const body = parsed.data;
  if (body.contract_version > STODD_CONTRACT_VERSION) {
    return svar(409, { ok: false, error: `Sajten stödjer kontraktsversion ${STODD_CONTRACT_VERSION}, fick ${body.contract_version}` });
  }
  if (body.sajt !== SAJT) return svar(400, { ok: false, error: `Payloaden gäller sajten ${body.sajt}, inte ${SAJT}` });
  if (!(STODDA_ENTITY_TYPES as readonly string[]).includes(body.entity_type)) {
    return svar(400, { ok: false, error: `Sajten hanterar entity_type ${STODDA_ENTITY_TYPES.join(" och ")}, fick ${body.entity_type}` });
  }
  if (!sentAtArFarsk(body.sent_at)) return svar(401, { ok: false, error: "sent_at ligger utanför tillåtet tidsfönster" });

  // Raden som publiceringen hade skrivit, läst som sidorna läser den.
  const rad = tillampaNiva({
    ...(body as unknown as OverlayProfilRow),
    profilniva: body.profilniva ?? null,
    logo_url: body.logo ? "(logotyp i paketet)" : null,
  } as OverlayProfilRow);
  const visning = overlayVisning(rad)!;

  let sida: boolean;
  try {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    sida = await identitetFinns(anon, body.entity_type, body.external_id);
  } catch {
    return svar(500, { ok: false, error: "Kunde inte läsa registret" });
  }

  const falt: Record<string, unknown> = {};
  for (const f of FALT) {
    const v = (rad as unknown as Record<string, unknown>)[f];
    if (v === null || v === undefined || v === false || v === 0 || (Array.isArray(v) && v.length === 0) || v === "") continue;
    falt[f] = v;
  }

  return svar(200, {
    ok: true,
    torrkorning: true,
    niva: visning.niva,
    marke: visning.marke,
    etikett: visning.etikett,
    rankning: visning.rankning,
    // Gör raden sidan indexerbar (robots och sitemap)? Samma regel som sidan.
    indexering: overlayGerSubstans(rad),
    saljvag: visning.saljvag,
    // Sajten har en sida för identiteten. En overlay skapar aldrig en sida.
    sida,
    synlig: sida,
    falt,
  });
}
