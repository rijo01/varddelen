"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Home, Search, MapPin, Layers } from "lucide-react";
import { SearchBar } from "@/components/search-bar";

/**
 * Sticky top-nav: kompakt logotyp + (icke-startsida) inbäddad sökbar + meny.
 * Döljer söket på startsidan eftersom hjältesöket redan är synligt där.
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
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
        scrolled
          ? "border-[var(--rule)] bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70"
          : "border-transparent bg-white/60 backdrop-blur-sm"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-5">
        <Link
          href="/"
          aria-label="Vårddelen, till startsidan"
          className="flex shrink-0 items-center gap-2.5 text-[var(--text-strong)]"
        >
          <span
            aria-hidden
            className="relative inline-flex size-8 items-center justify-center overflow-hidden rounded-xl rd-brand-gradient text-base font-bold text-white shadow-[0_4px_12px_-4px_rgba(30,142,132,0.6)]"
          >
            <span className="relative z-10">V</span>
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-1/2 bg-white/25"
            />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            Vårddelen
          </span>
        </Link>

        <div className="flex-1">
          {!isHome ? (
            <div className="flex justify-center sm:justify-start">
              <Suspense fallback={null}>
                <SearchBar variant="single" />
              </Suspense>
            </div>
          ) : null}
        </div>

        <nav className="hidden shrink-0 items-center gap-0.5 text-sm md:flex">
          <NavLink href="/" label="Hem" current={pathname === "/"} />
          <NavLink
            href="/kommuner"
            label="Kommuner"
            current={pathname.startsWith("/kommun")}
          />
          <NavLink
            href="/branscher"
            label="Branscher"
            current={pathname.startsWith("/bransch")}
          />
        </nav>
      </div>
    </header>
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
      className={`rounded-lg px-3 py-1.5 transition-colors ${
        current
          ? "text-[var(--brand-ink)] bg-[var(--tint-3)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-strong)]"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Mobil bottom-nav — fixerad nederst på små skärmar.
 * Bygger på premiumkänslan: glassbakgrund, mjuk skugga upp, brand-färg för aktiv.
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
      label: "Branscher",
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
