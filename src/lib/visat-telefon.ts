/**
 * Vilket telefonnummer ett bolag visas med — EN regel, för varje yta.
 *
 * `dolj_andra_nummer` är kundens köpta rätt att ersätta registrets nummer med
 * sitt eget, men bara när de faktiskt lämnat ett: en kund som kryssat i rutan
 * och tömt nummerfältet ska inte få en sida helt utan telefonnummer.
 *
 * Regeln stod tidigare bara i profilens huvud. FAQ:n (HTML och FAQPage-JSON-LD)
 * och listkorten läste `f.tel` direkt, så en betalande kund som köpt bort
 * registrets nummer fick det ändå visat i alla listor och i FAQ:n. Rättat
 * 2026-10-05; all kod som visar ett bolags nummer går hit.
 *
 * Beroendefri med flit: CompanyCard får inte dra in lib/overlay.ts, som
 * importerar server-only-moduler.
 */
export function visatTelefon(
  registrets: string | null | undefined,
  overlay: { telefon_override?: string | null; dolj_andra_nummer?: boolean | null } | null | undefined,
): string | null {
  const eget = overlay?.telefon_override?.trim() || null;
  if (overlay?.dolj_andra_nummer && eget) return eget;
  return registrets?.trim() || eget;
}
