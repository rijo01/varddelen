/**
 * SCB juridisk form-koder. Authoritative mappning från jurform (integer) till
 * svenskt namn. Källa: SCB Företagsregistret.
 *
 * När jurform finns i databasen ska vi använda den ÖVER vår heuristiska
 * namn-tolkning (detectLegalForm) — den är auktoritativ.
 */
const JURFORM_NAMES: ReadonlyMap<number, string> = new Map([
  [10, "Enskild firma"],
  [21, "Enkelt bolag"],
  [22, "Partrederi"],
  [31, "Handelsbolag"],
  [32, "Kommanditbolag"],
  [41, "Bankaktiebolag"],
  [42, "Försäkringsaktiebolag"],
  [49, "Aktiebolag"],
  [51, "Ekonomisk förening"],
  [52, "Sambruksförening"],
  [53, "Bostadsrättsförening"],
  [54, "Kooperativ hyresrättsförening"],
  [55, "Europeiska ekonomiska intressegrupperingar"],
  [61, "Ideell förening"],
  [62, "Servicebolag"],
  [63, "Religiöst samfund"],
  [71, "Familjestiftelse"],
  [72, "Pensions-/personalstiftelse"],
  [73, "Annan stiftelse"],
  [74, "Stiftelse"],
  [81, "Statlig enhet"],
  [82, "Offentlig korporation"],
  [83, "Kommun"],
  [84, "Landsting"],
  [85, "Kommunalförbund"],
  [86, "Församling"],
  [87, "Kyrklig samfällighet"],
  [88, "Borgerlig myndighet"],
  [89, "Allmän försäkringskassa"],
  [91, "Oskiftat dödsbo"],
  [92, "Ömsesidigt försäkringsbolag"],
  [93, "Understödsförening"],
  [94, "Sparbank"],
  [95, "Försäkringsförening"],
  [96, "Europabolag"],
  [99, "Övriga juridiska former"],
]);

export function jurformLabel(jurform: number | null | undefined): string | null {
  if (jurform == null) return null;
  return JURFORM_NAMES.get(jurform) ?? null;
}

/** Är jurform en sådan där orgnr är ett personnummer (= ska döljas)? */
export function isPersonalOrgnr(jurform: number | null | undefined): boolean {
  // Enskild firma (10), enkelt bolag (21), oskiftat dödsbo (91)
  // — orgnr === personnummer i dessa fall.
  if (jurform == null) return false;
  return jurform === 10 || jurform === 21 || jurform === 91;
}
