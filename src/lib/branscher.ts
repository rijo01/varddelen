import { getSupabaseAnon } from "./supabase";

/**
 * Branschnamn-lookup mot t_bransch via anon-nyckeln.
 *
 * Om anon saknar GRANT SELECT på t_bransch returneras null/tom map och
 * UI:t faller tillbaka till "SNI {kod}". Fixa då databasen med:
 *   GRANT SELECT ON public.t_bransch TO anon;
 */

const TABLE = "t_bransch";

export async function getBranschName(code: string | number): Promise<string | null> {
  const id = typeof code === "string" ? Number(code) : code;
  if (!Number.isFinite(id)) return null;
  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from(TABLE)
    .select("beskrivning")
    .eq("branschid", id)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { beskrivning: string | null }).beskrivning ?? null;
}

export async function getBranschNamesBulk(
  codes: Array<string | number>,
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(
      codes
        .map((c) => (typeof c === "string" ? Number(c) : c))
        .filter((n): n is number => Number.isFinite(n)),
    ),
  );
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  const supa = getSupabaseAnon();
  const { data, error } = await supa
    .from(TABLE)
    .select("branschid, beskrivning")
    .in("branschid", ids);
  if (error || !data) return result;
  for (const row of data as Array<{ branschid: number; beskrivning: string | null }>) {
    if (row.beskrivning) result.set(String(row.branschid), row.beskrivning);
  }
  return result;
}

/** Bygg URL-slug för en bransch: "byggmastare" från "Byggmästare". */
export function branschSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/\//g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
