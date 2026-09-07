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
 * Hubbgrind: minsta antal listade företag på en bransch-i-kommun-sida.
 *
 * Grinden räknar DB-rader — och det är sedan 2026-09-07 samma sak som
 * "faktiskt listade". Tidigare var det inte det: hubbfrågan bar ett
 * `.gte("aeant", 0)`, NULL >= 0 är falskt, och 1 222 vårdföretag renderades
 * aldrig. Grinden räknade därför bara rader med aeant satt, för att inte
 * släppa in tomma hubbar i sitemapen — rätt svar på fel problem. Filtret är
 * nu borta ur queries.ts, alla rader renderas, och grinden räknar dem alla.
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

/**
 * PostgREST-taket. db-max-rows = 1000 på det här projektet: en `limit=5000`
 * kapas TYST till 1000. Allt som hämtar "allt" måste därför paginera, och
 * varje paginering måste stämmas av mot en exakt räkning — annars blir ett
 * kapat svar en tyst undertalning i stället för ett fel.
 */
const PAGE_MAX = 1000;

/** Exakt radantal för en filtrerad resurs. Aldrig count=estimated — se lib/counts.ts. */
async function countExact(path, filter = "") {
  // Inget select: HEAD + Prefer count=exact räcker, och vi slipper veta vilken
  // kolumn resursen har.
  const url = `${SUPA_URL}/rest/v1/${path}?limit=1${filter}`;
  const r = await fetch(url, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (!r.ok) throw new Error(`count ${path} ${r.status}`);
  const m = (r.headers.get("content-range") ?? "").match(/\/(\d+)$/);
  if (!m) throw new Error(`count ${path}: oläsbar content-range`);
  return Number(m[1]);
}

/** SUMMERINGSINVARIANT — hämtat antal måste vara exakt DB:s antal. */
function assertComplete(path, got, want) {
  if (got !== want) {
    throw new Error(
      `${path}: hämtade ${got} rader men DB har ${want} (count=exact). ` +
        `Pagineringen tappade eller dubblerade rader — avbryter hellre än ` +
        `att skriva ett urval byggt på ofullständig data.`,
    );
  }
}

/**
 * Keyset-paginering på en UNIK kolumn.
 *
 * Why inte limit/offset: offset är bara välbestämt om ORDER BY är en total
 * ordning. Med ett icke-unikt sorteringsvärde är radernas inbördes ordning
 * inom en grupp ospecificerad, och Postgres får byta den mellan två
 * anrop — då hoppas rader över vid sidgränsen eller kommer med två gånger.
 * `cfarnr` är unikt över foretag_publik (verifierat: 35 528 rader, 35 528
 * distinkta) och ger en total ordning. `id` gör INTE det: 118 värden är
 * dubbletter och id=0 ligger på 2 701 rader.
 */
async function fetchAllByUniqueKey(path, select, filter, keyCol) {
  const want = await countExact(path, filter);
  const rows = [];
  let cursor = null;
  for (;;) {
    const seek = cursor === null ? "" : `&${keyCol}=gt.${cursor}`;
    const url = `${SUPA_URL}/rest/v1/${path}?select=${select}${filter}${seek}&order=${keyCol}.asc&limit=${PAGE_MAX}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const d = await r.json();
    if (d.length === 0) break;
    rows.push(...d);
    cursor = d[d.length - 1][keyCol];
    process.stderr.write(`\r  ${path}: ${rows.length}/${want}`);
    if (d.length < PAGE_MAX) break;
  }
  process.stderr.write("\n");
  assertComplete(path, rows.length, want);
  return rows;
}

/**
 * Keyset-paginering på en ICKE-unik grupperingskolumn (sokordtable.cfarnr).
 *
 * Grundregeln är densamma — men en grupp får aldrig delas av en sidgräns,
 * för då är ordningen inom gruppen ospecificerad. Vi kastar därför bort den
 * sista (möjligen halva) gruppen på varje full sida och börjar om från den.
 *
 * Undantaget som gör det icke-trivialt: en enskild cfarnr har 1 143 sökord,
 * alltså mer än hela sidtaket. Den gruppen kan aldrig "börjas om" utan att
 * loopen står stilla, så den töms för sig med offset inom gruppen. Där är
 * det säkert: sorteringen är då på sokord, alla kvarvarande lika-lägen är
 * IDENTISKA strängvärden, och att byta plats på två identiska värden kan
 * inte ändra vilken mängd vi får ut.
 */
async function fetchAllGrouped(path, select, filter, groupCol, orderCol) {
  const want = await countExact(path, filter);
  const rows = [];
  let cursor = null;
  for (;;) {
    const seek = cursor === null ? "" : `&${groupCol}=gte.${cursor}`;
    const url = `${SUPA_URL}/rest/v1/${path}?select=${select}${filter}${seek}&order=${groupCol}.asc,${orderCol}.asc&limit=${PAGE_MAX}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const d = await r.json();
    if (d.length === 0) break;

    if (d.length < PAGE_MAX) {
      rows.push(...d);
      break;
    }

    const lastGroup = d[d.length - 1][groupCol];
    const whole = d.filter((row) => row[groupCol] !== lastGroup);
    if (whole.length === 0) {
      // Hela sidan är EN grupp — töm den för sig och gå vidare.
      rows.push(...(await drainGroup(path, select, filter, groupCol, orderCol, lastGroup)));
      cursor = lastGroup + 1;
    } else {
      rows.push(...whole);
      cursor = lastGroup;
    }
    process.stderr.write(`\r  ${path}: ${rows.length}/${want}`);
  }
  process.stderr.write("\n");
  assertComplete(path, rows.length, want);
  return rows;
}

async function drainGroup(path, select, filter, groupCol, orderCol, group) {
  const groupFilter = `${filter}&${groupCol}=eq.${group}`;
  const want = await countExact(path, groupFilter);
  const out = [];
  for (let offset = 0; offset < want; offset += PAGE_MAX) {
    const url = `${SUPA_URL}/rest/v1/${path}?select=${select}${groupFilter}&order=${orderCol}.asc&limit=${PAGE_MAX}&offset=${offset}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
    const d = await r.json();
    if (d.length === 0) break;
    out.push(...d);
  }
  assertComplete(`${path} (${groupCol}=${group})`, out.length, want);
  return out;
}

/** Resurs som ryms på en sida. Invarianten fångar dagen den växer förbi taket. */
async function fetchSinglePage(path, select, filter) {
  const want = await countExact(path, filter);
  if (want > PAGE_MAX) {
    throw new Error(`${path}: ${want} rader > sidtaket ${PAGE_MAX} — behöver paginering`);
  }
  const url = `${SUPA_URL}/rest/v1/${path}?select=${select}${filter}&limit=${PAGE_MAX}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
  const d = await r.json();
  assertComplete(path, d.length, want);
  return d;
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
const VARD_FILTER = `&ng1=in.(${VARD.join(",")})`;
const foretag = await fetchAllByUniqueKey(
  "foretag_publik",
  FORETAG_COLS,
  VARD_FILTER,
  "cfarnr",
);

// Sökord per cfarnr — unika, case-insensitivt, precis som listSokordForCfarnr.
// sokord=not.is.null: 932 rader saknar sökord och räknas ändå inte. Att
// filtrera bort dem vid källan gör att keyset-ordningen slipper NULL-lägen.
const sokordRows = await fetchAllGrouped(
  "sokordtable",
  "cfarnr,sokord",
  "&sokord=not.is.null",
  "cfarnr",
  "sokord",
);
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

const branschRows = await fetchSinglePage(
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
// hubAll = alla rader (= alla renderade rader, sedan aeant-filtret togs bort).
// hubMedAeant behålls bara för att kunna rapportera diffen mot förra veckans
// urval, som räknade under filtret.
const hubAll = new Map();
const hubMedAeant = new Map();
const kommunTotal = new Map();
const branschTotal = new Map();
for (const r of foretag) {
  if (r.ng1 != null) branschTotal.set(r.ng1, (branschTotal.get(r.ng1) ?? 0) + 1);
  if (r.kommun == null || r.ng1 == null) continue;
  const k = `${r.kommun}|${r.ng1}`;
  hubAll.set(k, (hubAll.get(k) ?? 0) + 1);
  kommunTotal.set(r.kommun, (kommunTotal.get(r.kommun) ?? 0) + 1);
  if (r.aeant != null) hubMedAeant.set(k, (hubMedAeant.get(k) ?? 0) + 1);
}
const hubs = [];
const hubSkippedMissingName = new Set();
for (const [k, count] of hubAll) {
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

// --- Diff mot förra veckans grind ----------------------------------------
// Förra urvalet räknade renderade rader UNDER .gte("aeant", 0). Nu renderas
// alla rader, så grinden räknar alla. Skillnaden redovisas explicit.
const gammalGrind = new Set(
  [...hubMedAeant].filter(([, c]) => c >= HUB_MIN_FORETAG).map(([k]) => k),
);
const nyGrind = new Set(hubs.map((h) => h.key));
const tillkomna = [...nyGrind].filter((k) => !gammalGrind.has(k));
const bortfallna = [...gammalGrind].filter((k) => !nyGrind.has(k));
let undertalade = 0;
for (const [k, c] of hubAll) if ((hubMedAeant.get(k) ?? 0) !== c) undertalade++;

// --- Summeringsinvarianter ------------------------------------------------
const sumKommun = [...kommunTotal.values()].reduce((a, b) => a + b, 0);
const sumHub = [...hubAll.values()].reduce((a, b) => a + b, 0);
const utanKommun = foretag.filter((r) => r.kommun == null || r.ng1 == null).length;
if (sumKommun !== sumHub) {
  throw new Error(`Invariant: kommunsumma ${sumKommun} != hubbsumma ${sumHub}`);
}
if (sumKommun + utanKommun !== foretag.length) {
  throw new Error(
    `Invariant: ${sumKommun} + ${utanKommun} utan kommun/bransch != ${foretag.length} företag`,
  );
}

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
    hub_indexerbara: hubs.length,
    hub_utan_branschnamn: hubSkippedMissingName.size,
    /** Vad grinden hade valt med förra veckans räkning (under .gte(aeant,0)). */
    hub_indexerbara_fore_aeantfix: gammalGrind.size,
  },
  /** [nyckel "kommunkod|ng1", sökväg] — nyckeln driver robots, sökvägen sitemapen. */
  hubs: hubs.map((h) => [h.key, h.path]),
  foretag: foretagMap,
};

writeFileSync(
  new URL("../src/data/indexable.json", import.meta.url),
  JSON.stringify(data, null, 1) + "\n",
);

/**
 * Räknesnapshot — EN källa till alla tal sajten visar.
 *
 * Talen kommer ur samma fullständiga radhämtning som grinden ovan, alltså ur
 * count=exact-verifierade rader. Tidigare kom de från count=estimated och
 * från handinklistrade listor i stats.ts, och drev därför isär: totalen låg
 * 7,7 % fel och fem branschtal hade fastnat på estimatgolvet 1001.
 *
 * Invarianten som gäller per konstruktion och kollas ovan:
 *   summa(kommun_bransch för en kommun) === kommun[kommun]
 *   summa(kommun) + rader utan kommun/bransch === total
 */
const countsData = {
  generated_at: new Date().toISOString(),
  metod: "count=exact via fullständig keyset-hämtning av foretag_publik",
  total: foretag.length,
  utan_kommun_eller_bransch: utanKommun,
  kommun: Object.fromEntries([...kommunTotal].sort((a, b) => b[1] - a[1])),
  bransch: Object.fromEntries([...branschTotal].sort((a, b) => b[1] - a[1])),
  bransch_namn: Object.fromEntries(branschNamn),
  kommun_bransch: Object.fromEntries([...hubAll].sort((a, b) => b[1] - a[1])),
};
writeFileSync(
  new URL("../src/data/counts.json", import.meta.url),
  JSON.stringify(countsData, null, 1) + "\n",
);

console.error("");
console.error("=== URVAL ===");
console.error(`hubbar:   ${hubs.length} av ${hubAll.size} kombinationer i DB`);
console.error(`  grind FÖRE (räknat under .gte(aeant,0)) : ${gammalGrind.size}`);
console.error(`  grind EFTER (alla renderade rader)      : ${nyGrind.size}`);
console.error(`  diff: +${tillkomna.length} / -${bortfallna.length} · ${undertalade} hubbar hade undertalat antal`);
console.error(`företag:  ${foretagPass.length} av ${foretag.length}`);
console.error(`  beskrivning >= ${INFOTEXT_MIN_ORD} ord : ${foretag.filter(harBeskrivning).length}`);
console.error(`  sökord >= ${SOKORD_MIN}               : ${foretag.filter(harTjanstelista).length}`);
console.error(`  verifierad kontakt          : ${foretag.filter(harVerifieradKontakt).length}`);
console.error("→ src/data/indexable.json");
