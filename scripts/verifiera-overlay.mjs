#!/usr/bin/env node
/**
 * Skarp verifiering av overlay-vägen, ände till ände, mot en riktig deploy.
 *
 *   npm run overlay:verifiera -- --cfarnr 12345678 --url https://varddelen.se
 *
 * Kör stegen i ordning och skriver PASS/FAIL per delkontroll. Avslutar med
 * kod 1 om något faller.
 *
 *   0. förutsättningar — cfarnr finns i registret, ingen overlay-rad sedan
 *                        tidigare, endpointen svarar
 *   1. publish rev 1 (arbetsstalle) → aktiv, logo i bucket, företagssidan,
 *                        listplacering, 1.1-fälten lagrade
 *   1b. indexerbarhet   → sidan är inte noindex (sitemapen: --sitemap)
 *   2. omspelning av rev 1 → 200 utan skrivning (återförsök), sedan rev 1 med
 *                        ändrat innehåll → 409
 *   3. bolagsnivån → egen rad, och arbetsstället vinner på sidan
 *   4. unpublish rev 1 → 409; unpublish rev 3 → 200, filen kvar
 *   5. preview → utkast vid sidan av live-raden, noindex, live orörd
 *   6. kontraktsgrindar — fel signatur, gammal sent_at, för hög version,
 *                        fel sajt, en logotyp som ljuger om sin typ
 *
 * SKRIPTET SKRIVER I PRODUKTION. Det vägrar därför köra mot ett cfarnr som
 * redan har en overlay-rad — en riktig kund ska inte kunna bli testdata — och
 * städar alltid efter sig, även när ett steg faller.
 *
 * Kräver i miljön (kör med --env-file=.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OVERLAY_PUBLISH_SECRET
 * Supabase-projektet i .env.local MÅSTE vara samma som deployen läser.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ── Sajtens konstanter ──────────────────────────────────────────────────────
// ENDA stället som skiljer sig mellan sajterna. Måste stämma med lib/overlay.ts.
const SAJT = "varddelen";
const FORETAG_BAS = "/foretag";
/** Listar sajtens sitemap enskilda företagssidor? Regionsdelens gör inte det. */
const SITEMAP_LISTAR_FORETAG = true;

const TABELL = "overlay_profil";
const BUCKET = "overlay-logos";
const REGISTER = "foretag_publik";

// ── Argument och miljö ──────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flagga = (n) => argv.includes(`--${n}`);

const CFARNR = arg("cfarnr");
const BAS = (arg("url") ?? "").replace(/\/$/, "");
const SECRET = arg("secret", process.env.OVERLAY_PUBLISH_SECRET);

