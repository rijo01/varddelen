/**
 * Sveriges 21 län.
 *
 * `code`     = länskod utan leading zero (matchar aesamtable.lan i datan).
 * `scbCode`  = 2-siffrigt SCB-format.
 * `slug`     = för URL-bruk (a-z, gemener, åäö→a/o).
 *
 * För att filtrera företag per län använder vi `kommunCodesForLan()` som
 * returnerar alla kommuner inom länet — sedan filtreras queryen via
 * `.in("kommun", codes)`. Detta är medvetet val över `.eq("lan", X)`:
 * aesamtable.lan-kolumnen har data-dirt (samma kommun kan ha 2-4 olika
 * lan-värden inkl. NULL), medan kommun→län-mappningen i kommuner.ts är
 * auktoritativ (härledd från SCB-koden). Bonus: vi använder existerande
 * `(kommun, ng1, aeant DESC)`-indexen direkt.
 */

import { ALL_KOMMUNER } from "./kommuner";

export type Lan = {
  code: string;
  scbCode: string;
  name: string;
  slug: string;
};

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const RAW: Array<[string, string]> = [
  ["01", "Stockholm"],
  ["03", "Uppsala"],
  ["04", "Södermanland"],
  ["05", "Östergötland"],
  ["06", "Jönköping"],
  ["07", "Kronoberg"],
  ["08", "Kalmar"],
  ["09", "Gotland"],
  ["10", "Blekinge"],
  ["12", "Skåne"],
  ["13", "Halland"],
  ["14", "Västra Götaland"],
  ["17", "Värmland"],
  ["18", "Örebro"],
  ["19", "Västmanland"],
  ["20", "Dalarna"],
  ["21", "Gävleborg"],
  ["22", "Västernorrland"],
  ["23", "Jämtland"],
  ["24", "Västerbotten"],
  ["25", "Norrbotten"],
];

export const ALL_LAN: ReadonlyArray<Lan> = RAW.map(([scb, name]) => ({
  code: scb.replace(/^0+/, "") || "0",
  scbCode: scb,
  name,
  slug: makeSlug(name),
}));

const BY_SLUG = new Map<string, Lan>(ALL_LAN.map((l) => [l.slug, l]));
const BY_CODE = new Map<string, Lan>(ALL_LAN.map((l) => [l.code, l]));
const BY_SCB = new Map<string, Lan>(ALL_LAN.map((l) => [l.scbCode, l]));

export function lanBySlug(slug: string): Lan | undefined {
  return BY_SLUG.get(slug);
}

export function lanByCode(code: string): Lan | undefined {
  const normalized = code.replace(/^0+/, "") || "0";
  return BY_CODE.get(normalized) ?? BY_SCB.get(code);
}

/**
 * Alla kommun-koder som tillhör ett län. Använd för `.in("kommun", codes)`.
 * Tom array om lanCode inte är ett känt län — kallsidan får då skippa filtret
 * istället för att queryen blir tom.
 */
export function kommunCodesForLan(lanCode: string): string[] {
  const normalized = lanCode.replace(/^0+/, "") || "0";
  return ALL_KOMMUNER.filter((k) => k.lan === normalized).map((k) => k.code);
}
