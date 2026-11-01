import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ALL_KOMMUNER, kommunBySlug } from "@/lib/kommuner";
import { lanByCode, lanNamn } from "@/lib/lan";
import { branschFordelning, branschNamn, branschTotal, kommunBranschTotal, kommunTotal } from "@/lib/counts";
import { BRANSCH_LABEL, etikettIText } from "@/lib/stats";
import { AkutNotis, OrdningsNotis } from "@/components/vard-info";
import { getBranschName } from "@/lib/branscher";
import {
  branschPageSlug,
  listForetagInKommunByBransch,
  parseBranschSlug,
} from "@/lib/queries";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import { loadAktivaOverlays, overlayFor } from "@/lib/overlay";
import { ordnaBoostade } from "@/lib/overlay-rankning";
import { SITE_URL } from "@/lib/site";
import { robotsForHub } from "@/lib/indexability";

export const revalidate = 86400;

const fmt = (n: number) => n.toLocaleString("sv-SE");

type Params = Promise<{ slug: string; bransch: string }>;
type Search = Promise<{ page?: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug, bransch } = await params;
  const kommun = kommunBySlug(slug);
  const ng1 = parseBranschSlug(bransch);
  if (!kommun || !ng1) return { title: "Sida hittades inte" };
  const name = await getBranschName(ng1);
  // Samma dubblettyta som på företagssidan: parseBranschSlug läser bara
  // siffrorna sist, så canonical måste byggas ur branschnamnet — aldrig ur
  // den begärda sluggen. Utan känt branschnamn finns ingen kanonisk form att
  // peka på, och då utelämnar vi canonical hellre än att självkanonikalisera.
  const canonicalBransch = name ? branschPageSlug(name, ng1) : null;
  const title = `${name ?? `SNI ${ng1}`} i ${kommun.name}`;
  const description = `Vårdföretag inom ${(name ?? `SNI ${ng1}`).toLowerCase()} i ${kommun.name} kommun. Hitta lokala vård- och omsorgsföretag, kontaktuppgifter och adresser.`;
  return {
    title,
    description,
    ...(canonicalBransch
      ? {
          alternates: {
            canonical: `${SITE_URL}/kommun/${kommun.slug}/${canonicalBransch}`,
          },
        }
      : {}),
    openGraph: { title, description, type: "website", locale: "sv_SE" },
    // Hubbgrind: under 5 listade företag är sidan en omväg, inte ett urval.
    // noindex,follow — sidan lever kvar, länkflödet också. Se lib/indexability.ts.
    ...robotsForHub(kommun.code, ng1),
  };
}

const PAGE_SIZE = 25;

