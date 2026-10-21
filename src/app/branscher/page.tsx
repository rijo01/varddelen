import type { Metadata } from "next";
import Link from "next/link";
import { BRANSCH_LABEL, TOTAL_BRANSCHER, TOTAL_FORETAG } from "@/lib/stats";
import { VARD_KATEGORIER } from "@/lib/vard-kategorier";
import { branschNamn, branschTotal } from "@/lib/counts";
import { SOK_TERMER } from "@/lib/sok-termer";
import { AkutNotis } from "@/components/vard-info";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

const fmt = (n: number) => n.toLocaleString("sv-SE");

export const metadata: Metadata = {
  title: `Vårdkategorier i Sverige`,
  description: `Bläddra bland ${TOTAL_BRANSCHER} vård- & omsorgskategorier. ${fmt(TOTAL_FORETAG)} registrerade vårdföretag.`,
  alternates: { canonical: `${SITE_URL}/branscher` },
};

export default function BranscherPage() {
  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: "Branscher" },
  ];
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: "Branscher", url: `${SITE_URL}/branscher` },
  ]);

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <header className="max-w-3xl space-y-3">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">
          Typer av vård och omsorg
        </h1>
        <p className="text-[18px] leading-relaxed text-[var(--text-body)]">
          Registrets {fmt(TOTAL_FORETAG)} verksamheter är grupperade i{" "}
          {VARD_KATEGORIER.length} kategorier, byggda på {TOTAL_BRANSCHER} av SCB:s
          branschkoder. Välj en kategori för att se verksamheterna, eller sök på
          ett yrke.
        </p>
      </header>

      <section aria-labelledby="yrke-rubrik" className="space-y-3">
        <h2 id="yrke-rubrik" className="text-[1.25rem] font-semibold">
          Sök på yrke eller vårdform
        </h2>
        <ul className="flex flex-wrap gap-2">
          {SOK_TERMER.map((t) => (
            <li key={t.q}>
              <Link
                href={`/sok?q=${encodeURIComponent(t.q)}`}
                className="inline-flex min-h-11 items-center rounded-md border border-[var(--rule-strong)] px-3.5 text-[16px] text-[var(--text-body)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-ink)]"
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kat-rubrik" className="space-y-4">
        <h2 id="kat-rubrik" className="text-[1.25rem] font-semibold">
          Kategorier
        </h2>
        <ul className="grid gap-x-10 border-t border-[var(--rule)] md:grid-cols-2">
          {VARD_KATEGORIER.map((kat) => (
            <li key={kat.slug} className="space-y-2 border-b border-[var(--rule)] py-5">
              <Link
                href={`/sok?kategori=${kat.slug}`}
                className="group flex items-baseline justify-between gap-4"
              >
                <span className="text-[1.125rem] font-semibold text-[var(--text-strong)] group-hover:text-[var(--brand-ink)] group-hover:underline">
                  {kat.name}
                </span>
                <span className="shrink-0 text-[15px] text-[var(--text-dim)]">{fmt(kat.count)}</span>
              </Link>
              <p className="text-[16px] text-[var(--text-muted)]">{kat.description}</p>
              <ul className="space-y-0.5 text-[15px] text-[var(--text-dim)]">
                {kat.ng1
                  .map((n) => ({ n, count: branschTotal(n) }))
                  .filter((b) => b.count > 0)
                  .sort((a, b) => b.count - a.count)
                  .map((b) => (
                    <li key={b.n} className="flex justify-between gap-4">
                      <span>{BRANSCH_LABEL[b.n] ?? branschNamn(b.n) ?? `SNI ${b.n}`}</span>
                      <span>{fmt(b.count)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <AkutNotis />
    </div>
  );
}
