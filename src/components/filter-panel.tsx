import Link from "next/link";
import { Filter, X, Users, MapPin, Layers, Building2 } from "lucide-react";
import { ALL_KOMMUNER } from "@/lib/kommuner";
import { TOP_BRANSCHER } from "@/lib/stats";

export type FilterState = {
  q?: string;
  kategori?: string;
  kommun?: string;
  lan?: string;
  postort?: string;
  bransch?: string;
  aeantMin?: string;
  aeantMax?: string;
  page?: string;
};

/**
 * URL-driven filter-sidopanel. Server-rendered — varje val är en Link
 * som behåller övriga params. På mobil viks panelen ihop i en <details>.
 *
 * Aeant-buckets: tomma till stora (Hitta.se-stil). Bara filter som funkar
 * mot faktisk data — vi visar t.ex. inte F-skatt, omsättning eller
 * registrår eftersom de inte finns i `foretag_publik`.
 */
export function FilterPanel({
  state,
  pathname,
  totalCount,
}: {
  state: FilterState;
  pathname: string;
  totalCount?: number;
}) {
  const hasAnyFilter = Boolean(
    state.kommun ||
      state.bransch ||
      state.aeantMin ||
      state.aeantMax,
  );

  const sizeBuckets: Array<{
    label: string;
    min?: string;
    max?: string;
    icon?: React.ReactNode;
  }> = [
    { label: "Alla storlekar" },
    { label: "1–9 anställda", min: "1", max: "9" },
    { label: "10–49 anställda", min: "10", max: "49" },
    { label: "50–249 anställda", min: "50", max: "249" },
    { label: "250+ anställda", min: "250" },
  ];

  return (
    <aside aria-label="Filtrera resultat">
      {/* Mobile: collapsible drawer */}
      <details className="rd-card overflow-hidden lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-[var(--text-strong)]">
          <span className="inline-flex items-center gap-2">
            <Filter className="size-4 text-[var(--brand-2)]" aria-hidden />
            Filter
            {hasAnyFilter && (
              <span className="rounded-full bg-[var(--tint-3)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-ink)]">
                Aktivt
              </span>
            )}
          </span>
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--surface-soft)] text-[var(--text-muted)] transition-transform [details[open]_&]:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="border-t border-[var(--rule-soft)] p-4">
          <FilterBody
            state={state}
            pathname={pathname}
            sizeBuckets={sizeBuckets}
            totalCount={totalCount}
            hasAnyFilter={hasAnyFilter}
          />
        </div>
      </details>

      {/* Desktop: sticky panel */}
      <div className="hidden lg:block">
        <div className="rd-card sticky top-20 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--rule-soft)] px-5 py-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
              <Filter className="size-4 text-[var(--brand-2)]" aria-hidden />
              Filter
            </h2>
            {hasAnyFilter && (
              <Link
                href={buildHref(pathname, state, {
                kommun: null,
                lan: null,
                postort: null,
                bransch: null,
                aeantMin: null,
                aeantMax: null,
                page: null,
              })}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--brand-ink)]"
              >
                Rensa
                <X className="size-3" aria-hidden />
              </Link>
            )}
          </div>
          <div className="px-5 py-5">
            <FilterBody
              state={state}
              pathname={pathname}
              sizeBuckets={sizeBuckets}
              totalCount={totalCount}
              hasAnyFilter={hasAnyFilter}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function FilterBody({
  state,
  pathname,
  sizeBuckets,
  totalCount,
  hasAnyFilter,
}: {
  state: FilterState;
  pathname: string;
  sizeBuckets: Array<{ label: string; min?: string; max?: string }>;
  totalCount?: number;
  hasAnyFilter: boolean;
}) {
  return (
    <div className="space-y-6">
      {totalCount !== undefined && (
        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--text-dim)]">
          {totalCount.toLocaleString("sv-SE")} träffar
        </p>
      )}

      <FilterGroup
        title="Antal anställda"
        icon={<Users className="size-3.5" aria-hidden />}
      >
        <ul className="space-y-0.5">
          {sizeBuckets.map((b) => {
            const isActive =
              (state.aeantMin ?? "") === (b.min ?? "") &&
              (state.aeantMax ?? "") === (b.max ?? "");
            return (
              <li key={b.label}>
                <Link
                  href={buildHref(pathname, state, {
                    aeantMin: b.min ?? null,
                    aeantMax: b.max ?? null,
                  })}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
                    isActive
                      ? "bg-[var(--tint-3)] font-medium text-[var(--brand-ink)]"
                      : "text-[var(--text-body)] hover:bg-[var(--surface-soft)]"
                  }`}
                >
                  <span>{b.label}</span>
                  {isActive && (
                    <span aria-hidden className="text-[var(--brand-2)]">
                      ●
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </FilterGroup>

      <FilterGroup
        title="Bransch"
        icon={<Layers className="size-3.5" aria-hidden />}
      >
        <ul className="space-y-0.5">
          <li>
            <Link
              href={buildHref(pathname, state, { bransch: null })}
              className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
                !state.bransch
                  ? "bg-[var(--tint-3)] font-medium text-[var(--brand-ink)]"
                  : "text-[var(--text-body)] hover:bg-[var(--surface-soft)]"
              }`}
            >
              Alla branscher
              {!state.bransch && (
                <span aria-hidden className="text-[var(--brand-2)]">
                  ●
                </span>
              )}
            </Link>
          </li>
          {TOP_BRANSCHER.slice(0, 10).map((b) => {
            const isActive = state.bransch === String(b.id);
            return (
              <li key={b.id}>
                <Link
                  href={buildHref(pathname, state, { bransch: String(b.id) })}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                    isActive
                      ? "bg-[var(--tint-3)] font-medium text-[var(--brand-ink)]"
                      : "text-[var(--text-body)] hover:bg-[var(--surface-soft)]"
                  }`}
                  title={b.name}
                >
                  <span className="truncate">{b.name}</span>
                  {isActive && (
                    <span aria-hidden className="text-[var(--brand-2)]">
                      ●
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </FilterGroup>

      <FilterGroup
        title="Kommun"
        icon={<MapPin className="size-3.5" aria-hidden />}
      >
        <form action={pathname} method="GET" className="space-y-2">
          {/* Behåll övriga params via hidden inputs. Vi släpper lan/postort
              här — att välja en specifik kommun ska medvetet smala in från
              ett bredare län-/postort-filter (kommun > postort > lan mutex).
              Kategori bevaras däremot — kategori-browse ska kunna kombineras
              med kommun-val. */}
          {state.q && <input type="hidden" name="q" value={state.q} />}
          {state.kategori && (
            <input type="hidden" name="kategori" value={state.kategori} />
          )}
          {state.bransch && (
            <input type="hidden" name="bransch" value={state.bransch} />
          )}
          {state.aeantMin && (
            <input type="hidden" name="aeantMin" value={state.aeantMin} />
          )}
          {state.aeantMax && (
            <input type="hidden" name="aeantMax" value={state.aeantMax} />
          )}
          <select
            name="kommun"
            defaultValue={state.kommun ?? ""}
            className="w-full appearance-none rounded-lg border border-[var(--rule)] bg-white px-2.5 py-2 text-sm text-[var(--text-strong)] shadow-[0_1px_2px_rgba(17,24,28,0.03)] outline-none transition focus:border-[var(--brand-2)]/60 focus:ring-2 focus:ring-[var(--brand-2)]/15"
          >
            <option value="">Alla kommuner</option>
            {ALL_KOMMUNER.slice()
              .sort((a, b) => a.name.localeCompare(b.name, "sv"))
              .map((k) => (
                <option key={k.slug} value={k.slug}>
                  {k.name}
                </option>
              ))}
          </select>
          <button
            type="submit"
            className="w-full rounded-lg rd-brand-gradient rd-cta-shadow py-2 text-xs font-semibold text-white transition hover:brightness-105 active:scale-[0.99]"
          >
            Använd
          </button>
        </form>
      </FilterGroup>

      {hasAnyFilter && (
        <div className="lg:hidden">
          <Link
            href={pathname + (state.q ? `?q=${encodeURIComponent(state.q)}` : "")}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--rule)] bg-white py-2 text-xs font-semibold text-[var(--text-body)] transition hover:border-[var(--brand-2)]/40 hover:text-[var(--brand-ink)]"
          >
            <X className="size-3.5" aria-hidden />
            Rensa alla filter
          </Link>
        </div>
      )}

      <div className="rounded-xl border border-[var(--rule)] bg-[var(--surface-soft)] p-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--text-strong)]">
          <Building2 className="size-3.5 text-[var(--brand-2)]" aria-hidden />
          Officiell registerdata
        </div>
        Data från SCB och offentliga register. Org.nr maskas av GDPR-skäl.
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="inline-flex items-center gap-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
        <span className="text-[var(--brand-2)]">{icon}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function buildHref(
  pathname: string,
  current: FilterState,
  overrides: Partial<Record<keyof FilterState, string | null>>,
): string {
  const params = new URLSearchParams();
  const merged = { ...current } as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) merged[k] = undefined;
    else merged[k] = v;
  }
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
