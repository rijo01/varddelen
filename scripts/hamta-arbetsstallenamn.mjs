// Ögonblicksbild: arbetsställets eget namn (aesamtable.ben) för vårdställen
// som drivs av en kommun, en region eller staten.
//
// Varför: registret har sådana vårdställen med huvudmannens namn i `namn`,
// "VÄSTRA GÖTALANDS LÄNS LANDSTING" 428 gånger, "STOCKHOLMS KOMMUN" 351. Det
// är verkliga vårdcentraler, folktandvårdskliniker, sjukhus och boenden —
// kärninnehållet i en vårdkatalog — men utan namn går de inte att hitta eller
// skilja åt. Arbetsställets namn finns i `aesamtable.ben` (7 131 av 7 140,
// mätt 2026-11-01), som foretag_publik inte har och anon inte kan läsa.
// Registret och vyn ändras inte; namnen läses här och skrivs till
// src/lib/arbetsstallenamn-snapshot.ts.
//
// Urval: VARD_BRANSCHER, juridisk form 81–84 och orgnr som börjar på 2 —
// samma "offentlig huvudman" som NISCH_JURFORM_VILLKOR. Privata företag
// berörs inte: där är namnet företagets eget.
//
// Kör: node scripts/hamta-arbetsstallenamn.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const PROJECT_REF = "ymqbimerrvycbknstsai";
/** Ett namn som förekommer så här många gånger är en typ ("GRUPPBOSTAD"), inte ett namn. */
const GENERISK_FRAN = 5;

const vardSrc = readFileSync(new URL("../src/lib/vard-branscher.ts", import.meta.url), "utf8");
const lista = vardSrc.match(/export const VARD_BRANSCHER[^=]*=\s*\[([\s\S]*?)\];/);
if (!lista) throw new Error("Kunde inte parsa VARD_BRANSCHER");
const ng1 = [...lista[1].replace(/\/\/.*$/gm, "").matchAll(/\d{5}/g)].map((m) => Number(m[0]));
if (ng1.length === 0) throw new Error("VARD_BRANSCHER tom");

/**
 * Huvudmannens namn: kommun, landsting, region, förbund, statlig myndighet.
 * Bara när `namn` ÄR huvudmannen ersätts det. 19 rader har det omvänt —
 * eget namn i `namn` ("UNIVERSITETSSJUKHUSET ÖREBRO") och huvudmannen i
 * `ben` — då står namnet kvar och `ben` blir huvudman. Är båda egna namn
 * ("IDA CENTRET" / "JOHN LANGHOLM") rörs raden inte: `ben` kan då vara en
 * persons namn.
 */
const HUVUDMAN = "(KOMMUN|LANDSTING|REGION|FÖRBUND|LÄNSSTYRELSE|STATENS|VERKET)";

const sql = `
  select a.cfarnr,
         upper(regexp_replace(trim(a.ben), '\\s+', ' ', 'g')) as ben,
         upper(regexp_replace(trim(a.namn), '\\s+', ' ', 'g')) as namn
  from aesamtable a
  join foretag_publik f on f.cfarnr = a.cfarnr
  where a.ng1 in (${ng1.join(",")})
    and a.jurform::int in (81, 82, 83, 84)
    and f.orgnr like '2%'
    and nullif(trim(a.ben), '') is not null
    and nullif(trim(a.namn), '') is not null
  order by a.cfarnr`;

const ut = execFileSync(
  "supabase",
  ["db", "query", "--linked", "--project-ref", PROJECT_REF, "-o", "json", sql],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
);
rmSync(new URL("../supabase", import.meta.url), { recursive: true, force: true });
const alla = JSON.parse(ut.slice(ut.indexOf("{"), ut.lastIndexOf("}") + 1)).rows;
if (alla.length < 5000) throw new Error(`Misstänkt få rader: ${alla.length}`);

const arHuvudman = (n) => new RegExp(`\\b${HUVUDMAN}`).test(n);
/** [cfarnr, visningsnamn eller "" (behåll namn), huvudman] */
const rader = [];
for (const r of alla) {
  if (arHuvudman(r.namn) && !arHuvudman(r.ben)) rader.push([r.cfarnr, r.ben, r.namn]);
  else if (!arHuvudman(r.namn) && arHuvudman(r.ben)) rader.push([r.cfarnr, "", r.ben]);
}

const antal = new Map();
for (const [, v] of rader) if (v) antal.set(v, (antal.get(v) ?? 0) + 1);
const generiska = [...antal].filter(([, n]) => n >= GENERISK_FRAN).map(([b]) => b).sort();

// Kompakt: namnen i en ordlista, raderna som "cfarnr-delta:visning:huvudman"
// i bas 36; tom visning = behåll radens namn.
const namn = [...new Set(rader.flatMap(([, v, h]) => (v ? [v, h] : [h])))].sort();
const index = new Map(namn.map((b, i) => [b, i.toString(36)]));
let forra = 0;
const packad = rader
  .map(([c, v, h]) => {
    const d = (c - forra).toString(36);
    forra = c;
    return `${d}:${v ? index.get(v) : ""}:${index.get(h)}`;
  })
  .join(",");

const fil = `// GENERERAD av scripts/hamta-arbetsstallenamn.mjs — ändra inte för hand.
// Arbetsställets namn (aesamtable.ben) och huvudman för ${rader.length} vårdställen
// med offentlig huvudman. Hämtad ${new Date().toISOString().slice(0, 10)}.
// Format: NAMN = ordlista; PACKAD = "cfarnr-delta:visning:huvudman" (index i bas 36,
// tom visning = behåll radens namn), kommaseparerade.
export const NAMN: readonly string[] = ${JSON.stringify(namn)};
/** Namn som förekommer ${GENERISK_FRAN}+ gånger — en typ av ställe, inte ett namn. */
export const GENERISKA: readonly string[] = ${JSON.stringify(generiska)};
export const PACKAD = ${JSON.stringify(packad)};
`;
writeFileSync(new URL("../src/lib/arbetsstallenamn-snapshot.ts", import.meta.url), fil);
console.error(`arbetsstallenamn-snapshot.ts: ${rader.length} av ${alla.length} ställen, ${namn.length} namn, ${generiska.length} generiska, ${fil.length} byte`);
