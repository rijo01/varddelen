import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DbClient = SupabaseClient;

/**
 * Anon-klient mot Supabase. Sajten är en publik läs-sajt och får ALDRIG
 * röra service-role-nyckeln på serversidan — service role bypassar RLS
 * och skulle exponera känsliga kolumner (peorgnr) om en query slank igenom.
 *
 * All läsning sker mot vyn `foretag_publik` som är pre-maskad i databasen.
 * Initieras alltid inuti route handlers — aldrig på modulnivå.
 */
export function getSupabaseAnon(): DbClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