export default async function BranschPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { slug, bransch } = await params;
  const sp = await searchParams;
  const kommun = kommunBySlug(slug);
  const ng1 = parseBranschSlug(bransch);
  if (!kommun || !ng1) notFound();

  const branschNameOrNull = await getBranschName(ng1);

  /**
   * ÖPPEN DUBBLETTYTA — stängd med 308, samma felklass som /foretag/[slug].
   * /kommun/stockholm/vad-som-helst-86909 svarade 200 med egen canonical.
   *
   * Bara när branschnamnet är känt: utan namn finns ingen kanonisk slug att
   * peka på (fallback-rubriken "SNI 86909" är inte en identitet), och en
   * omdirigering dit hade bara flyttat problemet.
   */
  if (branschNameOrNull) {
    const canonicalBransch = branschPageSlug(branschNameOrNull, ng1);
    if (bransch !== canonicalBransch) {
      // Behåll sidparametern — en omdirigering som tappar den skickar
      // besökaren till sida 1, vilket ser ut som en bugg.
      const suffix = sp.page ? `?page=${encodeURIComponent(sp.page)}` : "";
      permanentRedirect(`/kommun/${kommun.slug}/${canonicalBransch}${suffix}`);
    }
  }

  const branschName = branschNameOrNull ?? `SNI ${ng1}`;
  const page = Math.max(1, Number(sp.page) || 1);

  // Databasen sorterar `poang desc, aeant desc, cfarnr asc`. Overlay-lagret
  // läggs ovanpå den ordningen, inte i stället för den: sorteringen är stabil,
  // så ett företag utan featured/list_priority hamnar exakt där det hade
  // hamnat utan overlay. Räckvidden är sidan — se ordnaBoostade().
  const [{ rows: oboostade, hasMore }, overlays] = await Promise.all([
    listForetagInKommunByBransch(kommun.code, ng1, {
      page,
      pageSize: PAGE_SIZE,
    }),
    loadAktivaOverlays(),
  ]);
  const rows = ordnaBoostade(oboostade, overlays);

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: kommun.name, href: `/kommun/${kommun.slug}` },
    { name: branschName, href: `/kommun/${kommun.slug}/${bransch}` },
  ];

  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: kommun.name, url: `${SITE_URL}/kommun/${kommun.slug}` },
    {
      name: branschName,
      url: `${SITE_URL}/kommun/${kommun.slug}/${bransch}`,
    },
  ]);

  const basePath = `/kommun/${kommun.slug}/${bransch}`;
  function withParams(overrides: Record<string, string | null>): string {
    const merged: Record<string, string | undefined> = {
      page: sp.page,
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) merged[k] = undefined;
      else merged[k] = v;
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // ===== Sidans egna fakta, ur räknesnapshoten =====
  // Allt nedan är tal för just den här orten och branschen — det som skiljer
  // sidan från samma mall i en annan kommun. Inga genererade påståenden.
  const etikett = BRANSCH_LABEL[ng1] ?? branschName;
  const antalHar = kommunBranschTotal(kommun.code, ng1);
  const antalKommun = kommunTotal(kommun.code);
  const antalLandet = branschTotal(ng1);
  const lan = lanByCode(kommun.lan);
  const andel = antalKommun > 0 ? Math.round((antalHar / antalKommun) * 100) : null;

  const grannar = ALL_KOMMUNER.filter((k) => k.lan === kommun.lan && k.code !== kommun.code)
    .map((k) => ({ kommun: k, count: kommunBranschTotal(k.code, ng1) }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const andraTyper = branschFordelning(kommun.code, 12)
    .filter((f) => f.ng1 !== ng1)
    .map((f) => {
      const dbName = branschNamn(f.ng1);
      if (!dbName) return null;
      return {
        ng1: f.ng1,
        count: f.count,
        label: BRANSCH_LABEL[f.ng1] ?? dbName,
        href: `/kommun/${kommun.slug}/${branschPageSlug(dbName, f.ng1)}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 8);

  const hubbHref = (slug: string) =>
    branschNameOrNull ? `/kommun/${slug}/${branschPageSlug(branschNameOrNull, ng1)}` : `/kommun/${slug}`;

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <header className="max-w-3xl space-y-3">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">
          {etikett} i {kommun.name}
        </h1>
        {antalHar > 0 && (
          <p className="text-[18px] leading-relaxed text-[var(--text-body)]">
            Registret har <strong className="font-semibold">{fmt(antalHar)}</strong>{" "}
            {antalHar === 1 ? "verksamhet" : "verksamheter"} inom {etikettIText(etikett)} i{" "}
            {kommun.name} kommun
            {andel != null && antalKommun > 0 && (
              <> — {andel < 1 ? "under 1" : andel} % av kommunens {fmt(antalKommun)} vård- och omsorgsverksamheter</>
            )}
            . I hela landet finns {fmt(antalLandet)}.
          </p>
        )}
      </header>

      <section aria-label={`${etikett} i ${kommun.name}`} className="space-y-3">
        {rows.length > 0 && <OrdningsNotis />}
        {rows.length === 0 ? (
          <div className="space-y-3 rounded-lg bg-[var(--surface-soft)] p-5 text-[17px]">
            <p>
              Inga verksamheter inom {etikettIText(etikett)} i {kommun.name}.
            </p>
            <Link
              href={`/kommun/${kommun.slug}`}
              className="inline-flex items-center gap-1.5 text-[var(--brand-ink)] underline"
            >
              <ArrowLeft aria-hidden className="size-4" />
              All vård och omsorg i {kommun.name}
            </Link>
          </div>
        ) : (
          <CompanyCardList>
            {rows.map((f) => (
              <li key={f.cfarnr}>
                <CompanyCard
                  foretag={f}
                  overlay={overlayFor(f, overlays)}
                  rubrikNiva={2}
                  branschName={etikett}
                  kommunName={kommun.name}
                />
              </li>
            ))}
          </CompanyCardList>
        )}

        {(page > 1 || hasMore) && (
          <nav aria-label="Sidor" className="flex items-center justify-between gap-3 pt-2 text-[16px]">
            {page > 1 ? (
              <Link
                href={withParams({ page: page > 2 ? String(page - 1) : null })}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--rule-strong)] px-4 font-medium text-[var(--text-strong)] hover:border-[var(--text-dim)]"
              >
                <ArrowLeft aria-hidden className="size-4" />
                Föregående
              </Link>
            ) : (
              <span />
            )}
            <span className="text-[var(--text-muted)]">Sida {page}</span>
            {hasMore ? (
              <Link
                href={withParams({ page: String(page + 1) })}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--rule-strong)] px-4 font-medium text-[var(--text-strong)] hover:border-[var(--text-dim)]"
              >
                Nästa
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>

      <div className="grid gap-10 border-t border-[var(--rule)] pt-8 md:grid-cols-2">
        {grannar.length > 0 && (
          <section aria-labelledby="grannar-rubrik" className="space-y-3">
            <h2 id="grannar-rubrik" className="text-[1.25rem] font-semibold">
              {etikett} i {lan ? lanNamn(lan) : "närheten"}
            </h2>
            <ul className="border-t border-[var(--rule)]">
              {grannar.map((g) => (
                <li key={g.kommun.code} className="border-b border-[var(--rule)]">
                  <Link
                    href={hubbHref(g.kommun.slug)}
                    className="flex min-h-11 items-center justify-between gap-3 py-2 text-[16px] text-[var(--text-body)] hover:text-[var(--brand-ink)] hover:underline"
                  >
                    {g.kommun.name}
                    <span className="text-[15px] text-[var(--text-dim)]">{fmt(g.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {andraTyper.length > 0 && (
          <section aria-labelledby="andra-rubrik" className="space-y-3">
            <h2 id="andra-rubrik" className="text-[1.25rem] font-semibold">
              Annan vård i {kommun.name}
            </h2>
            <ul className="border-t border-[var(--rule)]">
              {andraTyper.map((k) => (
                <li key={k.ng1} className="border-b border-[var(--rule)]">
                  <Link
                    href={k.href}
                    className="flex min-h-11 items-center justify-between gap-3 py-2 text-[16px] text-[var(--text-body)] hover:text-[var(--brand-ink)] hover:underline"
                  >
                    {k.label}
                    <span className="text-[15px] text-[var(--text-dim)]">{fmt(k.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={`/kommun/${kommun.slug}`} className="inline-block text-[16px] text-[var(--brand-ink)] underline">
              All vård och omsorg i {kommun.name}
            </Link>
          </section>
        )}
      </div>

      <AkutNotis />
    </div>
  );
}
