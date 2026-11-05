/**
 * Vilken databas sajten läser (DB-separeringen, pilot 2026-11).
 *
 *   kluster  (standard)  klustrets foretag_publik i ymqb — SNI 2007, som i dag
 *   pilot                varddelens egna projekt (babenztvwzaiesducpja), matat
 *                        envägs från arbetsstalle i mtoz — SNI 2025
 *
 * Styrs av NEXT_PUBLIC_DATAKALLA vid BYGGET (Next bakar in NEXT_PUBLIC_* i
 * koden), tillsammans med NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY som pekar ut
 * projektet. Allt annat än exakt "pilot" ger klustret — en saknad eller
 * felstavad variabel ger alltså dagens sajt, aldrig en halv pilot.
 *
 * Tillbakarullning = bygg om med NEXT_PUBLIC_DATAKALLA borttagen och de gamla
 * Supabase-variablerna.
 */
export type Datakalla = "kluster" | "pilot";

export const DATAKALLA: Datakalla =
  process.env.NEXT_PUBLIC_DATAKALLA === "pilot" ? "pilot" : "kluster";

export const AR_PILOT = DATAKALLA === "pilot";
