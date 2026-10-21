"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Home, Search, MapPin, Layers, Heart } from "lucide-react";
import { SearchBar } from "@/components/search-bar";

/**
 * Sidhuvudet: logotyp, sök och fyra länkar som alla leder någonstans.
 *
 * Det röda toppfältet med företagets kundtjänstnummer är borta. På en vårdsajt
 * läste det som ett nummer att ringa för vård; numret står nu på /kontakt med
 * en tydlig rad om att det inte är vårdrådgivning. Länkar som pekade på "#"
 * (Logga in, För verksamheter, Nyheter, språkväljaren) är också borta.
 *
 * Sökfältet ligger i huvudet från lg och uppåt, utom på startsidan och /sok
 * där sidan själv har det stora sökfältet. I mobilen tar en "Sök"-länk dess
 * plats — fältet fick aldrig plats bredvid logotypen och lade sig över den.
 */
const NAV = [
  { href: "/sok", label: "Sök", match: (p: string) => p.startsWith("/sok") },
  { href: "/branscher", label: "Vårdkategorier", match: (p: string) => p.startsWith("/bransch") },
  { href: "/kommuner", label: "Kommuner", match: (p: string) => p.startsWith("/kommun") },
  { href: "/kontakt", label: "Kontakt", match: (p: string) => p.startsWith("/kontakt") },
];

export function SiteNav() {
  const pathname = usePathname();
  const egetSokfalt = pathname === "/" || pathname.startsWith("/sok");

  return (
    <header className="border-b border-[var(--rule)] bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 lg:gap-8">
        <Link
          href="/"
          aria-label="Vårddelen.se, till startsidan"
          className="flex shrink-0 items-center gap-2 text-[var(--text-strong)]"
        >
          <Heart
            aria-hidden
            className="size-7 text-[var(--brand)]"
            fill="currentColor"
            strokeWidth={0}
          />
          <span className="text-[19px] font-bold tracking-tight">
            Vårddelen<span className="text-[var(--brand)]">.se</span>
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 lg:block">
          {!egetSokfalt && (
            <Suspense fallback={null}>
              <SearchBar variant="compact" />
            </Suspense>
          )}
        </div>

        <nav aria-label="Huvudmeny" className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((it) => {
            const current = it.match(pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={current ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-[16px] font-medium transition-colors ${
                  current
                    ? "text-[var(--brand-ink)] underline decoration-2 underline-offset-[10px]"
                    : "text-[var(--text-body)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-strong)]"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>

        {!egetSokfalt && (
          <Link
            href="/sok"
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--rule-strong)] px-3.5 text-[16px] font-semibold text-[var(--text-strong)] md:hidden"
          >
            <Search aria-hidden className="size-4" />
            Sök vård
          </Link>
        )}
      </div>
    </header>
  );
}

/**
 * Mobilens bottenmeny — fixerad nederst på små skärmar.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  const items = [
    { href: "/", label: "Hem", icon: Home, match: (p: string) => p === "/" },
    { href: "/sok", label: "Sök", icon: Search, match: (p: string) => p.startsWith("/sok") },
    { href: "/kommuner", label: "Kommuner", icon: MapPin, match: (p: string) => p.startsWith("/kommun") },
    { href: "/branscher", label: "Kategorier", icon: Layers, match: (p: string) => p.startsWith("/bransch") },
  ];

  return (
    <nav
      aria-label="Snabbmeny"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--rule)] bg-white pb-[max(env(safe-area-inset-bottom),0.25rem)] md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 text-[13px]">
        {items.map((it) => {
          const active = it.match(pathname);
          const Icon = it.icon;
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 ${
                  active
                    ? "font-semibold text-[var(--brand-ink)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                }`}
              >
                <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 2} />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
