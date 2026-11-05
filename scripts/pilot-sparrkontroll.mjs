/**
 * Prebuild-prov: piloten får inte byggas mot ett projekt utan företagsspärren (kontrakt 1.6).
 *
 * I pilotläget (NEXT_PUBLIC_DATAKALLA=pilot) läser sajten varddelens egna Supabase-projekt.
 * Finns inte `overlay_foretag_sparr` där tål koden det — tom spärr — och då visas bolag som
 * tagits bort genom CRM:ets "Ta bort företag" igen, och en DELETE skriver till fel databas.
 * Därför fäller det här steget bygget (exit ≠ 0) om:
 *
 *   1. overlay_ar_sparrade() inte svarar 200 med anon-nyckeln (tabellen/funktionerna saknas)
 *   2. service role inte kan läsa overlay_foretag_sparr (grants saknas — DELETE svarar då 500)
 *
 * Att spärrraderna är överförda och att DELETE är provad mot projektet går inte att se här;
 * det är villkor i README ("Piloten får inte slås på …") som provas för hand.
 * I klusterläget gör steget ingenting.
 */

export function bedom({ ar, tabell }) {
  const fel = [];
  if (ar.status !== 200) {
    fel.push(`overlay_ar_sparrade svarar ${ar.status}${ar.kod ? ` (${ar.kod})` : ""}: overlay_foretag_sparr och funktionerna saknas i projektet (lib/sql/overlay-radera.sql)`);
  }
  if (tabell === null) {
    fel.push("SUPABASE_SERVICE_ROLE_KEY saknas i byggmiljön: grants på overlay_foretag_sparr kan inte provas");
  } else if (tabell.status !== 200) {
    fel.push(`service role kan inte läsa overlay_foretag_sparr (HTTP ${tabell.status}${tabell.kod ? `, ${tabell.kod}` : ""}): kör lib/sql/overlay-radera-grants.sql`);
  }
  return fel;
}

async function svar(res) {
  const j = await res.json().catch(() => null);
  return { status: res.status, kod: j && typeof j === "object" && !Array.isArray(j) ? j.code ?? null : null };
}

async function main() {
  if (process.env.NEXT_PUBLIC_DATAKALLA !== "pilot") {
    console.error("pilot-sparrkontroll: klusterläge — hoppar över");
    return 0;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  if (!url || !anon) {
    console.error("pilot-sparrkontroll: NEXT_PUBLIC_SUPABASE_URL eller _ANON_KEY saknas — bygget stoppas");
    return 1;
  }
  const ar = await svar(
    await fetch(`${url}/rest/v1/rpc/overlay_ar_sparrade`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_sajt: "varddelen", p_nycklar: [] }),
    })
  );
  const tabell = service
    ? await svar(
        await fetch(`${url}/rest/v1/overlay_foretag_sparr?select=nyckel&limit=1`, {
          headers: { apikey: service, Authorization: `Bearer ${service}` },
        })
      )
    : null;
  const fel = bedom({ ar, tabell });
  if (fel.length) {
    console.error("pilot-sparrkontroll: piloten saknar företagsspärren (kontrakt 1.6) — bygget stoppas:");
    for (const f of fel) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.error("pilot-sparrkontroll: overlay_foretag_sparr, funktionerna och grants finns i pilotprojektet");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((k) => process.exit(k), (e) => {
    console.error("pilot-sparrkontroll: kunde inte fråga projektet — bygget stoppas:", e?.message ?? e);
    process.exit(1);
  });
}
