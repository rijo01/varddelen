import { getSupabaseAnon } from "./supabase";

/**
 * Kolumnen listorna sorterar och storleksfiltrerar på.
 *
 * `aeant` är bolagets antal anställda och står likadant på varje arbetsställe,
 * så en Praktikertjänst-mottagning sorterades som 1 198 anställda. Vyn har
 * (kluster/006) `aeant_per_stalle`: bolagets antal delat på dess arbetsställen,
 * enskild firma alltid ett arbetsställe.
 *
 * KODEN FÖRE MIGRATIONEN: kolumnen kan saknas. Den provas därför en gång och
 * svaret cachas — saknas den sorterar sajten på `aeant` som förut, och provar
 * igen om fem minuter så att migrationen tar utan omdeploy.
 */
export type Storlekskolumn = "aeant" | "aeant_per_stalle";

const OM_SAKNAS_MS = 5 * 60_000;
const OM_FINNS_MS = 24 * 60 * 60_000;

let svar: { kolumn: Storlekskolumn; till: number } | null = null;
let pagaende: Promise<Storlekskolumn> | null = null;

export async function storleksKolumn(): Promise<Storlekskolumn> {
  if (svar && svar.till > Date.now()) return svar.kolumn;
  pagaende ??= (async () => {
    try {
      const { error } = await getSupabaseAnon()
        .from("foretag_publik")
        .select("aeant_per_stalle")
        .limit(1);
      const kolumn: Storlekskolumn = error ? "aeant" : "aeant_per_stalle";
      svar = { kolumn, till: Date.now() + (error ? OM_SAKNAS_MS : OM_FINNS_MS) };
      return kolumn;
    } catch {
      svar = { kolumn: "aeant", till: Date.now() + OM_SAKNAS_MS };
      return "aeant" as const;
    } finally {
      pagaende = null;
    }
  })();
  return pagaende;
}
