/**
 * Bygger urvalet av indexerbara sidor → src/data/indexable.json.
 *
 * Kör:  node scripts/build-index-set.mjs
 * (läser NEXT_PUBLIC_SUPABASE_* ur miljön eller ur .env.local)
 *
 * TVÅ GRINDAR — en per sidtyp. Båda styr BÅDE robots-metan och sitemapen,
 * så sitemapurvalet är per definition identiskt med det indexerbara och en
 * URL kan aldrig ligga i sitemapen och samtidigt svara noindex.
 *
 *   1. HUBBGRIND  /kommun/[slug]/[bransch]  →  minst HUB_MIN_FORETAG företag
 *   2. SUBSTANSGRIND  /foretag/[slug]       →  beskrivning, egen tjänstelista
 *                                              eller verifierad kontakt
 *
 * Trösklarna och siffrorna bakom dem är dokumenterade i src/lib/indexability.ts.
 * Ändra dem HÄR och kör om skriptet — inget annat ska röras.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Trösklar
// ---------------------------------------------------------------------------

/**
 * Hubbgrind: minsta antal FAKTISKT LISTADE företag på en bransch-i-kommun-sida.
 *
 * "Faktiskt listade" — inte antalet rader i databasen. listForetagInKommunByBransch
 * filtrerar på aeant >= 0 (index-shortcut), så rader med aeant = NULL renderas
 * aldrig. Räknar vi på DB-rader hamnar tomma hubbar i sitemapen.
 */
const HUB_MIN_FORETAG = 5;

/** Substansgrind: minsta antal ord i beskrivningen (infotext, taggar borträknade). */
const INFOTEXT_MIN_ORD = 20;

/** Substansgrind: minsta antal unika sökord (sidans "Tjänster & sökord"-lista). */
const SOKORD_MIN = 3;

// ---------------------------------------------------------------------------
// Miljö
// ---------------------------------------------------------------------------

