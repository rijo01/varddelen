import { createHash, randomBytes } from "node:crypto";
import { visaTelefon } from "@/lib/telefon";
import { formatTelefon } from "@/lib/foretag-format";

/**
 * POST /api/telefon/<cfarnr> — "Visa nummer".
 *
 * Svarar med numret som får visas för arbetsstället och räknar visningen
 * (telefon_visning, per dag). Reglerna bor i databasen (pilot-007).
 *
 *   200 { telefon, tel, kalla }   numret, formaterat + tel:-värde
 *   404 { telefon: null }         inget nummer får visas
 *   400 / 403 / 429               ogiltigt cfarnr / annan sajt / för många
 *
 * INTEGRITET: ingen IP, ingen cookie, ingen user agent sparas någonstans.
 * Spärren mot massuttag hålls i minnet, per instans, på en saltad hash av
 * IP-adressen; saltet slumpas när instansen startar och lämnar den aldrig.
 * Botar (enkel UA-kontroll) får svar men räknas inte.
 */

export const dynamic = "force-dynamic";

const FONSTER_MS = 10 * 60_000;
const MAX_PER_FONSTER = 30;
const RAKNA_EN_GANG_MS = 30 * 60_000;
const BOT = /bot|crawl|spider|slurp|scrap|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|httpx|axios|node-fetch|go-http|java\//i;

const SALT = randomBytes(16);
const anrop = new Map<string, { start: number; n: number }>();
const raknade = new Map<string, number>();

function besokare(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "okand";
  return createHash("sha256").update(SALT).update(ip).digest("hex").slice(0, 32);
}

function stada(nu: number) {
  if (anrop.size > 5000) for (const [k, v] of anrop) if (nu - v.start > FONSTER_MS) anrop.delete(k);
  if (raknade.size > 20000) for (const [k, t] of raknade) if (nu - t > RAKNA_EN_GANG_MS) raknade.delete(k);
}

function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" },
  });
}

/** Bara anrop från sajtens egna sidor (knappen), inte från andra webbplatser. */
function egenSajt(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ cfarnr: string }> }) {
  const { cfarnr: s } = await ctx.params;
  if (!/^[1-9]\d{0,7}$/.test(s)) return json(400, { telefon: null, error: "ogiltigt arbetsställe" });
  if (!egenSajt(req)) return json(403, { telefon: null, error: "fel ursprung" });

  const nu = Date.now();
  stada(nu);
  const vem = besokare(req);
  const f = anrop.get(vem);
  if (!f || nu - f.start > FONSTER_MS) anrop.set(vem, { start: nu, n: 1 });
  else if (++f.n > MAX_PER_FONSTER) return json(429, { telefon: null, error: "för många visningar, försök igen om en stund" });

  const cfarnr = Number(s);
  const bot = BOT.test(req.headers.get("user-agent") ?? "");
  const nyckel = `${vem}:${cfarnr}`;
  const senast = raknade.get(nyckel);
  const rakna = !bot && !(senast && nu - senast < RAKNA_EN_GANG_MS);

  const svar = await visaTelefon(cfarnr, rakna);
  if (!svar) return json(404, { telefon: null });
  if (rakna) raknade.set(nyckel, nu);
  return json(200, {
    telefon: formatTelefon("0" + svar.telefon.slice(3)) ?? svar.telefon,
    tel: svar.telefon,
    kalla: svar.kalla,
  });
}
