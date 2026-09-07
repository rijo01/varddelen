/**
 * Byggspärr: ingen URL får ligga i sitemapen och samtidigt svara noindex.
 *
 * Motstridiga signaler är i sig ett SEO-problem — Google behandlar en
 * sitemap-post som "den här sidan vill jag ha indexerad" och robots-metan som
 * "nej". Den kombinationen kostar förtroende för hela sitemapen, inte bara för
 * den enskilda URL:en.
 *
 * Körs av `npm run build` FÖRE next build och avbryter med exit 1.
 *
 * Kollen är strukturell, inte en rendering: robots-metan på båda sidtyperna är
 * en ren funktion av urvalet i src/data/indexable.json. Skriptet verifierar
 *   1. att varje sitemap-sökväg går att parsa tillbaka till en entitet som
 *      finns i det indexerbara urvalet,
 *   2. att inga dubbletter eller okända sökvägsformer smugit in,
 *   3. att sidfilerna faktiskt frågar grinden — utan (1) blir (2) meningslös,
 *      och det är precis den regressionen som går att göra av misstag när
 *      generateMetadata skrivs om.
 *
 * En full renderad kontroll mot en körande deploy görs av
 * scripts/verify-sitemap-live.mjs.
 */
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const fel = [];
const varning = [];

const data = JSON.parse(read("src/data/indexable.json"));

// --- 1. Sitemapurvalet är en delmängd av det indexerbara --------------------

const hubKeys = new Set(data.hubs.map(([key]) => key));
const hubPaths = data.hubs.map(([, path]) => path);
const foretagCfarnr = new Set(Object.keys(data.foretag).map(Number));
const foretagPaths = Object.values(data.foretag).map((slug) => `/foretag/${slug}`);

// Kommunkoder → slug, för att kunna gå från sökväg tillbaka till nyckel.
const kommunSrc = read("src/lib/kommuner.ts");
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/\//g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const kommunOverride = new Map();
{
  const b = kommunSrc.match(/const SLUG_OVERRIDE[^=]*=\s*\{([\s\S]*?)\};/);
  if (b) for (const m of b[1].matchAll(/"(\d{4})":\s*"([^"]+)"/g)) kommunOverride.set(m[1], m[2]);
}
const kommunKodBySlug = new Map();
for (const m of kommunSrc.matchAll(/\["(\d{4})",\s*"([^"]+)"\]/g)) {
  const slug = kommunOverride.get(m[1]) ?? slugify(m[2]);
  if (kommunKodBySlug.has(slug)) fel.push(`kommun-slug-kollision: "${slug}"`);
  kommunKodBySlug.set(slug, m[1].replace(/^0+/, "") || "0");
}

for (const path of hubPaths) {
  // Samma form som routen: /kommun/<kommunslug>/<branschslug>-<ng1>
  const m = path.match(/^\/kommun\/([a-z0-9-]+)\/([a-z0-9-]*-)?(\d+)$/);
  if (!m) {
    fel.push(`hubb-sökväg går inte att parsa som routen gör: ${path}`);
    continue;
  }
  const kod = kommunKodBySlug.get(m[1]);
  if (!kod) {
    fel.push(`hubb-sökväg pekar på okänd kommun-slug: ${path}`);
    continue;
  }
  // Detta är exakt uppslaget robotsForHub() gör i generateMetadata.
  if (!hubKeys.has(`${kod}|${m[3]}`)) {
    fel.push(`SITEMAP + NOINDEX: ${path} ligger i sitemapen men grinden säger noindex`);
  }
}

for (const path of foretagPaths) {
  // Samma parsning som parseCfarnrFromSlug() i src/lib/queries.ts.
  const m = path.match(/^\/foretag\/(.+)-(\d+)$/);
  if (!m) {
    fel.push(`företags-sökväg saknar cfarnr-suffix: ${path}`);
    continue;
  }
  if (!foretagCfarnr.has(Number(m[2]))) {
    fel.push(`SITEMAP + NOINDEX: ${path} ligger i sitemapen men grinden säger noindex`);
  }
}

// --- 2. Dubbletter och formfel ---------------------------------------------

const alla = [...hubPaths, ...foretagPaths];
const sedda = new Set();
for (const p of alla) {
  if (sedda.has(p)) fel.push(`dubblett i sitemapen: ${p}`);
  sedda.add(p);
  if (!p.startsWith("/")) fel.push(`sökväg utan ledande slash: ${p}`);
  if (/[A-ZÅÄÖ\s]/.test(p)) fel.push(`sökväg med versal eller blanksteg: ${p}`);
}

if (hubKeys.size !== data.hubs.length) fel.push("dubbletter bland hubbnycklarna");

// --- 3. Sidorna frågar faktiskt grinden ------------------------------------

const sidor = [
  {
    fil: "src/app/kommun/[slug]/[bransch]/page.tsx",
    fn: "robotsForHub",
  },
  {
    fil: "src/app/foretag/[slug]/page.tsx",
    fn: "robotsForForetag",
  },
];
for (const { fil, fn } of sidor) {
  const src = read(fil);
  if (!src.includes(`from "@/lib/indexability"`) || !src.includes(`...${fn}(`)) {
    fel.push(
      `${fil} sprider inte ut ${fn}(...) i generateMetadata — ` +
        `sidan skulle svara index,follow oavsett grind`,
    );
  }
}

const sitemapSrc = read("src/app/sitemap.ts");
if (!sitemapSrc.includes("hubSitemapPaths") || !sitemapSrc.includes("foretagSitemapPaths")) {
  fel.push("src/app/sitemap.ts hämtar inte sina URL:er ur lib/indexability.ts");
}

// --- Färskhet ---------------------------------------------------------------

const alder = (Date.now() - Date.parse(data.generated_at)) / 86_400_000;
if (Number.isFinite(alder) && alder > 30) {
  varning.push(
    `urvalet är ${alder.toFixed(0)} dagar gammalt — kör 'npm run build:index' för att uppdatera`,
  );
}

// --- Rapport ----------------------------------------------------------------

console.log(
  `sitemap-kontroll: ${hubPaths.length} hubbar + ${foretagPaths.length} företag ` +
    `+ 293 statiska = ${alla.length + 293} URL:er`,
);
for (const v of varning) console.warn(`  varning: ${v}`);

if (fel.length > 0) {
  console.error(`\nBYGGET AVBRYTS — ${fel.length} fel:`);
  for (const f of fel.slice(0, 25)) console.error(`  ✗ ${f}`);
  if (fel.length > 25) console.error(`  … och ${fel.length - 25} till`);
  process.exit(1);
}
console.log("sitemap-kontroll: OK — ingen URL i sitemapen är noindex");