function loadEnv() {
  const out = { ...process.env };
  const p = new URL("../.env.local", import.meta.url);
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i < 1 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (!out[k]) out[k] = line.slice(i + 1).trim();
    }
  }
  return out;
}
const env = loadEnv();
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPA_URL || !KEY) {
  console.error("Saknar NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll(path, select, extra = "") {
  const rows = [];
  const STEP = 1000;
  for (let offset = 0; ; offset += STEP) {
    const url = `${SUPA_URL}/rest/v1/${path}?select=${select}${extra}&limit=${STEP}&offset=${offset}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const d = await r.json();
    rows.push(...d);
    process.stderr.write(`\r  ${path}: ${rows.length}`);
    if (d.length < STEP) break;
  }
  process.stderr.write("\n");
  return rows;
}

// ---------------------------------------------------------------------------
// Källor som redan finns i TS — parsas här hellre än dupliceras.
// ---------------------------------------------------------------------------

function readVardBranscher() {
  const src = readFileSync(new URL("../src/lib/vard-branscher.ts", import.meta.url), "utf8");
  const m = src.match(/export const VARD_BRANSCHER[^=]*=\s*\[([\s\S]*?)\];/);
  if (!m) throw new Error("Kunde inte parsa VARD_BRANSCHER");
  const out = [];
  // Bara siffror som står ensamma på raden — siffror i kommentarer ska inte med.
  for (const line of m[1].split("\n")) {
    const code = line.replace(/\/\/.*$/, "").trim();
    const mm = code.match(/^(\d+)\s*,?$/);
    if (mm) out.push(Number(mm[1]));
  }
  return out;
}

/** Samma normalisering som makeSlug i src/lib/kommuner.ts och branschSlug i branscher.ts. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/\//g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readKommuner() {
  const src = readFileSync(new URL("../src/lib/kommuner.ts", import.meta.url), "utf8");
  // Slug-undantag (SLUG_OVERRIDE i kommuner.ts) — Håbo/Habo kolliderar annars.
  const override = new Map();
  const ovBlock = src.match(/const SLUG_OVERRIDE[^=]*=\s*\{([\s\S]*?)\};/);
  if (ovBlock) {
    for (const m of ovBlock[1].matchAll(/"(\d{4})":\s*"([^"]+)"/g)) override.set(m[1], m[2]);
  }
  const out = new Map();
  for (const m of src.matchAll(/\["(\d{4})",\s*"([^"]+)"\]/g)) {
    const code = m[1].replace(/^0+/, "") || "0";
    out.set(code, override.get(m[1]) ?? slugify(m[2]));
  }
  if (out.size !== 290) throw new Error(`Förväntade 290 kommuner, fick ${out.size}`);
  if (new Set(out.values()).size !== out.size) throw new Error("Kommun-slug-kollision");
  return out;
}

/** Samma slug som foretagSlug() i src/lib/queries.ts. */
function foretagSlug(row) {
  const name = row.firma || row.namn || "foretag";
  const base = name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "foretag"}-${row.cfarnr}`;
}

const hasText = (v) => v != null && String(v).trim() !== "";

/** Ordräkning på infotext med taggarna borttagna — samma text besökaren ser. */
function infotextOrd(html) {
  if (!html) return 0;
  const t = String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.split(" ").length : 0;
}

// ---------------------------------------------------------------------------
// Kör
// ---------------------------------------------------------------------------

const VARD = readVardBranscher();
const KOMMUN_SLUG = readKommuner();
console.error(`Vård-branscher: ${VARD.length} · kommuner: ${KOMMUN_SLUG.size}`);

const FORETAG_COLS =
  "cfarnr,firma,namn,ng1,kommun,aeant,tel,webb,epostadress,kontaktperson,logotyp,poang,infotext";
const foretag = await fetchAll(
  "foretag_publik",
  FORETAG_COLS,
  `&ng1=in.(${VARD.join(",")})&order=cfarnr.asc`,
);

// Sökord per cfarnr — unika, case-insensitivt, precis som listSokordForCfarnr.
const sokordRows = await fetchAll("sokordtable", "cfarnr,sokord", "&order=cfarnr.asc");
const sokordCount = new Map();
{
  const seen = new Map();
  for (const r of sokordRows) {
    if (r.cfarnr == null) continue;
    const s = (r.sokord ?? "").trim().toLowerCase();
    if (!s) continue;
    let set = seen.get(r.cfarnr);
    if (!set) seen.set(r.cfarnr, (set = new Set()));
    set.add(s);
  }
  for (const [k, v] of seen) sokordCount.set(k, v.size);
}

const branschRows = await fetchAll(
  "t_bransch",
  "branschid,beskrivning",
  `&branschid=in.(${VARD.join(",")})`,
);
const branschNamn = new Map();
for (const r of branschRows) {
  if (r.beskrivning && !branschNamn.has(String(r.branschid))) {
    branschNamn.set(String(r.branschid), r.beskrivning);
  }
}

// --- Grind 1: hubbar ------------------------------------------------------
const hubRendered = new Map(); // "kommun|ng1" -> antal listade företag
const hubAll = new Map();
for (const r of foretag) {
  if (r.kommun == null || r.ng1 == null) continue;
  const k = `${r.kommun}|${r.ng1}`;
  hubAll.set(k, (hubAll.get(k) ?? 0) + 1);
  if (r.aeant != null) hubRendered.set(k, (hubRendered.get(k) ?? 0) + 1);
}
const hubs = [];
const hubSkippedMissingName = new Set();
for (const [k, count] of hubRendered) {
  if (count < HUB_MIN_FORETAG) continue;
  const [kommunCode, ng1] = k.split("|");
  const namn = branschNamn.get(ng1);
  const kommunSlug = KOMMUN_SLUG.get(kommunCode);
  // Utan branschnamn renderar sidan "SNI 12345" som rubrik — då är den ingen
  // hubb värd att bjuda in Google till, oavsett hur många företag den listar.
  if (!namn || !kommunSlug) {
    hubSkippedMissingName.add(k);
    continue;
  }
  hubs.push({ key: k, path: `/kommun/${kommunSlug}/${slugify(namn)}-${ng1}`, antal: count });
}
hubs.sort((a, b) => (a.path < b.path ? -1 : 1));

// --- Grind 2: företagssubstans -------------------------------------------
const sok = (r) => sokordCount.get(r.cfarnr) ?? 0;
const harBeskrivning = (r) => infotextOrd(r.infotext) >= INFOTEXT_MIN_ORD;
const harTjanstelista = (r) => sok(r) >= SOKORD_MIN;
/**
 * Verifierad kontakt = kontaktdata som INTE kommer gratis ur SCB-registret.
 * tel och gatuadress är registerdefault (89 % / 96 %) och räknas alltså inte.
 */
const harVerifieradKontakt = (r) =>
  hasText(r.webb) ||
  hasText(r.epostadress) ||
  hasText(r.kontaktperson) ||
  hasText(r.logotyp) ||
  (r.poang ?? 0) > 0;

const foretagPass = [];
for (const r of foretag) {
  if (r.cfarnr == null) continue;
  if (!(harBeskrivning(r) || harTjanstelista(r) || harVerifieradKontakt(r))) continue;
  foretagPass.push({ cfarnr: r.cfarnr, slug: foretagSlug(r) });
}
foretagPass.sort((a, b) => a.cfarnr - b.cfarnr);

// --- Skriv ---------------------------------------------------------------
const foretagMap = {};
for (const f of foretagPass) foretagMap[f.cfarnr] = f.slug;

const data = {
  generated_at: new Date().toISOString(),
  rules: {
    hub_min_foretag: HUB_MIN_FORETAG,
    infotext_min_ord: INFOTEXT_MIN_ORD,
    sokord_min: SOKORD_MIN,
    verifierad_kontakt: ["webb", "epostadress", "kontaktperson", "logotyp", "poang>0"],
  },
  counts: {
    foretag_totalt: foretag.length,
    foretag_indexerbara: foretagPass.length,
    hub_totalt: hubAll.size,
    hub_med_listade_rader: hubRendered.size,
    hub_indexerbara: hubs.length,
    hub_utan_branschnamn: hubSkippedMissingName.size,
  },
  /** [nyckel "kommunkod|ng1", sökväg] — nyckeln driver robots, sökvägen sitemapen. */
  hubs: hubs.map((h) => [h.key, h.path]),
  foretag: foretagMap,
};

writeFileSync(
  new URL("../src/data/indexable.json", import.meta.url),
  JSON.stringify(data, null, 1) + "\n",
);

console.error("");
console.error("=== URVAL ===");
console.error(`hubbar:   ${hubs.length} av ${hubRendered.size} med minst ett listat företag (${hubAll.size} kombinationer i DB)`);
console.error(`företag:  ${foretagPass.length} av ${foretag.length}`);
console.error(`  beskrivning >= ${INFOTEXT_MIN_ORD} ord : ${foretag.filter(harBeskrivning).length}`);
console.error(`  sökord >= ${SOKORD_MIN}               : ${foretag.filter(harTjanstelista).length}`);
console.error(`  verifierad kontakt          : ${foretag.filter(harVerifieradKontakt).length}`);
console.error("→ src/data/indexable.json");
