import { NextResponse, type NextRequest } from "next/server";
import { AR_PILOT } from "@/lib/datakalla";
import { foretagSlug } from "@/lib/queries";

/**
 * Omdirigeringar för piloten (DB-separeringen, B-P6/B-P8). Bara när
 * NEXT_PUBLIC_DATAKALLA=pilot — i klusterläget gör filen ingenting.
 *
 *   /foretag/<slug>-<cfarnr>
 *     omdirigering (bara aktiv = true; kundspärrens förslag är aktiv = false):
 *       301 → till_cfarnr (företagets kanoniska slug) eller till_url
 *       410 → 410 Gone
 *       404 → 410 när gone_fran passerats, annars vidare (sidan 404:ar själv,
 *             eftersom raden inte finns i foretag_publik)
 *   /kommun/<k>/<namn>-<ng1>[/sida/N]
 *     omdirigering_sni: SNI 2007-kod som bytt nummer i SNI 2025
 *       301 → /kommun/<k>/<till_slug>-<till_ng1>[/sida/N], eller /kommun/<k>
 *             om koden togs bort ur urvalet
 *
 * Tabellerna är bara läsbara för service_role (pilot-004/005), så frågorna går
 * med SUPABASE_SERVICE_ROLE_KEY — som stannar på servern, proxy körs i Node.
 * Svaren cachas i minnet i CACHE_MS; ett nytt beslut slår igenom inom den tiden.
 */

const CACHE_MS = 10 * 60 * 1000;
const MAX_POSTER = 5000;

type Omdirigering = {
  status: 301 | 404 | 410;
  till_cfarnr: number | null;
  till_url: string | null;
  gone_fran: string | null;
};
type SniOmdirigering = { fran_ng1: number; till_ng1: number | null; till_slug: string | null };

const foretagCache = new Map<number, { t: number; v: Omdirigering | null; mal: string | null }>();
let sniCache: { t: number; v: Map<number, SniOmdirigering> } | null = null;

async function rest<T>(path: string): Promise<T[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("proxy: saknar NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`proxy: ${path.split("?")[0]} ${r.status}`);
  return (await r.json()) as T[];
}

async function foretagRegel(cfarnr: number) {
  const hit = foretagCache.get(cfarnr);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit;
  const [v = null] = await rest<Omdirigering>(
    `omdirigering?select=status,till_cfarnr,till_url,gone_fran&fran_cfarnr=eq.${cfarnr}&aktiv=is.true`,
  );
  let mal: string | null = null;
  if (v?.status === 301) {
    if (v.till_url) mal = v.till_url;
    else if (v.till_cfarnr != null) {
      // Målet måste vara publicerat nu — annars hellre ingen 301 än en 301 till en 404.
      const [f] = await rest<{ cfarnr: number; firma: string | null; namn: string | null }>(
        `foretag_publik?select=cfarnr,firma,namn&cfarnr=eq.${v.till_cfarnr}`,
      );
      if (f) mal = `/foretag/${foretagSlug(f)}`;
    }
  }
  if (foretagCache.size >= MAX_POSTER) foretagCache.clear();
  const post = { t: Date.now(), v, mal };
  foretagCache.set(cfarnr, post);
  return post;
}

async function sniRegler() {
  if (sniCache && Date.now() - sniCache.t < CACHE_MS) return sniCache.v;
  const rader = await rest<SniOmdirigering>("omdirigering_sni?select=fran_ng1,till_ng1,till_slug");
  sniCache = { t: Date.now(), v: new Map(rader.map((r) => [r.fran_ng1, r])) };
  return sniCache.v;
}

function gone(): NextResponse {
  return new NextResponse(
    '<!doctype html><html lang="sv"><meta charset="utf-8"><title>Sidan finns inte längre – Vårddelen</title>' +
      '<meta name="robots" content="noindex"><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">' +
      '<h1>Sidan finns inte längre</h1><p>Verksamheten finns inte kvar i vårt register.</p>' +
      '<p><a href="/">Till startsidan</a> · <a href="/sok">Sök vårdgivare</a></p></body></html>',
    { status: 410, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function omdirigera(request: NextRequest, mal: string): NextResponse {
  return NextResponse.redirect(new URL(mal, request.url), 301);
}

export async function proxy(request: NextRequest) {
  if (!AR_PILOT) return NextResponse.next();
  const path = request.nextUrl.pathname;
  try {
    const f = path.match(/^\/foretag\/[^/]*?-?(\d{1,10})\/?$/);
    if (f) {
      const { v, mal } = await foretagRegel(Number(f[1]));
      if (!v) return NextResponse.next();
      if (v.status === 301 && mal) return omdirigera(request, mal);
      const idag = new Date().toISOString().slice(0, 10);
      if (v.status === 410 || (v.status === 404 && v.gone_fran && v.gone_fran <= idag)) return gone();
      return NextResponse.next();
    }
    const k = path.match(/^\/kommun\/([^/]+)\/[^/]*?-?(\d{1,6})(\/sida\/\d+)?\/?$/);
    if (k) {
      const r = (await sniRegler()).get(Number(k[2]));
      if (!r) return NextResponse.next();
      if (r.till_ng1 == null || !r.till_slug) return omdirigera(request, `/kommun/${k[1]}`);
      return omdirigera(request, `/kommun/${k[1]}/${r.till_slug}-${r.till_ng1}${k[3] ?? ""}`);
    }
  } catch (e) {
    // En trasig omdirigeringsfråga får aldrig fälla sajten: sidan renderas som utan proxy.
    console.error(e instanceof Error ? e.message : e);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/foretag/:slug", "/kommun/:slug/:bransch", "/kommun/:slug/:bransch/sida/:n"],
};
