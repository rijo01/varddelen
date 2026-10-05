#!/usr/bin/env node
/**
 * Verifiering av kontaktspärren (overlay-kontrakt 1.2), mot en riktig deploy.
 *
 * TVÅ LÄGEN.
 *
 * 1. Syntetiskt prov (skriver, städar efter sig):
 *
 *      npm run kontaktsparr:verifiera -- --url https://varddelen.se --cfarnr <cfarnr>
 *
 *    Bevisar varje led med ett FIKTIVT nummer — 070-174 06 05, ur serien som
 *    PTS reserverat för film, tv och test och som aldrig delas ut. Numret läggs
 *    i ett overlay-UTKAST för `--cfarnr` (syns bara bakom ?preview=, noindex),
 *    och spärren läggs med scope `sajt`, så att ingen annan sajt berörs.
 *
 *      0. förutsättningar  — utkast och spärr saknas sedan tidigare
 *      1. kontrollprov     — UTAN spärr syns numret i telefonfält, fritext,
 *                            sökord och JSON-LD, och sökfrågan ger träffar.
 *                            Utan det provet bevisar steg 3 ingenting.
 *      2. spärra           — signerat paket → 200, raden aktiv, händelsen loggad
 *      3. efter spärren    — telefonfältet tomt, fritexten skrubbad (texten
 *                            runt numret står kvar), JSON-LD utan numret,
 *                            sök → 0 träffar, suggest → 0 förslag
 *      4. grindar          — signatur, nyckelform, version, sajt, sent_at,
 *                            återförsök och konflikt
 *      5. häv              — numret tillbaka, sökningen ger träffar igen
 *      6. omspelning       — det gamla spärrpaketet efter hävningen → 409
 *
 * 2. Skarpt fall (läser bara):
 *
 *      npm run kontaktsparr:verifiera -- --url https://varddelen.se \
 *        --fall 0705096502 --sida /foretag/<slug> --namn "IT BITEN DALARNA"
 *
 *    Bevisar att ett spärrat nummer inte returneras: inte på sidan, inte i
 *    JSON-LD, inte i sök eller förslag — och att sidan har genererats om efter
 *    att spärren lades (cachens ålder är yngre än spärren).
 *
 * Mönstret som letar efter numret är KONTRAKTETS, importerat ur sajtens egen
 * kopia. Verifieringen letar alltså efter exakt det sajten skrubbar.
 *
 * Kräver i miljön (kör med --env-file=.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, OVERLAY_PUBLISH_SECRET
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  kontaktsparrMonster,
  normaliseraTelefon,
} from "../src/lib/overlay-contract.ts";

// ── Sajtens konstanter ──────────────────────────────────────────────────────
// ENDA stället som skiljer sig mellan sajterna. Måste stämma med lib/overlay.ts.
const SAJT = "varddelen";

/** PTS:s fiktiva serie 070-174 06 05 – 070-174 06 99. Delas aldrig ut. */
const TESTNUMMER = "070-174 06 05";

// ── Argument och miljö ──────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BAS = (arg("url") ?? "").replace(/\/$/, "");
const CFARNR = arg("cfarnr");
const FALL = arg("fall");
const SECRET = process.env.OVERLAY_PUBLISH_SECRET;
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!BAS || (!CFARNR && !FALL)) {
  console.error(
    "Användning:\n" +
      "  --url <deploy> --cfarnr <cfarnr>                       syntetiskt prov\n" +
      "  --url <deploy> --fall <nummer> --sida <sökväg> --namn <namn>   skarpt fall",
  );
  process.exit(2);
}
for (const [namn, v] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPA_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
  ["OVERLAY_PUBLISH_SECRET", SECRET],
]) {
  if (!v) {
    console.error(`Saknar ${namn}. Kör med --env-file=.env.local.`);
    process.exit(2);
  }
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPA_URL, SERVICE_KEY, opts);
/** Registret läses med anon: service role har inte SELECT på foretag_publik. */
const anon = createClient(SUPA_URL, ANON_KEY, opts);

// ── Utskrift ────────────────────────────────────────────────────────────────

