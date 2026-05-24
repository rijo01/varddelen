import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Layers } from "lucide-react";
import { kommunBySlug } from "@/lib/kommuner";
import { getBranschName } from "@/lib/branscher";
import {
  listForetagInKommunByBransch,
  parseBranschSlug,
} from "@/lib/queries";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { CompanyCard, CompanyCardList } from "@/components/company-card";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";
const fmt = (n: number) => n.toLocaleString("sv-SE");

type Params = Promise<{ slug: string; bransch: string }>;
type Search = Promise<{ page?: string; aeantMin?: string; aeantMax?: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug, bransch } = await params;
  const kommun = kommunBySlug(slug);
  const ng1 = parseBranschSlug(bransch);
  if (!kommun || !ng1) return { title: "Sida hittades inte" };
  const name = (await getBranschName(ng1)) ?? `SNI ${ng1}`;
  const title = `${name} i ${kommun.name}`;
  const description = `Vårdföretag inom ${name.toLowerCase()} i ${kommun.name} kommun. Hitta lokala vård- och omsorgsföretag, kontaktuppgifter och adresser.`;
  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/kommun/${kommun.slug}/${bransch}`,
    },
    openGraph: { title, description, type: "website", locale: "sv_SE" },
  };
}

const PAGE_SIZE = 25;

const SIZE_BUCKETS: Array<{ label: string; min?: number; max?: number }> = [
  { label: "Alla storlekar" },
  { label: "1–9", min: 1, max: 9 },
  { label: "10–49", min: 10, max: 49 },
  { label: "50–249", min: 50, max: 249 },
  { label: "250+", min: 250 },
];

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

  const branschName = (await getBranschName(ng1)) ?? `SNI ${ng1}`;
  const page = Math.max(1, Number(sp.page) || 1);
  const aeantMin = sp.aeantMin ? Number(sp.aeantMin) : undefined;
  const aeantMax = sp.aeantMax ? Number(sp.aeantMax) : undefined;

  const { rows, hasMore } = await listForetagInKommunByBransch(
    kommun.code,
    ng1,
    { page, pageSize: PAGE_SIZE, aeantMin, aeantMax },
  );

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
      aeantMin: sp.aeantMin,
      aeantMax: sp.aeantMax,
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
              "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(225,29,39,0.08), transparent 65%),"
              + "linear-gradient(180deg, #FFF5F5 0%, #ffffff 70%)",
          }}
        />
        <div className="relative space-y-4 p-6 sm:p-9">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-[var(--surface-soft)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-muted)]">
              SNI {ng1}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
              Bransch · {kommun.name}
            </span>
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight text-[var(--text-strong)] sm:text-[2.5rem]">
            <span className="rd-display rd-text-brand text-[1.1em]">
              {branschName}
            </span>{" "}
            i{" "}
            <Link
              href={`/kommun/${kommun.slug}`}
              className="text-[var(--text-strong)] underline-offset-[6px] hover:underline"
            >
              {kommun.name}
            </Link>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] sm:text-base">
            Vårdföretag inom {branschName.toLowerCase()} i {kommun.name} kommun,
            sorterat efter storlek (antal anställda).
          </p>
        </div>
      </header>

      {/* ======= STORLEKSFILTER ======= */}
      <nav
        aria-label="Filtrera på storlek"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
          Storlek:
        </span>
        {SIZE_BUCKETS.map((b) => {
          const isActive =
            (aeantMin ?? null) === (b.min ?? null) &&
            (aeantMax ?? null) === (b.max ?? null);
          return (
            <Link
              key={b.label}
              href={withParams({
                aeantMin: b.min ? String(b.min) : null,
                aeantMax: b.max ? String(b.max) : null,
                page: null,
              })}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition ${
                isActive
                  ? "border-[var(--brand-2)]/50 bg-[var(--tint-3)] text-[var(--brand-ink)]"
                  : "border-[var(--rule)] bg-white text-[var(--text-body)] hover:border-[var(--brand-2)]/40 hover:bg-[var(--tint-2)]"
              }`}
            >
              {b.label}
            </Link>
          );
        })}
      </nav>

      {/* ======= LIST ======= */}
      {rows.length === 0 ? (
        <div className="rd-card border-dashed bg-white p-8 text-center">
          <p className="text-base font-medium text-[var(--text-strong)]">
            Inga vårdföretag hittades
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Inga registrerade vårdföretag inom {branschName.toLowerCase()} i{" "}
            {kommun.name} matchar valt storleksfilter.
          </p>
          <Link
            href={`/kommun/${kommun.slug}`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-ink)] hover:underline"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Tillbaka till {kommun.name}
          </Link>
        </div>
      ) : (
        <CompanyCardList>
          {rows.map((f, i) => (
            <li key={f.id}>
              <CompanyCard
                foretag={f}
                rank={(page - 1) * PAGE_SIZE + i + 1}
                branschName={branschName}
                kommunName={kommun.name}
              />
            </li>
          ))}
        </CompanyCardList>
      )}

      {(page > 1 || hasMore) && (
        <nav className="flex items-center justify-between border-t border-[var(--rule)] pt-5 text-sm">
          {page > 1 ? (
            <Link
              href={withParams({ page: page > 2 ? String(page - 1) : null })}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-white px-4 py-2 font-medium text-[var(--text-body)] transition hover:border-[var(--brand-2)]/40 hover:bg-[var(--tint-2)] hover:text-[var(--brand-ink)]"
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
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-white px-4 py-2 font-medium text-[var(--text-body)] transition hover:border-[var(--brand-2)]/40 hover:bg-[var(--tint-2)] hover:text-[var(--brand-ink)]"
            >
              Nästa
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {/* ======= CROSS-LINKS ======= */}
      <section className="rd-fade-up rd-fade-up-delay-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href={`/kommun/${kommun.slug}`}
          className="rd-card rd-card-hover group flex items-center justify-between gap-3 p-5"
        >
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
              Pillar
            </p>
            <p className="mt-1 text-base font-semibold text-[var(--text-strong)]">
              All vård & omsorg i {kommun.name}
            </p>
          </div>
          <ArrowRight
            aria-hidden
            className="size-4 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-2)]"
          />
        </Link>
        <Link
          href={`/sok?q=${encodeURIComponent(branschName)}`}
          className="rd-card rd-card-hover group flex items-center justify-between gap-3 p-5"
        >
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
              Hela Sverige
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-base font-semibold text-[var(--text-strong)]">
              <Layers aria-hidden className="size-4 text-[var(--brand-2)]" />
              {branschName} i hela landet
            </p>
          </div>
          <ArrowRight
            aria-hidden
            className="size-4 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-2)]"
          />
        </Link>
      </section>
    </div>
  );
}
