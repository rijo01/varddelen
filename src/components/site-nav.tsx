"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Home, Search, MapPin, Layers, Phone, Heart, Globe } from "lucide-react";
import { SearchBar } from "@/components/search-bar";

/**
 * Toppen av sajten består av två rader:
 *   1. Topbar (mörkröd, tunn) — kontakt-info, scrollar bort med sidan
 *   2. Header (vit, sticky) — logo, nav, login + anslut-knapp
 *
 * När användaren scrollar gömmer vi topbaren och låter header:n ligga kvar
 * högst upp som tidigare. Söket bakas in i header:n förutom på startsidan,
 * där hero-sektionen redan har en stor sökbar.
 */
export function SiteNav() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* ===== Topbar — mörkröd, scrollar bort ===== */}
      <div className="bg-[var(--brand-2)] text-white">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-between gap-4 px-4 text-[12px]">
          <span className="hidden truncate sm:inline">
            Sök- och placeringstjänst inom vård och omsorg
          </span>
          <span className="text-white/80 sm:hidden">Vård & omsorg i Sverige</span>
          <a
            href="tel:0311309700"
            className="inline-flex items-center gap-1.5 font-medium text-white transition hover:text-white/90"
          >
            <Phone aria-hidden className="size-3.5" />
            031-130 970
          </a>
        </div>
      </div>

      {/* ===== Header — vit, sticky ===== */}
      <header
        className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
          scrolled
            ? "border-[var(--rule)] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.06)]"
            : "border-[var(--rule-soft)] bg-white"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 lg:gap-6">
          {/* Logo */}
          <Link
            href="/"
            aria-label="Vårddelen.se, till startsidan"
            className="flex shrink-0 items-center gap-2.5 text-[var(--text-strong)]"
          >
            <span
              aria-hidden
              className="relative inline-flex size-10 items-center justify-center"
            >
              <Heart
                className="size-9 text-[var(--brand)] drop-shadow-[0_2px_6px_rgba(225,29,39,0.30)]"
                fill="currentColor"
                strokeWidth={0}
              />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[17px] font-bold tracking-tight">
                Vårddelen<span className="text-[var(--brand)]">.se</span>
              </span>
              <span className="hidden text-[11px] font-medium text-[var(--text-muted)] sm:inline">
                Söktjänst inom vård och omsorg
              </span>
            </span>
          </Link>

          {/* Centrerat sök (visas inte på startsidan eftersom hero har det) */}
          <div className="flex-1">
            {!isHome ? (
              <div className="flex justify-center sm:justify-start lg:pl-6">
                <Suspense fallback={null}>
                  <SearchBar variant="single" />
                </Suspense>
              </div>
            ) : null}
          </div>

          {/* Nav-länkar (desktop) */}
          <nav className="hidden shrink-0 items-center gap-0.5 text-[13px] lg:flex">
            <NavLink href="/sok" label="Sök verksamhet" current={pathname === "/sok"} />
            <NavLink href="#" label="För verksamheter" current={false} />
            <NavLink href="#" label="Nyheter & artiklar" current={false} />
            <NavLink href="#" label="Om oss" current={false} />
          </nav>

          {/* Höger: språkväljare + login + anslut */}
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <button
              type="button"
              aria-label="Byt språk"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-strong)]"
            >
              <Globe aria-hidden className="size-3.5" />
              SV
            </button>
            <Link
              href="#"
              className="inline-flex h-9 items-center rounded-md border border-[var(--rule)] bg-white px-3 text-[13px] font-semibold text-[var(--text-strong)] transition hover:border-[var(--brand)]/40 hover:text-[var(--brand-ink)]"
            >
              Logga in
            </Link>
            <Link
              href="#"
              className="inline-flex h-9 items-center rounded-md bg-[var(--brand)] px-3.5 text-[13px] font-semibold text-white transition hover:bg-[var(--brand-2)] active:scale-[0.99]"
            >
              Anslut verksamhet
            </Link>
          </div>

          {/* Tablet — kompakta knappar utan språk */}
          <div className="hidden shrink-0 items-center gap-2 md:flex lg:hidden">
            <Link
              href="#"
              className="inline-flex h-9 items-center rounded-md bg-[var(--brand)] px-3 text-[12px] font-semibold text-white transition hover:bg-[var(--brand-2)]"
            >
              Anslut
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}

function NavLink({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
        current
          ? "text-[var(--brand-ink)] bg-[var(--tint-2)]"
          : "text-[var(--text-body)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-strong)]"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Mobil bottom-nav — fixerad nederst på små skärmar.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  const items = [
    { href: "/", label: "Hem", icon: Home, match: (p: string) => p === "/" },
    {
      href: "/sok",
      label: "Sök",
      icon: Search,
      match: (p: string) => p.startsWith("/sok"),
    },
    {
      href: "/kommuner",
      label: "Kommuner",
      icon: MapPin,
      match: (p: string) => p.startsWith("/kommun"),
    },
    {
      href: "/branscher",
      label: "Kategorier",
      icon: Layers,
      match: (p: string) => p.startsWith("/bransch"),
    },
  ];

  return (
    <nav
      aria-label="Huvudnavigering"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--rule)] bg-white/92 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/80 md:hidden"
      style={{ boxShadow: "0 -8px 24px -16px rgba(17,24,28,0.18)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 text-[11px]">
        {items.map((it) => {
          const active = it.match(pathname);
          const Icon = it.icon;
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                  active
                    ? "text-[var(--brand-ink)]"
                    : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"
                }`}
              >
                <Icon
                  aria-hidden
                  className={`size-[18px] ${active ? "stroke-[2.4px]" : ""}`}
                />
                <span className={active ? "font-medium" : ""}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
