import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ALL_KOMMUNER, kommunByCode, kommunBySlug } from "@/lib/kommuner";
import { kommunCodesForLan, lanBySlug, lanNamn } from "@/lib/lan";
import { branschPageSlug, searchForetag } from "@/lib/queries";
import { getBranschName } from "@/lib/branscher";
import { getKategoriBySlug } from "@/lib/vard-kategorier";
import { VARD_BRANSCHER } from "@/lib/vard-branscher";
import { branschNamn, branschTotal, kommunBranschTotal } from "@/lib/counts";
import { BRANSCH_LABEL } from "@/lib/stats";
import { SOK_TERMER, expanderaSokord, termFor } from "@/lib/sok-termer";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { SearchBar } from "@/components/search-bar";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import { AkutNotis, OrdningsNotis } from "@/components/vard-info";
import { loadAktivaOverlays, overlayFor } from "@/lib/overlay";
import { ordnaBoostade } from "@/lib/overlay-rankning";
import { FilterPanel, buildHref, type FilterState } from "@/components/filter-panel";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const fmt = (n: number) => n.toLocaleString("sv-SE");

type Search = Promise<{
  q?: string;
  kommun?: string;
  lan?: string;
  postort?: string;
  bransch?: string;
  /** Kategori-slug från startsidans kort (vard-kategorier.ts). */
  kategori?: string;
  aeantMin?: string;
  aeantMax?: string;
  page?: string;
}>;

function ortSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "tandläkare göteborg" → { q: "tandläkare", kommun: Göteborg }.
 *
 * Fritext med ortnamnet sist gav alltid noll träffar: hela strängen gick till
 * fulltextsöket, och ortnamnet står inte i företagens namn. Vi läser av en
 * kommun ur de sista ett eller två orden (ett "i" före orten tas bort).
 */
function delaUppOrt(q: string): { q: string; kommunSlug: string } | null {
  const ord = q.trim().split(/\s+/);
  if (ord.length < 2) return null;
  for (const n of [2, 1]) {
    if (ord.length <= n) continue;
    const kommun = kommunBySlug(ortSlug(ord.slice(-n).join(" ")));
    if (!kommun) continue;
    let rest = ord.slice(0, -n);
    if (rest.length > 1 && rest[rest.length - 1]!.toLowerCase() === "i") rest = rest.slice(0, -1);
    return { q: rest.join(" "), kommunSlug: kommun.slug };
  }
  return null;
}

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
    alternates: { canonical: `${SITE_URL}/sok` },
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

  // Ort i fritexten → egen parameter, så att sökfältets "Var?" visar orten.
  if (query && !sp.kommun && !sp.lan && !sp.postort) {
    const delad = delaUppOrt(query);
    if (delad) {
      const params = new URLSearchParams();
      params.set("q", delad.q);
      params.set("kommun", delad.kommunSlug);
      if (sp.aeantMin) params.set("aeantMin", sp.aeantMin);
      if (sp.aeantMax) params.set("aeantMax", sp.aeantMax);
      redirect(`/sok?${params.toString()}`);
    }
  }

  // Ett sökord som egentligen är en kategori (hemtjänst) → kategorin, med orten
  // kvar. Fritext hade bara hittat de få företag som har ordet i namnet.
  const kategoriTerm = query ? termFor(query)?.kategori : undefined;
  if (kategoriTerm && !sp.kategori) {
    const params = new URLSearchParams();
    params.set("kategori", kategoriTerm);
    for (const k of ["kommun", "lan", "postort", "aeantMin", "aeantMax"] as const) {
      const v = sp[k];
      if (v) params.set(k, v);
    }
    redirect(`/sok?${params.toString()}`);
  }

  const kommun = sp.kommun ? kommunBySlug(sp.kommun) : undefined;
  const lan = sp.lan ? lanBySlug(sp.lan) : undefined;
  const postort = sp.postort?.trim() || undefined;
  const ng1 = sp.bransch ? Number(sp.bransch) : undefined;
  const aeantMin = sp.aeantMin ? Number(sp.aeantMin) : undefined;
  const aeantMax = sp.aeantMax ? Number(sp.aeantMax) : undefined;
  const kategori = sp.kategori ? getKategoriBySlug(sp.kategori) : null;

  const filterState: FilterState = {
    q: sp.q,
    kategori: sp.kategori,
    kommun: sp.kommun,
    lan: sp.lan,
    postort: sp.postort,
    bransch: sp.bransch,
    aeantMin: sp.aeantMin,
    aeantMax: sp.aeantMax,
  };

  // Title för breadcrumb + JSON-LD speglar antingen sökord eller kategorinamn.
  const pageLabel = query
    ? `Sökresultat: ${query}`
    : kategori
      ? kategori.name
      : "Sök";
  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    { name: pageLabel },
  ];
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Vårddelen", url: SITE_URL },
    { name: pageLabel, url: `${SITE_URL}/sok` },
  ]);

  // Visa resultaten även när det inte finns query, så länge en kategori valts.
  const showResults = Boolean(query) || Boolean(kategori);
  const branschLabel = ng1 ? (BRANSCH_LABEL[ng1] ?? branschNamn(ng1) ?? `SNI ${ng1}`) : null;

  return (
    <div className="space-y-6">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      <div className="max-w-4xl">
        <Suspense fallback={null}>
          <SearchBar variant="dual" preserveFilters />
        </Suspense>
      </div>

      {!showResults ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <Suspense
            key={`${query}|${sp.kategori ?? ""}|${sp.kommun ?? ""}|${sp.lan ?? ""}|${sp.postort ?? ""}|${ng1 ?? ""}|${aeantMin ?? ""}|${aeantMax ?? ""}|${sp.page ?? "1"}`}
            fallback={<ResultsSkeleton />}
          >
            <ResultsAsync
              query={query}
              kategoriSlug={kategori?.slug ?? null}
              kommun={kommun}
              lan={lan}
              postort={postort}
              ng1={ng1}
              aeantMin={aeantMin}
              aeantMax={aeantMax}
              pageStr={sp.page}
              filterState={filterState}
              filter={<FilterPanel state={filterState} pathname="/sok" branschLabel={branschLabel} />}
            />
          </Suspense>
          <AkutNotis />
        </div>
      )}
    </div>
  );
}

