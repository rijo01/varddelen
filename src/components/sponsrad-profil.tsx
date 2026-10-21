import { Globe, Mail, MapPin, Phone, User } from "lucide-react";
import Link from "next/link";
import { logoMatt, telefontypText } from "@/lib/overlay-contract";
import type { OverlayProfilRow } from "@/lib/overlay-contract";
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

/**
 * Etiketten bredvid numret. Sedan kontrakt 1.4 är `telefon_typ` fri text
 * ("Kundtjänst", "Lager") och skrivs ut som den är. Koden "kontakt" heter
 * "Direkt" här, som den alltid gjort på sajten; övriga gamla koder blir ord
 * via kontraktets telefontypText().
 */
function telefonEtikett(typ: string | null | undefined): string | null {
  if (typ?.trim() === "kontakt") return "Direkt";
  return telefontypText(typ);
}

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
  /**
   * Företagssidan visar redan telefon, e-post, webbplats och kontaktperson
   * överst, sökorden i en gemensam lista och logotypen i sidhuvudet. Kompakt
   * läge visar då bara det som inte står någon annanstans: kundens text,
   * verksamhetsområden och adresser.
   */
  kompakt = false,
}: {
  overlay: OverlayProfilRow;
  namn: string;
  utkast?: boolean;
  kompakt?: boolean;
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

  const harInnehall = kompakt
    ? overlay.info_html || kategorier.length > 0 || besok || post
    : overlay.logo_url ||
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
    <section aria-labelledby="betald-profil-rubrik" className="rd-card overflow-hidden">
      {utkast && (
        <p className="bg-[var(--brand)] px-5 py-2 text-[15px] font-medium text-white">
          Förhandsvisning — så här kommer profilen att se ut. Ingen ser den här
          sidan förrän ordern godkänns.
        </p>
      )}

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-[14px] text-[var(--text-dim)]">
              <span className="font-semibold text-[var(--brand-ink)]">Betald profil</span> · texten
              är skriven av verksamheten, inte av Vårddelen.{" "}
              <Link href="#om-ordningen" className="underline">
                Läs mer
              </Link>
            </p>
            <h2 id="betald-profil-rubrik" className="text-[1.375rem] font-semibold text-[var(--text-strong)]">
              Om {rubriknamn}
            </h2>
            {!kompakt && overlay.kontaktperson && (
              <p className="inline-flex items-center gap-1.5 text-[16px] text-[var(--text-muted)]">
                <User className="size-4 shrink-0 text-[var(--text-dim)]" aria-hidden />
                {overlay.kontaktperson}
              </p>
            )}
          </div>

          {/* Plain <img>, inte next/image: logotypen ligger i sajtens egen
              storage-bucket, och en ny bucket-host ska inte kräva en ändring i
              next.config.ts innan en betald logotyp kan visas. */}
          {!kompakt && overlay.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={overlay.logo_url}
              alt={`${rubriknamn} logotyp`}
              width={logoMatt(overlay.logo_url)?.bredd}
              height={logoMatt(overlay.logo_url)?.hojd}
              loading="lazy"
              decoding="async"
              className="h-16 w-auto max-w-[180px] shrink-0 object-contain"
            />
          )}
        </div>

        {overlay.info_html && (
          <div
            className="rd-rich-text max-w-[68ch] text-[17px] leading-relaxed text-[var(--text-body)]"
            dangerouslySetInnerHTML={{ __html: overlay.info_html }}
          />
        )}

        {kategorier.length > 0 && (
          <div>
            <h3 className="mb-2 text-[16px] font-semibold text-[var(--text-strong)]">Verksamhet</h3>
            <ul className="flex flex-wrap gap-2">
              {kategorier.map((k) => (
                <li
                  key={k}
                  className="inline-flex min-h-9 items-center rounded-md border border-[var(--rule-strong)] px-3 text-[15px] text-[var(--text-body)]"
                >
                  {k}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!kompakt && sokord.length > 0 && (
          <div>
            <h3 className="mb-2 text-[16px] font-semibold text-[var(--text-strong)]">Tjänster och sökord</h3>
            <ul className="flex flex-wrap gap-2">
              {sokord.map((s) => (
                <li
                  key={s}
                  className="inline-flex min-h-9 items-center rounded-md border border-[var(--rule-strong)] px-3 text-[15px] text-[var(--text-body)]"
                >
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(besok || post) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {besok && (
              <div>
                <h3 className="mb-1 text-[16px] font-semibold text-[var(--text-strong)]">Besöksadress</h3>
                <p className="flex items-start gap-1.5 text-[16px] text-[var(--text-body)]">
                  <MapPin className="mt-1 size-4 shrink-0 text-[var(--text-dim)]" aria-hidden />
                  {besok}
                </p>
              </div>
            )}
            {post && (
              <div>
                <h3 className="mb-1 text-[16px] font-semibold text-[var(--text-strong)]">Postadress</h3>
                <p className="flex items-start gap-1.5 text-[16px] text-[var(--text-body)]">
                  <MapPin className="mt-1 size-4 shrink-0 text-[var(--text-dim)]" aria-hidden />
                  {post}
                </p>
              </div>
            )}
          </div>
        )}

        {!kompakt && (telefon || epost || hemsida) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--rule)] pt-4 text-[16px]">
            {telefon && (
              <a
                href={`tel:${telefon.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] underline"
              >
                <Phone className="size-4 shrink-0" aria-hidden />
                {telefon}
                {telefonEtikett(overlay.telefon_typ) && (
                  <span className="text-[14px] font-normal text-[var(--text-dim)]">
                    {telefonEtikett(overlay.telefon_typ)}
                  </span>
                )}
              </a>
            )}
            {epost && (
              <a href={`mailto:${epost}`} className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] underline">
                <Mail className="size-4 shrink-0" aria-hidden />
                {epost}
              </a>
            )}
            {hemsida && (
              <a
                href={hemsida}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-[var(--brand-ink)] underline"
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
