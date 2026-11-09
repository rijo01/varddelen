import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Profilnivån (kontrakt 1.7): lib/overlay-visning.ts är TypeScript och
 * importerar kontraktet. Båda transpileras här med projektets egen
 * `typescript` till en tillfällig katalog — inga nya beroenden.
 */
const require = createRequire(import.meta.url);
const ts = require("typescript");
const rot = new URL("../", import.meta.url);
const ut = mkdtempSync(join(tmpdir(), "overlay-visning-"));
function transpilera(rel, namn, ersatt = (s) => s) {
  const kalla = readFileSync(new URL(rel, rot), "utf8");
  const js = ts.transpileModule(ersatt(kalla), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(ut, namn), js);
}
// zod löses från projektets node_modules.
transpilera("src/lib/overlay-contract.ts", "overlay-contract.mjs", (s) =>
  s.replace('from "zod"', `from ${JSON.stringify(pathToFileURL(require.resolve("zod")).href)}`),
);
transpilera("src/lib/overlay-visning.ts", "overlay-visning.mjs", (s) =>
  s.replace('from "./overlay-contract"', 'from "./overlay-contract.mjs"'),
);
const { overlayVisning, tillampaNiva, ETIKETT_GRATIS } = await import(pathToFileURL(join(ut, "overlay-visning.mjs")).href);

const BAS = {
  id: "x", sajt: "varddelen", entity_type: "arbetsstalle", external_id: "123", status: "aktiv", revision: 3,
  featured: true, list_priority: 9, keywords: ["vård"], logo_url: "https://x/logo.png", info_html: "<p>Text</p>",
  kontaktperson: "Någon", kategorier: ["Hemtjänst"], popularnamn: "Popnamn", telefon_typ: "Växel",
  hemsida: "https://bolaget.se", telefon_override: "054-12 34 56", epost_override: "info@bolaget.se",
  dolj_andra_nummer: false, adress_override: { postort: "Karlstad" },
};

test("kontakt: bara de tre fälten, tyst; inget märke, ingen rankning, ingen indexering; säljvägen kvar", () => {
  const rad = tillampaNiva({ ...BAS, profilniva: "kontakt" });
  assert.equal(rad.featured, false);
  assert.equal(rad.list_priority, 0);
  assert.deepEqual(rad.keywords, []);
  assert.equal(rad.logo_url, null);
  assert.equal(rad.info_html, null);
  assert.equal(rad.kontaktperson, null);
  assert.deepEqual(rad.kategorier, []);
  assert.equal(rad.popularnamn, null);
  assert.equal(rad.adress_override, null);
  assert.equal(rad.hemsida, "https://bolaget.se");
  assert.equal(rad.telefon_override, "054-12 34 56");
  assert.equal(rad.epost_override, "info@bolaget.se");
  // Ersätter registrets nummer tyst.
  assert.equal(rad.dolj_andra_nummer, true);
  assert.deepEqual(overlayVisning(rad), { niva: "kontakt", marke: false, etikett: null, rankning: false, indexering: false, saljvag: true });
});

test("okänd nivå behandlas som kontakt", () => {
  const rad = tillampaNiva({ ...BAS, profilniva: "framtida" });
  assert.equal(overlayVisning(rad).niva, "kontakt");
  assert.equal(rad.logo_url, null);
  assert.equal(rad.featured, false);
});

test("gratis: 'Uppgifter från företaget', aldrig märke eller rankning, indexering som betald", () => {
  const rad = tillampaNiva({ ...BAS, profilniva: "gratis" });
  assert.equal(rad.featured, false);
  assert.equal(rad.list_priority, 0);
  assert.equal(rad.info_html, "<p>Text</p>");
  assert.deepEqual(overlayVisning(rad), { niva: "gratis", marke: false, etikett: ETIKETT_GRATIS, rankning: false, indexering: true, saljvag: true });
});

test("betald, och en rad från före 1.7 (ingen nivå): som i dag", () => {
  for (const profilniva of ["betald", undefined, null]) {
    const rad = tillampaNiva({ ...BAS, profilniva });
    assert.equal(rad.featured, true);
    assert.equal(rad.list_priority, 9);
    assert.equal(rad.logo_url, "https://x/logo.png");
    const v = overlayVisning(rad);
    assert.equal(v.niva, "betald");
    assert.ok(v.marke && v.rankning && v.indexering);
  }
});

test("varje läsning i lib/overlay.ts går genom tillampaNiva, och sitemapens grind frågar nivån", () => {
  const s = readFileSync(new URL("src/lib/overlay.ts", rot), "utf8");
  assert.equal((s.match(/filtreraOverlay\(/g) ?? []).length, (s.match(/tillampaNiva\(filtreraOverlay\(/g) ?? []).length);
  assert.match(s, /function harInnehall[\s\S]{0,200}overlayVisning\(rad\)\?\.indexering/);
  const r = readFileSync(new URL("src/lib/overlay-rankning.ts", rot), "utf8");
  assert.match(r, /export function overlayGerSubstans[\s\S]{0,200}overlayVisning\(rad\)\?\.indexering/);
  const k = readFileSync(new URL("src/components/sponsrad-profil.tsx", rot), "utf8");
  assert.match(k, /if \(!visning\?\.etikett\) return null/);
  assert.doesNotMatch(k, />Betald profil</);
});
