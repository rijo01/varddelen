import Link from "next/link";
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { JsonLd } from "@/components/json-ld";
import { TOTAL_FORETAG, TOTAL_KOMMUNER } from "@/lib/stats";

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://varddelen.se";

const POPULAR_SEARCHES = [
  "tandläkare",
  "behandlingshem",
  "specialistläkare",
  "apotek",
  "hemtjänst",
  "psykolog",
  "sjukgymnast",
  "omsorg",
];

const fmt = (n: number) => n.toLocaleString("sv-SE");

export default function HomePage() {
  const webSiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Vårddelen",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/sok?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div>
      <JsonLd data={webSiteJsonLd} />

      {/* =========== HJÄLTE =========== */}
      <section
        aria-labelledby="hero-title"
        className="relative -mx-4 -mt-2 overflow-hidden px-4 pt-16 pb-20 sm:pt-28 sm:pb-32"
      >
        {/* Gradient mesh-bakgrund */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rd-brand-gradient-soft"
        />
        {/* Drifting accent blobs */}
        <div
          aria-hidden
          className="rd-blob pointer-events-none absolute -left-12 top-8 -z-10 size-72 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(91,194,167,0.28), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="rd-blob pointer-events-none absolute -right-20 top-28 -z-10 size-80 rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(30,142,132,0.22), transparent 70%)",
            animationDelay: "-9s",
          }}
        />
        {/* Subtle dot-grid undertill */}
        <div
          aria-hidden
          className="rd-dot-grid pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-32 opacity-40 [mask-image:linear-gradient(180deg,transparent,#000)]"
        />

        <div className="mx-auto flex max-w-3xl flex-col items-center gap-7 text-center">
          <div className="rd-fade-up inline-flex items-center gap-2 rounded-full border border-[var(--brand)]/30 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-[var(--brand-ink)] backdrop-blur">
            <Sparkles aria-hidden className="size-3.5 text-[var(--brand-2)]" />
            Sveriges katalog för vård & omsorg
          </div>

          <h1
            id="hero-title"
            className="rd-fade-up rd-fade-up-delay-1 text-balance text-[2.5rem] font-semibold leading-[1.02] tracking-tight text-[var(--text-strong)] sm:text-6xl md:text-[4.25rem]"
          >
            Hitta vård & omsorg i hela{" "}
            <span className="rd-display rd-text-brand text-[1.18em]">
              Sverige
            </span>
          </h1>

          <p className="rd-fade-up rd-fade-up-delay-2 mx-auto max-w-xl text-balance text-[var(--text-muted)] sm:text-lg">
            Sök bland{" "}
            <span className="font-semibold tabular-nums text-[var(--text-strong)]">
              {fmt(TOTAL_FORETAG)}
            </span>{" "}
            vårdföretag i alla {TOTAL_KOMMUNER} kommuner — tandläkare,
            behandlingshem, apotek, specialistläkare och omsorgsföretag.
          </p>

          <div className="rd-fade-up rd-fade-up-delay-3 w-full">
            <div className="flex justify-center">
              <Suspense fallback={null}>
                <SearchBar variant="dual" />
              </Suspense>
            </div>
          </div>

          <div className="rd-fade-up rd-fade-up-delay-4 flex flex-wrap items-center justify-center gap-1.5 text-sm">
            <span className="text-[var(--text-dim)]">Populärt:</span>
            {POPULAR_SEARCHES.map((term) => (
              <Link
                key={term}
                href={`/sok?q=${encodeURIComponent(term)}`}
                className="rounded-full border border-[var(--brand)]/25 bg-white/80 px-3 py-1 text-[var(--brand-ink)] shadow-[0_1px_2px_rgba(17,24,28,0.04)] backdrop-blur transition hover:border-[var(--brand-2)]/55 hover:bg-white"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
