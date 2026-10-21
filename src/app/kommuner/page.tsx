import type { Metadata } from "next";
import Link from "next/link";
import { ALL_KOMMUNER } from "@/lib/kommuner";
import { TOP_KOMMUNER, TOTAL_KOMMUNER, TOTAL_LAN, TOTAL_FORETAG } from "@/lib/stats";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

const fmt = (n: number) => n.toLocaleString("sv-SE");

export const metadata: Metadata = {
  title: `Vård & omsorg i alla ${TOTAL_KOMMUNER} kommuner`,
  description: `Bläddra bland Sveriges ${TOTAL_KOMMUNER} kommuner i ${TOTAL_LAN} län. Hitta lokala vård- och omsorgsföretag, kontaktuppgifter och kategoriöversikt för varje kommun.`,
  alternates: { canonical: `${SITE_URL}/kommuner` },
};

export default function KommunerPage() {
  const sorted = [...ALL_KOMMUNER].sort((a, b) =>
    a.name.localeCompare(b.name, "sv"),
  );
  const groups = new Map<string, typeof sorted>();
  for (const k of sorted) {
    const letter = k.name[0]?.toUpperCase() ?? "?";
    const arr = groups.get(letter);
    if (arr) arr.push(k);
    else groups.set(letter, [k]);
  }

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: "Kommuner" },
  ];
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: "Kommuner", url: `${SITE_URL}/kommuner` },
  ]);

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <header className="max-w-3xl space-y-3">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.5rem]">
          Vård och omsorg i Sveriges {TOTAL_KOMMUNER} kommuner
        </h1>
        <p className="text-[18px] leading-relaxed text-[var(--text-body)]">
          Välj kommun för att se verksamheterna där, grupperade efter typ av
          vård. Totalt {fmt(TOTAL_FORETAG)} verksamheter i {TOTAL_LAN} län.
        </p>
      </header>

      <section aria-labelledby="storst-rubrik" className="space-y-3">
        <h2 id="storst-rubrik" className="text-[1.25rem] font-semibold">
          Flest verksamheter
        </h2>
        <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
          {TOP_KOMMUNER.slice(0, 12).map((k) => (
            <li key={k.kommun.code} className="border-b border-[var(--rule)]">
              <Link
                href={k.href}
                className="flex min-h-12 items-center justify-between gap-2 text-[16px] text-[var(--text-body)] hover:text-[var(--brand-ink)] hover:underline"
              >
                {k.kommun.name}
                <span className="text-[14px] text-[var(--text-dim)]">{fmt(k.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="alla" aria-labelledby="alla-kommuner" className="space-y-4">
        <h2 id="alla-kommuner" className="text-[1.25rem] font-semibold">
          Alla kommuner A–Ö
        </h2>
        <nav aria-label="Hoppa till bokstav" className="flex flex-wrap gap-1">
          {Array.from(groups.keys()).map((letter) => (
            <a
              key={letter}
              href={`#bokstav-${letter}`}
              className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--rule-strong)] text-[16px] font-semibold text-[var(--text-strong)] hover:border-[var(--brand)] hover:text-[var(--brand-ink)]"
            >
              {letter}
            </a>
          ))}
        </nav>
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {Array.from(groups.entries()).map(([letter, kommuner]) => (
            <div
              key={letter}
              id={`bokstav-${letter}`}
              className="grid scroll-mt-4 grid-cols-[2.5rem_1fr] items-start gap-3 py-4"
            >
              <h3 className="text-[1.375rem] font-bold text-[var(--text-strong)]">{letter}</h3>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 pt-0.5">
                {kommuner.map((k) => (
                  <li key={k.code}>
                    <Link
                      href={`/kommun/${k.slug}`}
                      className="inline-flex min-h-9 items-center text-[16px] text-[var(--text-body)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline"
                    >
                      {k.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
