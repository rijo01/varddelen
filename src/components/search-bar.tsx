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
import { Search, MapPin, Building2, Layers, Stethoscope } from "lucide-react";
import { ALL_KOMMUNER, kommunBySlug } from "@/lib/kommuner";
import { ALL_LAN, lanBySlug, lanNamn } from "@/lib/lan";
import { ALL_POSTORTER } from "@/lib/postorter";
import { KATEGORI_FORSLAG, SOK_TERMER } from "@/lib/sok-termer";

/**
 * Ett förslag under "Vilken vård söker du?".
 *   term     — fyller i fältet och flyttar fokus till "Var?"
 *   kategori — öppnar kategorin, med orten om en är vald
 *   foretag  — öppnar verksamhetens sida
 */
type Suggestion = {
  type: "foretag" | "kommun" | "bransch" | "term" | "kategori";
  label: string;
  sub: string;
  href: string;
  /** För term: ordet som skrivs i fältet. För kategori: sluggen. */
  value?: string;
};

/** Lokala förslag — ingen nätverksrunda, visas direkt vid fokus. */
function lokalaForslag(needle: string): Suggestion[] {
  const n = needle.trim().toLowerCase();
  const terms = SOK_TERMER.filter(
    (t) => !n || t.label.toLowerCase().includes(n) || t.synonymer.some((s) => s.startsWith(n)),
  ).map<Suggestion>((t) => ({ type: "term", label: t.label, sub: "Typ av vård", href: "", value: t.q }));
  const kats = KATEGORI_FORSLAG.filter((k) => !n || k.name.toLowerCase().includes(n)).map<Suggestion>(
    (k) => ({ type: "kategori", label: k.name, sub: "Kategori", href: "", value: k.slug }),
  );
  return n ? [...terms, ...kats].slice(0, 6) : [...terms.slice(0, 6), ...kats];
}

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
  if (type === "bransch" || type === "kategori") return Layers;
  if (type === "term") return Stethoscope;
  return Building2;
}

/**
 * Ortfältet som URL-parametrar. Lookup-kedja: län (brett, default för
 * ambiguösa namn som "Stockholm") → kommun → postort (rå text, backend kör
 * .ilike — stavfel blir 0 träffar).
 */