let fel = 0;
const steg = (n, titel) => console.log(`\n\x1b[1m── ${n}: ${titel}\x1b[0m`);
const pass = (t) => console.log(`  \x1b[32mPASS\x1b[0m  ${t}`);
const fail = (t, d = "") => {
  fel++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${t}${d ? `\n        ${d}` : ""}`);
};
const info = (t) => console.log(`  \x1b[2m·     ${t}\x1b[0m`);
const kolla = (v, t, d = "") => (v ? pass(t) : fail(t, d));

// ── Kontraktet ──────────────────────────────────────────────────────────────

const sign = (s) => createHmac("sha256", SECRET).update(s).digest("hex");

function previewToken(externalId, revision) {
  const kropp = Buffer.from(
    JSON.stringify({ e: externalId, r: revision, x: new Date(Date.now() + 3600_000).toISOString() }),
  ).toString("base64url");
  return `pv1.${kropp}.${sign(`pv1.${kropp}`)}`;
}

function deployHeaders(extra = {}) {
  return { ...extra, ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}) };
}

async function skicka(payload, { signatur = null, raw = null } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const res = await fetch(`${BAS}/api/overlay/publish`, {
    method: "POST",
    headers: deployHeaders({
      "content-type": "application/json",
      "x-overlay-signature": signatur ?? sign(body),
    }),
    body,
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

async function hamta(sokvag) {
  const res = await fetch(`${BAS}${sokvag}`, { redirect: "follow", headers: deployHeaders() });
  return { kod: res.status, html: await res.text(), headers: res.headers };
}

// ── Vad sidan innehåller ────────────────────────────────────────────────────

/** Förekomster av numret i texten, med kontraktets eget mönster. */
function forekomster(text, nyckel) {
  return (text.match(new RegExp(kontaktsparrMonster("telefon", nyckel), "g")) ?? []).length;
}

/** JSON-LD-blocken på sidan, som text. */
function jsonLd(html) {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** Antal träffar i en söklista: unika länkar till en företagssida. */
function traffar(html) {
  return new Set(html.match(/href="\/foretag\/[^"?]+"/g) ?? []).size;
}

/** Sidan utan själva sökfrågan, för den ekar tillbaka på resultatsidan. */
const sokSokvag = (q) => `/sok?q=${encodeURIComponent(q)}`;

// ════════════════════════════════════════════════════════════════════════════
// LÄGE 2: skarpt fall, bara läsning
// ════════════════════════════════════════════════════════════════════════════

async function skarptFall() {
  const nyckel = normaliseraTelefon(FALL);
  const sida = arg("sida");
  const namn = arg("namn");
  if (!nyckel) {
    console.error(`--fall ${FALL} är inte ett telefonnummer enligt kontraktet`);
    process.exit(2);
  }
  console.log(`\x1b[1mSkarpt fall på ${SAJT}\x1b[0m  ${BAS}`);

  steg("A", "spärren ligger i sajtens tabell");
  const { data: sparrar, error } = await admin
    .from("kontaktsparr")
    .select("scope,sajt,status,revision,updated_at")
    .eq("typ", "telefon")
    .eq("nyckel", nyckel)
    .or(`sajt.is.null,sajt.eq.${SAJT}`);
  if (error) fail("kunde inte läsa kontaktsparr", error.message);
  const aktiv = (sparrar ?? []).find((s) => s.status === "aktiv");
  kolla(Boolean(aktiv), "aktiv spärr som täcker sajten", JSON.stringify(sparrar));
  const { data: handelser } = await admin
    .from("kontaktsparr_handelse")
    .select("op,revision,berorda,created_at,revalidated")
    .eq("mottagen_av", SAJT)
    .eq("typ", "telefon")
    .eq("nyckel", nyckel)
    .order("created_at", { ascending: false })
    .limit(1);
  const senaste = handelser?.[0] ?? null;
  kolla(senaste?.op === "sparra", "sajtens senaste händelse för numret är en spärr");
  if (senaste) {
    info(`mottagen ${senaste.created_at}, ${senaste.berorda} bolag, ${senaste.revalidated.length} sidor revaliderade`);
  }

  if (sida) {
    steg("B", `sidan ${sida}`);
    const s = await hamta(sida);
    kolla(s.kod === 200, `sidan svarar 200 (${s.kod})`);
    kolla(forekomster(s.html, nyckel) === 0, "numret förekommer inte någonstans i svaret",
      `${forekomster(s.html, nyckel)} förekomster`);
    const ld = jsonLd(s.html);
    kolla(ld.length > 0 && ld.every((b) => forekomster(b, nyckel) === 0),
      `JSON-LD (${ld.length} block) utan numret`);
    kolla(!/tel:[^"]*7\D{0,3}0\D{0,3}5\D{0,3}0\D{0,3}9\D{0,3}6\D{0,3}5\D{0,3}0\D{0,3}2/.test(s.html),
      "ingen tel:-länk till numret");

    // Revalideringen: sidan ska vara genererad EFTER att spärren nådde sajten.
    const alder = Number(s.headers.get("age") ?? "0");
    const cache = s.headers.get("x-vercel-cache") ?? "?";
    if (senaste) {
      const sedanSparr = (Date.now() - Date.parse(senaste.created_at)) / 1000;
      kolla(alder <= sedanSparr,
        `cachens ålder (${alder} s, ${cache}) är yngre än spärren (${Math.round(sedanSparr)} s)`);
      kolla(senaste.revalidated.includes(sida), "sidan står bland de revaliderade");
    }
  }

  steg("C", "sök och förslag");
  const nr = await hamta(sokSokvag(FALL));
  kolla(traffar(nr.html) === 0, `/sok på numret → 0 träffar (${traffar(nr.html)})`);
  const e164 = await hamta(sokSokvag(`+${nyckel}`));
  kolla(traffar(e164.html) === 0, `/sok på +${nyckel} → 0 träffar (${traffar(e164.html)})`);
  const sug = await hamta(`/api/suggest?q=${encodeURIComponent(FALL)}`);
  let forslag = -1;
  try {
    forslag = JSON.parse(sug.html).suggestions.length;
  } catch {}
  kolla(forslag === 0, `/api/suggest på numret → 0 förslag (${forslag})`);
  if (namn) {
    const n = await hamta(sokSokvag(namn));
    kolla(traffar(n.html) > 0, `/sok på "${namn}" hittar fortfarande bolaget (${traffar(n.html)})`);
    kolla(forekomster(n.html, nyckel) === 0, "...men utan numret i träfflistan");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LÄGE 1: syntetiskt prov
// ════════════════════════════════════════════════════════════════════════════

const NYCKEL = normaliseraTelefon(TESTNUMMER);
const NONCE = `kontaktsparr-verifiering-${randomUUID().slice(0, 8)}`;
const ARENDE = `VERIFIERING-${NONCE.slice(-8)}`;
const ORDER_ID = randomUUID();
let PREVIEW_URL = null;
/**
 * Revisionen testspärren står på före provet. Spärrar RADERAS aldrig — service
 * role har inte ens DELETE på tabellen — de hävs. En tidigare körning lämnar
 * alltså en hävd rad efter sig, och provet fortsätter från dess nummer.
 */
let R0 = 0;
let SOKFRAGA = null;
let farStada = false;

function utkast(revision) {
  return {
    sajt: SAJT,
    entity_type: "arbetsstalle",
    external_id: CFARNR,
    order_id: ORDER_ID,
    revision,
    giltig_from: null,
    giltig_till: null,
    featured: false,
    list_priority: 0,
    keywords: [`Jour ${TESTNUMMER}`, "Verifieringssökord"],
    hemsida: null,
    telefon_override: TESTNUMMER,
    epost_override: null,
    kontaktperson: "Testkontakt",
    adress_override: null,
    info_html: `<p>Ring oss på ${TESTNUMMER} eller +46 70 174 06 05 – ${NONCE}</p><p><a href="tel:+46701740605">Ring</a></p>`,
    dolj_andra_nummer: true,
    preview_token: previewToken(CFARNR, revision),
    contract_version: 1.1,
    action: "preview",
    remove_logo: false,
    sent_at: new Date().toISOString(),
  };
}

function sparr(op, revision, extra = {}) {
  return {
    action: "kontaktsparr",
    op,
    sajt: SAJT,
    typ: "telefon",
    nyckel: NYCKEL,
    scope: "sajt",
    arende: ARENDE,
    revision,
    contract_version: 1.2,
    sent_at: new Date().toISOString(),
    ...extra,
  };
}

async function sparrRad() {
  const { data } = await admin
    .from("kontaktsparr")
    .select("status,revision,scope,sajt")
    .eq("sajt", SAJT)
    .eq("typ", "telefon")
    .eq("nyckel", NYCKEL)
    .maybeSingle();
  return data;
}

async function syntetiskt() {
  console.log(`\x1b[1mSyntetiskt prov på ${SAJT}\x1b[0m  ${BAS}  testnummer ${TESTNUMMER} (PTS fiktiv serie)`);

  steg("0", "förutsättningar");
  const { data: rad } = await anon
    .from("foretag_publik")
    .select("cfarnr,firma,namn")
    .eq("cfarnr", Number(CFARNR))
    .maybeSingle();
  if (!rad) {
    fail(`cfarnr ${CFARNR} finns inte i registret`);
    return;
  }
  const { data: overlay } = await admin
    .from("overlay_profil")
    .select("id,status")
    .eq("sajt", SAJT)
    .eq("external_id", CFARNR);
  if ((overlay ?? []).length > 0) {
    fail(`cfarnr ${CFARNR} har redan overlay-rader — en riktig kund blir inte testdata`);
    return;
  }
  const tidigare = await sparrRad();
  if (tidigare?.status === "aktiv") {
    fail("testnumret är spärrat på sajten — en tidigare körning avbröts; häv spärren och kör om");
    return;
  }
  R0 = tidigare?.revision ?? 0;
  pass(`testbolag ${rad.firma ?? rad.namn} (${CFARNR}) utan overlay, testnumret ospärrat (rev ${R0})`);
  farStada = true;

  // Sökfrågan: bolagets namn ELLER testnumret. Utan spärr ger namnet träffar;
  // med spärr ska frågan som helhet ge noll, eftersom den innehåller numret.
  const ord = (rad.firma ?? rad.namn ?? "").split(/\s+/).find((w) => w.length >= 4) ?? "AB";
  SOKFRAGA = `${ord} or ${TESTNUMMER.replace(/\s/g, "")}`;

  steg("1", "kontrollprov — utan spärr syns numret");
  const p = await skicka(utkast(1));
  kolla(p.kod === 200 && p.preview_url, `utkast sparat (${p.kod})`, p.error);
  PREVIEW_URL = p.preview_url ? new URL(p.preview_url).pathname + new URL(p.preview_url).search : null;
  if (!PREVIEW_URL) return;
  const fore = await hamta(PREVIEW_URL);
  kolla(fore.html.includes(NONCE), "förhandsvisningen renderar utkastet");
  kolla(forekomster(fore.html, NYCKEL) > 0, `numret syns (${forekomster(fore.html, NYCKEL)} förekomster)`);
  kolla(/href="tel:\+?[0-9]/.test(fore.html), "telefonfältet renderas som tel:-länk");
  const sokFore = await hamta(sokSokvag(SOKFRAGA));
  kolla(traffar(sokFore.html) > 0, `sökningen "${SOKFRAGA}" ger träffar utan spärr (${traffar(sokFore.html)})`);

  steg("2", "spärra — signerat paket, scope sajt");
  const s1 = await skicka(sparr("sparra", R0 + 1));
  kolla(s1.kod === 200 && s1.ok, `200 ok (${s1.kod})`, s1.error);
  info(`berörda bolag i registret: ${s1.berorda}, revaliderade sidor: ${(s1.revalidated ?? []).length}`);
  const r1 = await sparrRad();
  kolla(r1?.status === "aktiv" && r1.revision === R0 + 1 && r1.scope === "sajt", `raden är aktiv, rev ${R0 + 1}, scope sajt`);
  const { data: h1 } = await admin
    .from("kontaktsparr_handelse")
    .select("op,arende")
    .eq("arende", ARENDE)
    .eq("op", "sparra");
  kolla((h1 ?? []).length === 1, "händelsen loggad hos sajten");

  steg("3", "efter spärren");
  const efter = await hamta(PREVIEW_URL);
  kolla(efter.html.includes(NONCE), "förhandsvisningen renderar fortfarande utkastet");
  kolla(forekomster(efter.html, NYCKEL) === 0, "numret förekommer inte någonstans i svaret",
    `${forekomster(efter.html, NYCKEL)} förekomster`);
  kolla(efter.html.includes("Ring oss på"), "fritexten är skrubbad, inte borttagen — texten runt numret står kvar");
  kolla(efter.html.includes("Verifieringssökord"), "sökorden utan numret står kvar");
  const ld = jsonLd(efter.html);
  kolla(ld.length > 0 && ld.every((b) => forekomster(b, NYCKEL) === 0), `JSON-LD (${ld.length} block) utan numret`);
  const sokEfter = await hamta(sokSokvag(SOKFRAGA));
  kolla(traffar(sokEfter.html) === 0, `sökningen "${SOKFRAGA}" → 0 träffar (${traffar(sokEfter.html)})`);
  const sokNr = await hamta(sokSokvag("+46701740605"));
  kolla(traffar(sokNr.html) === 0, `sökning på +46701740605 → 0 träffar`);
  const sug = await hamta(`/api/suggest?q=${encodeURIComponent(TESTNUMMER)}`);
  let antalForslag = -1;
  try {
    antalForslag = JSON.parse(sug.html).suggestions.length;
  } catch {}
  kolla(antalForslag === 0, `/api/suggest → 0 förslag (${antalForslag})`);

  steg("4", "kontraktets grindar");
  const g1 = await skicka(sparr("sparra", R0 + 1), { signatur: "0".repeat(64) });
  kolla(g1.kod === 401, `fel signatur → 401 (${g1.kod})`);
  const g2 = await skicka(sparr("sparra", R0 + 2, { nyckel: "0701740605" }));
  kolla(g2.kod === 400, `onormaliserad nyckel → 400 (${g2.kod})`);
  const g3 = await skicka(sparr("sparra", R0 + 2, { contract_version: 1.3 }));
  kolla(g3.kod === 409, `kontraktsversion 1.3 → 409 (${g3.kod})`);
  const g4 = await skicka(sparr("sparra", R0 + 2, { sajt: "nagon-annan" }));
  kolla(g4.kod === 400, `fel sajt → 400 (${g4.kod})`);
  const g5 = await skicka(sparr("sparra", R0 + 2, { sent_at: new Date(Date.now() - 3600_000).toISOString() }));
  kolla(g5.kod === 401, `sent_at en timme gammal → 401 (${g5.kod})`);
  const g6 = await skicka(sparr("sparra", R0 + 1));
  kolla(g6.kod === 200 && g6.ok, `samma paket igen → 200, ett återförsök (${g6.kod})`);
  const g7 = await skicka(sparr("sparra", R0 + 1, { arende: `${ARENDE}-X` }));
  kolla(g7.kod === 409, `samma revision, annat innehåll → 409 (${g7.kod})`);
  const g8 = await skicka(sparr("sparra", R0 + 2, { namn: "Någon" }));
  kolla(g8.kod === 400, `okänt fält (namn) → 400 (${g8.kod})`);

  steg("5", "häv");
  const h = await skicka(sparr("hav", R0 + 2));
  kolla(h.kod === 200 && h.ok, `200 ok (${h.kod})`, h.error);
  kolla((await sparrRad())?.status === "havd", `raden är hävd, rev ${R0 + 2}`);
  const tillbaka = await hamta(PREVIEW_URL);
  kolla(forekomster(tillbaka.html, NYCKEL) > 0, "numret syns igen — frånvaron i steg 3 var spärrens verk");
  const sokTillbaka = await hamta(sokSokvag(SOKFRAGA));
  kolla(traffar(sokTillbaka.html) > 0, `sökningen ger träffar igen (${traffar(sokTillbaka.html)})`);

  steg("6", "omspelning");
  const o = await skicka(sparr("sparra", R0 + 1));
  kolla(o.kod === 409, `spärrpaketet rev ${R0 + 1} efter hävningen rev ${R0 + 2} → 409 (${o.kod})`);
}

async function stada() {
  if (!farStada) return;
  console.log("\n\x1b[1m── städning\x1b[0m");
  const { error: e1 } = await admin
    .from("overlay_profil")
    .delete()
    .eq("sajt", SAJT)
    .eq("external_id", CFARNR)
    .eq("status", "utkast");
  kolla(!e1, "testutkastet borttaget", e1?.message);
  // Spärren raderas inte — den hävs, och det gjorde steg 5. Står den aktiv här
  // avbröts provet mitt i, och då ska det synas.
  const kvar = await sparrRad();
  kolla(!kvar || kvar.status === "havd", "testspärren är hävd (raden står kvar, hävd, med flit)",
    `status ${kvar?.status}`);
  info(`händelseloggen behåller provets rader (ärende ${ARENDE}) — den är bara-tillägg, med flit`);
}

try {
  if (FALL) await skarptFall();
  else await syntetiskt();
} catch (e) {
  fail("oväntat fel", e?.stack ?? String(e));
} finally {
  await stada();
}
console.log(fel === 0 ? "\n\x1b[32mALLT GRÖNT\x1b[0m" : `\n\x1b[31m${fel} FEL\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
