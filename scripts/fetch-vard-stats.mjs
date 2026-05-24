// Engångsskript — räknar vårdföretag totalt + per vård-branschid + per kommun.
// Resultat skrivs till stdout som JSON, klistras in i src/lib/stats.ts.
//
// Kör: node scripts/fetch-vard-stats.mjs > /tmp/vard-stats.json
import { readFileSync } from "node:fs";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://ymqbimerrvycbknstsai.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_ANON_KEY in env");
  process.exit(1);
}

// Läs vård-branscher från TS-källan så vi inte dupliccerar listan här.
const vardSrc = readFileSync(
  new URL("../src/lib/vard-branscher.ts", import.meta.url),
  "utf8",
);
const VARD_BRANSCHER = [];
const inListMatch = vardSrc.match(/export const VARD_BRANSCHER[^=]*=\s*\[([\s\S]*?)\];/);
if (!inListMatch) {
  console.error("Could not parse VARD_BRANSCHER from vard-branscher.ts");
  process.exit(1);
}
// Plocka bara siffror som följs av komma/whitespace — strunta i siffror som
// råkar nämnas i kommentarer (annars läses "96040 borttagen" som ett aktivt id).
for (const line of inListMatch[1].split("\n")) {
  const code = line.replace(/\/\/.*$/, "").trim();
  const m = code.match(/^(\d+)\s*,?$/);
  if (m) VARD_BRANSCHER.push(Number(m[1]));
}

// Kommuner — samma parsning som fetch-stats.mjs.
const kommunerSrc = readFileSync(
  new URL("../src/lib/kommuner.ts", import.meta.url),
  "utf8",
);
const kommuner = [];
for (const m of kommunerSrc.matchAll(/\["(\d{3,4})",\s*"([^"]+)"\]/g)) {
  const scb = m[1];
  const name = m[2];
  const code = scb.replace(/^0+/, "") || "0";
  kommuner.push({ code, scb, name });
}

const branschCsv = VARD_BRANSCHER.join(",");

async function countHead(url) {
  const r = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=estimated",
    },
  });
  const cr = r.headers.get("content-range") ?? "";
  const m = cr.match(/\/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

async function fetchVardBranschNames() {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/t_bransch?select=branschid,beskrivning&branschid=in.(${branschCsv})&limit=200`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  if (!r.ok) throw new Error(`t_bransch ${r.status}`);
  return r.json();
}

async function countTotalVard() {
  return countHead(
    `${SUPA_URL}/rest/v1/foretag_publik?select=id&ng1=in.(${branschCsv})&limit=1`,
  );
}

async function countForBransch(id) {
  return countHead(
    `${SUPA_URL}/rest/v1/foretag_publik?select=id&ng1=eq.${id}&limit=1`,
  );
}

async function countForKommun(code) {
  return countHead(
    `${SUPA_URL}/rest/v1/foretag_publik?select=id&kommun=eq.${encodeURIComponent(code)}&ng1=in.(${branschCsv})&limit=1`,
  );
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

console.error(`Fetching stats for ${VARD_BRANSCHER.length} vård-branscher, ${kommuner.length} kommuner...`);

const [total, branschNames, branschCounts, kommunCounts] = await Promise.all([
  countTotalVard(),
  fetchVardBranschNames(),
  mapLimit(VARD_BRANSCHER, 8, countForBransch),
  mapLimit(kommuner, 12, (k) => countForKommun(k.code)),
]);

const nameById = new Map(
  branschNames.map((r) => [r.branschid, r.beskrivning ?? `SNI ${r.branschid}`]),
);

const branscher = VARD_BRANSCHER
  .map((id, i) => ({
    id,
    name: nameById.get(id) ?? `SNI ${id}`,
    count: branschCounts[i] ?? 0,
  }))
  .sort((a, b) => b.count - a.count);

const kommunerSorted = kommuner
  .map((k, i) => ({ code: k.code, name: k.name, count: kommunCounts[i] ?? 0 }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 25);

console.log(JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  total,
  branscher,
  kommuner: kommunerSorted,
}, null, 2));
