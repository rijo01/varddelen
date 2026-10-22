import Link from "next/link";
import { Globe, Phone } from "lucide-react";
import { foretagSlug, type Foretag } from "@/lib/queries";
import type { OverlayProfilRow } from "@/lib/overlay-contract";
import { visatTelefon } from "@/lib/visat-telefon";
import {
  displayName,
  employerSize,
  formatTelefon,
  normalizeWebb,
  profilMarkning,
  shortWebb,
  telHref,
} from "@/lib/foretag-format";
import { ProfilEtikett } from "@/components/vard-info";
import { delarOrgnr } from "@/lib/flerstalle";

/**
 * En verksamhet som en rad i en lista.
 *
 * Allt man behöver för att välja syns utan klick: namn, typ av vård, adress
 * och telefonnummer i klartext. Numret skrivs ut även i mobilen — den som
 * ringer vill se vart samtalet går, och en knapp som bara säger "Ring" döljer
 * det. Inga monogram, inga färgade storleksbrickor: raden ska gå att skumma.
 */
export function CompanyCard({
  foretag,
  branschName,
  kommunName,
  showOrt = true,
  /**
   * Den betalda profilen, när företaget har en. Skickas in av listsidan så att
   * raden slipper göra ett eget uppslag — listan har redan hela lagret i minnet
   * (se loadAktivaOverlays).
   */
  overlay = null,
  /** Rubriknivå för namnet: 2 när listan står direkt under sidans h1. */
  rubrikNiva = 3,
}: {
  foretag: Foretag;
  /** Tas emot för bakåtkompatibilitet; numreringen visas inte längre. */
  rank?: number;
  branschName?: string | null;
  kommunName?: string | null;
  showOrt?: boolean;
  overlay?: OverlayProfilRow | null;
  rubrikNiva?: 2 | 3;
}) {
  const Rubrik = rubrikNiva === 2 ? "h2" : "h3";
  const name = overlay?.popularnamn?.trim() || displayName(foretag);
  // Samma regel som profilsidan: kundens köpta nummer ersätter registrets.
  const telefon = visatTelefon(foretag.tel, overlay);
  const webb = normalizeWebb(overlay?.hemsida) ?? normalizeWebb(foretag.webb);
  // Bolagets antal är inte mottagningens: visa bara när bolaget har ett enda
  // arbetsställe i katalogen. Se lib/flerstalle.ts.
  const size = delarOrgnr(foretag.cfarnr) ? null : employerSize(foretag.aeant);
  const markning = profilMarkning(foretag, overlay);
  const href = `/foretag/${foretagSlug(foretag)}`;
  const adress = [foretag.gatuadress, foretag.postort ?? kommunName]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      className={`rd-row relative grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:px-5 ${
        markning === "betald" ? "bg-[var(--surface-warm)]" : ""
      }`}
    >
      <div className="flex min-w-0 gap-3">
        {/* En köpt logotyp är en del av det kunden betalat för att synas med. */}
        {overlay?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={overlay.logo_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-0.5 size-11 shrink-0 rounded-md border border-[var(--rule)] bg-white object-contain p-1"
          />
        )}
        <div className="min-w-0 space-y-1">
          <Rubrik className="text-[1.125rem] font-semibold leading-snug tracking-tight">
            <Link
              href={href}
              className="text-[var(--text-strong)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline"
            >
              {name}
            </Link>
          </Rubrik>
          <p className="text-[15px] leading-snug text-[var(--text-muted)]">
            {branschName && (
              <span className="font-medium text-[var(--text-body)]">{branschName}</span>
            )}
            {branschName && showOrt && adress && <span aria-hidden> · </span>}
            {showOrt && adress}
          </p>
          {(markning || size) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[14px] text-[var(--text-dim)]">
              <ProfilEtikett markning={markning} />
              {size && <span>{size.label}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:justify-center">
        {telefon ? (
          <a
            href={telHref(telefon)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--rule-strong)] bg-white px-3.5 text-[16px] font-semibold text-[var(--text-strong)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-ink)]"
            aria-label={`Ring ${name}, ${formatTelefon(telefon)}`}
          >
            <Phone aria-hidden className="size-4 text-[var(--brand)]" />
            {formatTelefon(telefon)}
          </a>
        ) : (
          <span className="text-[15px] text-[var(--text-dim)]">Telefon saknas</span>
        )}
        {webb && (
          <a
            href={webb}
            target="_blank"
            rel="nofollow noopener"
            className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[15px] text-[var(--brand-ink)] underline-offset-4 hover:underline sm:min-h-0"
          >
            <Globe aria-hidden className="size-4" />
            {shortWebb(webb) ?? "Webbplats"}
          </a>
        )}
      </div>
    </article>
  );
}

/** Lista med avdelare mellan raderna. */
export function CompanyCardList({ children }: { children: React.ReactNode }) {
  return (
    <ol className="rd-card divide-y divide-[var(--rule)] overflow-hidden">{children}</ol>
  );
}
