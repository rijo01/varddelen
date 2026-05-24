import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { ALL_KOMMUNER } from "@/lib/kommuner";
import { TOP_KOMMUNER, TOTAL_KOMMUNER, TOTAL_LAN, TOTAL_FORETAG } from "@/lib/stats";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";
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

      {/* ======= HERO ======= */}
      <header className="rd-fade-up relative overflow-hidden rounded-3xl border border-[var(--rule)] bg-white rd-shadow-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(225,29,39,0.10), transparent 65%),"
              + "linear-gradient(180deg, #FFF5F5 0%, #ffffff 70%)",
          }}
        />
        <div className="relative space-y-4 p-6 sm:p-9">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-2)]">
            <MapPin aria-hidden className="size-3.5" />
            Index · {TOTAL_LAN} län
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.75rem]">
            Alla{" "}
            <span className="rd-display rd-text-brand text-[1.15em]">
              {TOTAL_KOMMUNER} kommuner
            </span>{" "}
            i Sverige
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Bläddra A–Ö och hitta lokala vårdföretag bland{" "}
            <span className="font-semibold tabular-nums text-[var(--text-strong)]">
              {fmt(TOTAL_FORETAG)}
            </span>{" "}
            registrerade arbetsställen inom vård & omsorg.
          </p>
        </div>
      </header>

      {/* ======= MEST SÖKTA ======= */}
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
              Mest sökta
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-3xl">
              Mest vård & omsorg
            </h2>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TOP_KOMMUNER.slice(0, 12).map((k, i) => (
            <li key={k.kommun.code}>
              <Link
                href={k.href}
                className="rd-card rd-card-hover group relative flex h-full flex-col justify-between gap-6 overflow-hidden p-5"
                title={`Vård & omsorg i ${k.kommun.name} kommun`}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(225,29,39,0.30), transparent 70%)",
                  }}
                />
                <div className="space-y-1.5">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">
                    #{i + 1}
                  </p>
                  <p className="text-lg font-semibold tracking-tight text-[var(--text-strong)] group-hover:text-[var(--brand-ink)]">
                    {k.kommun.name}
                  </p>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-strong)]">
                    {fmt(k.count)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ======= A-Ö ======= */}
      <section
        id="alla"
        aria-labelledby="alla-kommuner"
        className="space-y-6 border-t border-[var(--rule)] pt-10"
      >
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
              Index
            </p>
            <h2
              id="alla-kommuner"
              className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-3xl"
            >
              Alla {TOTAL_KOMMUNER} kommuner
            </h2>
          </div>
          <span className="text-xs text-[var(--text-dim)]">A–Ö</span>
        </div>
        <div className="rd-card divide-y divide-[var(--rule-soft)] p-2 sm:p-3">
          {Array.from(groups.entries()).map(([letter, kommuner]) => (
            <div
              key={letter}
              className="grid grid-cols-[2.5rem_1fr] items-start gap-3 px-2 py-3 sm:px-3"
            >
              <h3 className="rd-display text-2xl text-[var(--brand-2)]">
                {letter}
              </h3>
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
                {kommuner.map((k) => (
                  <li key={k.code}>
                    <Link
                      href={`/kommun/${k.slug}`}
                      className="text-sm text-[var(--text-body)] transition-colors hover:text-[var(--brand-ink)]"
                      title={`Vård & omsorg i ${k.name} kommun`}
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
