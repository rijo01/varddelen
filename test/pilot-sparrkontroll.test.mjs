import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { bedom } from "../scripts/pilot-sparrkontroll.mjs";

const SKRIPT = fileURLToPath(new URL("../scripts/pilot-sparrkontroll.mjs", import.meta.url));

test("bedom: allt på plats → inga fel", () => {
  assert.deepEqual(bedom({ ar: { status: 200 }, tabell: { status: 200 } }), []);
});

test("bedom: funktionen saknas (PGRST202) → fel", () => {
  const fel = bedom({ ar: { status: 404, kod: "PGRST202" }, tabell: { status: 200 } });
  assert.equal(fel.length, 1);
  assert.match(fel[0], /overlay_foretag_sparr och funktionerna saknas/);
});

test("bedom: grants saknas (42501) → fel", () => {
  assert.match(bedom({ ar: { status: 200 }, tabell: { status: 403, kod: "42501" } })[0], /overlay-radera-grants\.sql/);
});

test("bedom: ingen service role-nyckel → fel", () => {
  assert.match(bedom({ ar: { status: 200 }, tabell: null })[0], /SUPABASE_SERVICE_ROLE_KEY saknas/);
});

/** Kör skriptet (som prebuild gör) mot en låtsasdatabas och ger exit-koden. */
async function kor(env, svar) {
  const server = createServer((req, res) => {
    const s = svar(req.url ?? "");
    res.writeHead(s.status, { "content-type": "application/json" });
    res.end(JSON.stringify(s.kropp ?? []));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const kod = await new Promise((losa) => {
    const p = spawn(process.execPath, [SKRIPT], {
      env: { PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", ...env },
      stdio: "ignore",
    });
    p.on("exit", (k) => losa(k));
  });
  server.close();
  return kod;
}

const UTAN_SPARR = (u) =>
  u.includes("overlay_ar_sparrade")
    ? { status: 404, kropp: { code: "PGRST202", message: "Could not find the function" } }
    : { status: 404, kropp: { code: "PGRST205", message: "Could not find the table" } };
const MED_SPARR = () => ({ status: 200, kropp: [] });

test("bygget fälls: pilot mot ett projekt utan overlay_foretag_sparr", async () => {
  assert.equal(await kor({ NEXT_PUBLIC_DATAKALLA: "pilot" }, UTAN_SPARR), 1);
});

test("bygget fälls: pilot där grants saknas", async () => {
  const utanGrants = (u) => (u.includes("overlay_ar_sparrade") ? { status: 200, kropp: [] } : { status: 401, kropp: { code: "42501" } });
  assert.equal(await kor({ NEXT_PUBLIC_DATAKALLA: "pilot" }, utanGrants), 1);
});

test("bygget går: pilot mot ett projekt med spärren", async () => {
  assert.equal(await kor({ NEXT_PUBLIC_DATAKALLA: "pilot" }, MED_SPARR), 0);
});

test("klusterläge: steget gör ingenting, också mot ett projekt utan spärren", async () => {
  assert.equal(await kor({}, UTAN_SPARR), 0);
});