/**
 * Exakt antal i registret för en uppsättning branscher i en ort, ur
 * räknesnapshoten. null när det inte går att säga exakt: postort och
 * storleksfilter finns inte i snapshoten, och då gissar vi inte.
 */
function antalIRegistret(
  ng1s: readonly number[],
  geo: { kommunCode?: string; lanCode?: string; postort?: string },
  harStorleksfilter: boolean,
): number | null {
  if (ng1s.length === 0 || harStorleksfilter || geo.postort) return null;
  const kommuner = geo.kommunCode
    ? [geo.kommunCode]
    : geo.lanCode
      ? kommunCodesForLan(geo.lanCode)
      : null;
  let sum = 0;
  for (const n of ng1s) {
    if (!kommuner) sum += branschTotal(n);
    else for (const k of kommuner) sum += kommunBranschTotal(k, n);
  }
  return sum;
}

async function ResultsAsync({
  query,
  kategoriSlug,
  kommun,
  lan,
  postort,
  ng1,
  aeantMin,
  aeantMax,
  pageStr,
  filterState,
  filter,
}: {
  query: string;
  kategoriSlug: string | null;
  kommun: ReturnType<typeof kommunBySlug>;
  lan: ReturnType<typeof lanBySlug>;
  postort?: string;
  ng1?: number;
  aeantMin?: number;
  aeantMax?: number;
  pageStr?: string;
  filterState: FilterState;
  /** Filtren renderas under rubriken, så att träffantalet syns först i mobilen. */
  filter: React.ReactNode;
}) {
  const page = Math.max(1, Number(pageStr) || 1);
  const kategori = kategoriSlug ? getKategoriBySlug(kategoriSlug) : null;
  // Synonymerna: "fysioterapeut" söker också sjukgymnast/sjukgymnastik osv.
  // Rubriken visar fortfarande det besökaren skrev. Se lib/sok-termer.ts.
  const term = query ? termFor(query) : null;
  const sokord = query ? expanderaSokord(query) : "";

  // Söksidan är force-dynamic och läser alltså overlay vid VARJE request. Det
  // är avsiktligt: en publicering ska synas i söket direkt, och det finns ingen
  // cache här att revalidera.
  const [{ rows: oboostade, hasMore, matchedBransch }, overlays] = await Promise.all([
    searchForetag(sokord, {
      kommun: kommun?.code,
      lan: lan?.code,
      postort,
      ng1,
      ng1List: kategori?.ng1,
      aeantMin,
      aeantMax,
      page,
      pageSize: PAGE_SIZE,
    }),
    loadAktivaOverlays(),
  ]);
  const rows = ordnaBoostade(oboostade, overlays);

  const geoText = kommun
    ? ` i ${kommun.name}`
    : postort
      ? ` i ${postort}`
      : lan
        ? ` i ${lanNamn(lan)}`
        : " i hela Sverige";

  const branschName = ng1 ? await getBranschName(ng1) : null;
  const offset = (page - 1) * PAGE_SIZE;
  const rubrik = term?.label ?? (query || kategori?.name || "");

  // Antal i registret när det går att säga exakt: en kategori, eller en
  // bransch som sökordet träffade. Fritext har inget totalantal.
  const traffadeBranscher = matchedBransch
    ? VARD_BRANSCHER.filter((n) => branschNamn(n) === matchedBransch)
    : [];
  const ng1sForAntal = !query && kategori ? kategori.ng1 : !ng1 ? traffadeBranscher : [];
  const antal = antalIRegistret(
    ng1sForAntal,
    { kommunCode: kommun?.code, lanCode: lan?.code, postort },
    aeantMin != null || aeantMax != null,
  );

  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-1.5">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight sm:text-[2rem]">
          {rubrik}
          <span className="font-normal text-[var(--text-muted)]">{geoText}</span>
        </h1>
        <p className="text-[17px] text-[var(--text-body)]" aria-live="polite">
          {rows.length === 0 ? (
            "Inga verksamheter matchade."
          ) : antal != null && antal > 0 ? (
            <>
              <strong className="font-semibold">{fmt(antal)}</strong>{" "}
              {antal === 1 ? "verksamhet" : "verksamheter"} i registret
              {matchedBransch && query ? ` inom ${matchedBransch.toLowerCase()}` : ""}. Visar{" "}
              {fmt(offset + 1)}–{fmt(offset + rows.length)}.
            </>
          ) : (
            page === 1 && !hasMore ? (
              <>
                <strong className="font-semibold">{fmt(rows.length)}</strong>{" "}
                {rows.length === 1 ? "träff" : "träffar"}.
              </>
            ) : (
              <>
                Visar {fmt(offset + 1)}–{fmt(offset + rows.length)}
                {hasMore ? ", fler finns på nästa sida" : ""}.
              </>
            )
          )}
        </p>
        {term && term.synonymer.length > 0 && (
          <p className="text-[15px] text-[var(--text-dim)]">
            Söker även på {term.synonymer.join(", ")}.
          </p>
        )}
      </header>

      {filter}
      {rows.length > 0 && <OrdningsNotis />}

      {rows.length === 0 ? (
        <IngaTraffar query={query} kommunSlug={kommun?.slug} geoText={geoText} filterState={filterState} />
      ) : (
        <CompanyCardList>
          {rows.map((f) => {
            const k = f.kommun ? kommunByCode(f.kommun) : null;
            const rowBransch = f.ng1 ? (BRANSCH_LABEL[f.ng1] ?? branschNamn(f.ng1)) : null;
            return (
              <li key={f.cfarnr}>
                <CompanyCard
                  foretag={f}
                  overlay={overlayFor(f, overlays)}
                  rubrikNiva={2}
                  branschName={rowBransch ?? matchedBransch ?? branschName}
                  kommunName={k?.name}
                />
              </li>
            );
          })}
        </CompanyCardList>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="Sidor" className="flex items-center justify-between gap-3 pt-2 text-[16px]">
          {page > 1 ? (
            <Link
              href={buildHref("/sok", filterState, { page: page > 2 ? String(page - 1) : null })}
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
              href={buildHref("/sok", filterState, { page: String(page + 1) })}
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

      {rows.length > 0 && kommun && ng1 && branschName && (
        <p className="text-[16px] text-[var(--text-muted)]">
          <Link
            href={`/kommun/${kommun.slug}/${branschPageSlug(branschName, ng1)}`}
            className="text-[var(--brand-ink)] underline"
          >
            Alla {branschName.toLowerCase()} i {kommun.name}
          </Link>
        </p>
      )}
    </div>
  );
}

/** Noll träffar: säg varför det kan vara så, och ge vägar vidare. */
function IngaTraffar({
  query,
  kommunSlug,
  geoText,
  filterState,
}: {
  query: string;
  kommunSlug?: string;
  geoText: string;
  filterState: FilterState;
}) {
  const harFilter = Boolean(filterState.aeantMin || filterState.aeantMax || filterState.bransch);
  return (
    <div className="space-y-4 rounded-lg bg-[var(--surface-soft)] p-5 text-[17px]">
      <p className="text-[var(--text-body)]">
        Vi hittade inga verksamheter{query ? <> för &ldquo;{query}&rdquo;</> : null}
        {geoText}. Registret använder ibland andra ord än man själv gör.
      </p>
      <ul className="space-y-2">
        {harFilter && (
          <li>
            <Link
              href={buildHref("/sok", filterState, { aeantMin: null, aeantMax: null, bransch: null, page: null })}
              className="text-[var(--brand-ink)] underline"
            >
              Ta bort filtren
            </Link>
          </li>
        )}
        {kommunSlug && query && (
          <li>
            <Link href={`/sok?q=${encodeURIComponent(query)}`} className="text-[var(--brand-ink)] underline">
              Sök &ldquo;{query}&rdquo; i hela Sverige
            </Link>
          </li>
        )}
        {kommunSlug && (
          <li>
            <Link href={`/kommun/${kommunSlug}`} className="text-[var(--brand-ink)] underline">
              Se alla vård- och omsorgsverksamheter på orten
            </Link>
          </li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        {SOK_TERMER.slice(0, 6).map((t) => (
          <Link
            key={t.q}
            href={kommunSlug ? `/sok?q=${encodeURIComponent(t.q)}&kommun=${kommunSlug}` : `/sok?q=${encodeURIComponent(t.q)}`}
            className="inline-flex min-h-10 items-center rounded-md border border-[var(--rule-strong)] bg-white px-3 text-[15px] text-[var(--text-body)] hover:border-[var(--text-dim)]"
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="min-w-0 space-y-4" aria-busy="true">
      <div className="space-y-2">
        <div className="rd-skeleton h-8 w-[45%] rounded" />
        <p className="text-[17px] text-[var(--text-muted)]">Söker i registret…</p>
      </div>
      <ol className="rd-card divide-y divide-[var(--rule)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-5 py-5">
            <div className="flex-1 space-y-2">
              <div className="rd-skeleton h-5 w-[50%] rounded" />
              <div className="rd-skeleton h-4 w-[35%] rounded" />
            </div>
            <div className="rd-skeleton h-11 w-36 rounded-lg" />
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="max-w-3xl space-y-6 py-4">
      <h1 className="text-[1.75rem] font-bold tracking-tight">Sök vård och omsorg</h1>
      <p className="text-[17px] text-[var(--text-muted)]">
        Skriv vilken typ av vård du söker och var. Du kan också skriva namnet på en
        verksamhet.
      </p>
      <div className="flex flex-wrap gap-2">
        {SOK_TERMER.map((t) => (
          <Link
            key={t.q}
            href={`/sok?q=${encodeURIComponent(t.q)}`}
            className="inline-flex min-h-11 items-center rounded-md border border-[var(--rule-strong)] px-3.5 text-[16px] text-[var(--text-body)] hover:border-[var(--text-dim)]"
          >
            {t.label}
          </Link>
        ))}
      </div>
      <AkutNotis />
      <p className="text-[16px] text-[var(--text-muted)]">
        Eller bläddra bland{" "}
        <Link href="/kommuner" className="text-[var(--brand-ink)] underline">
          Sveriges {ALL_KOMMUNER.length} kommuner
        </Link>
        .
      </p>
    </div>
  );
}
