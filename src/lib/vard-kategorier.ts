/**
 * Vårddelens kategorier för startsidan.
 *
 * Mappning av en användarvänlig kategori-bucket till en eller flera
 * SCB-branschid (ng1). Counts är förberäknade mot foretag_publik
 * (2026-05-24, samma datum som stats.ts).
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

export type VardKategori = {
  slug: string;
  name: string;
  description: string;
  ng1: readonly number[];
  count: number;
  icon: LucideIcon;
};

export const VARD_KATEGORIER: ReadonlyArray<VardKategori> = [
  {
    slug: "halsovard",
    name: "Hälso- & sjukvård",
    description: "Vårdcentraler, specialistläkare, sjukgymnaster, slutenvård",
    // 86909, 86905, 86212, 86222, 86211, 86903, 86102, 86103, 86221, 86902 = läkare/sjukvård/rehab
    // 84123 = offentlig förvaltning av vård, 2 = företagshälsovård
    ng1: [86909, 86905, 86212, 86222, 86211, 86903, 86102, 86103, 86221, 86902, 84123, 2],
    count: 20887,
    icon: Stethoscope,
  },
  {
    slug: "lss",
    name: "LSS & funktionshinder",
    description: "Boende & stöd för personer med funktionshinder",
    // 87201 = utvecklingsstörda LSS, 87202 = fysiska, 87203 = psykiska
    // 87302 = särskilda boendeformer funktionshindrade, 84124 = admin omsorg
    ng1: [87201, 87202, 87203, 87302, 84124],
    count: 4817,
    icon: Accessibility,
  },
  {
    slug: "tandvard",
    name: "Tandvård",
    description: "Tandläkare, tandhygienister, specialisttandvård",
    ng1: [86230, 86904],
    count: 4011,
    icon: Smile,
  },
  {
    slug: "hvb",
    name: "HVB & Behandlingshem",
    description: "Heldygnsvård, missbruksvård, sociala insatser",
    // 87901 = barn/ungdom heldygn, 87902 = vuxen missbruk heldygn
    // 88991 = öppna insatser missbruk, 88992 = övriga öppna insatser
    ng1: [87901, 87902, 88991, 88992],
    count: 1376,
    icon: Home,
  },
  {
    slug: "apotek",
    name: "Apotek & medicinsk handel",
    description: "Apotek, sjukvårdsartiklar, medicinsk grossist",
    ng1: [47730, 47740, 46460],
    count: 1032,
    icon: Pill,
  },
  {
    slug: "aldreomsorg",
    name: "Äldreomsorg",
    description: "Särskilda boendeformer för äldre personer",
    ng1: [87100],
    count: 361,
    icon: Heart,
  },
];

/** Slå upp en kategori via slug. */
export function getKategoriBySlug(slug: string): VardKategori | null {
  return VARD_KATEGORIER.find((k) => k.slug === slug) ?? null;
}
