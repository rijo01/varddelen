import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role-klient. ENDAST för overlay-lagret, och endast på servern.
 *
 * `src/lib/supabase.ts` säger rakt ut att sajten aldrig får röra
 * service-role-nyckeln, och det gäller fortfarande för all läsning av
 * registret: `foretag_publik` är en maskad vy, och service role kringgår RLS
 * och skulle kunna läcka `peorgnr` om en query slank igenom.
 *
 * Overlay-endpointen behöver ändå nyckeln, av två skäl som inte går att
 * komma runt:
 *
 *   • den SKRIVER i overlay_profil, och tabellens RLS har med flit ingen
 *     skrivpolicy alls — enda vägen in är service role,
 *   • den läser UTKAST, som RLS aldrig visar publikt.
 *
 * Gränsen upprätthålls i stället här: `server-only` gör att en import från en
 * klientkomponent blir ett byggfel, inte en tyst läcka, och den här modulen
 * rör aldrig `foretag_publik` — bara overlay_profil och storage-bucketen.
 *
 * Klienten skapas per anrop, inte som modulsingleton: env läses vid anropet,
 * och en saknad nyckel blir ett fel här och nu i stället för ett halvt
 * tillstånd som fastnat i byggcachen.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
