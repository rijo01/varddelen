import "server-only";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * "Visa nummer" (beslut 2026-11-09). Numret finns ALDRIG i sidans HTML, JSON
 * eller RSC-payload: sidan får bara veta OM det finns ett nummer
 * (harTelefon), och själva numret hämtas av knappen från
 * POST /api/telefon/<cfarnr>, som också räknar visningen.
 *
 * Allt avgörs i databasen (pilot-007): kundens eget nummer före SCB AFR,
 * kontaktspärren vid varje läsning, och regeln att en enskild firma som inte
 * är kund bara visas med fast nummer. Här finns ingen kopia av reglerna.
 *
 * Service role, men bara mot de tre funktionerna — aldrig mot foretag_publik.
 */

/** kund = profilnivå betald/gratis; kontakt = numret i en kontaktorder (1.7, pilot-009). */
export type TelefonKalla = "kund" | "kontakt" | "scb-afr";

/** Har arbetsstället ett nummer som får visas? Fail-closed: vid fel → nej. */
export async function harTelefon(cfarnr: number): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin || !Number.isSafeInteger(cfarnr) || cfarnr < 1) return false;
  const { data, error } = await admin.rpc("vd_har_telefon", { p_cfarnr: [cfarnr] });
  if (error) {
    console.error("[telefon] vd_har_telefon:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Numret för ett arbetsställe, och räkna visningen om `rakna`. null = inget
 * nummer får visas (eller fel — då visas inget hellre än fel nummer).
 */
export async function visaTelefon(
  cfarnr: number,
  rakna: boolean,
): Promise<{ telefon: string; kalla: TelefonKalla } | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin.rpc("vd_telefon_visa", { p_cfarnr: cfarnr, p_rakna: rakna });
  if (error) {
    console.error("[telefon] vd_telefon_visa:", error.message);
    return null;
  }
  const rad = (Array.isArray(data) ? data[0] : data) as { telefon_norm?: string; kalla?: string } | undefined;
  if (!rad?.telefon_norm || (rad.kalla !== "kund" && rad.kalla !== "kontakt" && rad.kalla !== "scb-afr")) return null;
  return { telefon: `+${rad.telefon_norm}`, kalla: rad.kalla as TelefonKalla };
}
