/**
 * Vårddelens kategorier för startsidan.
 *
 * Mappning av en användarvänlig kategori-bucket till en eller flera
 * SCB-branschid (ng1). `count` HÄRLEDS ur räknesnapshoten (lib/counts.ts)
 * genom att summera bucketens branscher — det är per konstruktion samma tal
 * som /branscher och kommunsidorna visar för samma branscher.
 *
 * Talen var tidigare hårdkodade per kategori och kom från count=estimated.
 * De låg därför fel (Hälso- & sjukvård stod som 22 010, exakt antal är
 * 21 316) och kunde inte hållas i synk med resten av sajten.
 *
 * Designprincip — visa BARA kategorier vi kan fylla med riktig data:
 *  - Varje bucket har ≥361 företag (lägsta är Äldreomsorg).
 *  - Ingen överlapp mellan buckets (87302 ligger bara i LSS, 87100 bara i
 *    Äldreomsorg, etc.).
 *  - Alla branschid kommer från VARD_BRANSCHER så filter-guards passar.
 *
 * Klick på ett kategorikort skickar till /sok?kategori=<slug>.
 * /sok-route:n läser kategorin här och passerar ng1List vidare till
 * searchForetag — så att resultat-listan visar äkta träffar inom bucketen.
 */

import type { LucideIcon } from "lucide-react";
import { Home, Heart, Accessibility, Stethoscope, Smile, Pill } from "lucide-react";
import { branschTotal } from "./counts";

export type VardKategori = {
  slug: string;
  name: string;
  description: string;
  ng1: readonly number[];
  /** Härlett: summan av bucketens branscher i räknesnapshoten. */
  count: number;
  icon: LucideIcon;
};

type KategoriDef = Omit<VardKategori, "count">;

const KATEGORI_DEFS: ReadonlyArray<KategoriDef> = [
  {
    slug: "halsovard",
    name: "Hälso- & sjukvård",
    description: "Vårdcentraler, specialistläkare, sjukgymnaster, slutenvård",
    // 86909, 86905, 86212, 86222, 86211, 86903, 86102, 86103, 86221, 86902 = läkare/sjukvård/rehab
    // 2 = företagshälsovård
    ng1: [86909, 86905, 86212, 86222, 86211, 86903, 86102, 86103, 86221, 86902, 2],
    icon: Stethoscope,
  },
  {
    slug: "lss",
    name: "LSS & funktionshinder",
    description: "Boende & stöd för personer med funktionshinder",
    // 87201 = utvecklingsstörda LSS, 87202 = fysiska, 87203 = psykiska
    // 87302 = särskilda boendeformer funktionshindrade
    ng1: [87201, 87202, 87203, 87302],
    icon: Accessibility,
  },
  {
    slug: "tandvard",
    name: "Tandvård",
    description: "Tandläkare, tandhygienister, specialisttandvård",
    ng1: [86230, 86904],
    icon: Smile,
  },
  {
    slug: "hvb",
    name: "HVB & Behandlingshem",
    description: "Heldygnsvård, missbruksvård, sociala insatser",
    // 87901 = barn/ungdom heldygn, 87902 = vuxen missbruk heldygn
    // 88991 = öppna insatser missbruk, 88992 = övriga öppna insatser
    ng1: [87901, 87902, 88991, 88992],
    icon: Home,
  },
  {
    slug: "apotek",
    name: "Apotek & medicinsk handel",
    description: "Apotek, sjukvårdsartiklar, medicinsk grossist",
    ng1: [47730, 47740, 46460],
    icon: Pill,
  },
  {
    slug: "aldreomsorg",
    name: "Äldreomsorg",
    description: "Särskilda boendeformer för äldre personer",
    ng1: [87100],
    icon: Heart,
  },
];

/**
 * Bucketarna får inte överlappa — gör de det dubbelräknas företag i summan
 * och kategorikortens tal slutar vara jämförbara med resten av sajten.
 */
const _seen = new Set<number>();
for (const k of KATEGORI_DEFS) {
  for (const ng1 of k.ng1) {
    if (_seen.has(ng1)) {
      throw new Error(`Branschid ${ng1} ligger i mer än en vårdkategori`);
    }
    _seen.add(ng1);
  }
}

export const VARD_KATEGORIER: ReadonlyArray<VardKategori> = KATEGORI_DEFS.map(
  (k) => ({ ...k, count: k.ng1.reduce((sum, ng1) => sum + branschTotal(ng1), 0) }),
);

/** Slå upp en kategori via slug. */
export function getKategoriBySlug(slug: string): VardKategori | null {
  return VARD_KATEGORIER.find((k) => k.slug === slug) ?? null;
}
