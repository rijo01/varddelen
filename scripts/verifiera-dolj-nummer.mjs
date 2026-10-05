#!/usr/bin/env node
/**
 * `dolj_andra_nummer` på varje yta, mot en riktig deploy.
 *
 *   npm run dolj:verifiera -- --url https://varddelen.se --cfarnr <cfarnr>
 *
 * En betalande kund som köpt bort registrets nummer ska aldrig få det visat —
 * inte i profilens huvud, inte i FAQ:n (HTML och FAQPage-JSON-LD), inte i
 * LocalBusiness-JSON-LD och inte i listkorten. Före 2026-10-05 läste FAQ:n och
 * korten `f.tel` direkt.
 *
 *   0. förutsättningar — bolaget har ett nummer i registret och ingen overlay
 *   1. publicera: dolj_andra_nummer + eget nummer (PTS fiktiva 070-174 06 10)
 *   2. profilsidan     — registrets nummer 0 gånger, det egna i huvud, FAQ, JSON-LD
 *   3. listkortet      — söklistan: kortet visar det egna, aldrig registrets
 *   4. avpublicera     — registrets nummer tillbaka: frånvaron var overlayns verk
 *
 * SKRIVER I PRODUKTION, en aktiv profil i någon minut. Vägrar köra mot ett
 * bolag som redan har en overlay-rad, och städar alltid efter sig.
 *
 * Kör med --env-file=.env.local (NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OVERLAY_PUBLISH_SECRET).
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { kontaktsparrMonster, normaliseraTelefon } from "../src/lib/overlay-contract.ts";

// ENDA raden som skiljer sig mellan sajterna.
const SAJT = "varddelen";

const EGET = "070-174 06 10";
const argv = process.argv.slice(2);
const arg = (n) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : null);
const BAS = (arg("url") ?? "").replace(/\/$/, "");
const CFARNR = arg("cfarnr");
if (!BAS || !CFARNR) {
  console.error("Användning: --url <deploy> --cfarnr <cfarnr>");
  process.exit(2);
}
const SECRET = process.env.OVERLAY_PUBLISH_SECRET;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);

let fel = 0;
const pass = (t) => console.log(`  \x1b[32mPASS\x1b[0m  ${t}`);
const fail = (t, d = "") => {
  fel++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${t}${d ? `\n        ${d}` : ""}`);
};
const kolla = (v, t, d = "") => (v ? pass(t) : fail(t, d));
const steg = (n, t) => console.log(`\n\x1b[1m── ${n}: ${t}\x1b[0m`);

const sign = (s) => createHmac("sha256", SECRET).update(s).digest("hex");
const ORDER_ID = randomUUID();

function paket(action, revision) {
  return {
    sajt: SAJT, entity_type: "arbetsstalle", external_id: CFARNR, order_id: ORDER_ID, revision,
    giltig_from: null, giltig_till: null, featured: true, list_priority: 900, keywords: [],
    hemsida: null, telefon_override: action === "unpublish" ? null : EGET, epost_override: null,
    kontaktperson: null, adress_override: null, info_html: null,
    dolj_andra_nummer: action !== "unpublish", preview_token: null, contract_version: 1.1,
    action, remove_logo: false, sent_at: new Date().toISOString(),
  };
}

async function skicka(p) {
  const raw = JSON.stringify(p);
  const res = await fetch(`${BAS}/api/overlay/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-overlay-signature": sign(raw) },
    body: raw,
  });
  return { kod: res.status, ...(await res.json().catch(() => ({}))) };
}

const hamta = async (p) => {
  const r = await fetch(`${BAS}${p}`, { redirect: "follow" });
  return { kod: r.status, html: await r.text() };
};
const antal = (text, nyckel) => (text.match(new RegExp(kontaktsparrMonster("telefon", nyckel), "g")) ?? []).length;
const jsonLd = (html) =>
  [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/** ISR regenererar vid första requesten efter revalidatePath — polla hellre än sova. */
