import { sidhuvudetsLogotyp } from "@/lib/overlay-contract";
import type { Metadata } from "next";
import { visatTelefon as visatTelefonFor } from "@/lib/visat-telefon";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowRight, ExternalLink, Globe, Mail, MapPin, Phone, User } from "lucide-react";
import { kommunByCode } from "@/lib/kommuner";
import {
  branschPageSlug,
  foretagSlug,
  getForetagByCfarnr,
  listRelatedForetag,
  listSokordForCfarnr,
  parseCfarnrFromSlug,
  type Foretag,
} from "@/lib/queries";
import { getBranschName } from "@/lib/branscher";
import { JsonLd, buildBreadcrumb } from "@/components/json-ld";
import { Breadcrumb } from "@/components/breadcrumb";
import { CompanyCard, CompanyCardList } from "@/components/company-card";
import {
  displayName,
  formatTelefon,
  googleMapsUrl,
  legalFormFor,
  normalizeWebb,
  orgnrDisplay,
  profilMarkning,
  shortWebb,
  synligAdress,
  telHref,
} from "@/lib/foretag-format";
import { AkutNotis, ProfilEtikett } from "@/components/vard-info";
import { BRANSCH_LABEL, etikettIText } from "@/lib/stats";
import { delarOrgnr } from "@/lib/flerstalle";
import { isPersonalOrgnr } from "@/lib/jurform";
import { sanitizeInfotext, safeLogotypUrl } from "@/lib/sanitize-html";
import { SITE_URL } from "@/lib/site";
import { robotsForForetagMedOverlay } from "@/lib/indexability";
import {
  getOverlayForForetag,
  getOverlayUtkastForForetag,
  loadAktivaOverlays,
  overlayFor,
} from "@/lib/overlay";
import { ordnaBoostade, overlayGerSubstans } from "@/lib/overlay-rankning";
import SponsradProfil from "@/components/sponsrad-profil";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const cfarnr = parseCfarnrFromSlug(slug);
  if (!cfarnr) return { title: "Företag hittades inte" };
  const f = await getForetagByCfarnr(cfarnr);
  if (!f) return { title: "Företag hittades inte" };
  // Kanonisk slug, inte den begärda. Sidan 308:ar visserligen bort felslugar
  // (se ForetagPage), men metadatan får aldrig kunna peka på en URL som inte
  // är kanonisk — det var precis den självkanonikaliseringen som gjorde varje
  // felslug till en indexerbar dublett.
  const canonicalSlug = foretagSlug(f);
  const name = displayName(f);
  const kommun = f.kommun ? kommunByCode(f.kommun) : null;
  const title = kommun ? `${name} – ${kommun.name}` : name;
  const description = `${name}${
    kommun ? ` i ${kommun.name} kommun` : ""
  }${f.gatuadress ? `, ${f.gatuadress}` : ""}. Kontaktuppgifter, bransch och företagsinformation från offentliga register.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/foretag/${canonicalSlug}` },
    openGraph: { title, description, type: "website", locale: "sv_SE" },
    // Substansgrind: utan beskrivning, tjänstelista eller verifierad kontakt är
    // sidan en registerrad — mätt 20 unika ord mot mallen. noindex,follow.
    // En betald profil är ALLTID indexerbar — uppslaget är cachat per request
    // och delar rundtur med sidan nedan. Se robotsForForetagMedOverlay().
    ...robotsForForetagMedOverlay(
      cfarnr,
      overlayGerSubstans(await getOverlayForForetag(f)),
    ),
  };
}

/**
 * Företagssidans hela innehåll.
 *
 * Bruten ur page.tsx för att förhandsvisningen ska kunna återanvända den.
 * Den publika sidan är ISR (revalidate 86400) för tiotusentals företag, och
 * hade den läst searchParams själv för att hitta `?preview=` hade varenda
 * sidvisning blivit en serverrendering. Nu betalar bara förhandsvisningen det
 * priset — se forhandsvisning/page.tsx.
 */
