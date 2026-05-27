import { NextResponse } from "next/server";
import { getSupabaseAnon } from "@/lib/supabase";
import { foretagSlug } from "@/lib/queries";
import { ALL_KOMMUNER } from "@/lib/kommuner";
import { TOP_BRANSCHER } from "@/lib/stats";
import { VARD_BRANSCHER } from "@/lib/vard-branscher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Slå upp upp till 3 branschnamn som matchar query (för suggest-dropdown). */
async function lookupBranscher(raw: string): Promise<Array<{ id: number; name: string }>> {
  try {
    const supa = getSupabaseAnon();
    const safe = raw.replace(/[%_]/g, " ").trim();
    const { data } = await supa
      .from("t_bransch")
      .select("branschid, beskrivning")
      .ilike("beskrivning", `%${safe}%`)
      .in("branschid", VARD_BRANSCHER)
      .limit(8);
    if (!data) return [];
    const lower = raw.toLowerCase();
    const seen = new Set<string>();
    const items: Array<{ id: number; name: string }> = [];
    const rows = (data as Array<{ branschid: number; beskrivning: string | null }>)
      .filter((r) => r.beskrivning)
      .sort((a, b) => {
        const ab = a.beskrivning!.toLowerCase();
        const bb = b.beskrivning!.toLowerCase();
        const ascore = (ab.startsWith(lower) ? 0 : 1) + (ab === lower ? -10 : 0);
        const bscore = (bb.startsWith(lower) ? 0 : 1) + (bb === lower ? -10 : 0);
        return ascore - bscore;
      });
    for (const r of rows) {
      if (seen.has(r.beskrivning!)) continue;
      seen.add(r.beskrivning!);
      items.push({ id: r.branschid, name: r.beskrivning! });
      if (items.length >= 3) break;
    }
    return items;
  } catch {
    return [];
  }
}

type Suggestion =
  | {
      type: "kommun";
      label: string;
      sub: string;
      href: string;
    }
  | {
      type: "bransch";
      label: string;
      sub: string;
      href: string;
    }
  | {
      type: "foretag";
      label: string;
      sub: string;
      href: string;
    };

/**
 * Instant-suggest:
 *  1) Kommunnamn matchas in-memory (290 st — billigt).
 *  2) Populära branscher matchas in-memory (12 st — billigt).
 *  3) Företag matchas via `search_vector` (websearch, swedish), 5 träffar.
 *
 * Resultatet är litet (~10 träffar) — klart att rendera i en dropdown direkt.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) {
    return NextResponse.json({ suggestions: [] }, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  }

  const needle = raw.toLowerCase();

  // 1. Kommuner som matchar på namnstart
  const kommunHits: Suggestion[] = ALL_KOMMUNER.filter((k) =>
    k.name.toLowerCase().startsWith(needle),
  )
    .slice(0, 3)
    .map((k) => ({
      type: "kommun" as const,
      label: k.name,
      sub: "Kommun",
      href: `/kommun/${k.slug}`,
    }));

  // 2. Branscher — först snabb in-memory mot populära, sedan DB-uppslag
  //    så att t.ex. "elektriker" hittar Elektriker även om den inte finns
  //    bland top-12.
  const memBransch = new Map<string, Suggestion>();
  for (const b of TOP_BRANSCHER) {
    if (b.name.toLowerCase().includes(needle)) {
      memBransch.set(b.name, {
        type: "bransch",
        label: b.name,
        sub: "Bransch",
        href: `/sok?q=${encodeURIComponent(b.name)}`,
      });
    }
  }
  const dbBransch = await lookupBranscher(raw);
  for (const b of dbBransch) {
    if (!memBransch.has(b.name)) {
      memBransch.set(b.name, {
        type: "bransch",
        label: b.name,
        sub: "Bransch",
        href: `/sok?q=${encodeURIComponent(b.name)}`,
      });
    }
  }
  const branschHits = Array.from(memBransch.values()).slice(0, 3);

  // 3. Företag via search_vector
  let foretagHits: Suggestion[] = [];
  try {
    const supa = getSupabaseAnon();
    const { data, error } = await supa
      .from("foretag_publik")
      .select("cfarnr,firma,namn,postort,kommun,aeant")
      .textSearch("search_vector", raw, {
        type: "websearch",
        config: "swedish_unaccent",
      })
      .in("ng1", VARD_BRANSCHER)
      .gte("aeant", 0)
      .order("aeant", { ascending: false })
      .order("cfarnr", { ascending: true })
      .limit(5);

    if (!error && data) {
      foretagHits = (
        data as Array<{
          cfarnr: number;
          firma: string | null;
          namn: string | null;
          postort: string | null;
          kommun: string | null;
        }>
      ).map((r) => {
        const name = r.firma || r.namn || "Okänt företag";
        return {
          type: "foretag" as const,
          label: name,
          sub: r.postort || r.kommun || "Sverige",
          href: `/foretag/${foretagSlug({ firma: r.firma, namn: r.namn, cfarnr: r.cfarnr })}`,
        };
      });
    }
  } catch {
    // Ignorera — låt UI:t visa enbart in-memory-träffar.
  }

  const suggestions: Suggestion[] = [
    ...kommunHits,
    ...branschHits,
    ...foretagHits,
  ];

  return NextResponse.json(
    { suggestions, query: raw },
    {
      headers: { "Cache-Control": "public, max-age=15, s-maxage=30" },
    },
  );
}
