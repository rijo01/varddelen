import Link from "next/link";
import { Suspense } from "react";
import { SearchBar } from "@/components/search-bar";
import { JsonLd } from "@/components/json-ld";
import { AkutNotis } from "@/components/vard-info";
import { TOTAL_FORETAG, TOP_KOMMUNER } from "@/lib/stats";
import { VARD_KATEGORIER } from "@/lib/vard-kategorier";
import { SOK_TERMER } from "@/lib/sok-termer";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

/**
 * Snabbvalen: det som söks mest av privatpersoner, plus de omsorgsformer
 * som anhöriga och handläggare letar efter.
 */
const SNABBVAL: Array<{ label: string; href: string }> = [
  ...["tandläkare", "fysioterapeut", "psykolog", "vårdcentral", "kiropraktor"].map((q) => {
    const t = SOK_TERMER.find((x) => x.q === q)!;
    return { label: t.label.split(" / ")[0]!, href: `/sok?q=${encodeURIComponent(t.q)}` };
  }),
  { label: "Hemtjänst", href: "/sok?kategori=hemtjanst" },
  { label: "Äldreboende", href: "/sok?kategori=aldreomsorg" },
  { label: "LSS-boende", href: "/sok?kategori=lss" },
  { label: "HVB-hem", href: "/sok?kategori=hvb" },
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
    <div className="space-y-14 pb-4">
      <JsonLd data={webSiteJsonLd} />

      {/* =========== SÖK =========== */}
      <section aria-labelledby="hero-title" className="max-w-4xl space-y-6 pt-4 sm:pt-10">
        <div className="space-y-3">
          <h1
            id="hero-title"
            className="text-[2rem] font-bold leading-[1.1] tracking-tight sm:text-[2.75rem]"
          >
            Hitta vård och omsorg nära dig
          </h1>
          <p className="max-w-2xl text-[18px] text-[var(--text-muted)]">
            {fmt(TOTAL_FORETAG)} vård- och omsorgsverksamheter i
            Sveriges 290 kommuner — med adress och telefonnummer, direkt ur
            offentliga register. Inga betyg, inga påhittade omdömen.
          </p>
        </div>

        <Suspense fallback={<div className="h-[244px] sm:h-[82px]" />}>
          <SearchBar variant="dual" />
        </Suspense>

        <div className="space-y-2">
          <p className="text-[15px] font-semibold text-[var(--text-strong)]">Vanliga sökningar</p>
          <ul className="flex flex-wrap gap-2">
            {SNABBVAL.map((v) => (
              <li key={v.label}>
                <Link
                  href={v.href}
                  className="inline-flex min-h-11 items-center rounded-md border border-[var(--rule-strong)] px-3.5 text-[16px] text-[var(--text-body)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-ink)]"
                >
                  {v.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* =========== KATEGORIER =========== */}
      <section aria-labelledby="kategori-title" className="space-y-4">
        <h2 id="kategori-title" className="text-[1.5rem] font-semibold tracking-tight">
          Bläddra efter typ av vård
        </h2>
        <ul className="grid border-t border-[var(--rule)] sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3">
          {VARD_KATEGORIER.map((kat) => (
            <li key={kat.slug} className="border-b border-[var(--rule)]">
              <Link
                href={`/sok?kategori=${kat.slug}`}
                className="group flex min-h-[72px] items-center justify-between gap-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold text-[var(--text-strong)] group-hover:text-[var(--brand-ink)] group-hover:underline">
                    {kat.name}
                  </span>
                  <span className="block text-[15px] text-[var(--text-muted)]">{kat.description}</span>
                </span>
                <span className="shrink-0 text-[15px] text-[var(--text-dim)]">{fmt(kat.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* =========== KOMMUNER =========== */}
      <section aria-labelledby="kommun-title" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="kommun-title" className="text-[1.5rem] font-semibold tracking-tight">
            Flest verksamheter
          </h2>
          <Link href="/kommuner" className="text-[16px] font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline">
            Alla 290 kommuner
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
          {TOP_KOMMUNER.slice(0, 16).map((k) => (
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

      {/* =========== OM TJÄNSTEN =========== */}
      <section aria-labelledby="om-title" className="grid gap-8 border-t border-[var(--rule)] pt-10 lg:grid-cols-3">
        <h2 id="om-title" className="sr-only">
          Om Vårddelen
        </h2>
        <div className="space-y-2">
          <h3 className="text-[17px] font-semibold">Uppgifter från register</h3>
          <p className="text-[16px] text-[var(--text-muted)]">
            Namn, adress, telefon och bransch kommer från offentliga register och
            SCB. Verksamheter kan själva komplettera sin profil.
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="text-[17px] font-semibold">Tydligt vad som är betalt</h3>
          <p className="text-[16px] text-[var(--text-muted)]">
            Betalda placeringar märks alltid &ldquo;Betald placering&rdquo;. Det
            är synlighet, inte en bedömning av vården.{" "}
            <Link href="#om-ordningen" className="text-[var(--brand-ink)] underline">
              Så sorteras listorna
            </Link>
          </p>
        </div>
        <AkutNotis className="self-start" />
      </section>
    </div>
  );
}
