import Link from "next/link";
import { X } from "lucide-react";
import { KATEGORI_FORSLAG } from "@/lib/sok-termer";

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

const STORLEKAR: Array<{ label: string; min?: string; max?: string }> = [
  { label: "Alla" },
  { label: "1–9", min: "1", max: "9" },
  { label: "10–49", min: "10", max: "49" },
  { label: "50–249", min: "50", max: "249" },
  { label: "250+", min: "250" },
];

/**
 * Filtren ovanför resultatlistan — få val, alla synliga, inga paneler att
 * öppna. URL-drivet: varje val är en länk som behåller övriga parametrar.
 *
 * Typ av vård visas bara när man bläddrar (ingen fritext). searchForetag
 * använder kategorins branscher bara utan sökord, så en kategori ovanpå en
 * fritextsökning hade sett ut att filtrera utan att göra det.
 *
 * Orten väljs och tas bort i sökfältets "Var?" ovanför — den upprepas inte här.
 */
export function FilterPanel({
  state,
  pathname,
  branschLabel,
}: {
  state: FilterState;
  pathname: string;
  /** Visningsnamn för ett aktivt branschfilter (?bransch=). */
  branschLabel?: string | null;
}) {
  const bladdrar = !state.q;
  const aktivaVal = [
    branschLabel && {
      label: branschLabel,
      href: buildHref(pathname, state, { bransch: null, page: null }),
    },
  ].filter(Boolean) as Array<{ label: string; href: string }>;

  return (
    <div aria-label="Filtrera resultat" role="group" className="space-y-3 border-y border-[var(--rule)] py-4">
      {bladdrar && (
        <FilterRad rubrik="Typ av vård">
          <Val
            href={buildHref(pathname, state, { kategori: null, page: null })}
            active={!state.kategori}
          >
            Alla
          </Val>
          {KATEGORI_FORSLAG.map((k) => (
            <Val
              key={k.slug}
              href={buildHref(pathname, state, { kategori: k.slug, bransch: null, page: null })}
              active={state.kategori === k.slug}
            >
              {k.name}
            </Val>
          ))}
        </FilterRad>
      )}

      <FilterRad rubrik="Antal anställda">
        {STORLEKAR.map((b) => (
          <Val
            key={b.label}
            href={buildHref(pathname, state, {
              aeantMin: b.min ?? null,
              aeantMax: b.max ?? null,
              page: null,
            })}
            active={(state.aeantMin ?? "") === (b.min ?? "") && (state.aeantMax ?? "") === (b.max ?? "")}
          >
            {b.label}
          </Val>
        ))}
      </FilterRad>

      {aktivaVal.length > 0 && (
        <FilterRad rubrik="Valt">
          {aktivaVal.map((v) => (
            <Link
              key={v.label}
              href={v.href}
              aria-label={`Ta bort ${v.label}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-[var(--text-strong)] px-3 text-[15px] font-medium text-white hover:bg-[var(--text-body)]"
            >
              {v.label}
              <X aria-hidden className="size-4" />
            </Link>
          ))}
        </FilterRad>
      )}
    </div>
  );
}

function FilterRad({ rubrik, children }: { rubrik: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <p className="w-36 shrink-0 text-[15px] font-semibold text-[var(--text-strong)]">{rubrik}</p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {children}
      </div>
    </div>
  );
}

function Val({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-md border px-3 text-[15px] transition-colors ${
        active
          ? "border-[var(--brand)] bg-[var(--tint-2)] font-semibold text-[var(--brand-ink)]"
          : "border-[var(--rule-strong)] bg-white text-[var(--text-body)] hover:border-[var(--text-dim)]"
      }`}
    >
      {children}
    </Link>
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
