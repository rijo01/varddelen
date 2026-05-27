"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Search, MapPin, Building2, Layers, ArrowRight } from "lucide-react";
import { ALL_KOMMUNER, kommunBySlug } from "@/lib/kommuner";
import { ALL_LAN, lanBySlug } from "@/lib/lan";
import { ALL_POSTORTER } from "@/lib/postorter";

type Suggestion = {
  type: "foretag" | "kommun" | "bransch";
  label: string;
  sub: string;
  href: string;
};

type OrtSuggestion =
  | { type: "lan"; slug: string; label: string; sub: string }
  | { type: "kommun"; slug: string; label: string; sub: string }
  | { type: "postort"; value: string; label: string; sub: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function iconFor(type: Suggestion["type"]) {
  if (type === "kommun") return MapPin;
  if (type === "bransch") return Layers;
  return Building2;
}

export function SearchBar({
  variant = "compact",
  initialValue,
  preserveFilters = false,
}: {
  /**
   * "compact" — pill-format för header. Två fält (bransch + ort) horisontellt
   *             på sm+, stackade på mobile. h-10, samma logik som dual men slimmad.
   * "dual"    — hero-storlek, h-14, max-w-3xl. Använd på startsidan och /sok.
   */
  variant?: "compact" | "dual";
  initialValue?: string;
  preserveFilters?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listId = useId();

  const [q, setQ] = useState(initialValue ?? searchParams.get("q") ?? "");
  const [ort, setOrt] = useState<string>(() => {
    // Prioritet matchar URL-konventionen: lan > postort > kommun.
    // Vi visar bara display-namnet — submit-flödet återskapar rätt param via lookup-kedjan.
    const lan = searchParams.get("lan");
    if (lan) {
      const match = lanBySlug(lan);
      if (match) return match.name;
    }
    const postort = searchParams.get("postort");
    if (postort) return postort;
    const k = searchParams.get("kommun");
    if (k) {
      const match = kommunBySlug(k);
      if (match) return match.name;
    }
    return "";
  });
  const [pending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [ortSuggestions, setOrtSuggestions] = useState<OrtSuggestion[]>([]);
  const [showOrtSuggestions, setShowOrtSuggestions] = useState(false);
  const [ortActiveIndex, setOrtActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stäng dropdowns vid click utanför hela sök-formuläret
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setShowOrtSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch för q-dropdown
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setSuggestions([]);
      setLoadingSuggest(false);
      return;
    }
    setLoadingSuggest(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/suggest?q=${encodeURIComponent(needle)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) throw new Error("suggest failed");
        const data: { suggestions: Suggestion[] } = await res.json();
        setSuggestions(data.suggestions ?? []);
        setActiveIndex(-1);
      } catch {
        // tyst
      } finally {
        if (!ctrl.signal.aborted) setLoadingSuggest(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Ort-suggest — fullt in-memory (ingen network, ingen debounce behövs).
  // Tre datakällor med prefix-match: lan (21) > kommun (290) > postort (1675).
  // Caps per grupp så dropdown inte växer vilt vid generiska prefix.
  useEffect(() => {
    const needle = ort.trim().toLowerCase();
    if (needle.length < 1) {
      setOrtSuggestions([]);
      setOrtActiveIndex(-1);
      return;
    }

    const lanMatches: OrtSuggestion[] = ALL_LAN
      .filter((l) => l.name.toLowerCase().startsWith(needle))
      .slice(0, 3)
      .map((l) => ({
        type: "lan" as const,
        slug: l.slug,
        label: `${l.name}s län`,
        sub: "Län",
      }));

    const kommunMatches: OrtSuggestion[] = ALL_KOMMUNER
      .filter((k) => k.name.toLowerCase().startsWith(needle))
      .slice(0, 5)
      .map((k) => ({
        type: "kommun" as const,
        slug: k.slug,
        label: `${k.name} (kommun)`,
        sub: "Kommun",
      }));

    const postortMatches: OrtSuggestion[] = ALL_POSTORTER
      .filter((p) => p.toLowerCase().startsWith(needle))
      .slice(0, 5)
      .map((p) => ({
        type: "postort" as const,
        value: p,
        label: p,
        sub: "Postort",
      }));

    setOrtSuggestions([...lanMatches, ...kommunMatches, ...postortMatches]);
    setOrtActiveIndex(-1);
  }, [ort]);

  const goToSearch = useCallback(
    (rawQ: string, rawOrt: string) => {
      const query = rawQ.trim();
      const ortRaw = rawOrt.trim();
      const params = new URLSearchParams();

      const finalQ = query;
      if (ortRaw) {
        const slug = slugify(ortRaw);
        // Lookup-kedja: län (brett, default för ambiguösa namn som "Stockholm")
        //             → kommun (kan väljas explicit via URL/autocomplete-pick)
        //             → postort (raw text, backend kör .ilike — typos blir 0 träffar)
        const lan = lanBySlug(slug);
        if (lan) {
          params.set("lan", lan.slug);
        } else {
          const kommun = kommunBySlug(slug);
          if (kommun) {
            params.set("kommun", kommun.slug);
          } else {
            params.set("postort", ortRaw);
          }
        }
      }

      if (finalQ) params.set("q", finalQ);

      if (preserveFilters) {
        const bransch = searchParams.get("bransch");
        if (bransch && !params.has("bransch")) params.set("bransch", bransch);
      }

      if (!params.toString()) return;
      setShowSuggestions(false);
      startTransition(() => router.push(`/sok?${params.toString()}`));
    },
    [router, searchParams, preserveFilters],
  );

  const goToSuggestion = useCallback(
    (s: Suggestion) => {
      setShowSuggestions(false);
      startTransition(() => router.push(s.href));
    },
    [router],
  );

  const pickOrt = useCallback(
    (s: OrtSuggestion) => {
      const params = new URLSearchParams();
      const currentQ = q.trim();
      if (currentQ) params.set("q", currentQ);
      if (preserveFilters) {
        const bransch = searchParams.get("bransch");
        if (bransch) params.set("bransch", bransch);
      }
      let displayName: string;
      if (s.type === "lan") {
        params.set("lan", s.slug);
        // Visa bara länets namn ("Stockholm") i fältet — matchar useState-init
        // när användaren senare landar på sidan med ?lan=stockholm.
        const lan = ALL_LAN.find((l) => l.slug === s.slug);
        displayName = lan?.name ?? s.slug;
      } else if (s.type === "kommun") {
        params.set("kommun", s.slug);
        const kommun = ALL_KOMMUNER.find((k) => k.slug === s.slug);
        displayName = kommun?.name ?? s.slug;
      } else {
        params.set("postort", s.value);
        displayName = s.value;
      }
      setShowOrtSuggestions(false);
      setOrt(displayName);
      startTransition(() => router.push(`/sok?${params.toString()}`));
    },
    [q, router, searchParams, preserveFilters],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      goToSuggestion(suggestions[activeIndex]);
      return;
    }
    goToSearch(q, ort);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "ArrowDown") {
        setShowSuggestions(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        i <= 0 ? suggestions.length - 1 : i - 1,
      );
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function onOrtKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showOrtSuggestions || ortSuggestions.length === 0) {
      if (e.key === "ArrowDown") {
        setShowOrtSuggestions(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOrtActiveIndex((i) => (i + 1) % ortSuggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOrtActiveIndex((i) =>
        i <= 0 ? ortSuggestions.length - 1 : i - 1,
      );
    } else if (e.key === "Enter" && ortActiveIndex >= 0) {
      e.preventDefault();
      const picked = ortSuggestions[ortActiveIndex];
      if (picked) pickOrt(picked);
    } else if (e.key === "Escape") {
      setShowOrtSuggestions(false);
    }
  }

  const dropdownVisible =
    showSuggestions &&
    q.trim().length >= 2 &&
    (suggestions.length > 0 || loadingSuggest);

  const dropdown = useMemo(() => {
    if (!dropdownVisible) return null;
    return (
      <div
        id={listId}
        role="listbox"
        className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[var(--rule)] bg-white shadow-[0_24px_60px_-20px_rgba(17,24,28,0.20)] rd-fade-in"
      >
        {loadingSuggest && suggestions.length === 0 ? (
          <div className="space-y-2 p-3">
            <div className="rd-skeleton h-4 w-3/5 rounded" />
            <div className="rd-skeleton h-4 w-4/5 rounded" />
            <div className="rd-skeleton h-4 w-2/3 rounded" />
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1.5">
            {suggestions.map((s, i) => {
              const Icon = iconFor(s.type);
              const active = i === activeIndex;
              return (
                <li key={`${s.type}-${s.href}-${i}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      goToSuggestion(s);
                    }}
                    className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "bg-[var(--tint-2)]"
                        : "hover:bg-[var(--surface-soft)]"
                    }`}
                  >
                    <span
                      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl border ${
                        s.type === "foretag"
                          ? "border-[var(--rule)] bg-white text-[var(--text-muted)]"
                          : "border-[var(--brand)]/30 bg-[var(--tint-3)] text-[var(--brand-ink)]"
                      }`}
                    >
                      <Icon className="size-[15px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                        {s.label}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-muted)]">
                        {s.sub}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className={`size-3.5 shrink-0 transition-transform ${
                        active
                          ? "text-[var(--brand-2)] translate-x-0.5"
                          : "text-[var(--text-faint)]"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
            <li className="border-t border-[var(--rule-soft)]">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  goToSearch(q, ort);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--surface-soft)]"
              >
                <span className="text-[var(--text-muted)]">
                  Sök efter{" "}
                  <span className="font-medium text-[var(--text-strong)]">
                    &ldquo;{q.trim()}&rdquo;
                  </span>
                </span>
                <span className="text-[var(--brand-ink)]">
                  Visa alla träffar →
                </span>
              </button>
            </li>
          </ul>
        )}
      </div>
    );
  }, [
    dropdownVisible,
    loadingSuggest,
    suggestions,
    activeIndex,
    listId,
    q,
    ort,
    goToSearch,
    goToSuggestion,
  ]);

  const ortDropdownVisible =
    showOrtSuggestions && ort.trim().length >= 1 && ortSuggestions.length > 0;

  const ortDropdown = useMemo(() => {
    if (!ortDropdownVisible) return null;
    return (
      <div
        role="listbox"
        className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[var(--rule)] bg-white shadow-[0_24px_60px_-20px_rgba(17,24,28,0.20)] rd-fade-in"
      >
        <ul className="max-h-[60vh] overflow-y-auto py-1.5">
          {ortSuggestions.map((s, i) => {
            const active = i === ortActiveIndex;
            const key = s.type === "postort" ? `postort-${s.value}-${i}` : `${s.type}-${s.slug}-${i}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setOrtActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickOrt(s);
                  }}
                  className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-[var(--tint-2)]"
                      : "hover:bg-[var(--surface-soft)]"
                  }`}
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/30 bg-[var(--tint-3)] text-[var(--brand-ink)]">
                    <MapPin className="size-[15px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                      {s.label}
                    </span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {s.sub}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className={`size-3.5 shrink-0 transition-transform ${
                      active
                        ? "text-[var(--brand-2)] translate-x-0.5"
                        : "text-[var(--text-faint)]"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }, [ortDropdownVisible, ortSuggestions, ortActiveIndex, pickOrt]);

  // === COMPACT — header-pill med vårdföretag+ort horisontellt (mobile: stackad) ===
  if (variant === "compact") {
    return (
      <div ref={wrapRef} className="relative w-full max-w-xl">
        <form
          onSubmit={onSubmit}
          role="search"
          aria-label="Sök vårdföretag och ort"
          className="rd-search-box flex w-full flex-col items-stretch rounded-2xl border border-[var(--rule)] bg-white p-1 sm:flex-row sm:items-center sm:rounded-full"
        >
          {/* Q-fält */}
          <label className="group relative flex flex-1 items-center">
            <span className="sr-only">Vårdföretag, kategori eller person</span>
            <Search
              aria-hidden
              className="absolute left-3 size-4 text-[var(--text-dim)] transition-colors group-focus-within:text-[var(--brand-2)]"
            />
            <input
              type="search"
              name="q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => {
                setShowSuggestions(true);
                setShowOrtSuggestions(false);
              }}
              onKeyDown={onKeyDown}
              placeholder="Vårdföretag eller kategori"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-controls={dropdownVisible ? listId : undefined}
              aria-expanded={dropdownVisible}
              className="h-10 w-full rounded-2xl bg-transparent pl-9 pr-3 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-dim)] focus:outline-none sm:rounded-full"
            />
          </label>

          {/* Divider — vertikal pipe på sm+, horisontell linje på mobile */}
          <div aria-hidden className="mx-1 hidden h-5 w-px bg-[var(--rule)] sm:block" />
          <div aria-hidden className="my-0.5 h-px w-full bg-[var(--rule-soft)] sm:hidden" />

          {/* Ort-fält */}
          <label className="group relative flex flex-1 items-center">
            <span className="sr-only">Ort, kommun eller län</span>
            <MapPin
              aria-hidden
              className="absolute left-3 size-4 text-[var(--text-dim)] transition-colors group-focus-within:text-[var(--brand-2)]"
            />
            <input
              type="text"
              name="ort"
              value={ort}
              onChange={(e) => {
                setOrt(e.target.value);
                setShowOrtSuggestions(true);
              }}
              onFocus={() => {
                setShowOrtSuggestions(true);
                setShowSuggestions(false);
              }}
              onKeyDown={onOrtKeyDown}
              placeholder="Ort, kommun eller län"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-expanded={ortDropdownVisible}
              className="h-10 w-full rounded-2xl bg-transparent pl-9 pr-3 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-dim)] focus:outline-none sm:rounded-full"
            />
            {ortDropdown}
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={pending || (q.trim().length < 2 && ort.trim().length < 2)}
            className="mt-1 inline-flex h-9 shrink-0 items-center justify-center rounded-full rd-brand-gradient rd-cta-shadow px-4 text-xs font-semibold text-white transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:ml-1 sm:mt-0 sm:h-8 sm:px-3.5"
          >
            {pending ? "Söker…" : "Sök"}
          </button>
        </form>
        {dropdown}
      </div>
    );
  }

  // === DUAL — hero: två stora fält (vårdföretag + ort) ===
  return (
    <div ref={wrapRef} className="relative w-full max-w-3xl">
      <form
        onSubmit={onSubmit}
        role="search"
        aria-label="Sök vårdföretag och ort"
        className="rd-search-box flex w-full flex-col items-stretch gap-0 overflow-visible rounded-3xl border border-[var(--rule-strong)] bg-white p-2 sm:flex-row sm:rounded-full"
      >
        <label className="group relative flex flex-1 items-center">
          <span className="sr-only">Vårdföretag, kategori eller person</span>
          <Search
            aria-hidden
            className="absolute left-5 size-5 text-[var(--text-dim)] transition-colors group-focus-within:text-[var(--brand-2)]"
          />
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => {
              setShowSuggestions(true);
              setShowOrtSuggestions(false);
            }}
            onKeyDown={onKeyDown}
            placeholder="Vårdföretag eller kategori"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="next"
            aria-controls={dropdownVisible ? listId : undefined}
            aria-expanded={dropdownVisible}
            className="h-13 w-full rounded-2xl bg-transparent pl-13 pr-3 text-base text-[var(--text-strong)] placeholder:text-[var(--text-dim)] focus:outline-none sm:h-14"
          />
        </label>

        <div
          aria-hidden
          className="mx-2 hidden h-9 w-px bg-[var(--rule)] sm:block"
        />

        <label className="group relative flex flex-1 items-center border-t border-[var(--rule-soft)] sm:border-t-0">
          <span className="sr-only">Ort, kommun eller län</span>
          <MapPin
            aria-hidden
            className="absolute left-5 size-5 text-[var(--text-dim)] transition-colors group-focus-within:text-[var(--brand-2)]"
          />
          <input
            type="text"
            name="ort"
            value={ort}
            onChange={(e) => {
              setOrt(e.target.value);
              setShowOrtSuggestions(true);
            }}
            onFocus={() => {
              setShowOrtSuggestions(true);
              setShowSuggestions(false);
            }}
            onKeyDown={onOrtKeyDown}
            placeholder="Ort, kommun eller län"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-expanded={ortDropdownVisible}
            className="h-13 w-full rounded-2xl bg-transparent pl-13 pr-3 text-base text-[var(--text-strong)] placeholder:text-[var(--text-dim)] focus:outline-none sm:h-14"
          />
          {ortDropdown}
        </label>

        <button
          type="submit"
          disabled={pending || (q.trim().length < 2 && ort.trim().length < 2)}
          className="mt-2 inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl rd-brand-gradient rd-cta-shadow px-6 text-sm font-semibold text-white transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:ml-1 sm:mt-0 sm:h-12 sm:rounded-full sm:px-7"
        >
          <Search aria-hidden className="size-4 sm:hidden" />
          {pending ? "Söker…" : "Sök"}
        </button>
      </form>
      {dropdown}
    </div>
  );
}