function ortParams(rawOrt: string): URLSearchParams {
  const params = new URLSearchParams();
  const ortRaw = rawOrt.trim();
  if (!ortRaw) return params;
  const slug = slugify(ortRaw);
  const lan = lanBySlug(slug);
  if (lan) {
    params.set("lan", lan.slug);
    return params;
  }
  const kommun = kommunBySlug(slug);
  if (kommun) params.set("kommun", kommun.slug);
  else params.set("postort", ortRaw);
  return params;
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
  const ortInputRef = useRef<HTMLInputElement | null>(null);
  const qInputRef = useRef<HTMLInputElement | null>(null);
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
      setSuggestions(lokalaForslag(needle));
      setLoadingSuggest(false);
      return;
    }
    setSuggestions(lokalaForslag(needle));
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
        // Orten har ett eget fält, och vårdtyperna kommer ur den lokala
        // listan — från API:t tas bara verksamheterna.
        const foretag = (data.suggestions ?? []).filter((x) => x.type === "foretag");
        setSuggestions([...lokalaForslag(needle), ...foretag]);
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
        label: lanNamn(l),
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
      const params = ortParams(rawOrt);
      if (query) params.set("q", query);

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
      if (s.type === "term" && s.value) {
        setQ(s.value);
        // Med ort ifylld är sökningen komplett; annars är "Var?" nästa fråga.
        if (ort.trim()) goToSearch(s.value, ort);
        else ortInputRef.current?.focus();
        return;
      }
      if (s.type === "kategori" && s.value) {
        const params = ortParams(ort);
        params.set("kategori", s.value);
        startTransition(() => router.push(`/sok?${params.toString()}`));
        return;
      }
      startTransition(() => router.push(s.href));
    },
    [router, ort, goToSearch],
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
    // Tomt formulär: led tillbaka till första frågan i stället för att inget händer.
    if (!q.trim() && !ort.trim()) {
      qInputRef.current?.focus();
      setShowSuggestions(true);
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

  const dropdownVisible = showSuggestions && (suggestions.length > 0 || loadingSuggest);

  const optionClass = (active: boolean) =>
    `flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
      active ? "bg-[var(--tint-2)]" : "hover:bg-[var(--surface-soft)]"
    }`;

  const dropdown = useMemo(() => {
    if (!dropdownVisible) return null;
    return (
      <div
        id={listId}
        role="listbox"
        aria-label="Förslag"
        className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--rule-strong)] bg-white shadow-[var(--shadow-pop)]"
      >
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {suggestions.map((s, i) => {
            const Icon = iconFor(s.type);
            const active = i === activeIndex;
            return (
              <li key={`${s.type}-${s.value ?? s.href}-${i}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goToSuggestion(s);
                  }}
                  className={optionClass(active)}
                >
                  <Icon aria-hidden className="size-[18px] shrink-0 text-[var(--text-dim)]" />
                  <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--text-strong)]">
                    {s.label}
                  </span>
                  <span className="shrink-0 text-[14px] text-[var(--text-dim)]">
                    {s.type === "foretag" ? s.sub : s.type === "kategori" ? "Kategori" : ""}
                  </span>
                </button>
              </li>
            );
          })}
          {loadingSuggest && (
            <li className="px-4 py-2.5 text-[15px] text-[var(--text-dim)]">Söker verksamheter…</li>
          )}
        </ul>
      </div>
    );
  }, [dropdownVisible, loadingSuggest, suggestions, activeIndex, listId, goToSuggestion]);

  const ortDropdownVisible =
    showOrtSuggestions && ort.trim().length >= 1 && ortSuggestions.length > 0;

  const ortDropdown = useMemo(() => {
    if (!ortDropdownVisible) return null;
    return (
      <div
        role="listbox"
        aria-label="Orter"
        className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--rule-strong)] bg-white shadow-[var(--shadow-pop)]"
      >
        <ul className="max-h-[60vh] overflow-y-auto py-1">
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
                  className={optionClass(active)}
                >
                  <MapPin aria-hidden className="size-[18px] shrink-0 text-[var(--text-dim)]" />
                  <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--text-strong)]">
                    {s.label}
                  </span>
                  <span className="shrink-0 text-[14px] text-[var(--text-dim)]">{s.sub}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }, [ortDropdownVisible, ortSuggestions, ortActiveIndex, pickOrt]);

  const kanSoka = q.trim().length >= 2 || ort.trim().length >= 2;
  const stor = variant === "dual";

  const qInput = (
    <input
      id={`${listId}-q`}
      ref={qInputRef}
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
      placeholder={stor ? "T.ex. tandläkare, psykolog, hemtjänst" : "Vilken vård?"}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="next"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={dropdownVisible ? listId : undefined}
      aria-expanded={dropdownVisible}
      className={`w-full bg-transparent pl-10 pr-3 text-[var(--text-strong)] focus:outline-none ${
        stor ? "h-12 text-[17px]" : "h-10 text-[16px]"
      }`}
    />
  );

  const ortInput = (
    <input
      id={`${listId}-ort`}
      ref={ortInputRef}
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
      placeholder={stor ? "Kommun, ort eller län" : "Var?"}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="search"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={ortDropdownVisible}
      className={`w-full bg-transparent pl-10 pr-3 text-[var(--text-strong)] focus:outline-none ${
        stor ? "h-12 text-[17px]" : "h-10 text-[16px]"
      }`}
    />
  );

  // === COMPACT — sidhuvudet på stora skärmar: två fält på en rad, utan etiketter ===
  if (!stor) {
    return (
      <div ref={wrapRef} className="relative w-full max-w-xl">
        <form
          onSubmit={onSubmit}
          role="search"
          aria-label="Sök vård"
          className="rd-search-box flex w-full items-center rounded-lg border border-[var(--rule-strong)] bg-white"
        >
          <div className="relative flex-1">
            <label htmlFor={`${listId}-q`} className="sr-only">Vilken vård söker du?</label>
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-dim)]" />
            {qInput}
          </div>
          <div aria-hidden className="h-6 w-px bg-[var(--rule)]" />
          <div className="relative flex-1">
            <label htmlFor={`${listId}-ort`} className="sr-only">Var?</label>
            <MapPin aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-dim)]" />
            {ortInput}
            {ortDropdown}
          </div>
          <button
            type="submit"
            disabled={pending || !kanSoka}
            className="m-1 inline-flex h-8 shrink-0 items-center rounded-md bg-[var(--brand)] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--brand-2)] disabled:cursor-not-allowed disabled:bg-[var(--text-dim)]"
          >
            {pending ? "Söker…" : "Sök"}
          </button>
        </form>
        {dropdown}
      </div>
    );
  }

  // === DUAL — stort sökfält med synliga etiketter: "Vilken vård?" + "Var?" ===
  return (
    <div ref={wrapRef} className="relative w-full">
      <form
        onSubmit={onSubmit}
        role="search"
        aria-label="Sök vård"
        className="grid w-full gap-3 sm:grid-cols-[1.3fr_1fr_auto] sm:items-end"
      >
        <div className="relative">
          <label htmlFor={`${listId}-q`} className="mb-1.5 block text-[16px] font-semibold text-[var(--text-strong)]">
            Vilken vård söker du?
          </label>
          <div className="rd-search-box relative rounded-lg border-2 border-[var(--rule-strong)] bg-white">
            <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[var(--text-dim)]" />
            {qInput}
          </div>
          {dropdown}
        </div>
        <div className="relative">
          <label htmlFor={`${listId}-ort`} className="mb-1.5 block text-[16px] font-semibold text-[var(--text-strong)]">
            Var?
          </label>
          <div className="rd-search-box relative rounded-lg border-2 border-[var(--rule-strong)] bg-white">
            <MapPin aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[var(--text-dim)]" />
            {ortInput}
          </div>
          {ortDropdown}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-[52px] items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-7 text-[17px] font-semibold text-white transition-colors hover:bg-[var(--brand-2)] active:bg-[var(--brand-deep)] disabled:cursor-wait"
        >
          <Search aria-hidden className="size-5" />
          {pending ? "Söker…" : "Sök"}
        </button>
      </form>
    </div>
  );
}