async function vanta(sokvag, villkor, forsok = 15) {
  let s = null;
  for (let i = 0; i < forsok; i++) {
    s = await hamta(sokvag);
    if (villkor(s)) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return s;
}

let farStada = false;
let revalidated = [];

async function main() {
  console.log(`\x1b[1mdolj_andra_nummer på ${SAJT}\x1b[0m  ${BAS}  cfarnr ${CFARNR}`);
  const nyEget = normaliseraTelefon(EGET);

  steg("0", "förutsättningar");
  const { data: rad } = await anon.from("foretag_publik").select("cfarnr,firma,namn,tel").eq("cfarnr", Number(CFARNR)).maybeSingle();
  const reg = normaliseraTelefon(rad?.tel ?? "");
  if (!rad || !reg) return fail("bolaget saknas eller har inget tolkbart nummer i registret");
  const { data: finns } = await admin.from("overlay_profil").select("id").eq("sajt", SAJT).eq("external_id", CFARNR);
  if ((finns ?? []).length) return fail("bolaget har redan overlay-rader — en riktig kund blir inte testdata");
  pass(`${rad.firma ?? rad.namn}: registrets nummer finns, ingen overlay`);
  farStada = true;

  steg("1", "publicera med dolj_andra_nummer och eget nummer");
  const p = await skicka(paket("publish", 1));
  kolla(p.kod === 200 && p.ok, `200 ok (${p.kod})`, p.error);
  revalidated = p.revalidated ?? [];
  const profil = revalidated.find((x) => x.startsWith("/foretag/"));
  if (!profil) return fail("revalideringen saknar profilsidan", JSON.stringify(revalidated));

  steg("2", `profilsidan ${profil}`);
  const s = await vanta(profil, (r) => antal(r.html, nyEget) > 0);
  kolla(antal(s.html, nyEget) > 0, `det egna numret syns (${antal(s.html, nyEget)})`);
  kolla(antal(s.html, reg) === 0, `registrets nummer förekommer inte (${antal(s.html, reg)})`);
  const faqLd = jsonLd(s.html).find((b) => b.includes("FAQPage")) ?? "";
  kolla(Boolean(faqLd) && antal(faqLd, reg) === 0 && antal(faqLd, nyEget) > 0, "FAQPage-JSON-LD: det egna numret, inte registrets");
  const lb = jsonLd(s.html).find((b) => b.includes('"telephone"')) ?? "";
  kolla(antal(lb, reg) === 0, "LocalBusiness-JSON-LD utan registrets nummer");

  // Söklistan renderar samma CompanyCard som kommunsidorna, och bolaget hamnar
  // garanterat där. Kortprovet kräver att bolagets egen länk finns på sidan —
  // annars bevisar en nolla ingenting (första versionen av provet gjorde det).
  const sok = `/sok?q=${encodeURIComponent(rad.firma ?? rad.namn)}`;
  steg("3", `listkortet på ${sok}`);
  const l = await hamta(sok);
  kolla(l.html.includes(`-${CFARNR}"`), "bolagets kort finns i listan");
  kolla(antal(l.html, nyEget) > 0, "kortet visar det egna numret");
  kolla(antal(l.html, reg) === 0, `registrets nummer förekommer inte i listan (${antal(l.html, reg)})`);

  steg("4", "avpublicera — registrets nummer tillbaka");
  const u = await skicka(paket("unpublish", 2));
  kolla(u.kod === 200 && u.ok, `200 ok (${u.kod})`, u.error);
  const t = await vanta(profil, (r) => antal(r.html, reg) > 0);
  kolla(antal(t.html, reg) > 0, "registrets nummer syns igen — frånvaron var overlayns verk");
}

async function stada() {
  if (!farStada) return;
  console.log("\n\x1b[1m── städning\x1b[0m");
  const { error } = await admin.from("overlay_profil").delete().eq("sajt", SAJT).eq("external_id", CFARNR);
  kolla(!error, "testraden borttagen", error?.message);
}

try {
  await main();
} catch (e) {
  fail("oväntat fel", e?.stack ?? String(e));
} finally {
  await stada();
}
console.log(fel === 0 ? "\n\x1b[32mALLT GRÖNT\x1b[0m" : `\n\x1b[31m${fel} FEL\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
