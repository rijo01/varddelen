import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Layers, MapPin } from "lucide-react";
import { kommunBySlug } from "@/lib/kommuner";
import {
  branschPageSlug,
  countForetagInKommun,
  getBranschFordelning,
  listForetagInKommun,
} from "@/lib/queries";
import { getBranschNamesBulk } from "@/lib/branscher";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { kommunForetagCount } from "@/lib/stats";
import { CompanyCard, CompanyCardList } from "@/components/company-card";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";
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

  const snapshot = kommunForetagCount(kommun.code);

  const [liveTotal, fordelning, foretagSample] = await Promise.all([
    snapshot != null
      ? Promise.resolve(snapshot)
      : countForetagInKommun(kommun.code),
    getBranschFordelning(kommun.code, 24),
    listForetagInKommun(kommun.code, 12),
  ]);

  const branschNames = await getBranschNamesBulk(fordelning.map((f) => f.ng1));

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

      {/* ======= HERO ======= */}
      <header className="rd-fade-up relative overflow-hidden rounded-3xl border border-[var(--rule)] bg-white rd-shadow-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 0% 0%, rgba(225,29,39,0.10), transparent 65%),"
              + "linear-gradient(180deg, #FFF5F5 0%, #ffffff 70%)",
          }}
        />
        <div
          aria-hidden
          className="rd-dot-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(180deg,#000,transparent_70%)]"
        />
        <div className="relative grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-9">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--brand-2)]">
              <MapPin aria-hidden className="size-3.5" />
              Kommun · Län {kommun.lan}
            </div>
            <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.75rem]">
              Vård & omsorg i{" "}
              <span className="rd-display rd-text-brand text-[1.15em]">
                {kommun.name}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-muted)] sm:text-base">
              <span>
                <span className="font-mono font-semibold tabular-nums text-[var(--text-strong)]">
                  {fmt(liveTotal)}
                </span>{" "}
                vårdföretag registrerade
              </span>
              <span aria-hidden className="text-[var(--text-faint)]">·</span>
              <span className="font-mono text-[var(--text-dim)]">
                SCB {kommun.scbCode}
              </span>
            </div>
          </div>
          <Link
            href={`/sok?kommun=${kommun.slug}`}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full rd-brand-gradient rd-cta-shadow px-5 text-sm font-semibold text-white transition hover:brightness-105 active:scale-[0.99]"
          >
            Sök i {kommun.name}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </header>

      {/* ======= LARGEST EMPLOYERS + BRANSCHFÖRDELNING ======= */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="rd-fade-up rd-fade-up-delay-1 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-0.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
                Arbetsgivare
              </p>
              <h2 className="text-xl font-semibold text-[var(--text-strong)] sm:text-2xl">
                Största i {kommun.name}
              </h2>
            </div>
            <Link
              href={`/sok?kommun=${kommun.slug}`}
              className="hidden text-sm text-[var(--text-muted)] hover:text-[var(--brand-ink)] sm:inline"
            >
              Se alla →
            </Link>
          </div>
          {foretagSample.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Ingen vårddata tillgänglig.
            </p>
          ) : (
            <CompanyCardList>
              {foretagSample.map((f, i) => (
                <li key={f.id}>
                  <CompanyCard
                    foretag={f}
                    rank={i + 1}
                    kommunName={kommun.name}
                  />
                </li>
              ))}
            </CompanyCardList>
          )}
        </div>

        <aside className="rd-fade-up rd-fade-up-delay-2 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-0.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
                Branscher
              </p>
              <h2 className="text-xl font-semibold text-[var(--text-strong)] sm:text-2xl">
                Vårdkategorier
              </h2>
            </div>
            <span className="text-xs text-[var(--text-dim)]">
              Topp {fordelning.length}
            </span>
          </div>
          {fordelning.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Ingen branschdata tillgänglig.
            </p>
          ) : (
            <ol className="rd-card divide-y divide-[var(--rule-soft)]">
              {fordelning.map((f) => {
                const name = branschNames.get(String(f.ng1)) ?? `SNI ${f.ng1}`;
                const href = `/kommun/${kommun.slug}/${branschPageSlug(name, f.ng1)}`;
                return (
                  <li key={f.ng1}>
                    <Link
                      href={href}
                      className="rd-row flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                      title={`${name} i ${kommun.name}`}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-[var(--text-body)]">
                        <Layers
                          aria-hidden
                          className="size-3.5 shrink-0 text-[var(--brand-2)]"
                        />
                        <span className="truncate">{name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--text-muted)]">
                        {fmt(f.count)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </section>

      {/* ======= SEO-TEXT + CTA ======= */}
      <section className="rd-fade-up rd-fade-up-delay-3 grid grid-cols-1 gap-5 rounded-3xl border border-[var(--brand)]/25 bg-[var(--tint-2)] p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-ink)]">
            Om sidan
          </p>
          <h3 className="text-lg font-semibold text-[var(--text-strong)] sm:text-xl">
            Lokal vård- & omsorgskatalog för {kommun.name} kommun
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-body)]">
            Här hittar du{" "}
            <span className="font-semibold tabular-nums text-[var(--text-strong)]">
              {fmt(liveTotal)}
            </span>{" "}
            registrerade vårdföretag i {kommun.name}. Klicka på en kategori
            för att se alla vårdföretag inom den nischen, eller använd
            sökfunktionen för att hitta ett specifikt vårdföretag.
          </p>
        </div>
        <Link
          href={`/sok?kommun=${kommun.slug}`}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full rd-brand-gradient rd-cta-shadow px-5 text-sm font-semibold text-white transition hover:brightness-105 active:scale-[0.99]"
        >
          Sök i {kommun.name}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>
    </div>
  );
}
