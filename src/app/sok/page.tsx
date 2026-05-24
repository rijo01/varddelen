import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { kommunByCode, kommunBySlug } from "@/lib/kommuner";
import {
  branschPageSlug,
  searchForetag,
} from "@/lib/queries";
import { getBranschName } from "@/lib/branscher";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SearchBar } from "@/components/search-bar";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import { FilterPanel, buildHref, type FilterState } from "@/components/filter-panel";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";
const PAGE_SIZE = 25;

type Search = Promise<{
  q?: string;
  kommun?: string;
  bransch?: string;
  aeantMin?: string;
  aeantMax?: string;
  page?: string;
}>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const title = query
    ? `Sökresultat för "${query}"`
    : "Sök vård & omsorg i Sverige";
  return {
    title,
    description:
      "Sök bland Sveriges vårdföretag — tandläkare, behandlingshem, apotek, specialistläkare och omsorg. Filtrera på kommun, bransch och antal anställda.",
    robots: { index: false, follow: true },
  };
}

export default async function SokPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const kommun = sp.kommun ? kommunBySlug(sp.kommun) : undefined;
  const ng1 = sp.bransch ? Number(sp.bransch) : undefined;
  const aeantMin = sp.aeantMin ? Number(sp.aeantMin) : undefined;
  const aeantMax = sp.aeantMax ? Number(sp.aeantMax) : undefined;

  const filterState: FilterState = {
    q: sp.q,
    kommun: sp.kommun,
    bransch: sp.bransch,
    aeantMin: sp.aeantMin,
    aeantMax: sp.aeantMax,
  };

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: query ? `Sökresultat: ${query}` : "Sök" },
  ];
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: query ? `Sökresultat: ${query}` : "Sök", url: `${SITE_URL}/sok` },
  ]);

  return (
    <div className="space-y-6">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      {/* Hjälp-sök överst */}
      <div className="flex justify-center">
        <Suspense fallback={null}>
          <SearchBar variant="dual" preserveFilters />
        </Suspense>
      </div>

      {!query ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr] lg:gap-8">
          <FilterPanel state={filterState} pathname="/sok" />
          <Suspense
            key={`${query}|${sp.kommun ?? ""}|${ng1 ?? ""}|${aeantMin ?? ""}|${aeantMax ?? ""}|${sp.page ?? "1"}`}
            fallback={<ResultsSkeleton query={query} />}
          >
            <ResultsAsync
              query={query}
              kommun={kommun}
              ng1={ng1}
              aeantMin={aeantMin}
              aeantMax={aeantMax}
              pageStr={sp.page}
              filterState={filterState}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

async function ResultsAsync({
  query,
  kommun,
  ng1,
  aeantMin,
  aeantMax,
  pageStr,
  filterState,
}: {
  query: string;
  kommun: ReturnType<typeof kommunBySlug>;
  ng1?: number;
  aeantMin?: number;
  aeantMax?: number;
  pageStr?: string;
  filterState: FilterState;
}) {
  const page = Math.max(1, Number(pageStr) || 1);

  const { rows, hasMore, matchedBransch } = await searchForetag(query, {
    kommun: kommun?.code,
    ng1,
    aeantMin,
    aeantMax,
    page,
    pageSize: PAGE_SIZE,
  });

  const branschName = ng1 ? await getBranschName(ng1) : null;
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className="min-w-0 space-y-5">
      <header className="rd-fade-up space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
          Sökresultat
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-[1.75rem]">
          &ldquo;{query}&rdquo;
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          {rows.length === 0
            ? "Inga företag matchade din sökning."
            : matchedBransch && !ng1
              ? (
                <>
                  Visar företag inom{" "}
                  <span className="font-medium text-[var(--text-strong)]">
                    {matchedBransch}
                  </span>
                  {kommun ? ` i ${kommun.name}` : " i hela Sverige"}. Sorterat efter
                  antal anställda.
                </>
              )
              : (
                <>
                  Visar {rows.length} träff{rows.length === 1 ? "" : "ar"} (sida{" "}
                  {page}). Sorterat efter antal anställda.
                </>
              )}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rd-card border-dashed bg-white p-10 text-center">
          <p className="text-base font-semibold text-[var(--text-strong)]">
            Inga träffar
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Prova ett bredare sökord eller rensa filter.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-[var(--text-muted)]">Förslag:</span>
            {["tandläkare", "behandlingshem", "apotek", "psykolog"].map((t) => (
              <Link
                key={t}
                href={`/sok?q=${t}`}
                className="rounded-full border border-[var(--brand)]/30 bg-white px-3 py-1 text-[var(--brand-ink)] transition hover:bg-[var(--tint-2)]"
              >
                {t}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <CompanyCardList>
          {rows.map((f, i) => {
            const k = f.kommun ? kommunByCode(f.kommun) : null;
            return (
              <li key={f.id}>
                <CompanyCard
                  foretag={f}
                  rank={offset + i + 1}
                  branschName={matchedBransch ?? branschName}
                  kommunName={k?.name}
                />
              </li>
            );
          })}
        </CompanyCardList>
      )}

      {(page > 1 || hasMore) && (
        <nav className="flex items-center justify-between border-t border-[var(--rule)] pt-5 text-sm">
          {page > 1 ? (
            <Link
              href={buildHref("/sok", filterState, { page: page > 2 ? String(page - 1) : null })}
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
              href={buildHref("/sok", filterState, { page: String(page + 1) })}
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

      {rows.length > 0 && kommun && ng1 && branschName && (
        <p className="text-sm text-[var(--text-muted)]">
          Vill du se alla?{" "}
          <Link
            href={`/kommun/${kommun.slug}/${branschPageSlug(branschName, ng1)}`}
            className="text-[var(--brand-ink)] hover:underline"
          >
            {branschName} i {kommun.name} →
          </Link>
        </p>
      )}
    </div>
  );
}

function ResultsSkeleton({ query }: { query: string }) {
  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[var(--brand-2)]">
          Sökresultat
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-[1.75rem]">
          &ldquo;{query}&rdquo;
        </h1>
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-[var(--brand-2)] border-t-transparent" />
          Söker i registret…
        </p>
      </header>
      <ol className="rd-card divide-y divide-[var(--rule-soft)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-5 py-5">
            <div className="rd-skeleton size-12 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <div className="rd-skeleton h-4 w-[55%] rounded" />
              <div className="rd-skeleton h-3 w-[35%] rounded" />
              <div className="rd-skeleton h-3 w-[25%] rounded" />
            </div>
            <div className="rd-skeleton h-9 w-20 rounded-full" />
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rd-fade-up mx-auto max-w-2xl space-y-6 py-12 text-center">
      <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl rd-brand-gradient text-white rd-shadow-glow">
        <Search aria-hidden className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-3xl">
          Sök bland{" "}
          <span className="rd-display rd-text-brand text-[1.15em]">
            vård & omsorg
          </span>
        </h1>
        <p className="text-[var(--text-muted)]">
          Skriv en vårdkategori (t.ex. &ldquo;tandläkare&rdquo;), ett företagsnamn eller en ort.
        </p>
      </div>
    </div>
  );
}
