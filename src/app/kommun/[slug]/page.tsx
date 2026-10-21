import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_KOMMUNER, kommunBySlug } from "@/lib/kommuner";
import { lanByCode, lanNamn } from "@/lib/lan";
import {
  branschPageSlug,
  countForetagInKommun,
  listForetagInKommun,
} from "@/lib/queries";
import { branschFordelning, branschNamn, kommunTotal } from "@/lib/counts";
import { getBranschNamesBulk } from "@/lib/branscher";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { BRANSCH_LABEL, etikettIText, kommunForetagCount } from "@/lib/stats";
import { AkutNotis, OrdningsNotis } from "@/components/vard-info";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import { loadAktivaOverlays, overlayFor } from "@/lib/overlay";
import { ordnaBoostade } from "@/lib/overlay-rankning";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

const fmt = (n: number) => n.toLocaleString("sv-SE");

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const kommun = kommunBySlug(slug);
  if (!kommun) return { title: "Kommun hittades inte" };
  const title = `Vård & omsorg i ${kommun.name} kommun`;
  const description = `Vård- och omsorgskatalog för ${kommun.name} kommun. Hitta tandläkare, behandlingshem, apotek, specialistläkare och omsorg i ${kommun.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/kommun/${kommun.slug}` },
    openGraph: { title, description, type: "website", locale: "sv_SE" },
  };
}

export default async function KommunPage({ params }: { params: Params }) {
  const { slug } = await params;
  const kommun = kommunBySlug(slug);
  if (!kommun) notFound();

  /**
   * Totalen och fördelningen måste komma UR SAMMA KÄLLA.
   *
   * Förr gjorde de inte det: totalen kom ur en handinklistrad estimated-lista
   * (topp-25 kommuner) eller en estimated live-räkning, medan fördelningen
   * räknades i app-lagret på ett stickprov som PostgREST tyst kapade till
   * 1 000 rader. På Stockholm stod därför "5 019 vårdföretag registrerade"
   * över en kategorilista vars 24 rader summerade till högst 1 000.
   *
   * Nu kommer båda ur räknesnapshoten, som byggs med count=exact och vars
   * summeringsinvariant kollas vid bygget: summan av kategorierna ÄR totalen.
   */
  const snapshotTotal = kommunForetagCount(kommun.code);
  const fordelning = branschFordelning(kommun.code, 24);

  const [liveTotal, oboostadeForetag, overlays] = await Promise.all([
    snapshotTotal != null
      ? Promise.resolve(snapshotTotal)
      : countForetagInKommun(kommun.code),
    listForetagInKommun(kommun.code, 12),
    loadAktivaOverlays(),
  ]);

  // Overlay-vikten läggs ovanpå sajtens ordning (störst arbetsgivare först).
  // Stabil sortering: den som inte köpt framhävning står kvar där den stod.
  const foretagSample = ordnaBoostade(oboostadeForetag, overlays);

  const branschNames = await getBranschNamesBulk(fordelning.map((f) => f.ng1));
  const lan = lanByCode(kommun.lan);

  // Kategorierna med sajtens egna etiketter: SCB:s namn är inte unika (fem
  // "Hälso & sjukvård" i rad). Sluggen byggs alltid ur t_bransch-namnet.
  const kategorier = fordelning
    .map((f) => {
      const dbName = branschNames.get(String(f.ng1)) ?? branschNamn(f.ng1);
      if (!dbName) return null;
      return {
        ng1: f.ng1,
        count: f.count,
        label: BRANSCH_LABEL[f.ng1] ?? dbName,
        href: `/kommun/${kommun.slug}/${branschPageSlug(dbName, f.ng1)}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Övriga kommuner i samma län, störst först — en riktig väg vidare för den
  // som inte hittar rätt på orten, inte en lista med samma mall.
  const grannar = ALL_KOMMUNER.filter((k) => k.lan === kommun.lan && k.code !== kommun.code)
    .map((k) => ({ kommun: k, count: kommunTotal(k.code) }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const topp3 = kategorier.slice(0, 3);

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: kommun.name, href: `/kommun/${kommun.slug}` },
  ];

  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: kommun.name, url: `${SITE_URL}/kommun/${kommun.slug}` },
  ]);

  return (
    <div className="space-y-12">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <header className="max-w-3xl space-y-3">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">
          Vård och omsorg i {kommun.name}
        </h1>
        <p className="text-[18px] leading-relaxed text-[var(--text-body)]">
          {kommun.name} kommun{lan ? ` i ${lanNamn(lan)}` : ""} har{" "}
          <strong className="font-semibold">{fmt(liveTotal)}</strong> vård- och
          omsorgsverksamheter i registret.
          {topp3.length > 0 && (
            <>
              {" "}Flest finns inom{" "}
              {topp3.map((k, i) => (
                <span key={k.ng1}>
                  {i > 0 && (i === topp3.length - 1 ? " och " : ", ")}
                  {etikettIText(k.label)} ({fmt(k.count)})
                </span>
              ))}
              .
            </>
          )}
        </p>
        <Link
          href={`/sok?kommun=${kommun.slug}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-5 text-[16px] font-semibold text-white transition-colors hover:bg-[var(--brand-2)]"
        >
          Sök vård i {kommun.name}
        </Link>
      </header>

      <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="storsta-rubrik" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="storsta-rubrik" className="text-[1.5rem] font-semibold">
              Största verksamheterna
            </h2>
            <Link href={`/sok?kommun=${kommun.slug}`} className="text-[16px] font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline">
              Se alla
            </Link>
          </div>
          <OrdningsNotis />
          {foretagSample.length === 0 ? (
            <p className="text-[16px] text-[var(--text-muted)]">Inga verksamheter i registret.</p>
          ) : (
            <CompanyCardList>
              {foretagSample.map((f) => (
                <li key={f.cfarnr}>
                  <CompanyCard
                    foretag={f}
                    overlay={overlayFor(f, overlays)}
                    branschName={f.ng1 ? (BRANSCH_LABEL[f.ng1] ?? branschNamn(f.ng1)) : null}
                    kommunName={kommun.name}
                  />
                </li>
              ))}
            </CompanyCardList>
          )}
        </section>

        <aside className="space-y-10">
          <section aria-labelledby="typ-rubrik" className="space-y-3">
            <h2 id="typ-rubrik" className="text-[1.25rem] font-semibold">
              Typ av vård i {kommun.name}
            </h2>
            {kategorier.length === 0 ? (
              <p className="text-[16px] text-[var(--text-muted)]">Ingen kategoridata.</p>
            ) : (
              <ul className="border-t border-[var(--rule)]">
                {kategorier.map((k) => (
                  <li key={k.ng1} className="border-b border-[var(--rule)]">
                    <Link
                      href={k.href}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 text-[16px] text-[var(--text-body)] hover:text-[var(--brand-ink)] hover:underline"
                    >
                      <span className="min-w-0">{k.label}</span>
                      <span className="shrink-0 text-[15px] text-[var(--text-dim)]">{fmt(k.count)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {grannar.length > 0 && (
            <section aria-labelledby="grannar-rubrik" className="space-y-3">
              <h2 id="grannar-rubrik" className="text-[1.25rem] font-semibold">
                {lan ? `Fler kommuner i ${lanNamn(lan)}` : "Fler kommuner"}
              </h2>
              <ul className="border-t border-[var(--rule)]">
                {grannar.map((g) => (
                  <li key={g.kommun.code} className="border-b border-[var(--rule)]">
                    <Link
                      href={`/kommun/${g.kommun.slug}`}
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
        </aside>
      </div>

      <AkutNotis />
    </div>
  );
}
