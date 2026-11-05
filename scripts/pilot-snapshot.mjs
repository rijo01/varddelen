/**
 * Prebuild-steg: i pilotläget (NEXT_PUBLIC_DATAKALLA=pilot) byggs src/data/*.pilot.json om ur
 * varddelen-projektet vid VARJE bygge, så att talen och indexerbarhetsgrinden alltid speglar databasen
 * vid deployögonblicket. I klusterläget gör steget ingenting — klustrets snapshotar är committade.
 *
 * Misslyckas hämtningen avbryts bygget (exit ≠ 0): en misslyckad deploy lämnar föregående
 * deployment kvar, vilket är bättre än en ny deploy med inaktuella eller halva tal.
 * Kräver NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_ANON_KEY i byggmiljön (anon räcker).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.NEXT_PUBLIC_DATAKALLA !== "pilot") {
  console.error("pilot-snapshot: klusterläge — hoppar över");
  process.exit(0);
}
const skript = fileURLToPath(new URL("./build-index-set.mjs", import.meta.url));
const r = spawnSync(process.execPath, [skript], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