export default async function ForetagSida({
  slug,
  /** Satt ENDAST från förhandsvisningsrouten. Publik rendering skickar aldrig med den. */
  previewToken,
}: {
  slug: string;
  previewToken?: string;
}) {
  const cfarnr = parseCfarnrFromSlug(slug);
  if (!cfarnr) notFound();
  const f = await getForetagByCfarnr(cfarnr);
  if (!f) notFound();

  /**
   * ÖPPEN DUBBLETTYTA — stängd med 308.
   *
   * parseCfarnrFromSlug läser bara siffrorna sist i sluggen, så /foretag/
   * <vad-som-helst>-4711 svarade 200 med fullt innehåll OCH en canonical som
   * pekade på den begärda sluggen. Varje företag hade därmed obegränsat många
   * självkanonikaliserande dubletter, och vem som helst kunde skapa fler genom
   * att länka en påhittad slug.
   *
   * Rätt svar är en permanent omdirigering till den enda kanoniska URL:en.
   * Ingen loop är möjlig: foretagSlug() slutar alltid på samma cfarnr, så den
   * kanoniska sluggen är per konstruktion ett fixpunkt.
   */
  // Förhandsvisningen har en egen adress; en omdirigering här hade kastat
  // säljaren till den publika sidan.
  const canonicalSlug = foretagSlug(f);
  if (!previewToken && slug !== canonicalSlug) {
    permanentRedirect(`/foretag/${canonicalSlug}`);
  }

  const kommun = f.kommun ? kommunByCode(f.kommun) : null;
  const branschName = f.ng1 ? await getBranschName(f.ng1) : null;
  const name = displayName(f);
  const legalForm = legalFormFor(f);
  const webb = normalizeWebb(f.webb);
  const orgnrInfo = orgnrDisplay(f);
  const sanitizedInfotext = sanitizeInfotext(f.infotext);
  const personalOrgnr = isPersonalOrgnr(f.jurform);

  // Hämta liknande företag + sökord parallellt — sokord-queryn är liten
  // (en cfarnr) men ska inte serialiseras efter related-queryn.
  // Overlay: den betalda profilen. I förhandsvisning läses UTKASTET i stället
  // för den publicerade raden — samma rendering, annan källa, så att säljaren
  // ser exakt vad kunden kommer att se.
  const [oboostadeRelated, sokord, overlay, overlays] = await Promise.all([
    kommun && f.ng1
      ? listRelatedForetag(kommun.code, f.ng1, f.cfarnr, 6)
      : Promise.resolve([] as Foretag[]),
    listSokordForCfarnr(f.cfarnr),
    previewToken
      ? getOverlayUtkastForForetag(f, previewToken)
      : getOverlayForForetag(f),
    loadAktivaOverlays(),
  ]);

  // Ett utkast som inte finns, eller en token som inte håller, ger ingen sida
  // alls i förhandsvisningsläget. Att i stället visa den publika sidan hade
  // gjort förhandsvisningen till en självkanonikaliserande dubblett.
  if (previewToken && !overlay) notFound();

  // SIDHUVUDETS LOGOTYP: den köpta före registrets. Regeln är kontraktets
  // sidhuvudetsLogotyp() — samma på alla tre klustersajter. Förut visades bara
  // registrets bild här, och en köpt logotyp syntes först i det sponsrade
  // kortet längre ner. `overlay` är utkastet bakom en förhandsvisning.
  const logoUrl = sidhuvudetsLogotyp(overlay, safeLogotypUrl(f.logotyp))?.url ?? null;

  const related = ordnaBoostade(oboostadeRelated, overlays);

  // Adressen som visas, i rutan, i JSON-LD, i texten och i FAQ:n. En enskild
  // firma har ingen gatuadress här (mapRow) — utom den kunden själv publicerat.
  const fVisad: Foretag = { ...f, ...synligAdress(f, overlay) };
  // Kartlänk bara till en gatuadress — en länk till bara postorten pekar ut
  // ingenting och är ingen hjälp.
  const mapsUrl = fVisad.gatuadress ? googleMapsUrl(fVisad) : null;

  // Märkningen: "Betald placering" bara för ett aktuellt köp (overlay.featured),
  // "Komplett profil" för registrets poang. Se profilMarkning().
  const markning = profilMarkning(f, overlay);

  // Kontaktuppgifterna som visas överst — kundens egna före registrets, med
  // samma regel för telefonen som listraderna (visatTelefon).
  const webbVisad = normalizeWebb(overlay?.hemsida) ?? webb;
  const epostVisad = overlay?.epost_override?.trim() || f.epostadress || null;
  const kontaktperson = overlay?.kontaktperson?.trim() || f.kontaktperson || null;
  const branschEtikett = f.ng1 ? (BRANSCH_LABEL[f.ng1] ?? branschName) : branschName;
  const hubbHref =
    kommun && branschName && f.ng1
      ? `/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`
      : null;
  const egenText = Boolean(overlay?.info_html);

  /**
   * Vilket telefonnummer sidan visar i huvudet.
   *
   * `dolj_andra_nummer` är kundens köpta rätt att ersätta registrets nummer med
   * sitt eget — men bara NÄR DE FAKTISKT LÄMNAT ETT. Utan den spärren hade en
   * kund som kryssat i rutan och sedan tömt sitt nummerfält fått en sida helt
   * utan telefonnummer, vilket är motsatsen till vad de betalade för.
   */
  const visatTelefon = visatTelefonFor(f.tel, overlay);

  /**
   * Sökorden i strukturerad data. Kundens egna ord först, dubbletter bort
   * skiftlägesokänsligt — registret och kunden stavar sällan likadant.
   */
  const strukturSokord = slaIhopSokord(
    [...(overlay?.kategorier ?? []), ...(overlay?.keywords ?? [])],
    sokord,
  );

  const breadcrumbItems = [
    { name: "Vårddelen", href: "/" },
    ...(kommun ? [{ name: kommun.name, href: `/kommun/${kommun.slug}` }] : []),
    ...(kommun && branschName && f.ng1
      ? [
          {
            name: branschName,
            href: `/kommun/${kommun.slug}/${branschPageSlug(branschName, f.ng1)}`,
          },
        ]
      : []),
    { name },
  ];

  const breadcrumbJsonLd = buildBreadcrumb(
    breadcrumbItems
      .filter((b) => b.href)
      .map((b) => ({ name: b.name, url: `${SITE_URL}${b.href!}` }))
      .concat([{ name, url: `${SITE_URL}/foretag/${slug}` }]),
  );

  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    ...(fVisad.gatuadress || fVisad.postort
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: fVisad.gatuadress ?? undefined,
            postalCode: fVisad.postnr ? String(fVisad.postnr) : undefined,
            addressLocality: fVisad.postort ?? kommun?.name,
            addressCountry: "SE",
          },
        }
      : {}),
    ...(visatTelefon ? { telephone: visatTelefon } : {}),
    ...(webb ? { url: webb } : {}),
    ...(f.epostadress ? { email: f.epostadress } : {}),
    ...(f.aeant ? { numberOfEmployees: f.aeant } : {}),
    ...(strukturSokord.length > 0
      ? {
          keywords: strukturSokord.join(", "),
          knowsAbout: strukturSokord.slice(0, 30),
        }
      : {}),
  };

  // FAQ — kontextuell, dynamisk
  const faqItems = buildFaq({ name, branschName, kommun: kommun?.name ?? null, f: fVisad, telefon: visatTelefon });
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };

  // Genererad beskrivning — neutral mening om vi saknar infotext
  const description = buildDescription({
    name,
    branschName,
    kommun: kommun?.name ?? null,
    f: fVisad,
    legalForm,
  });

  return (
    <div className="space-y-10">
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={localBusinessJsonLd} />
      <JsonLd data={faqJsonLd} />
      <Breadcrumb items={breadcrumbItems} />

      {/* ========= NAMN ========= */}
      <header className="flex items-start gap-4">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`${name} logotyp`}
            className="size-16 shrink-0 rounded-lg border border-[var(--rule)] bg-white object-contain p-1.5 sm:size-20"
          />
        )}
        <div className="min-w-0 space-y-2">
          <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2.25rem]">
            {name}
          </h1>
          <p className="text-[17px] text-[var(--text-muted)]">
            {branschEtikett && hubbHref ? (
              <Link href={hubbHref} className="font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline">
                {branschEtikett}
              </Link>
            ) : (
              branschEtikett
            )}
            {branschEtikett && kommun && <span aria-hidden> · </span>}
            {kommun && (
              <Link href={`/kommun/${kommun.slug}`} className="underline-offset-4 hover:text-[var(--brand-ink)] hover:underline">
                {kommun.name}
              </Link>
            )}
          </p>
          {markning && (
            <p>
              <ProfilEtikett markning={markning} />
            </p>
          )}
        </div>
      </header>

      {/* ========= KONTAKT — det besökaren kom för ========= */}
      <section aria-labelledby="kontakt-rubrik" className="rd-card p-5 sm:p-6">
        <h2 id="kontakt-rubrik" className="sr-only">
          Kontaktuppgifter
        </h2>
        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:gap-10">
          <div className="space-y-2">
            {visatTelefon ? (
              <a
                href={telHref(visatTelefon)}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-[var(--brand)] px-6 text-[19px] font-semibold text-white transition-colors hover:bg-[var(--brand-2)] sm:w-auto"
              >
                <Phone aria-hidden className="size-5" />
                {formatTelefon(visatTelefon)}
              </a>
            ) : (
              <p className="text-[16px] text-[var(--text-muted)]">Inget telefonnummer registrerat.</p>
            )}
          </div>

          <dl className="grid gap-x-8 gap-y-4 text-[16px] sm:grid-cols-2">
            <Uppgift ikon={<MapPin className="size-4" aria-hidden />} rubrik="Besöksadress">
              {fVisad.gatuadress || fVisad.postort ? (
                <>
                  <address className="not-italic text-[var(--text-strong)]">
                    {fVisad.gatuadress && <span className="block">{fVisad.gatuadress}</span>}
                    <span className="block">{[fVisad.postnr, fVisad.postort].filter(Boolean).join(" ")}</span>
                  </address>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="nofollow noopener"
                      className="mt-1 inline-flex items-center gap-1 text-[15px] text-[var(--brand-ink)] underline"
                    >
                      Visa på karta
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </>
              ) : (
                <span className="text-[var(--text-dim)]">Ingen adress registrerad</span>
              )}
            </Uppgift>
            {webbVisad && (
              <Uppgift ikon={<Globe className="size-4" aria-hidden />} rubrik="Webbplats">
                <a href={webbVisad} target="_blank" rel="nofollow noopener" className="break-all text-[var(--brand-ink)] underline">
                  {shortWebb(webbVisad)}
                </a>
              </Uppgift>
            )}
            {epostVisad && (
              <Uppgift ikon={<Mail className="size-4" aria-hidden />} rubrik="E-post">
                <a href={`mailto:${epostVisad}`} className="break-all text-[var(--brand-ink)] underline">
                  {epostVisad}
                </a>
              </Uppgift>
            )}
            {kontaktperson && (
              <Uppgift ikon={<User className="size-4" aria-hidden />} rubrik="Kontaktperson">
                <span className="text-[var(--text-strong)]">{kontaktperson}</span>
              </Uppgift>
            )}
          </dl>
        </div>
      </section>

      {/* ========= BESKRIVNING =========
          Kundens egen text när det finns en betald profil, annars registrets
          infotext eller den neutrala registermeningen — aldrig båda, så att
          sidan inte säger "Om …" två gånger. */}
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {overlay && (
            <SponsradProfil overlay={overlay} namn={name} utkast={Boolean(previewToken)} kompakt />
          )}

          {!egenText && (
            <section aria-labelledby="om-rubrik" className="space-y-3">
              <h2 id="om-rubrik" className="text-[1.375rem] font-semibold">
                Om {name}
              </h2>
              {sanitizedInfotext ? (
                <div
                  className="rd-rich-text max-w-[68ch] text-[17px] leading-relaxed text-[var(--text-body)]"
                  dangerouslySetInnerHTML={{ __html: sanitizedInfotext }}
                />
              ) : (
                <p className="max-w-[68ch] text-[17px] leading-relaxed text-[var(--text-body)]">{description}</p>
              )}
            </section>
          )}

          {strukturSokord.length > 0 && (
            <section aria-labelledby="sokord-rubrik" className="space-y-3">
              <h2 id="sokord-rubrik" className="text-[1.125rem] font-semibold">
                Tjänster och sökord
              </h2>
              <ul className="flex flex-wrap gap-2">
                {strukturSokord.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/sok?q=${encodeURIComponent(s)}`}
                      className="inline-flex min-h-9 items-center rounded-md border border-[var(--rule-strong)] px-3 text-[15px] text-[var(--text-body)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand-ink)]"
                    >
                      {s}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AkutNotis />
        </div>

        {/* ========= REGISTERFAKTA ========= */}
        <aside aria-labelledby="fakta-rubrik" className="space-y-3">
          <h2 id="fakta-rubrik" className="text-[1.125rem] font-semibold">
            Uppgifter i registret
          </h2>
          <dl className="divide-y divide-[var(--rule)] border-y border-[var(--rule)] text-[16px]">
            <Fakta rubrik="Organisationsnummer">
              {orgnrInfo?.kind === "orgnr" ? (
                <span className="tabular-nums">{orgnrInfo.value}</span>
              ) : orgnrInfo?.kind === "hidden" ? (
                <span className="text-[15px] text-[var(--text-muted)]">{orgnrInfo.value}</span>
              ) : null}
            </Fakta>
            <Fakta rubrik="Juridisk form">{legalForm}</Fakta>
            <Fakta rubrik={delarOrgnr(f.cfarnr) ? "Anställda i hela bolaget" : "Antal anställda"}>
              {f.aeant ? `ca ${f.aeant.toLocaleString("sv-SE")}` : null}
            </Fakta>
            <Fakta rubrik="Bransch">{branschName}</Fakta>
            <Fakta rubrik="Kommun">
              {kommun ? (
                <Link href={`/kommun/${kommun.slug}`} className="text-[var(--brand-ink)] underline">
                  {kommun.name}
                </Link>
              ) : null}
            </Fakta>
          </dl>
          <p className="text-[14px] text-[var(--text-dim)]">
            {personalOrgnr
              ? "Organisationsnumret visas inte eftersom det är ett personnummer (enskild firma). Uppgifterna kommer från offentliga register och SCB."
              : "Uppgifterna kommer från offentliga register och SCB."}
          </p>
        </aside>
      </div>

      {/* ========= LIKNANDE ========= */}
      {related.length > 0 && kommun && (
        <section aria-labelledby="liknande-rubrik" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="liknande-rubrik" className="text-[1.375rem] font-semibold">
              Fler {branschEtikett ? etikettIText(branschEtikett) : "verksamheter"} i {kommun.name}
            </h2>
            <Link
              href={hubbHref ?? `/kommun/${kommun.slug}`}
              className="inline-flex items-center gap-1 text-[16px] font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
            >
              Visa alla <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <CompanyCardList>
            {related.map((rf) => (
              <li key={rf.cfarnr}>
                <CompanyCard
                  foretag={rf}
                  overlay={overlayFor(rf, overlays)}
                  branschName={branschEtikett}
                  kommunName={kommun.name}
                />
              </li>
            ))}
          </CompanyCardList>
        </section>
      )}

      {/* ========= FRÅGOR ========= */}
      <section aria-labelledby="faq-rubrik" className="space-y-3">
        <h2 id="faq-rubrik" className="text-[1.375rem] font-semibold">
          Frågor och svar
        </h2>
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {faqItems.map((it, i) => (
            <details key={i} className="group py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-[17px] font-medium text-[var(--text-strong)]">
                {it.q}
                <span aria-hidden className="text-[22px] leading-none text-[var(--text-dim)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-[68ch] pb-4 text-[16px] leading-relaxed text-[var(--text-muted)]">{it.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

type FaqItem = { q: string; a: string };

function buildDescription({
  name,
  branschName,
  kommun,
  f,
  legalForm,
}: {
  name: string;
  branschName: string | null;
  kommun: string | null;
  f: Foretag;
  legalForm: string | null;
}): string {
  const segs: string[] = [];
  segs.push(
    `${name} är ${legalForm ? `ett ${legalForm.toLowerCase()}` : "registrerat"}${
      branschName
        ? ` verksamt inom ${branschName.toLowerCase()}`
        : ""
    }${kommun ? ` i ${kommun} kommun` : ""}.`,
  );
  if (f.aeant && f.aeant > 0) {
    segs.push(
      `Företaget har ca ${f.aeant.toLocaleString("sv-SE")} anställda enligt senast tillgängliga uppgifter.`,
    );
  }
  if (f.gatuadress) {
    segs.push(
      `Besöksadress: ${f.gatuadress}${f.postort ? `, ${f.postort}` : ""}.`,
    );
  }
  return segs.join(" ");
}

function buildFaq({
  name,
  branschName,
  kommun,
  f,
  telefon,
}: {
  name: string;
  branschName: string | null;
  kommun: string | null;
  f: Foretag;
  /** Numret sidan visar — visatTelefon(), aldrig f.tel. FAQ:n hamnar också i JSON-LD. */
  telefon: string | null;
}): FaqItem[] {
  const items: FaqItem[] = [];

  if (f.gatuadress || f.postort || kommun) {
    const addr =
      [f.gatuadress, [f.postnr, f.postort].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || kommun || "Sverige";
    items.push({
      q: `Var ligger ${name}?`,
      a: `${name} finns på ${addr}${
        kommun && !f.postort ? ` i ${kommun} kommun` : ""
      }.`,
    });
  }

  if (branschName) {
    items.push({
      q: `Vad gör ${name}?`,
      a: `${name} är verksamt inom ${branschName.toLowerCase()}${
        kommun ? ` i ${kommun}` : ""
      }. För att se andra företag i samma bransch kan du klicka på branschlänken ovan.`,
    });
  }

  if (telefon || f.epostadress || f.webb) {
    const ch: string[] = [];
    if (telefon) ch.push(`telefon ${telefon}`);
    if (f.epostadress) ch.push(`e-post ${f.epostadress}`);
    if (f.webb) ch.push(`hemsida ${f.webb}`);
    items.push({
      q: `Hur kontaktar jag ${name}?`,
      a: `Du når ${name} via ${ch.join(", ")}.`,
    });
  } else {
    items.push({
      q: `Hur kontaktar jag ${name}?`,
      a: `Vi har inga publika kontaktuppgifter för ${name} just nu. Företagsuppgifter kan ändras — kontrollera officiella register vid behov.`,
    });
  }

  if (f.aeant) {
    items.push({
      q: `Hur många anställda har ${name}?`,
      a: `${name} har cirka ${f.aeant.toLocaleString("sv-SE")} anställda enligt senast tillgängliga data.`,
    });
  }

  if (f.arEnskildFirma) {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `${name} är en enskild firma. Organisationsnumret är detsamma som ägarens personnummer och visas inte av integritetsskäl enligt GDPR.`,
    });
  } else if (f.orgnr) {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `Organisationsnumret för ${name} är ${f.orgnr}. Uppgiften kommer från officiella register.`,
    });
  } else {
    items.push({
      q: `Vad är organisationsnumret för ${name}?`,
      a: `Organisationsnumret för ${name} är inte tillgängligt i vår källa just nu. Du kan kontrollera det via Bolagsverket eller Skatteverket.`,
    });
  }

  return items;
}

function Uppgift({
  ikon,
  rubrik,
  children,
}: {
  ikon: React.ReactNode;
  rubrik: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-2 text-[14px] font-medium text-[var(--text-dim)]">
        {ikon}
        {rubrik}
      </dt>
      <dd className="pl-6">{children}</dd>
    </div>
  );
}

function Fakta({ rubrik, children }: { rubrik: string; children: React.ReactNode | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[var(--text-muted)]">{rubrik}</dt>
      <dd className="text-right text-[var(--text-strong)]">
        {children ?? <span className="text-[var(--text-dim)]">–</span>}
      </dd>
    </div>
  );
}

/**
 * Slår ihop två sökordslistor utan dubbletter, med den första listans ordning
 * och stavning bevarad. Jämförelsen är skiftlägesokänslig och trimmad.
 */
function slaIhopSokord(forst: string[], sedan: string[]): string[] {
  const ut: string[] = [];
  const sedda = new Set<string>();
  for (const ord of [...forst, ...sedan]) {
    const rent = ord.trim();
    if (!rent) continue;
    const nyckel = rent.toLowerCase();
    if (sedda.has(nyckel)) continue;
    sedda.add(nyckel);
    ut.push(rent);
  }
  return ut;
}