/**
 * Vercels Deployment Protection släpper igenom ett anrop som bär den här
 * hemligheten i headern x-vercel-protection-bypass. Utan den möts skriptet av
 * SSO-sidan och varje steg faller med svar som ser ut som kodfel.
 *
 * Läses ENBART ur miljön, aldrig som flagga: ett kommandoradsargument hamnar i
 * skalets historik. Värdet skrivs aldrig ut — bara om det finns eller inte.
 */
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!CFARNR || !BAS) {
  console.error(
    "Användning: npm run overlay:verifiera -- --cfarnr <cfarnr> --url <deploy-url>",
  );
  process.exit(2);
}
for (const [namn, v] of [
  ["OVERLAY_PUBLISH_SECRET", SECRET],
  ["NEXT_PUBLIC_SUPABASE_URL", SUPA_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
]) {
  if (!v) {
    console.error(`Saknar ${namn}. Kör med --env-file=.env.local.`);
    process.exit(2);
  }
}

const admin = createClient(SUPA_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Registret läses med ANON-nyckeln, inte service role.
 *
 * `foretag_publik` är grantad till anon och postgres — service_role har INTE
 * SELECT på vyn. Det är avsiktligt (vyn är den maskade ytan, service role
 * kringgår RLS), och det betyder att en service-role-klient får
 * "permission denied for view foretag_publik". Avläst 2026-09-16.
 *
 * Samma uppdelning gäller i endpointen: den läser registret med anon och
 * skriver overlay_profil med service role.
 */
const anon = createClient(SUPA_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Unik markör i info_html. Syns den på en sida är det VÅR rad som renderas. */
const NONCE = `overlay-verifiering-${randomUUID().slice(0, 8)}`;
const ORDER_ID = randomUUID();
const POPULARNAMN = `Populärnamn ${NONCE.slice(-8)}`;

/** 1×1 px PNG. Räcker för att bevisa att filen tar sig hela vägen till bucketen. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ── Utskrift ────────────────────────────────────────────────────────────────

let fel = 0;
const steg = (n, titel) => console.log(`\n\x1b[1m── Steg ${n}: ${titel}\x1b[0m`);
const pass = (t) => console.log(`  \x1b[32mPASS\x1b[0m  ${t}`);
const fail = (t, detalj = "") => {
  fel++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${t}${detalj ? `\n        ${detalj}` : ""}`);
};
const info = (t) => console.log(`  \x1b[2m·     ${t}\x1b[0m`);
const kolla = (villkor, t, detalj = "") => (villkor ? pass(t) : fail(t, detalj));

// ── Kontraktets signering ───────────────────────────────────────────────────

const sign = (s) => createHmac("sha256", SECRET).update(s).digest("hex");

function previewToken(externalId, revision, ttlSekunder = 86400) {
  const kropp = Buffer.from(
    JSON.stringify({
      e: externalId,
      r: revision,
      x: new Date(Date.now() + ttlSekunder * 1000).toISOString(),
    }),
  ).toString("base64url");
  return `pv1.${kropp}.${sign(`pv1.${kropp}`)}`;
}

/** Identiteten som testas. Sätts av steg 0 när registerraden är läst. */
let ORGNR = null;

/** Markören i bolagsradens info_html. Sätts av steg 3, läses av steg 4. */
let BOLAGSNONCE = null;

function byggPayload({
  action,
  revision,
  entityType = "arbetsstalle",
  externalId = CFARNR,
  extra = {},
  sentAt = null,
}) {
  return {
    sajt: SAJT,
    entity_type: entityType,
    external_id: externalId,
    order_id: ORDER_ID,
    revision,
    giltig_from: null,
    giltig_till: null,
    featured: true,
    list_priority: 900,
    keywords: ["Verifieringssökord", "Tandvård"],
    hemsida: "https://exempel.se",
    telefon_override: "010-123 45 67",
    epost_override: null,
    kontaktperson: "Testkontakt",
    adress_override: null,
    info_html: `<p>${NONCE}</p><script>alert(1)</script>`,
    dolj_andra_nummer: true,
    preview_token: action === "preview" ? previewToken(externalId, revision) : null,
    contract_version: 1.1,
    // ── 1.1-fälten. Hela poängen med den här utrullningen; om de tappas
    // någonstans på vägen ska det synas här och inte hos en kund.
    popularnamn: POPULARNAMN,
    telefon_typ: "vaxel",
    kategorier: ["Tandvård", "Akut"],
    adress_override_besok: { gata: "Verifieringsgatan 1", postort: "Teststad" },
    action,
    remove_logo: false,
    ...extra,
    sent_at: sentAt ?? new Date().toISOString(),
  };
}

/**
 * Headers för anrop till DEPLOYEN. Bypass-hemligheten skickas hit och ingen
 * annanstans — logotypen hämtas t.ex. från Supabase storage, en helt annan
 * värd, och dit får en Vercel-hemlighet aldrig gå.
 */
function deployHeaders(extra = {}) {
  return { ...extra, ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}) };
}

async function skicka(payload, { signeraMed = null } = {}) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${BAS}/api/overlay/publish`, {
    method: "POST",
    headers: deployHeaders({
      "content-type": "application/json",
      "x-overlay-signature": signeraMed ?? sign(raw),
    }),
    body: raw,
  });
  const text = await res.text();
  let kropp = {};
  try {
    kropp = JSON.parse(text);
  } catch {
    kropp = { error: text.slice(0, 200) };
  }
  return { kod: res.status, ...kropp };
}

// ── Läsning ─────────────────────────────────────────────────────────────────

const RAD_KOLUMNER =
  "id,entity_type,external_id,revision,status,featured,list_priority,keywords,logo_url," +
  "info_html,payload_hash,published_at,preview_token,contract_version,popularnamn," +
  "telefon_typ,kategorier,adress_override_besok,dolj_andra_nummer";

/** Råa overlay-rader. ARRAYFRÅGA, aldrig maybeSingle — se steg 0. */
function overlayFraga(entityType, externalId) {
  return admin
    .from(TABELL)
    .select(RAD_KOLUMNER)
    .eq("sajt", SAJT)
    .eq("entity_type", entityType)
    .eq("external_id", externalId);
}

async function rader(entityType = "arbetsstalle", externalId = CFARNR) {
  const { data, error } = await overlayFraga(entityType, externalId);
  if (error) throw new Error(`Kunde inte läsa ${TABELL}: ${error.message}`);
  return {
    live: (data ?? []).find((r) => r.status !== "utkast") ?? null,
    utkast: (data ?? []).find((r) => r.status === "utkast") ?? null,
    antal: (data ?? []).length,
  };
}

/** Filnamnet endpointen använder: <sajt>/<typ>/<id>.<ext>. */
function logoPath(entityType, externalId) {
  return `${SAJT}/${entityType}/${externalId}.png`;
}

async function filFinns(entityType = "arbetsstalle", externalId = CFARNR) {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .list(`${SAJT}/${entityType}`, { search: `${externalId}.` });
  if (error) return { ok: false, orsak: error.message };
  return {
    ok: (data ?? []).some((f) => f.name.startsWith(String(externalId))),
    filer: (data ?? []).map((f) => f.name),
  };
}

async function hamta(sokvag) {
  const res = await fetch(`${BAS}${sokvag}`, {
    redirect: "follow",
    headers: deployHeaders(),
  });
  return { kod: res.status, html: await res.text(), headers: res.headers };
}

/**
 * ISR-sidor regenereras vid FÖRSTA requesten efter revalidatePath. Vi pollar
 * hellre än att sova en fast tid — en fast sekundsiffra är antingen för kort
 * (falskt FAIL) eller slöseri.
 */
async function vantaPa(sokvag, villkor, { forsok = 12, paus = 2000 } = {}) {
  let sista = null;
  for (let i = 0; i < forsok; i++) {
    sista = await hamta(sokvag);
    if (villkor(sista)) return { ok: true, svar: sista, forsok: i + 1 };
    await new Promise((r) => setTimeout(r, paus));
  }
  return { ok: false, svar: sista, forsok };
}

// ── Städning ────────────────────────────────────────────────────────────────

let stadatKlart = false;

/**
 * Städningen raderar rader och filer. Den släpps därför inte lös förrän steg 0
 * har slagit fast att identiteten INTE hade någon overlay-rad sedan tidigare.
 *
 * Utan den spärren skulle ett nätverksfel mitt i förutsättningskontrollen leda
 * till att vi avpublicerar och raderar för en identitet vi aldrig hann
 * verifiera — i värsta fall en riktig kund.
 */
let farStada = false;

async function stada() {
  if (!farStada) {
    console.log("\n\x1b[2m── Ingen städning: skriptet ägde aldrig några rader.\x1b[0m");
    stadatKlart = true;
    return;
  }
  if (stadatKlart || flagga("behall")) {
    if (flagga("behall")) console.log("\n\x1b[33m--behall angivet: raderna ligger kvar.\x1b[0m");
    return;
  }
  stadatKlart = true;
  console.log("\n\x1b[1m── Städning\x1b[0m");

  // Avpublicera först, så sidorna revalideras medan raden fortfarande finns.
  // Raderar vi raden rakt av ligger den gamla HTML:en kvar i cachen.
  for (const [typ, id] of identiteter()) {
    const svar = await skicka(
      byggPayload({ action: "unpublish", revision: 99, entityType: typ, externalId: id }),
    );
    info(`unpublish ${typ} rev 99 → HTTP ${svar.kod}`);

    const { error } = await admin
      .from(TABELL)
      .delete()
      .eq("sajt", SAJT)
      .eq("entity_type", typ)
      .eq("external_id", id);
    if (error) fail(`kunde inte radera testraderna (${typ})`, error.message);

    await admin.storage.from(BUCKET).remove([logoPath(typ, id)]);

    const kvar = await rader(typ, id);
    kolla(kvar.antal === 0, `inga overlay-rader kvar (${typ})`, `hittade ${kvar.antal}`);
    const fil = await filFinns(typ, id);
    kolla(fil.ok === false, `logotypfilen borttagen ur bucketen (${typ})`);
  }
}

function identiteter() {
  const ut = [["arbetsstalle", CFARNR]];
  if (ORGNR) ut.push(["bolag", ORGNR]);
  return ut;
}

process.on("exit", () => {
  if (farStada && !stadatKlart && !flagga("behall")) {
    console.log(
      "\n\x1b[31mVARNING: skriptet avbröts innan städning. Kör om, eller rensa manuellt.\x1b[0m",
    );
  }
});

// ── Steg 0: förutsättningar ─────────────────────────────────────────────────

async function forutsattningar() {
  steg(0, "Förutsättningar");
  info(`deploy: ${BAS}`);
  info(`supabase: ${SUPA_URL}`);
  info(`sajt: ${SAJT}   cfarnr: ${CFARNR}   markör: ${NONCE}`);
  info(`bypass-header: ${BYPASS ? "aktiv" : "inte satt"}`);

  // Endpointen först: ligger deployen bakom Vercel Authentication, eller saknas
  // hemligheten, faller annars varje steg med svar som ser ut som kodfel.
  let res;
  try {
    res = await fetch(`${BAS}/api/overlay/publish`, {
      method: "POST",
      headers: deployHeaders({ "content-type": "application/json" }),
      body: "{}",
      redirect: "manual",
    });
  } catch (err) {
    fail("endpointen går att nå", err?.message ?? String(err));
    return null;
  }
  if (res.status === 401) {
    const kropp = await res.text();
    if (/vercel|authenticate|sso/i.test(kropp)) {
      fail(
        "deployen är skyddad av Vercel Authentication",
        "sätt VERCEL_AUTOMATION_BYPASS_SECRET i miljön",
      );
      return null;
    }
    pass("endpointen svarar 401 på en osignerad POST (finns, kör, avvisar)");
  } else if (res.status === 500) {
    fail(
      "endpointen svarar 500 — den är inte konfigurerad",
      "saknas OVERLAY_PUBLISH_SECRET eller SUPABASE_SERVICE_ROLE_KEY i Vercel?",
    );
    return null;
  } else {
    fail("endpointen svarar 401 på en osignerad POST", `fick ${res.status}`);
    return null;
  }

  // ARRAYFRÅGA, inte maybeSingle: en array skiljer [] (inga rader) från null
  // (fel). maybeSingle svarar null i BÅDA fallen, och då är spärren borta.
  const kor = async (loffe, vad) => {
    try {
      return await loffe();
    } catch (err) {
      return { data: null, error: { message: `${vad} kastade: ${err?.message ?? String(err)}` } };
    }
  };

  const reg = await kor(
    () =>
      anon
        .from(REGISTER)
        .select("cfarnr,orgnr,firma,namn,kommun,ng1,poang,infotext,logotyp")
        .eq("cfarnr", Number(CFARNR)),
    REGISTER,
  );
  if (reg.error) {
    fail(`kunde inte läsa ${REGISTER}`, reg.error.message);
    return null;
  }
  const foretag = (reg.data ?? [])[0];
  if (!foretag) {
    fail(`cfarnr ${CFARNR} finns inte i ${REGISTER}`);
    return null;
  }
  pass(`cfarnr finns i registret: ${foretag.firma ?? foretag.namn}`);

  ORGNR = (foretag.orgnr ?? "").replace(/\D/g, "") || null;
  info(ORGNR ? `orgnr: ${ORGNR} (bolagsnivån testas)` : "inget orgnr (enskild firma) — bolagsnivån hoppas över");

  // Ett företag som redan har poang i registret är en befintlig betalkund.
  // Skriptet skriver inte över dem, men det ska inte heller tolka deras
  // befintliga listplacering som ett bevis på att overlay fungerar.
  if ((foretag.poang ?? 0) > 0) {
    info(`OBS: företaget har redan poang ${foretag.poang} i registret (äldre betallager)`);
  }

  for (const [typ, id] of [["arbetsstalle", CFARNR], ...(ORGNR ? [["bolag", ORGNR]] : [])]) {
    const q = await kor(() => overlayFraga(typ, id), TABELL);
    if (q.error) {
      fail(`kunde inte läsa ${TABELL} (${typ})`, q.error.message);
      return null;
    }
    if ((q.data ?? []).length > 0) {
      fail(
        `${typ} ${id} har redan en overlay-rad`,
        "skriptet vägrar röra en identitet som kan vara en riktig kund",
      );
      return null;
    }
  }
  pass("ingen overlay-rad sedan tidigare (någon status, båda nivåerna)");

  // Först HÄR får städningen lov att radera.
  farStada = true;
  return foretag;
}

// ── Steg 1: publish på arbetsställenivå ─────────────────────────────────────

async function steg1(foretag) {
  steg(1, "publish rev 1 (arbetsstalle)");
  const svar = await skicka(
    byggPayload({
      action: "publish",
      revision: 1,
      extra: { logo: { data_base64: PNG_B64, mime: "image/png" } },
    }),
  );
  kolla(svar.kod === 200 && svar.ok === true, "HTTP 200 och ok", `fick ${svar.kod} ${svar.error ?? ""}`);
  kolla(svar.revision === 1, "svaret bär revision 1", `fick ${svar.revision}`);
  kolla(
    Array.isArray(svar.revalidated) && svar.revalidated.length > 0,
    "endpointen rapporterar revaliderade paths",
    JSON.stringify(svar.revalidated),
  );
  info(`revaliderat: ${(svar.revalidated ?? []).join(", ")}`);

  const { live, utkast } = await rader();
  kolla(live?.status === "aktiv", "raden är aktiv", `status ${live?.status}`);
  kolla(live?.revision === 1, "raden har revision 1", `revision ${live?.revision}`);
  kolla(live?.featured === true && live?.list_priority === 900, "featured och list_priority skrevs");
  kolla(Boolean(live?.published_at), "published_at sattes");
  kolla(utkast === null, "ingen utkastrad skapades av en publish");

  // Saneringen sker i mottagaren. <script> ska vara borta, markören kvar.
  kolla(
    (live?.info_html ?? "").includes(NONCE) && !(live?.info_html ?? "").includes("<script"),
    "info_html sparades saniterad",
    live?.info_html,
  );

  // ── 1.1-fälten ────────────────────────────────────────────────────────────
  kolla(Number(live?.contract_version) === 1.1, "contract_version lagrades som 1.1 (inte avrundat till 1)", `fick ${live?.contract_version}`);
  kolla(live?.popularnamn === POPULARNAMN, "popularnamn lagrades", `fick ${live?.popularnamn}`);
  kolla(live?.telefon_typ === "vaxel", "telefon_typ lagrades", `fick ${live?.telefon_typ}`);
  kolla(
    JSON.stringify(live?.kategorier) === JSON.stringify(["Tandvård", "Akut"]),
    "kategorier lagrades",
    JSON.stringify(live?.kategorier),
  );
  kolla(
    live?.adress_override_besok?.gata === "Verifieringsgatan 1",
    "adress_override_besok lagrades",
    JSON.stringify(live?.adress_override_besok),
  );

  const fil = await filFinns();
  kolla(fil.ok, "logotypen ligger i bucketen", `filer: ${JSON.stringify(fil.filer ?? fil.orsak)}`);
  kolla(
    Boolean(live?.logo_url) && live.logo_url.includes(BUCKET),
    "logo_url pekar på sajtens bucket",
    live?.logo_url,
  );
  if (live?.logo_url) {
    const bild = await fetch(live.logo_url);
    kolla(bild.ok, "logotypen går att hämta publikt", `HTTP ${bild.status}`);
  }

  // ── Renderingen ───────────────────────────────────────────────────────────
  const sidor = (svar.revalidated ?? []).filter((p) => p.startsWith(`${FORETAG_BAS}/`));
  if (sidor.length === 0) {
    fail("endpointen rapporterade ingen företagssida att revalidera");
    return null;
  }
  const foretagssida = sidor[0];
  const detalj = await vantaPa(foretagssida, (r) => r.html.includes(NONCE));
  kolla(detalj.ok, `företagssidan visar den betalda profilen (${foretagssida})`, `försök ${detalj.forsok}, HTTP ${detalj.svar?.kod}`);
  if (detalj.ok) {
    kolla(detalj.svar.html.includes(POPULARNAMN), "populärnamnet renderas");
    kolla(detalj.svar.html.includes("Akut"), "kategorierna renderas");
    kolla(
      !detalj.svar.html.includes("<script>alert(1)</script>"),
      "det osanerade skriptet finns INTE i HTML:en",
    );
    // dolj_andra_nummer var true och ett eget nummer skickades: registrets
    // nummer ska vara borta ur huvudet.
    if (foretag.tel) {
      kolla(
        !detalj.svar.html.includes(foretag.tel),
        "dolj_andra_nummer döljer registrets nummer",
      );
    }
  }

  // Listsidorna gissas inte fram: endpointen har just talat om exakt vilka
  // ytor raden påverkar. Är listan tom är DET felet — inte att vi letade fel.
  const listor = (svar.revalidated ?? []).filter((p) => p.startsWith("/kommun/"));
  kolla(listor.length > 0, "endpointen revaliderade minst en listsida", JSON.stringify(svar.revalidated));

  /**
   * Lyftet är SIDLOKALT, och kontrollen måste vara ärlig om det.
   *
   * ordnaBoostade() sorterar de rader som listsidan faktiskt hämtade. Finns
   * företaget inte i sidans urval — en kommunsida visar tolv företag, sorterade
   * på antal anställda — finns det ingenting att lyfta, och att kräva "Utvald"
   * där vore att kräva något koden aldrig lovat.
   *
   * Så: står företaget på sidan MÅSTE det vara märkt utvalt. Står det inte där
   * rapporteras det som en upplysning, inte ett fel. Se OVERLAY.md,
   * "Vad lyftet inte gör".
   */
  const slugg = foretagssida.slice(FORETAG_BAS.length + 1);
  for (const lista of listor.slice(0, 3)) {
    const r = await vantaPa(lista, (x) => x.kod === 200 && x.html.includes(slugg), {
      forsok: 6,
    });
    if (!r.ok) {
      info(`${lista}: företaget ligger utanför sidans urval — inget att lyfta`);
      continue;
    }
    kolla(
      r.svar.html.includes("Utvald"),
      `listsidan visar företaget som utvalt (${lista})`,
      "företaget står på sidan men saknar utvald-märkningen",
    );
  }

  // Söksidan är force-dynamic — ingen väntan behövs, den läser overlay direkt.
  const sok = await hamta(`/sok?q=${encodeURIComponent("Verifieringssökord")}`);
  info(`/sok svarade HTTP ${sok.kod}`);

  return foretagssida;
}

// ── Steg 1b: en betald profil ligger ALDRIG på en noindex-sida ─────────────

/**
 * Kunden betalar för synlighet i Google. En publicerad profil på en sida som
 * ber Google att inte visa den är inte en avvägning utan en produkt som inte
 * levereras.
 *
 * Två håll måste stämma, och de kan gå isär var för sig:
 *   • sidan får inte svara noindex, och
 *   • sidan måste finnas i sitemapen — en sida som svarar index,follow men
 *     inte annonseras är samma fel spegelvänt.
 */
async function stegIndexerbarhet(foretagssida) {
  steg("1b", "betald profil är aldrig noindex");

  const sida = await hamta(foretagssida);
  kolla(sida.kod === 200, "företagssidan svarar 200", `HTTP ${sida.kod}`);

  const metaNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(
    sida.html,
  );
  const headerNoindex = /noindex/i.test(sida.headers.get("x-robots-tag") ?? "");
  kolla(
    !metaNoindex && !headerNoindex,
    "sidan svarar INTE noindex",
    metaNoindex ? "noindex i robots-metan" : "noindex i x-robots-tag",
  );

  if (!SITEMAP_LISTAR_FORETAG) {
    info("sajtens sitemap listar inga företagssidor — inget att kontrollera där");
    return;
  }

  /**
   * SITEMAPEN KONTROLLERAS INTE PER AUTOMATIK, och det är ett mätt beslut.
   *
   * Att sitemapen TAR MED betalda profiler är bevisat på två andra ställen:
   * scripts/check-sitemap-noindex.mjs avbryter bygget om src/app/sitemap.ts
   * slutar fråga overlayIndexerbaraSokvagar(), och en körning mot en lokal
   * server visar sidan i sitemap.xml direkt.
   *
   * Det som INTE går att kontrollera i en tvåminuterskörning är hur snabbt
   * PRODUKTIONENS sitemap hinner ikapp. Mätt mot hantverkardelen.se
   * 2026-09-16: `revalidatePath("/sitemap.xml")` från endpointen slog inte
   * igenom på 300 sekunder — `x-vercel-cache` svarade HIT hela vägen och `age`
   * växte i takt med klockan. Sidrevalideringen fungerar (steg 1 bevisar det);
   * metadata-routens edge-cache gör det inte.
   *
   * Den verkliga gränsen är därför `revalidate = 3600` i sitemap.ts: upp till
   * en timme. Det är ofarligt — en sitemap är en ledtråd för upptäckt, och
   * Google hämtar den ändå på sin egen kadens, oftast en gång per dygn. Det
   * som MÅSTE gälla omedelbart är att sidan inte svarar noindex, och det
   * kontrolleras ovan.
   *
   * Kör med --sitemap för att ändå vänta ut den.
   */
  if (!flagga("sitemap")) {
    info("sitemap-kontrollen hoppas över (kör med --sitemap; tar upp till en timme)");
    return;
  }
  const i = await vantaPa("/sitemap.xml", (r) => r.html.includes(foretagssida), {
    forsok: 120,
    paus: 30000,
  });
  kolla(i.ok, "företagssidan finns i sitemap.xml", `gav upp efter ${i.forsok} försök`);
}

// ── Steg 2: idempotens och konflikt ─────────────────────────────────────────

async function steg2() {
  steg(2, "omspelning och konflikt");

  const fore = (await rader()).live;

  // Samma revision, samma innehåll → ofarligt återförsök ur kön.
  const retry = await skicka(
    byggPayload({
      action: "publish",
      revision: 1,
      extra: { logo: { data_base64: PNG_B64, mime: "image/png" } },
    }),
  );
  kolla(retry.kod === 200, "samma revision + samma innehåll → 200", `fick ${retry.kod} ${retry.error ?? ""}`);
  const efterRetry = (await rader()).live;
  kolla(
    efterRetry?.payload_hash === fore?.payload_hash,
    "återförsöket skrev ingenting (payload_hash oförändrad)",
  );

  // Samma revision, ANNAT innehåll → två versioner delar nummer. 409.
  const krock = await skicka(
    byggPayload({ action: "publish", revision: 1, extra: { list_priority: 5 } }),
  );
  kolla(krock.kod === 409, "samma revision + annat innehåll → 409", `fick ${krock.kod} ${krock.error ?? ""}`);

  // Lägre revision → gammalt paket eller omspelning. 409.
  await skicka(byggPayload({ action: "publish", revision: 2 }));
  const gammal = await skicka(byggPayload({ action: "publish", revision: 1 }));
  kolla(gammal.kod === 409, "lägre revision → 409 (omspelning stoppad)", `fick ${gammal.kod}`);
}

// ── Steg 3: bolagsnivån och företrädesregeln ────────────────────────────────

async function steg3(foretagssida) {
  steg(3, "bolagsnivå + mest specifik vinner");
  if (!ORGNR) {
    info("inget orgnr på registerraden — steget hoppas över");
    return;
  }

  // Egen markör, INTE `${NONCE}-bolag`: en superstring hade gjort varje
  // `includes(NONCE)`-kontroll sann även när det är bolagsraden som renderas,
  // och steg 4 hade då aldrig kunnat skilja de två åt.
  const bolagsNonce = NONCE.replace("verifiering", "bolagsniva");
  BOLAGSNONCE = bolagsNonce;
  const svar = await skicka(
    byggPayload({
      action: "publish",
      revision: 1,
      entityType: "bolag",
      externalId: ORGNR,
      extra: { info_html: `<p>${bolagsNonce}</p>`, popularnamn: null, featured: false },
    }),
  );
  kolla(svar.kod === 200, "bolagsraden publiceras", `fick ${svar.kod} ${svar.error ?? ""}`);

  const bolag = await rader("bolag", ORGNR);
  kolla(bolag.live?.status === "aktiv", "bolagsraden är aktiv");
  kolla(
    (await rader("arbetsstalle", CFARNR)).live?.status === "aktiv",
    "arbetsställeraden är orörd av bolagspubliceringen",
  );

  // Företrädesregeln: sidan ska visa ARBETSSTÄLLETS profil, inte bolagets.
  const sida = await vantaPa(foretagssida, (r) => r.html.includes(NONCE));
  kolla(
    sida.ok && sida.svar.html.includes(NONCE) && !sida.svar.html.includes(bolagsNonce),
    "företagssidan visar arbetsställets profil, inte bolagets",
    "mest specifik ska vinna",
  );
}

// ── Steg 4: unpublish ───────────────────────────────────────────────────────

async function steg4() {
  steg(4, "unpublish");

  // Revisionen är monoton också för unpublish — annars kan ett gammalt
  // publish-paket spelas upp efteråt och återuppliva kunden.
  const forTidigt = await skicka(byggPayload({ action: "unpublish", revision: 1 }));
  kolla(forTidigt.kod === 409, "unpublish med lägre revision → 409", `fick ${forTidigt.kod}`);

  const ok = await skicka(byggPayload({ action: "unpublish", revision: 3 }));
  kolla(ok.kod === 200, "unpublish rev 3 → 200", `fick ${ok.kod} ${ok.error ?? ""}`);

  const { live } = await rader();
  kolla(live?.status === "inaktiv", "raden är inaktiv", `status ${live?.status}`);

  // Filen ska ÖVERLEVA. En kund som publiceras igen ska få tillbaka sin
  // logotyp utan att CRM:et behöver skicka om bilden.
  const fil = await filFinns();
  kolla(fil.ok, "logotypfilen ligger kvar efter unpublish", JSON.stringify(fil.filer));

  /**
   * Vad företagssidan ska visa när ARBETSSTÄLLETS köp tagits ner.
   *
   * Inte registerdatan — utan BOLAGETS profil, om steg 3 hann publicera en.
   * Det är företrädesregeln baklänges: mest specifik vinner, och när den
   * specifika försvinner tar den bredare över. Att kräva en naken registerrad
   * här hade varit att testa fel sak.
   */
  const sidor = (ok.revalidated ?? []).filter((p) => p.startsWith(`${FORETAG_BAS}/`));
  if (sidor.length > 0) {
    const harBolagsrad = BOLAGSNONCE !== null;
    const r = await vantaPa(sidor[0], (x) => !x.html.includes(NONCE));
    kolla(r.ok, "arbetsställets profil är borta från företagssidan", `försök ${r.forsok}`);
    if (harBolagsrad && r.ok) {
      kolla(
        r.svar.html.includes(BOLAGSNONCE),
        "sidan faller tillbaka på bolagets profil",
        "mest specifik vann; när den tas ner ska den bredare ta över",
      );
    }
  }

  // Och en uppspelad publish av rev 1 får inte återuppliva den.
  const omspelning = await skicka(byggPayload({ action: "publish", revision: 1 }));
  kolla(omspelning.kod === 409, "uppspelad publish rev 1 → 409 (kunden kommer inte tillbaka)", `fick ${omspelning.kod}`);
}

// ── Steg 5: preview ─────────────────────────────────────────────────────────

async function steg5() {
  steg(5, "preview");

  const rev = 4;
  const token = previewToken(CFARNR, rev);
  const svar = await skicka(
    byggPayload({
      action: "preview",
      revision: rev,
      extra: { preview_token: token, info_html: `<p>${NONCE}-utkast</p>` },
    }),
  );
  kolla(svar.kod === 200, "preview → 200", `fick ${svar.kod} ${svar.error ?? ""}`);
  kolla(Boolean(svar.preview_url), "svaret bär en preview_url", JSON.stringify(svar));

  const { live, utkast, antal } = await rader();
  kolla(antal === 2, "identiteten har två rader: en live och ett utkast", `antal ${antal}`);
  kolla(utkast?.status === "utkast", "utkastraden finns");
  kolla(live?.status === "inaktiv" && live?.revision === 3, "live-raden är orörd av förhandsvisningen");

  if (svar.preview_url) {
    const url = new URL(svar.preview_url);
    const r = await hamta(url.pathname + url.search);
    kolla(r.kod === 200, "förhandsvisningen svarar 200", `HTTP ${r.kod}`);
    kolla(r.html.includes(`${NONCE}-utkast`), "förhandsvisningen visar utkastet");
    const robots = r.headers.get("x-robots-tag") ?? "";
    kolla(
      /noindex/i.test(robots) || /noindex/i.test(r.html),
      "förhandsvisningen är noindex",
      `x-robots-tag: ${robots || "(saknas)"}`,
    );

    // Utan token ska det inte finnas någon sida alls.
    const utanToken = await hamta(url.pathname);
    kolla(utanToken.kod === 404, "förhandsvisning utan token → 404", `HTTP ${utanToken.kod}`);

    // En token för fel revision ska inte duga.
    const felToken = previewToken(CFARNR, 99);
    const fel2 = await hamta(`${url.pathname}?preview=${encodeURIComponent(felToken)}`);
    kolla(fel2.kod === 404, "token för fel revision → 404", `HTTP ${fel2.kod}`);
  }
}

// ── Steg 6: kontraktets grindar ─────────────────────────────────────────────

async function steg6() {
  steg(6, "kontraktets grindar");

  const felSignatur = await skicka(byggPayload({ action: "publish", revision: 10 }), {
    signeraMed: "0".repeat(64),
  });
  kolla(felSignatur.kod === 401, "fel signatur → 401", `fick ${felSignatur.kod}`);

  const gammal = await skicka(
    byggPayload({
      action: "publish",
      revision: 10,
      sentAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }),
  );
  kolla(gammal.kod === 401, "sent_at 10 minuter gammal → 401", `fick ${gammal.kod}`);

  const forHog = await skicka(
    byggPayload({ action: "publish", revision: 10, extra: { contract_version: 2 } }),
  );
  kolla(forHog.kod === 409, "contract_version 2 → 409", `fick ${forHog.kod}`);

  const felSajt = await skicka(
    byggPayload({ action: "publish", revision: 10, extra: { sajt: "nagon-annan-sajt" } }),
  );
  kolla(felSajt.kod === 400, "fel sajt → 400", `fick ${felSajt.kod}`);

  const okantFalt = await skicka(
    byggPayload({ action: "publish", revision: 10, extra: { pahittat_falt: true } }),
  );
  kolla(okantFalt.kod === 400, "okänt fält → 400 (schemat är strict)", `fick ${okantFalt.kod}`);

  // En HTML-fil som utger sig för att vara PNG. Magic bytes ska avslöja den.
  const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
  const luras = await skicka(
    byggPayload({
      action: "publish",
      revision: 10,
      extra: { logo: { data_base64: html, mime: "image/png" } },
    }),
  );
  kolla(luras.kod === 400, "HTML som påstår sig vara PNG → 400", `fick ${luras.kod} ${luras.error ?? ""}`);

  const felTelefontyp = await skicka(
    byggPayload({ action: "publish", revision: 10, extra: { telefon_typ: "faxen" } }),
  );
  kolla(felTelefontyp.kod === 400, "ogiltig telefon_typ → 400", `fick ${felTelefontyp.kod}`);

  const forManyKategorier = await skicka(
    byggPayload({
      action: "publish",
      revision: 10,
      extra: { kategorier: ["a", "b", "c", "d", "e"] },
    }),
  );
  kolla(forManyKategorier.kod === 400, "fem kategorier → 400 (max är fyra)", `fick ${forManyKategorier.kod}`);

  // `bas` utan `skapa_om_saknas` är en halv mening enligt kontraktet.
  const basUtanLov = await skicka(
    byggPayload({
      action: "publish",
      revision: 10,
      extra: { bas: { namn: "Testbolaget" } },
    }),
  );
  kolla(basUtanLov.kod === 400, "bas utan skapa_om_saknas → 400", `fick ${basUtanLov.kod}`);
}

// ── Körning ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\x1b[1mVerifiering av overlay-kontrakt v1.1 — ${SAJT}\x1b[0m`);
  const foretag = await forutsattningar();
  if (!foretag) {
    console.log("\n\x1b[31mFörutsättningarna håller inte. Inget kördes.\x1b[0m");
    process.exit(1);
  }

  try {
    const foretagssida = await steg1(foretag);
    if (foretagssida) await stegIndexerbarhet(foretagssida);
    await steg2();
    if (foretagssida) await steg3(foretagssida);
    await steg4();
    await steg5();
    await steg6();
  } finally {
    await stada();
  }

  console.log(
    fel === 0
      ? "\n\x1b[32m\x1b[1mAlla kontroller gick igenom.\x1b[0m"
      : `\n\x1b[31m\x1b[1m${fel} kontroll(er) föll.\x1b[0m`,
  );
  process.exit(fel === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n\x1b[31mAvbrott:\x1b[0m", err?.message ?? err);
  try {
    await stada();
  } catch (stadFel) {
    console.error("Städningen misslyckades också:", stadFel?.message ?? stadFel);
  }
  process.exit(1);
});
