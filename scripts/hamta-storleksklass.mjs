// Ögonblicksbild: arbetsställets storleksklass (SCB, kolumnen anstkl) per cfarnr,
// för VARD_BRANSCHER. Samma skript som i hantverkardelen-se, med vårdens urval.
//
// Varför: registrets `aeant` är INTE antal anställda. Det är bolagets antal
// arbetsställen — NCC AB har aeant 56 och 57 rader i registret, Skanska Sverige
// 138 och 139, och för 9 992 av 10 682 bolag med flera arbetsställen ligger
// aeant inom 10 % av radantalet (mätt 2026-11-01). Därför stod "1 anställd" på
// 65 804 av 76 264 hantverksföretag på hantverkardelen. Vårddelens
// `aeant_per_stalle` (kluster/006: aeant delat på antalet arbetsställen) bygger
// på samma felaktiga premiss och blir därför ≈ 1 för nästan alla. Antalet anställda finns bara som SCB:s
// storleksklass i `aesamtable.anstkl`, med kodlistan i `anstkltable`
// (1 = 0 anställda, 2 = 1–4, 3 = 5–9 …).
//
// Varken aesamtable eller foretag_publik får ändras, och anon kan inte läsa
// aesamtable. Klassen läses därför här, med en läsfråga via Supabase CLI, och
// skrivs till src/lib/storleksklass-snapshot.ts. Registret ändras inte (det är
// från ca 2011), så filen behöver bara göras om när registret byts.
//
// Kör: node scripts/hamta-storleksklass.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const PROJECT_REF = "ymqbimerrvycbknstsai";

// Samma parsning som scripts/build-index-set.mjs: bara siffror som står
// ensamma på raden — siffror i kommentarer ska inte med.
const vardSrc = readFileSync(new URL("../src/lib/vard-branscher.ts", import.meta.url), "utf8");
const lista = vardSrc.match(/export const VARD_BRANSCHER[^=]*=\s*\[([\s\S]*?)\];/);
if (!lista) throw new Error("Kunde inte parsa VARD_BRANSCHER");
const ng1 = [];
for (const line of lista[1].split("\n")) {
  const m = line.replace(/\/\/.*$/, "").trim().match(/^(\d+)\s*,?$/);
  if (m) ng1.push(Number(m[1]));
}
if (ng1.length === 0) throw new Error("VARD_BRANSCHER tom");

const sql = `
  select nullif(trim(anstkl), '')::int as kod,
         string_agg(cfarnr::text, ',' order by cfarnr) as cfarnr
  from aesamtable
  where ng1 in (${ng1.join(",")}) and cfarnr is not null
  group by 1 order by 1 nulls first`;

const ut = execFileSync(
  "supabase",
  ["db", "query", "--linked", "--project-ref", PROJECT_REF, "-o", "json", sql],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
);
// CLI:n lämnar en supabase/.temp efter sig i arbetskatalogen.
rmSync(new URL("../supabase", import.meta.url), { recursive: true, force: true });

const rader = JSON.parse(ut.slice(ut.indexOf("{"))).rows;

/** Sorterade cfarnr som deltan i bas 36 — kompakt och snabb att packa upp. */
function packa(lista) {
  let forra = 0;
  return lista
    .map((c) => {
      const d = c - forra;
      forra = c;
      return d.toString(36);
    })
    .join(",");
}

const klasser = {};
let antal = 0;
for (const r of rader) {
  // Kod 0 är "Uppgift saknas" och NULL är inget värde alls — båda utelämnas.
  if (r.kod == null || r.kod === 0) continue;
  const cf = r.cfarnr.split(",").map(Number);
  antal += cf.length;
  klasser[r.kod] = packa(cf);
}

const fil = `// GENERERAD av scripts/hamta-storleksklass.mjs — ändra inte för hand.
// Arbetsställets storleksklass (SCB anstkl) per cfarnr, ${antal} arbetsställen
// inom VARD_BRANSCHER. Hämtad ${new Date().toISOString().slice(0, 10)}.
// Format: kod → cfarnr sorterade, som deltan i bas 36, kommaseparerade.
export const STORLEKSKLASS_PACKAD: Readonly<Record<number, string>> = ${JSON.stringify(klasser, null, 2)};
`;
writeFileSync(new URL("../src/lib/storleksklass-snapshot.ts", import.meta.url), fil);
console.error(`storleksklass-snapshot.ts: ${antal} arbetsställen, ${Object.keys(klasser).length} klasser, ${fil.length} byte`);
