/**
 * Renderad kontroll mot en körande deploy: hämtar sitemap.xml och varje URL i
 * den, och verifierar att ingen svarar noindex eller något annat än 200.
 *
 * Kör:  npm run verify:sitemap                    (mot https://varddelen.se)
 *       npm run verify:sitemap -- http://localhost:3000
 *       npm run verify:sitemap -- <url> --sample 200
 *
 * Byggspärren (scripts/check-sitemap-noindex.mjs) kollar samma invariant
 * strukturellt och kostar 40 ms. Det här skriptet kollar den på riktigt HTML
 * och används efter deploy.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "https://varddelen.se").replace(/\/$/, "");
const sampleIdx = args.indexOf("--sample");
const sample = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) : 0;
const CONCURRENCY = 16;

const res = await fetch(`${base}/sitemap.xml`);
if (!res.ok) {
  console.error(`sitemap.xml svarade ${res.status}`);
  process.exit(1);
}
const xml = await res.text();
let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
  m[1].replace(/&amp;/g, "&"),
);
console.log(`sitemap.xml: ${urls.length} URL:er`);
if (urls.length === 0) {
  console.error("tom sitemap");
  process.exit(1);
}

// Kanonisk host i sitemapen måste vara den host vi testar mot, annars mäter vi
// fel sajt. Vid test mot localhost skriver vi om.
urls = urls.map((u) => u.replace(/^https?:\/\/[^/]+/, base));

if (sample > 0 && sample < urls.length) {
  const step = urls.length / sample;
  urls = Array.from({ length: sample }, (_, i) => urls[Math.floor(i * step)]);
  console.log(`stickprov: ${urls.length} URL:er`);
}

const NOINDEX = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i;

const fel = [];
let klara = 0;
let i = 0;
async function worker() {
  for (;;) {
    const idx = i++;
    if (idx >= urls.length) return;
    const u = urls[idx];
    try {
      const r = await fetch(u, { redirect: "manual" });
      if (r.status !== 200) {
        fel.push(`${r.status} ${u}`);
      } else {
        const html = await r.text();
        if (NOINDEX.test(html)) fel.push(`NOINDEX i sitemapen: ${u}`);
        const canon = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        if (canon && canon[1].replace(/^https?:\/\/[^/]+/, base) !== u) {
          fel.push(`canonical pekar bort: ${u} → ${canon[1]}`);
        }
      }
    } catch (e) {
      fel.push(`${e.message} ${u}`);
    }
    if (++klara % 100 === 0) process.stderr.write(`\r  ${klara}/${urls.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write(`\r  ${klara}/${urls.length}\n`);

if (fel.length > 0) {
  console.error(`\n${fel.length} fel:`);
  for (const f of fel.slice(0, 40)) console.error(`  ✗ ${f}`);
  if (fel.length > 40) console.error(`  … och ${fel.length - 40} till`);
  process.exit(1);
}
console.log(`OK — ${urls.length} URL:er, alla 200, ingen noindex, canonical stämmer`);
