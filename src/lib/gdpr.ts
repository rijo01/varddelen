/**
 * Maskerar de sista 4 siffrorna av ett person- eller organisationsnummer.
 * Personnummer (12 siffror) i kolumnen peorgnr för enskilda firmor får
 * sista 4 ersatta med "xxxx". Organisationsnummer (10 siffror för AB)
 * behandlas likadant av konsekvens — vi visar aldrig fullständigt nummer
 * publikt.
 *
 * Why: peorgnr på enskilda firmor är personuppgifter enligt GDPR.
 */
export function maskOrgnr(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "xxxx";
  const head = digits.slice(0, -4);
  return `${head}xxxx`;
}

/**
 * Formaterar maskat orgnr för visning:
 *   12 siffror (personnummer): "YYYYMMDD-xxxx"
 *   10 siffror (orgnr AB):     "XXXXXX-xxxx"
 */
export function formatMaskedOrgnr(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12) {
    return `${digits.slice(0, 8)}-xxxx`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 6)}-xxxx`;
  }
  return maskOrgnr(raw);
}
