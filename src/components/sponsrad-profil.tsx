import {
  BadgeCheck,
  Globe,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import type { OverlayProfilRow, Telefontyp } from "@/lib/overlay-contract";
import { normalizeWebb, shortWebb } from "@/lib/foretag-format";

/**
 * Den betalda profilen — allt kunden köpt, samlat i ett kort.
 *
 * Visar ENBART det kunden själv lämnat: logotyp, egen beskrivning, sökord,
 * kategorier, hemsida och kontaktuppgifter. Ingen genererad text, inga betyg,
 * inga omdömen, inga påhittade "rekommenderas av"-formuleringar. Ett företag
 * som betalar för synlighet köper synlighet, inte ett omdöme vi hittat på åt
 * dem.
 *
 * `info_html` är redan saniterad när den skrevs (allowlist i
 * /api/overlay/publish, enligt kontraktet: p, br, strong, em, ul, li, a[href]),
 * och kan därför renderas som HTML här. Den saneras aldrig i CRM:et — sajten
 * litar inte på att avsändaren städat.
 */

const TELEFON_ETIKETT: Record<Telefontyp, string> = {
  kontakt: "Direkt",
  vaxel: "Växel",
  mobil: "Mobil",
};

/** Adressöverskrivning som en rad text, eller null om inget fält är satt. */
function adressrad(
  a: OverlayProfilRow["adress_override"] | null | undefined,
): string | null {
  if (!a || typeof a !== "object") return null;
  const { gata, postnummer, postort } = a as {
    gata?: string;
    postnummer?: string;
    postort?: string;
  };
  const rad = [gata, [postnummer, postort].filter(Boolean).join(" ")]
    .filter((d) => d && d.trim().length > 0)
    .join(", ");
  return rad.length > 0 ? rad : null;
}

export default function SponsradProfil({
  overlay,
  /** Namnet sidan redan visar. Används som fallback när popularnamn saknas. */
  namn,
  /** Sätts för ?preview= — då är detta ett utkast, inte något som ligger live. */
  utkast = false,
}: {
  overlay: OverlayProfilRow;
  namn: string;
  utkast?: boolean;
}) {
  const rubriknamn = overlay.popularnamn?.trim() || namn;
  const sokord = (overlay.keywords ?? []).filter((k) => k.trim().length > 0);
  const kategorier = (overlay.kategorier ?? []).filter((k) => k.trim().length > 0);
  const hemsida = normalizeWebb(overlay.hemsida);
  const telefon = overlay.telefon_override?.trim() || null;
  const epost = overlay.epost_override?.trim() || null;

  // Post- och besöksadress var för sig (1.1). Faller tillbaka på den odelade
  // adress_override från 1.0 när de nya fälten saknas.
  const besok = adressrad(overlay.adress_override_besok) ?? adressrad(overlay.adress_override);
  const post = adressrad(overlay.adress_override_post);

  const harInnehall =
    overlay.logo_url ||
    overlay.info_html ||
    sokord.length > 0 ||
    kategorier.length > 0 ||
    hemsida ||
    overlay.kontaktperson ||
    telefon ||
    epost ||
    besok ||
    post;

  // Ett tomt kort är värre än inget kort: det ser ut som ett fel.
  if (!harInnehall) return null;

  return (
    <section className="rd-card overflow-hidden border-[var(--brand)]/30">
      {utkast && (
        <p className="rd-brand-gradient px-5 py-2 text-xs font-medium tracking-tight text-white">
          Förhandsvisning — så här kommer profilen att se ut. Ingen ser den här
          sidan förrän ordern godkänns.
        </p>
      )}

      <div className="p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand)]/30 bg-[var(--surface-warm)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-ink)]">
              <BadgeCheck className="size-3.5" aria-hidden />
              Företagets egen profil
            </span>
            <h2 className="mt-3 text-lg font-semibold text-[var(--text-strong)]">
              Om {rubriknamn}
            </h2>
            {overlay.kontaktperson && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                <User className="size-3.5 shrink-0 text-[var(--text-dim)]" aria-hidden />
                {overlay.kontaktperson}
              </p>
            )}
          </div>

          {/* Plain <img>, inte next/image: logotypen ligger i sajtens egen
              storage-bucket, och en ny bucket-host ska inte kräva en ändring i
              next.config.ts innan en betald logotyp kan visas. */}
          {overlay.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={overlay.logo_url}
              alt={`${rubriknamn} logotyp`}
              loading="lazy"
              decoding="async"
              className="h-16 w-auto max-w-[180px] shrink-0 self-start object-contain sm:h-20"
            />
          )}
        </div>

        {overlay.info_html && (
          <div
            className="rd-rich-text mt-4 text-[15px] leading-relaxed text-[var(--text-body)]"
            dangerouslySetInnerHTML={{ __html: overlay.info_html }}
          />
        )}

        {kategorier.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
              Verksamhet
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {kategorier.map((k) => (
                <li
                  key={k}
                  className="inline-flex items-center rounded-full border border-[var(--brand)]/30 bg-[var(--surface-warm)] px-3 py-1 text-[13px] font-medium text-[var(--brand-ink)]"
                >
                  {k}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sokord.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
              Tjänster &amp; sökord
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {sokord.map((s) => (
                <li
                  key={s}
                  className="inline-flex items-center rounded-full border border-[var(--rule)] bg-white px-2.5 py-1 text-[13px] font-medium text-[var(--text-body)]"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(besok || post) && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {besok && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                  Besöksadress
                </h3>
                <p className="inline-flex items-start gap-1.5 text-sm text-[var(--text-body)]">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-[var(--text-dim)]" aria-hidden />
                  {besok}
                </p>
              </div>
            )}
            {post && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                  Postadress
                </h3>
                <p className="inline-flex items-start gap-1.5 text-sm text-[var(--text-body)]">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-[var(--text-dim)]" aria-hidden />
                  {post}
                </p>
              </div>
            )}
          </div>
        )}

        {(telefon || epost || hemsida) && (
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--rule-soft)] pt-4 text-sm">
            {telefon && (
              <a
                href={`tel:${telefon.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] hover:underline"
              >
                <Phone className="size-4 shrink-0" aria-hidden />
                {telefon}
                {overlay.telefon_typ && (
                  <span className="text-xs font-normal text-[var(--text-dim)]">
                    {TELEFON_ETIKETT[overlay.telefon_typ]}
                  </span>
                )}
              </a>
            )}
            {epost && (
              <a
                href={`mailto:${epost}`}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] hover:underline"
              >
                <Mail className="size-4 shrink-0" aria-hidden />
                {epost}
              </a>
            )}
            {hemsida && (
              <a
                href={hemsida}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] hover:underline"
              >
                <Globe className="size-4 shrink-0" aria-hidden />
                {shortWebb(hemsida) ?? hemsida}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
