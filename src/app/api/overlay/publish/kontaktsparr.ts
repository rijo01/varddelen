import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SAJT, STODD_CONTRACT_VERSION } from "@/lib/overlay";
import { KONTAKTSPARR_TABLE, hamtaBerorda, kontaktsparrRevalidatePaths } from "@/lib/kontaktsparr";
import {
  bedomRevision,
  kontaktsparrHash,
  kontaktsparrRequestSchema,
  sentAtArFarsk,
  type KontaktsparrRequest,
  type OverlayPublishResponse,
} from "@/lib/overlay-contract";

/**
 * `action: "kontaktsparr"` — kontrakt 1.2.
 *
 * Samma grindar som overlay, i samma ordning, efter att signaturen redan
 * godkänts i route.ts:
 *
 *   schema → version → sajt → sent_at → revision → skriv → revalidera → logga
 *
 * Med scope `register` tar alla tre klustersajterna emot samma spärr och den
 * landar i SAMMA rad (sajt is null). Den första skriver; de andra får
 * "oforandrad" ur revisionsregeln — men revaliderar ändå SINA sidor. Annars
 * hade bara den första sajten slutat visa numret direkt, och de andra först
 * när ISR-cachen gick ut.
 */
export async function hanteraKontaktsparr(
  json: unknown,
  admin: SupabaseClient,
  anon: SupabaseClient,
  svar: (
    status: number,
    body: Partial<OverlayPublishResponse> & Pick<OverlayPublishResponse, "ok">,
  ) => Response,
): Promise<Response> {
  const parsed = kontaktsparrRequestSchema.safeParse(json);
  if (!parsed.success) {
    return svar(400, {
      ok: false,
      error: `Kontaktspärren matchar inte kontraktet: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(rot)"}: ${i.message}`)
        .slice(0, 5)
        .join("; ")}`,
    });
  }
  const body: KontaktsparrRequest = parsed.data;

  if (body.contract_version > STODD_CONTRACT_VERSION) {
    return svar(409, {
      ok: false,
      error: `Sajten stödjer kontraktsversion ${STODD_CONTRACT_VERSION}, fick ${body.contract_version}`,
    });
  }
  if (body.sajt !== SAJT) {
    return svar(400, { ok: false, error: `Payloaden gäller sajten ${body.sajt}, inte ${SAJT}` });
  }
  if (!sentAtArFarsk(body.sent_at)) {
    return svar(401, { ok: false, error: "sent_at ligger utanför tillåtet tidsfönster" });
  }

  // Raden spärren bor i: register = sajt is null, annars den här sajten.
  const sajtKolumn = body.scope === "register" ? null : SAJT;
  let q = admin
    .from(KONTAKTSPARR_TABLE)
    .select("id,revision,payload_hash")
    .eq("typ", body.typ)
    .eq("nyckel", body.nyckel);
  q = sajtKolumn === null ? q.is("sajt", null) : q.eq("sajt", sajtKolumn);
  const { data: befintlig, error: lasFel } = await q.maybeSingle();
  if (lasFel) {
    console.error("[kontaktsparr] läsfel", lasFel.message);
    return svar(500, { ok: false, error: "Kunde inte läsa spärrtabellen" });
  }

  const hash = await kontaktsparrHash(body);
  const beslut = bedomRevision(
    { revision: body.revision, payload_hash: hash },
    befintlig as { revision: number; payload_hash: string } | null,
  );
  if (beslut.typ === "konflikt") {
    return svar(409, { ok: false, revision: beslut.aktuell, error: beslut.orsak });
  }

  if (beslut.typ === "skriv") {
    const rad = {
      scope: body.scope,
      sajt: sajtKolumn,
      typ: body.typ,
      nyckel: body.nyckel,
      status: body.op === "sparra" ? "aktiv" : "havd",
      arende: body.arende,
      revision: body.revision,
      payload_hash: hash,
      contract_version: body.contract_version,
      skriven_av: SAJT,
    };
    const { error } = befintlig
      ? await admin.from(KONTAKTSPARR_TABLE).update(rad).eq("id", (befintlig as { id: string }).id)
      : await admin.from(KONTAKTSPARR_TABLE).insert(rad);
    if (error) {
      console.error("[kontaktsparr] skrivfel", error.message);
      return svar(500, { ok: false, error: "Kunde inte spara spärren" });
    }
  }

  // Spärren ligger. Allt härifrån är att få bort det som redan renderats.
  const berorda = await hamtaBerorda(admin, body.typ, body.nyckel);
  if (berorda === null) {
    // Spärren gäller redan vid nästa rendering — men vi vet inte vilka sidor
    // som ligger i cachen. Ett fel, så att CRM:et kör om.
    return svar(500, {
      ok: false,
      revision: body.revision,
      error: "Spärren är sparad men berörda sidor kunde inte slås upp; ingen revalidering gjord",
    });
  }
  const revalidated = await kontaktsparrRevalidatePaths(berorda, anon);
  for (const p of revalidated) revalidatePath(p);

  const antalBolag = new Set(berorda.map((b) => b.cfarnr ?? `${b.entity_type}:${b.external_id}`)).size;

  const { error: loggFel } = await admin.from("kontaktsparr_handelse").insert({
    mottagen_av: SAJT,
    op: body.op,
    scope: body.scope,
    sajt: sajtKolumn,
    typ: body.typ,
    nyckel: body.nyckel,
    arende: body.arende,
    revision: body.revision,
    berorda: antalBolag,
    revalidated,
  });
  if (loggFel) {
    // Allt ska loggas. Spärren gäller och sidorna är revaliderade, men utan
    // logg är händelsen inte redovisad — ett fel, så att CRM:et kör om. Ett nytt
    // försök är ofarligt: revisionsregeln gör det till ett återförsök.
    console.error("[kontaktsparr] kunde inte logga händelsen", loggFel.message);
    return svar(500, { ok: false, revision: body.revision, revalidated, error: "Spärren gäller men händelsen kunde inte loggas" });
  }

  return svar(200, { ok: true, revision: body.revision, revalidated, berorda: antalBolag });
}
