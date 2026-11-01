import { publiktNamn } from "./personuppgifter";

/**
 * Företagssidans slug: namnet + "-{cfarnr}". Routen matchar bara på cfarnr.
 *
 * Namnet är det publika namnet (publiktNamn), så en enskild firma utan eget
 * firmanamn får "enskild-firma-i-ort-{cfarnr}", aldrig ägarens namn.
 *
 * Sluggen byggs på flera ställen — listor, sitemap, overlay-publicering och
 * kontaktspärrens revalidering — och på varje sajt i klustret. Är den inte
 * densamma överallt revalideras fel adress när en kund publicerar eller en
 * uppgift spärras. Därför finns den bara här.
 */
export function foretagSlug(f: {
  firma: string | null;
  namn: string | null;
  cfarnr: number;
  jurform: number | null;
  // Obligatoriska med flit: varje anropsplats — även de som läser registret
  // direkt — måste kunna tillämpa namnregeln, annars pekar länkar och
  // canonical på olika adresser.
  poang: number | null;
  postort: string | null;
}): string {
  const p = publiktNamn(f);
  const name = p.firma || p.namn || "foretag";
  const base = name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "foretag"}-${f.cfarnr}`;
}
