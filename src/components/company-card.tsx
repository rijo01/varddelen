import Link from "next/link";
import { ArrowRight, Globe, Mail, MapPin, Phone, Sparkles, Users } from "lucide-react";
import { foretagSlug, type Foretag } from "@/lib/queries";
import {
  displayName,
  employerSize,
  initialFor,
  isFeatured,
  legalFormFor,
  monogramGradient,
} from "@/lib/foretag-format";

/**
 * Merinfo-stil företagskort:
 *   - Monogram (initial) till vänster med gradient bakgrund
 *   - Namn (stor länk), bransch+ort under
 *   - Badges på rad: anställda, juridisk form, kommun
 *   - Telefon-knapp framträdande (grön) om tel finns
 *   - Sekundära ikoner: webb, e-post
 */
export function CompanyCard({
  foretag,
  rank,
  branschName,
  kommunName,
  showOrt = true,
}: {
  foretag: Foretag;
  rank?: number;
  branschName?: string | null;
  kommunName?: string | null;
  showOrt?: boolean;
}) {
  const name = displayName(foretag);
  const size = employerSize(foretag.aeant);
  const legalForm = legalFormFor(foretag);
  const featured = isFeatured(foretag);
  const href = `/foretag/${foretagSlug(foretag)}`;
  const orterad =
    [foretag.gatuadress, foretag.postort].filter(Boolean).join(" · ") ||
    kommunName ||
    "Sverige";

  return (
    <article
      className={`rd-card-row group relative flex items-start gap-4 px-4 py-4 transition-colors sm:px-5 sm:py-5 ${
        featured ? "rd-card-featured" : ""
      }`}
    >
      {featured && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 rd-brand-gradient"
        />
      )}
      {rank ? (
        <span className="mt-1 hidden w-6 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--text-faint)] sm:inline">
          {rank}
        </span>
      ) : null}

      {/* Monogram */}
      <Link
        href={href}
        aria-hidden
        tabIndex={-1}
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-[0_4px_12px_-4px_rgba(225,29,39,0.5)] ring-1 ring-white/40 sm:size-14 sm:text-xl"
        style={{ backgroundImage: monogramGradient(foretag.cfarnr) }}
      >
        {initialFor(name)}
      </Link>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            href={href}
            className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-strong)] hover:text-[var(--brand-ink)] hover:underline sm:text-base"
          >
            {name}
          </Link>
          {legalForm && (
            <span className="hidden font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--text-dim)] sm:inline">
              {legalForm}
            </span>
          )}
        </div>

        <p className="truncate text-[13px] text-[var(--text-muted)] sm:text-sm">
          {branschName ? (
            <>
              <span className="text-[var(--text-body)]">{branschName}</span>
              {showOrt && <span aria-hidden> · </span>}
            </>
          ) : null}
          {showOrt ? orterad : null}
        </p>

        {/* Badges-rad */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {featured && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-2)]/45 bg-[var(--tint-3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-ink)]">
              <Sparkles className="size-3" aria-hidden />
              Utvald
            </span>
          )}
          {size && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeStyleForSize(size.tier)}`}
            >
              <Users className="size-3" aria-hidden />
              {size.label}
            </span>
          )}
          {legalForm && (
            <span className="inline-flex items-center rounded-full border border-[var(--rule)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] sm:hidden">
              {legalForm}
            </span>
          )}
          {kommunName && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--rule)] bg-[var(--surface-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
              <MapPin className="size-3" aria-hidden />
              {kommunName}
            </span>
          )}
        </div>
      </div>

      {/* Action-kolumn */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {foretag.tel && (
          <a
            href={`tel:${foretag.tel}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0c8a3d] px-3.5 text-xs font-semibold text-white shadow-[0_4px_12px_-4px_rgba(12,138,61,0.5)] transition hover:bg-[#076b2f] active:scale-[0.98]"
            aria-label={`Ring ${name}`}
          >
            <Phone className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{foretag.tel}</span>
            <span className="sm:hidden">Ring</span>
          </a>
        )}
        <div className="flex items-center gap-0.5 text-[var(--text-dim)]">
          {foretag.webb && (
            <SmallIconLink
              href={foretag.webb}
              external
              title="Hemsida"
              icon={<Globe className="size-3.5" aria-hidden />}
            />
          )}
          {foretag.epostadress && (
            <SmallIconLink
              href={`mailto:${foretag.epostadress}`}
              title="E-post"
              icon={<Mail className="size-3.5" aria-hidden />}
            />
          )}
          <Link
            href={href}
            className="ml-0.5 inline-flex h-7 items-center gap-0.5 rounded-md px-2 text-[11px] font-medium text-[var(--brand-ink)] hover:bg-[var(--tint-2)]"
            aria-label={`Visa profil för ${name}`}
          >
            Profil
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}

function badgeStyleForSize(
  tier: "solo" | "small" | "mid" | "large" | "xlarge",
): string {
  switch (tier) {
    case "solo":
      return "border border-[var(--rule)] bg-white text-[var(--text-muted)]";
    case "small":
      return "border border-[var(--rule)] bg-[var(--surface-soft)] text-[var(--text-body)]";
    case "mid":
      return "border border-[var(--brand)]/25 bg-[var(--tint-2)] text-[var(--brand-ink)]";
    case "large":
      return "border border-[var(--brand-2)]/40 bg-[var(--tint-3)] text-[var(--brand-ink)]";
    case "xlarge":
      return "rd-brand-gradient text-white";
  }
}

function SmallIconLink({
  href,
  title,
  icon,
  external = false,
}: {
  href: string;
  title: string;
  icon: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={external ? (href.startsWith("http") ? href : `https://${href}`) : href}
      title={title}
      aria-label={title}
      {...(external ? { target: "_blank", rel: "nofollow noopener" } : {})}
      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--brand-ink)]"
    >
      {icon}
    </a>
  );
}

/**
 * Lista-wrapper med snygga dividers — vit yta, mjuk skugga, divider mellan
 * kort. Använd för CompanyCard-listor.
 */
export function CompanyCardList({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ol className="rd-card overflow-hidden divide-y divide-[var(--rule-soft)]">
      {children}
    </ol>
  );
}
