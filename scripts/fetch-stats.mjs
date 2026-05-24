// Engångsskript — hämtar counts per kommun + per bransch och skriver
// JSON till stdout. Resultatet klistras in i src/lib/stats.ts som
// statisk data. Körs manuellt: `node scripts/fetch-stats.mjs > /tmp/stats.json`
import { readFileSync } from "node:fs";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://ymqbimerrvycbknstsai.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_ANON_KEY in env");
  process.exit(1);
}

// Pull kommun codes from the TS source via a regex over the array literal.
const kommunerSrc = readFileSync(
  new URL("../src/lib/kommuner.ts", import.meta.url),
  "utf8",
);
const codes = [];
for (const m of kommunerSrc.matchAll(/\["(\d{3,4})",\s*"([^"]+)"\]/g)) {
  const scb = m[1];
  const name = m[2];
  const code = scb.replace(/^0+/, "") || "0";
  codes.push({ code, scb, name });
}

async function countForKommun({ code }) {
  const url = `${SUPA_URL}/rest/v1/foretag_publik?select=id&kommun=eq.${encodeURIComponent(code)}&limit=1`;
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

async function fetchBranschList() {
  // Bransch-namn vi vill räkna — använd t_bransch som källa.
  const r = await fetch(
    `${SUPA_URL}/rest/v1/t_bransch?select=branschid,beskrivning&limit=2000`,
    {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
    },
  );
  if (!r.ok) throw new Error(`t_bransch ${r.status}`);
  return r.json();
}

async function countForBransch(id) {
  const url = `${SUPA_URL}/rest/v1/foretag_publik?select=id&ng1=eq.${id}&limit=1`;
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

// Concurrency limiter (Supabase tål ~50 parallella anrop bra)
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

console.error(`Fetching counts for ${codes.length} kommuner...`);
const kommunCounts = await mapLimit(codes, 30, async (k) => ({
  code: k.code,
  scb: k.scb,
  name: k.name,
  count: await countForKommun(k),
}));

console.error(`Loading bransch list...`);
const branschList = await fetchBranschList();
// Dedupe på branschid (vissa rader är dubbletter med olika beskrivning)
const branschMap = new Map();
for (const b of branschList) {
  if (!branschMap.has(b.branschid) && b.beskrivning) {
    branschMap.set(b.branschid, b.beskrivning);
  }
}
const branschItems = Array.from(branschMap.entries()).map(([id, name]) => ({
  id,
  name,
}));

console.error(`Fetching counts for ${branschItems.length} branscher...`);
const branschCounts = await mapLimit(branschItems, 30, async (b) => ({
  id: b.id,
  name: b.name,
  count: await countForBransch(b.id),
}));

const topKommuner = [...kommunCounts]
  .filter((k) => k.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, 25);

const topBranscher = [...branschCounts]
  .filter((b) => b.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, 20);

const total = kommunCounts.reduce((acc, k) => acc + k.count, 0);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totals: {
        foretag: total,
        kommuner: codes.length,
        branscher: branschItems.length,
      },
      topKommuner,
      topBranscher,
    },
    null,
    2,
  ),
);
