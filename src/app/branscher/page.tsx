import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";
import { TOP_BRANSCHER, TOTAL_BRANSCHER, TOTAL_FORETAG } from "@/lib/stats";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";
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

      {/* ======= HERO ======= */}
      <header className="rd-fade-up relative overflow-hidden rounded-3xl border border-[var(--rule)] bg-white rd-shadow-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(91,194,167,0.16), transparent 65%),"
              + "linear-gradient(180deg, #f6fcf9 0%, #ffffff 70%)",
          }}
        />
        <div className="relative space-y-4 p-6 sm:p-9">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-2)]">
            <Layers aria-hidden className="size-3.5" />
            {TOTAL_BRANSCHER} vårdkategorier
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.75rem]">
            Vård & omsorg i{" "}
            <span className="rd-display rd-text-brand text-[1.15em]">
              Sverige
            </span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Klicka på en kategori för att se de största aktörerna och alla
            registrerade vårdföretag inom den nischen.
          </p>
        </div>
      </header>

      {/* ======= TOP-BRANSCHER ======= */}
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
              Mest aktiva
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-3xl">
              Populära vårdkategorier
            </h2>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOP_BRANSCHER.map((b, i) => (
            <li key={b.id}>
              <Link
                href={`/sok?q=${encodeURIComponent(b.name)}`}
                className="rd-card rd-card-hover group relative flex h-full items-center justify-between gap-4 overflow-hidden p-5"
                title={`Sök ${b.name}`}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">
                    #{i + 1}
                  </p>
                  <p className="text-base font-semibold tracking-tight text-[var(--text-strong)] group-hover:text-[var(--brand-ink)]">
                    {b.name}
                  </p>
                  <p className="font-mono text-xs tabular-nums text-[var(--text-muted)]">
                    {fmt(b.count)} vårdföretag
                  </p>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-2)]"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ======= CTA ======= */}
      <section className="rd-fade-up grid grid-cols-1 gap-5 rounded-3xl border border-[var(--brand)]/25 bg-[var(--tint-2)] p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-ink)]">
            Hittar du inte rätt kategori?
          </p>
          <h3 className="text-lg font-semibold text-[var(--text-strong)] sm:text-xl">
            Sök bland alla {TOTAL_BRANSCHER} vårdkategorier
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-body)]">
            Skriv en vårdkategori (t.ex. &ldquo;tandläkare&rdquo;,
            &ldquo;behandlingshem&rdquo;, &ldquo;apotek&rdquo;) i sökrutan ovan så
            visar vi alla registrerade vårdföretag som matchar.
          </p>
        </div>
        <Link
          href="/sok"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full rd-brand-gradient rd-cta-shadow px-5 text-sm font-semibold text-white transition hover:brightness-105 active:scale-[0.99]"
        >
          Öppna söket
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>
    </div>
  );
}
